import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The client's handling of who is signed in: where tokens live, when they are
 * renewed, and what a refusal looks like. fetch and localStorage are replaced,
 * so no server and no browser is needed.
 */

type Call = { url: string; auth: string | null }

function installStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  return store
}

/** A scripted server: each handler answers one request, in order, by URL prefix. */
function installFetch(handlers: Record<string, (call: Call, n: number) => Response>) {
  const calls: Call[] = []
  const counts: Record<string, number> = {}
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const headers = (init.headers ?? {}) as Record<string, string>
      const call = { url, auth: headers.Authorization ?? null }
      calls.push(call)
      const key = Object.keys(handlers).find((k) => url.startsWith(k))
      if (!key) throw new Error(`unexpected request to ${url}`)
      counts[key] = (counts[key] ?? 0) + 1
      return handlers[key](call, counts[key])
    }),
  )
  return calls
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const session = (token: string) => ({
  accessToken: token,
  role: 'CAREGIVER',
  userId: 'u1',
  name: 'Rupa',
  status: 'ACTIVE',
  patientIds: ['p1'],
})

async function freshApi() {
  vi.resetModules()
  return await import('./api')
}

let store: Map<string, string>

beforeEach(() => {
  store = installStorage()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('where credentials live', () => {
  it('a signed-in person’s access token is never written to storage', async () => {
    installFetch({ '/api/auth/login': () => json(200, session('access-1')) })
    const { auth, getAccessToken } = await freshApi()
    await auth.login('a@example.com', 'a-long-password')
    expect(getAccessToken()).toBe('access-1')
    expect([...store.values()].join()).not.toContain('access-1')
    expect(store.size).toBe(0)
  })

  it('a tablet’s device token is kept in storage and used when no one is signed in', async () => {
    const calls = installFetch({ '/api/patient/': () => json(200, { ok: true }) })
    const { setDeviceToken, patients } = await freshApi()
    setDeviceToken('device-1')
    expect(store.get('smaran.deviceToken')).toBe('device-1')
    await patients.profile('p1')
    expect(calls[0].auth).toBe('Bearer device-1')
  })

  it('a signed-in person’s token wins over the tablet’s', async () => {
    installFetch({ '/api/auth/login': () => json(200, session('access-1')), '/api/patients': () => json(200, []) })
    const calls = installFetch({
      '/api/auth/login': () => json(200, session('access-1')),
      '/api/patients': () => json(200, []),
    })
    const { auth, setDeviceToken, patients } = await freshApi()
    setDeviceToken('device-1')
    await auth.login('a@example.com', 'a-long-password')
    await patients.mine()
    expect(calls.at(-1)?.auth).toBe('Bearer access-1')
  })

  it('a tablet paired under the old storage name keeps working', async () => {
    store.set('smaran.token', 'old-device-token')
    const { getDeviceToken } = await freshApi()
    expect(getDeviceToken()).toBe('old-device-token')
    expect(store.get('smaran.deviceToken')).toBe('old-device-token')
    expect(store.has('smaran.token')).toBe(false)
  })
})

describe('renewing a session', () => {
  it('an expired access token is renewed once and the request is retried with the new one', async () => {
    const calls = installFetch({
      '/api/auth/login': () => json(200, session('access-1')),
      '/api/auth/refresh': () => json(200, session('access-2')),
      '/api/patients': (_c, n) => (n === 1 ? new Response(null, { status: 401 }) : json(200, [{ id: 'p1' }])),
    })
    const { auth, patients } = await freshApi()
    await auth.login('a@example.com', 'a-long-password')
    const mine = await patients.mine()
    expect(mine).toEqual([{ id: 'p1' }])
    const patientCalls = calls.filter((c) => c.url.startsWith('/api/patients'))
    expect(patientCalls.map((c) => c.auth)).toEqual(['Bearer access-1', 'Bearer access-2'])
    expect(calls.filter((c) => c.url === '/api/auth/refresh')).toHaveLength(1)
  })

  it('many requests expiring together share one renewal, because a refresh token is single use', async () => {
    let renewed = false
    const calls = installFetch({
      '/api/auth/login': () => json(200, session('access-1')),
      '/api/auth/refresh': () => {
        renewed = true
        return json(200, session('access-2'))
      },
      '/api/patients': (call) => (call.auth === 'Bearer access-2' ? json(200, []) : new Response(null, { status: 401 })),
    })
    const { auth, patients } = await freshApi()
    await auth.login('a@example.com', 'a-long-password')
    await Promise.all([patients.mine(), patients.mine(), patients.mine(), patients.mine()])
    expect(renewed).toBe(true)
    expect(calls.filter((c) => c.url === '/api/auth/refresh')).toHaveLength(1)
  })

  it('a tablet is never renewed: a 401 for its token is just a refusal', async () => {
    const calls = installFetch({ '/api/patients': () => new Response(null, { status: 401 }) })
    const { setDeviceToken, patients, HttpError } = await freshApi()
    setDeviceToken('device-1')
    await expect(patients.mine()).rejects.toBeInstanceOf(HttpError)
    expect(calls.some((c) => c.url === '/api/auth/refresh')).toBe(false)
  })

  it('when renewal fails the person is signed out and the 401 is reported, not retried forever', async () => {
    const calls = installFetch({
      '/api/auth/login': () => json(200, session('access-1')),
      '/api/auth/refresh': () => new Response(null, { status: 401 }),
      '/api/patients': () => new Response(null, { status: 401 }),
    })
    const { auth, patients, getAccessToken } = await freshApi()
    await auth.login('a@example.com', 'a-long-password')
    await expect(patients.mine()).rejects.toMatchObject({ status: 401 })
    expect(getAccessToken()).toBeNull()
    expect(calls.filter((c) => c.url === '/api/auth/refresh')).toHaveLength(1)
  })

  it('logging out forgets the access token even if the server cannot be reached', async () => {
    installFetch({
      '/api/auth/login': () => json(200, session('access-1')),
      '/api/auth/logout': () => {
        throw new TypeError('network down')
      },
    })
    const { auth, getAccessToken } = await freshApi()
    await auth.login('a@example.com', 'a-long-password')
    await expect(auth.logout()).rejects.toBeDefined()
    expect(getAccessToken()).toBeNull()
  })
})

describe('what a refusal looks like', () => {
  it('carries the sentence the server wrote for a person', async () => {
    installFetch({ '/api/auth/register': () => json(400, { message: 'Use at least 10 characters.' }) })
    const { auth } = await freshApi()
    await expect(
      auth.register({ name: 'A', email: 'a@example.com', password: 'short', role: 'CAREGIVER' }),
    ).rejects.toMatchObject({ status: 400, message: 'Use at least 10 characters.' })
  })

  it('falls back to the status line when there is no body', async () => {
    installFetch({ '/api/auth/login': () => new Response(null, { status: 401, statusText: 'Unauthorized' }) })
    const { auth } = await freshApi()
    await expect(auth.login('a@example.com', 'x')).rejects.toMatchObject({ status: 401, message: '401 Unauthorized' })
  })

  it('a dashboard the server refuses is a refusal, never sample data or a stale copy', async () => {
    installFetch({ '/api/caregiver/dashboard/': () => new Response(null, { status: 404 }) })
    const { caregiver } = await freshApi()
    // Without an IndexedDB the cache cannot answer; a refusal must not reach it anyway.
    expect(await caregiver.dashboard('p-gone')).toEqual({ kind: 'denied', status: 404 })
  })

  it('a dashboard with no server to ask is reported as offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('network down')
    }))
    const { caregiver } = await freshApi()
    expect(await caregiver.dashboard('p1')).toEqual({ kind: 'offline' })
  })
})
