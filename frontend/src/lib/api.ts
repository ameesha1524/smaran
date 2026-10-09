/**
 * Every call the app makes to Spring Boot.
 *
 * The contract with the rest of the app: a call never throws because the network
 * is gone. Reads fall back to the IndexedDB cache; writes queue and return a
 * local echo. The patient must not be able to tell whether she is online.
 */

import type {
  AcousticVector,
  DashboardSummary,
  FamilyMember,
  GameRoute,
  GameSession,
  GardenState,
  MeaningfulObject,
  DeviceMe,
  PairedDevice,
  PairingCode,
  Patient,
  RedeemResult,
  ReminderSchedule,
} from './types'
import { cacheGet, cacheSet, get, getAll, getDeviceFingerprint, put, remove } from './db'

/**
 * Two kinds of credential, kept apart on purpose.
 *
 * A person who signs in (family, doctor, admin) gets a short-lived access token
 * that lives only in this module's memory, never in storage. It is renewed from
 * an HttpOnly cookie the browser holds and scripts cannot read, so a stolen page
 * script cannot walk away with a long-lived secret.
 *
 * A paired tablet holds a long-lived device token in localStorage. It has no
 * person to sign in and no cookie; the family removes the tablet instead.
 */
const DEVICE_KEY = 'smaran.deviceToken'
const LEGACY_DEVICE_KEY = 'smaran.token'

let accessToken: string | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

export function setDeviceToken(token: string) {
  localStorage.setItem(DEVICE_KEY, token)
}

export function clearDeviceToken() {
  localStorage.removeItem(DEVICE_KEY)
  localStorage.removeItem(LEGACY_DEVICE_KEY)
}

export function getDeviceToken(): string | null {
  // A tablet paired before the two were separated stored its token under the old name.
  const legacy = localStorage.getItem(LEGACY_DEVICE_KEY)
  if (legacy && !localStorage.getItem(DEVICE_KEY)) {
    localStorage.setItem(DEVICE_KEY, legacy)
    localStorage.removeItem(LEGACY_DEVICE_KEY)
  }
  return localStorage.getItem(DEVICE_KEY)
}

/*
 * A person's calls and a tablet's calls never share a credential. A caregiver who
 * signs in on the tablet's browser does not turn the tablet into a caregiver, and
 * the tablet's token is never sent to a person's endpoint.
 */

export class OfflineError extends Error {
  constructor() {
    super('offline')
  }
}

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token = accessToken
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  }
  if (token) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(path, { ...init, headers })
  } catch {
    throw new OfflineError()
  }

  // A person's access token lasts 15 minutes. Renew it once from the cookie
  // and try again. A tablet's token is never renewed: a 401 there means the
  // family removed it, and the caller falls back to its offline copy.
  if (res.status === 401 && accessToken !== null && !retried) {
    if (await refreshSession()) return request<T>(path, init, true)
  }
  if (!res.ok) throw await HttpError.from(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** A non-2xx answer, with the sentence the server wrote for a person, if it wrote one. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }

  static async from(res: Response): Promise<HttpError> {
    let message = `${res.status} ${res.statusText}`.trim()
    try {
      const body = (await res.clone().json()) as { message?: string }
      if (body && typeof body.message === 'string') message = body.message
    } catch {
      /* no body, or not JSON: the status line will do */
    }
    return new HttpError(res.status, message)
  }
}

/* ------------------------------------------------- a paired tablet's calls */

const SUSPENDED_KEY = 'smaran.deviceSuspendedAt'
/** While suspended, ask the server again this often, in case the refusal was a mistake. */
const PROBE_EVERY_MS = 60 * 60 * 1000

/**
 * Has the server stopped honouring this tablet's token?
 *
 * When the family removes a tablet, its next request is refused. The tablet
 * must not announce that to her: it goes quiet, keeps everything she has, and
 * behaves exactly as if it were offline. It still asks again once an hour, so a
 * refusal that was a mistake mends itself. Pairing again clears it.
 */
export function deviceSuspended(): boolean {
  return localStorage.getItem(SUSPENDED_KEY) !== null
}

function markSuspended() {
  localStorage.setItem(SUSPENDED_KEY, String(Date.now()))
}

export function clearSuspended() {
  localStorage.removeItem(SUSPENDED_KEY)
}

function suspendedAndNotDueToProbe(): boolean {
  const at = Number(localStorage.getItem(SUSPENDED_KEY))
  return Number.isFinite(at) && at > 0 && Date.now() - at < PROBE_EVERY_MS
}

/**
 * A call on the tablet's own surface, /api/device/**. It carries the tablet's
 * token and nothing else. A refusal (401 or 403) is not shown to her: it
 * suspends the tablet's talking to the server and is reported as "offline", so
 * reads fall back to what she already has and writes are queued.
 */
async function deviceRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getDeviceToken()
  if (!token || suspendedAndNotDueToProbe()) throw new OfflineError()

  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...((init.headers as Record<string, string>) ?? {}),
        Authorization: `Bearer ${token}`,
      },
    })
  } catch {
    throw new OfflineError()
  }
  if (res.status === 401 || res.status === 403) {
    markSuspended()
    throw new OfflineError()
  }
  if (!res.ok) throw await HttpError.from(res)
  clearSuspended()
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

let refreshing: Promise<AuthSession | null> | null = null

/**
 * Trade the refresh cookie for a new access token.
 *
 * One at a time: a second caller waits for the first and shares its answer.
 * Refresh tokens rotate, so two parallel refreshes would present the same
 * token twice, which the server treats as theft and answers by ending the
 * session.
 */
export function refreshSession(): Promise<AuthSession | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
        if (!res.ok) {
          accessToken = null
          return null
        }
        const session = (await res.json()) as AuthSession
        accessToken = session.accessToken
        return session
      } catch {
        return null
      } finally {
        refreshing = null
      }
    })()
  }
  return refreshing
}

/** Read-through for the tablet: network first, cache second, never an error screen. */
async function cachedDeviceGet<T>(path: string, cacheKey: string): Promise<T | undefined> {
  try {
    const fresh = await deviceRequest<T>(path)
    await cacheSet(cacheKey, fresh)
    return fresh
  } catch {
    return await cacheGet<T>(cacheKey)
  }
}

/* --------------------------------------------------------------- auth */

export type UserRole = 'CAREGIVER' | 'DOCTOR' | 'ADMIN'

export interface AuthSession {
  accessToken: string
  role: UserRole
  userId: string
  name: string
  status: string
  patientIds: string[]
}

export interface RegisterResult {
  userId: string
  status: string
  message: string
  session: AuthSession | null
}

async function authCall<T>(path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new OfflineError()
  }
  if (!res.ok) throw await HttpError.from(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const auth = {
  login: async (email: string, password: string) => {
    const session = await authCall<AuthSession>('/api/auth/login', { email, password })
    accessToken = session.accessToken
    return session
  },
  register: async (input: { name: string; email: string; password: string; role: 'CAREGIVER' | 'DOCTOR' }) => {
    const result = await authCall<RegisterResult>('/api/auth/register', input)
    if (result.session) accessToken = result.session.accessToken
    return result
  },
  logout: async () => {
    try {
      await authCall<void>('/api/auth/logout')
    } finally {
      accessToken = null
    }
  },
  me: () =>
    request<{ userId: string; name: string; email: string; role: UserRole; status: string; patientIds: string[] }>(
      '/api/auth/me',
    ),
}

/* ------------------------------------------------------------ patient */

/** What the tablet knows of its own patient, and the one thing it may change about her. */
export const device = {
  me: () => cachedDeviceGet<DeviceMe>('/api/device/me', 'me'),
  setLanguage: (languageCode: string) =>
    deviceRequest<DeviceMe>('/api/device/me', { method: 'PATCH', body: JSON.stringify({ languageCode }) }),
}

/** The family's side: setting a patient up and adding her. */
export const patients = {
  update: (id: string, patch: Partial<Patient>) =>
    request<Patient>(`/api/patient/${id}/profile`, { method: 'PATCH', body: JSON.stringify(patch) }),
  /** A caregiver adds the person they care for. The guardian's consent is part of the request, and required. */
  create: (body: NewPatient) => request<Patient>('/api/patients', { method: 'POST', body: JSON.stringify(body) }),
  mine: () => request<Patient[]>('/api/patients'),
}

/* -------------------------------------------------------------- games */

// The tablet's calls name no patient: the server reads her from the token.
export const games = {
  route: (patientId: string) => cachedDeviceGet<GameRoute>('/api/device/game/route', `route:${patientId}`),
  objects: (patientId: string) => cachedDeviceGet<MeaningfulObject[]>('/api/device/objects', `objects:${patientId}`),
}

/* ----------------------------------------------------------- sessions */

/**
 * Submit a finished session. If the network is gone the session is written to
 * `pending_sessions` and a Background Sync is requested; the garden still blooms
 * locally, and the family is notified whenever the signal returns.
 */
export async function submitSession(session: GameSession): Promise<{ queued: boolean }> {
  try {
    await deviceRequest('/api/device/sessions', { method: 'POST', body: JSON.stringify(session) })
    return { queued: false }
  } catch {
    await put('pending_sessions', session)
    await requestBackgroundSync()
    return { queued: true }
  }
}

/* ------------------------------------------------------------- garden */

export const garden = {
  async state(patientId: string): Promise<GardenState | undefined> {
    try {
      const fresh = await deviceRequest<GardenState>('/api/device/garden')
      await put('garden_state', fresh)
      return fresh
    } catch {
      return await get<GardenState>('garden_state', patientId)
    }
  },

  /** Watering is the only "score" in Smaran, and it is a flower, not a number. */
  async water(patientId: string, gameType: string): Promise<GardenState | undefined> {
    try {
      const fresh = await deviceRequest<GardenState>('/api/device/garden/water', {
        method: 'POST',
        body: JSON.stringify({ gameType, at: new Date().toISOString() }),
      })
      await put('garden_state', fresh)
      return fresh
    } catch {
      await put('pending_blooms', { patientId, gameType, at: new Date().toISOString() })
      await requestBackgroundSync()
      return await get<GardenState>('garden_state', patientId)
    }
  },
}

/* ------------------------------------------------------------- family */

export const family = {
  async members(patientId: string): Promise<FamilyMember[]> {
    try {
      const fresh = await deviceRequest<FamilyMember[]>('/api/device/family/members')
      await put('family_members', { patientId, members: fresh })
      return fresh
    } catch {
      const row = await get<{ patientId: string; members: FamilyMember[] }>('family_members', patientId)
      return row?.members ?? []
    }
  },
  add: (patientId: string, body: FormData) =>
    fetch(`/api/family/${patientId}/member`, {
      method: 'POST',
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      body,
    }).then((r) => {
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<FamilyMember>
    }),
  /** Correct recognition tells the backend to advance this member's phase. */
  recognised: (_patientId: string, memberId: string, correct: boolean, latencyMs: number) =>
    deviceRequest(`/api/device/family/members/${encodeURIComponent(memberId)}/result`, {
      method: 'POST',
      body: JSON.stringify({ correct, latencyMs }),
    }).catch(() => undefined),
}

/* ---------------------------------------------------------- biomarker */

export async function submitVector(vector: AcousticVector): Promise<void> {
  try {
    await deviceRequest('/api/device/biomarker/vector', { method: 'POST', body: JSON.stringify(vector) })
  } catch {
    await put('pending_vectors', vector)
    await requestBackgroundSync()
  }
}

/* ---------------------------------------------------------- reminders */

export const reminders = {
  schedule: (patientId: string) => cachedDeviceGet<ReminderSchedule[]>('/api/device/reminders', `reminders:${patientId}`),
  save: (patientId: string, list: ReminderSchedule[]) =>
    request<ReminderSchedule[]>(`/api/reminder/${patientId}/schedule`, {
      method: 'PUT',
      body: JSON.stringify(list),
    }),
  test: (patientId: string) => request('/api/reminder/trigger', { method: 'POST', body: JSON.stringify({ patientId }) }),
}

/* ---------------------------------------------------------- caregiver */

/** What asking for a dashboard can come to: the data, a refusal, or no server to ask. */
export type DashboardResult =
  | { kind: 'ok'; data: DashboardSummary }
  | { kind: 'denied'; status: 401 | 403 | 404 }
  | { kind: 'offline' }

export interface NewPatient {
  name: string
  languageCode?: string
  kinshipTerm?: string
  region?: string
  guardianConsent: boolean
  guardianName?: string
}

export interface DoctorGrant {
  id: string
  patientId: string
  doctorName: string | null
  doctorEmail: string | null
  grantedAt: string
  expiresAt: string
  revokedAt: string | null
  live: boolean
}

export interface AuditEntry {
  id: number
  at: string
  actorType: string
  actorId: string | null
  action: string
  resource: string | null
}

export interface SharedPatient {
  patientId: string
  name: string
  sharedUntil: string
}

export interface AdminUser {
  id: string
  name: string
  email: string
  role: string
  status: string
  createdAt: string
  lastLoginAt: string | null
}

export const caregiver = {
  /**
   * A refusal is shown as a refusal, never papered over with sample data: a
   * doctor whose access ended must not be shown a plausible-looking week.
   * Sample data is only for "there is no server here at all".
   */
  dashboard: async (patientId: string): Promise<DashboardResult> => {
    try {
      const data = await request<DashboardSummary>(`/api/caregiver/dashboard/${patientId}`)
      await cacheSet(`dashboard:${patientId}`, data)
      return { kind: 'ok', data }
    } catch (e) {
      if (e instanceof HttpError && (e.status === 401 || e.status === 403 || e.status === 404)) {
        return { kind: 'denied', status: e.status }
      }
      const cached = await cacheGet<DashboardSummary>(`dashboard:${patientId}`)
      return cached ? { kind: 'ok', data: cached } : { kind: 'offline' }
    }
  },
  /**
   * The doctor's PDF. A plain link cannot carry the sign-in header, so this
   * fetches it with the token and hands back the file.
   */
  report: async (patientId: string): Promise<Blob> => {
    const send = () =>
      fetch(`/api/report/patient/${patientId}`, { headers: { Authorization: `Bearer ${accessToken ?? ''}` } })
    let res = await send()
    if (res.status === 401 && getAccessToken() !== null && (await refreshSession())) res = await send()
    if (!res.ok) throw await HttpError.from(res)
    return res.blob()
  },
  saveObjects: (patientId: string, objects: MeaningfulObject[]) =>
    request<MeaningfulObject[]>(`/api/patient/${patientId}/objects`, {
      method: 'PUT',
      body: JSON.stringify(objects),
    }),
  grants: (patientId: string) => request<DoctorGrant[]>(`/api/patients/${patientId}/doctor-grants`),
  grant: (patientId: string, doctorEmail: string, days: number) =>
    request<DoctorGrant>(`/api/patients/${patientId}/doctor-grants`, {
      method: 'POST',
      body: JSON.stringify({ doctorEmail, days }),
    }),
  revokeGrant: (patientId: string, grantId: string) =>
    request<void>(`/api/patients/${patientId}/doctor-grants/${grantId}`, { method: 'DELETE' }),
  audit: (patientId: string, limit = 30) => request<AuditEntry[]>(`/api/patients/${patientId}/audit?limit=${limit}`),
}

export const doctor = {
  patients: () => request<SharedPatient[]>('/api/doctor/patients'),
}

export const admin = {
  users: (status?: string) => request<AdminUser[]>(`/api/admin/users${status ? `?status=${status}` : ''}`),
  approve: (id: string) => request<AdminUser>(`/api/admin/users/${id}/approve`, { method: 'POST' }),
  disable: (id: string) => request<AdminUser>(`/api/admin/users/${id}/disable`, { method: 'POST' }),
}

/* ------------------------------------------------------------ pairing */

/** Why a pairing call failed, in terms the screen can turn into a sentence. */
export type PairingFailure = 'offline' | 'invalid' | 'rate-limited' | 'forbidden' | 'unknown'

export class PairingError extends Error {
  constructor(readonly reason: PairingFailure) {
    super(reason)
  }
}

/**
 * Pairing is the one flow that must not fall back to a cache or a queue: a
 * code either works now, against the server, or it doesn't. So these calls
 * throw a PairingError the screen can explain, instead of going through
 * `request` and its quiet offline behaviour.
 */
async function pairingCall<T>(path: string, init: RequestInit = {}, asPerson = true, retried = false): Promise<T> {
  // The family's calls carry the signed-in person's token. Redeeming carries
  // none, even if a person happens to be signed in on this browser: the code is
  // the credential.
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (asPerson && accessToken) headers.Authorization = `Bearer ${accessToken}`
  let res: Response
  try {
    res = await fetch(path, { ...init, headers })
  } catch {
    throw new PairingError('offline')
  }
  // The family's token lasts fifteen minutes; renew it once, as every other call does.
  if (asPerson && res.status === 401 && accessToken !== null && !retried && (await refreshSession())) {
    return pairingCall<T>(path, init, asPerson, true)
  }
  if (res.status === 429) throw new PairingError('rate-limited')
  if (res.status === 400 || res.status === 404 || res.status === 410) throw new PairingError('invalid')
  if (res.status === 401 || res.status === 403) throw new PairingError('forbidden')
  // A dev proxy with no backend behind it answers 5xx rather than failing the fetch.
  if (res.status >= 500) throw new PairingError('offline')
  if (!res.ok) throw new PairingError('unknown')
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const pairing = {
  /** Family side: a fresh one-time code. Any earlier unused code stops working. */
  createCode: (patientId: string) =>
    pairingCall<PairingCode>(`/api/patients/${encodeURIComponent(patientId)}/pairing-codes`, { method: 'POST' }),
  /** Family side: tablets currently holding a live device token. */
  devices: (patientId: string) =>
    pairingCall<PairedDevice[]>(`/api/patients/${encodeURIComponent(patientId)}/devices`),
  revoke: (patientId: string, deviceId: string) =>
    pairingCall<void>(
      `/api/patients/${encodeURIComponent(patientId)}/devices/${encodeURIComponent(deviceId)}`,
      { method: 'DELETE' },
    ),
  /** Tablet side: trade a code for a device token. Works without being signed in. */
  redeem: async (code: string, deviceLabel: string) =>
    pairingCall<RedeemResult>(
      '/api/pairing/redeem',
      { method: 'POST', body: JSON.stringify({ code, deviceLabel, deviceFingerprint: await getDeviceFingerprint() }) },
      false,
    ),
}

/* --------------------------------------------------------------- sync */

export interface SyncOutcome {
  sessions: number
  vectors: number
  blooms: number
  ok: boolean
}

/**
 * Drain everything the device has been holding. Called on reconnect, on app
 * open, and by the Service Worker's Background Sync handler.
 */
export async function syncNow(patientId: string): Promise<SyncOutcome> {
  const sessions = await getAll<GameSession>('pending_sessions')
  const vectors = await getAll<AcousticVector>('pending_vectors')
  const blooms = await getAll<{ id: number; patientId: string; gameType: string; at: string }>('pending_blooms')

  if (!sessions.length && !vectors.length && !blooms.length) {
    await put('sync_meta', { patientId, lastSynced: Date.now(), queueDepth: 0 })
    return { sessions: 0, vectors: 0, blooms: 0, ok: true }
  }

  try {
    await deviceRequest('/api/device/sessions/batch', {
      method: 'POST',
      body: JSON.stringify({ sessions, vectors, blooms }),
    })
  } catch {
    return { sessions: sessions.length, vectors: vectors.length, blooms: blooms.length, ok: false }
  }

  // Only clear what we actually sent — a session queued mid-sync survives.
  for (const s of sessions) await remove('pending_sessions', [s.patientId, s.startedAt])
  for (const v of vectors) await remove('pending_vectors', [v.patientId, v.capturedAt])
  for (const b of blooms) await remove('pending_blooms', b.id)

  await put('sync_meta', { patientId, lastSynced: Date.now(), queueDepth: 0 })
  return { sessions: sessions.length, vectors: vectors.length, blooms: blooms.length, ok: true }
}

export async function lastSynced(patientId: string): Promise<number | null> {
  const row = await get<{ patientId: string; lastSynced: number }>('sync_meta', patientId)
  return row?.lastSynced ?? null
}

async function requestBackgroundSync() {
  try {
    const reg = await navigator.serviceWorker?.ready
    // `sync` is not in the base TS lib; the capability is feature-detected.
    const sync = (reg as unknown as { sync?: { register(tag: string): Promise<void> } })?.sync
    await sync?.register('smaran-sync')
  } catch {
    /* Background Sync unsupported — syncNow() on next app open covers it. */
  }
}

/* -------------------------------------------- federated learning (ph. 2) */

export async function uploadGradients(payload: { deviceId: string; patientId: string; modelVersion: string; cipher: string }) {
  return deviceRequest<{ modelVersion: string; weights: number[] }>('/api/device/fl/gradients', {
    method: 'POST',
    body: JSON.stringify(payload),
  }).catch(() => undefined)
}
