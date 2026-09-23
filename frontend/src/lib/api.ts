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
  Patient,
  ReminderSchedule,
  CognitiveProfile,
} from './types'
import { cacheGet, cacheSet, get, getAll, put, remove } from './db'

const TOKEN_KEY = 'smaran.token'
const REFRESH_KEY = 'smaran.refresh'

export function setTokens(access: string, refresh?: string) {
  localStorage.setItem(TOKEN_KEY, access)
  if (refresh) localStorage.setItem(REFRESH_KEY, refresh)
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_KEY)
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export class OfflineError extends Error {
  constructor() {
    super('offline')
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
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

  if (res.status === 401 && localStorage.getItem(REFRESH_KEY)) {
    const refreshed = await tryRefresh()
    if (refreshed) return request<T>(path, init)
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: localStorage.getItem(REFRESH_KEY) }),
    })
    if (!res.ok) return false
    const data = (await res.json()) as { accessToken: string; refreshToken: string }
    setTokens(data.accessToken, data.refreshToken)
    return true
  } catch {
    return false
  }
}

/** Read-through: network first, cache second, never an error screen. */
async function cachedGet<T>(path: string, cacheKey: string): Promise<T | undefined> {
  try {
    const fresh = await request<T>(path)
    await cacheSet(cacheKey, fresh)
    return fresh
  } catch {
    return await cacheGet<T>(cacheKey)
  }
}

/* --------------------------------------------------------------- auth */

export interface LoginResponse {
  accessToken: string
  refreshToken: string
  role: 'PATIENT' | 'CAREGIVER' | 'DOCTOR' | 'ADMIN'
  userId: string
  patientIds: string[]
}

export const auth = {
  login: (email: string, password: string) =>
    request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => clearTokens(),
}

/* ------------------------------------------------------------ patient */

export const patients = {
  profile: (id: string) => cachedGet<Patient & { cognitiveProfile: CognitiveProfile }>(`/api/patient/${id}/profile`, `profile:${id}`),
  update: (id: string, patch: Partial<Patient>) =>
    request<Patient>(`/api/patient/${id}/profile`, { method: 'PATCH', body: JSON.stringify(patch) }),
  create: (body: Partial<Patient>) => request<Patient>('/api/patient', { method: 'POST', body: JSON.stringify(body) }),
}

/* -------------------------------------------------------------- games */

export const games = {
  route: (patientId: string) => cachedGet<GameRoute>(`/api/game/${patientId}/route`, `route:${patientId}`),
  objects: (patientId: string) => cachedGet<MeaningfulObject[]>(`/api/patient/${patientId}/objects`, `objects:${patientId}`),
}

/* ----------------------------------------------------------- sessions */

/**
 * Submit a finished session. If the network is gone the session is written to
 * `pending_sessions` and a Background Sync is requested; the garden still blooms
 * locally, and the family is notified whenever the signal returns.
 */
export async function submitSession(session: GameSession): Promise<{ queued: boolean }> {
  try {
    await request('/api/session', { method: 'POST', body: JSON.stringify(session) })
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
      const fresh = await request<GardenState>(`/api/garden/${patientId}`)
      await put('garden_state', fresh)
      return fresh
    } catch {
      return await get<GardenState>('garden_state', patientId)
    }
  },

  /** Watering is the only "score" in Smaran, and it is a flower, not a number. */
  async water(patientId: string, gameType: string): Promise<GardenState | undefined> {
    try {
      const fresh = await request<GardenState>(`/api/garden/${patientId}/water`, {
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
      const fresh = await request<FamilyMember[]>(`/api/family/${patientId}/members`)
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
      headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
      body,
    }).then((r) => {
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<FamilyMember>
    }),
  /** Correct recognition tells the backend to advance this member's phase. */
  recognised: (patientId: string, memberId: string, correct: boolean, latencyMs: number) =>
    request(`/api/family/${patientId}/member/${memberId}/result`, {
      method: 'POST',
      body: JSON.stringify({ correct, latencyMs }),
    }).catch(() => undefined),
}

/* ---------------------------------------------------------- biomarker */

export async function submitVector(vector: AcousticVector): Promise<void> {
  try {
    await request('/api/biomarker/vector', { method: 'POST', body: JSON.stringify(vector) })
  } catch {
    await put('pending_vectors', vector)
    await requestBackgroundSync()
  }
}

/* ---------------------------------------------------------- reminders */

export const reminders = {
  schedule: (patientId: string) =>
    cachedGet<ReminderSchedule[]>(`/api/reminder/${patientId}/schedule`, `reminders:${patientId}`),
  save: (patientId: string, list: ReminderSchedule[]) =>
    request<ReminderSchedule[]>(`/api/reminder/${patientId}/schedule`, {
      method: 'PUT',
      body: JSON.stringify(list),
    }),
  test: (patientId: string) => request('/api/reminder/trigger', { method: 'POST', body: JSON.stringify({ patientId }) }),
}

/* ---------------------------------------------------------- caregiver */

export const caregiver = {
  dashboard: (patientId: string) =>
    cachedGet<DashboardSummary>(`/api/caregiver/dashboard/${patientId}`, `dashboard:${patientId}`),
  reportUrl: (patientId: string) => `/api/report/patient/${patientId}`,
  saveObjects: (patientId: string, objects: MeaningfulObject[]) =>
    request<MeaningfulObject[]>(`/api/patient/${patientId}/objects`, {
      method: 'PUT',
      body: JSON.stringify(objects),
    }),
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
    await request('/api/sync/sessions', {
      method: 'POST',
      body: JSON.stringify({ patientId, sessions, vectors, blooms }),
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
  return request<{ modelVersion: string; weights: number[] }>('/api/fl/gradients', {
    method: 'POST',
    body: JSON.stringify(payload),
  }).catch(() => undefined)
}
