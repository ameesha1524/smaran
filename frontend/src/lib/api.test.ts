import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The client's handling of who is signed in: where tokens live, when they are
 * renewed, and what a refusal looks like. fetch and localStorage are replaced,
 * so no server and no browser is needed.
 */

type Call = { url: string; auth: string | null; body: string | null }

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
      const call = { url, auth: headers.Authorization ?? null, body: typeof init.body === 'string' ? init.body : null }
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

  it('a tablet’s device token is kept in storage and sent to the tablet’s own endpoints', async () => {
    const calls = installFetch({ '/api/device/me': () => json(200, { patientId: 'p1' }) })
    const { setDeviceToken, device } = await freshApi()
    setDeviceToken('device-1')
    expect(store.get('smaran.deviceToken')).toBe('device-1')
    await device.me()
    expect(calls[0].auth).toBe('Bearer device-1')
  })

  it('a person’s calls and a tablet’s calls never share a credential', async () => {
    const calls = installFetch({
      '/api/auth/login': () => json(200, session('access-1')),
      '/api/patients': () => json(200, []),
      '/api/device/me': () => json(200, { patientId: 'p1' }),
    })
    const { auth, setDeviceToken, patients, device } = await freshApi()
    setDeviceToken('device-1')
    await auth.login('a@example.com', 'a-long-password')
    await patients.mine()
    await device.me()
    expect(calls.find((c) => c.url === '/api/patients')?.auth).toBe('Bearer access-1')
    expect(calls.find((c) => c.url === '/api/device/me')?.auth).toBe('Bearer device-1')
  })

  it('a person who is not signed in sends no credential, even on a tablet that holds one', async () => {
    const calls = installFetch({ '/api/patients': () => new Response(null, { status: 401 }) })
    const { setDeviceToken, patients } = await freshApi()
    setDeviceToken('device-1')
    await expect(patients.mine()).rejects.toMatchObject({ status: 401 })
    expect(calls[0].auth).toBeNull()
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

  it('a tablet is never renewed: a refusal of its token is never answered with a refresh', async () => {
    const calls = installFetch({ '/api/device/me': () => new Response(null, { status: 401 }) })
    const { setDeviceToken, device } = await freshApi()
    setDeviceToken('device-1')
    await device.me()
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

describe('a tablet the family has removed', () => {
  it('goes quiet: no error reaches her, it keeps what it has, and it stops asking', async () => {
    const calls = installFetch({ '/api/device/': () => new Response(null, { status: 401 }) })
    const { setDeviceToken, device, deviceSuspended } = await freshApi()
    setDeviceToken('device-1')

    // The refusal is reported as "no answer", so the caller falls back to its copy.
    await expect(device.me()).resolves.toBeUndefined()
    expect(deviceSuspended()).toBe(true)
    expect(calls).toHaveLength(1)

    await device.me()
    await device.me()
    expect(calls, 'no further requests while suspended').toHaveLength(1)
  })

  it('a refusal on any device endpoint, 401 or 403, is silent', async () => {
    for (const status of [401, 403]) {
      installFetch({ '/api/device/': () => new Response(null, { status }) })
      const { setDeviceToken, submitSession, deviceSuspended } = await freshApi()
      setDeviceToken('device-1')
      store.delete('smaran.deviceSuspendedAt')
      const outcome = await submitSession({ patientId: 'p1', gameType: 'KOI_ARE_JUMPING', startedAt: 'x' } as never)
      expect(outcome.queued, `a ${status} queues the session`).toBe(true)
      expect(deviceSuspended()).toBe(true)
    }
  })

  it('asks again after an hour, and a good answer ends the suspension', async () => {
    vi.useFakeTimers()
    try {
      let allowed = false
      const calls = installFetch({
        '/api/device/me': () => (allowed ? json(200, { patientId: 'p1' }) : new Response(null, { status: 401 })),
      })
      const { setDeviceToken, device, deviceSuspended } = await freshApi()
      setDeviceToken('device-1')
      await device.me()
      expect(deviceSuspended()).toBe(true)

      vi.advanceTimersByTime(59 * 60_000)
      await device.me()
      expect(calls).toHaveLength(1)

      allowed = true
      vi.advanceTimersByTime(2 * 60_000)
      await expect(device.me()).resolves.toMatchObject({ patientId: 'p1' })
      expect(calls).toHaveLength(2)
      expect(deviceSuspended()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('pairing again clears the suspension', async () => {
    installFetch({ '/api/device/': () => new Response(null, { status: 401 }) })
    const { setDeviceToken, clearSuspended, device, deviceSuspended } = await freshApi()
    setDeviceToken('device-1')
    await device.me()
    expect(deviceSuspended()).toBe(true)
    clearSuspended()
    expect(deviceSuspended()).toBe(false)
  })

  it('an unpaired tablet makes no request at all', async () => {
    const calls = installFetch({})
    const { device, submitSession } = await freshApi()
    await device.me()
    await submitSession({ patientId: 'p1', gameType: 'KOI_ARE_JUMPING', startedAt: 'x' } as never)
    expect(calls).toHaveLength(0)
  })
})

describe('the tablet’s endpoints name no patient', () => {
  it('sessions, garden, family and reminders all go to /api/device/**', async () => {
    const calls = installFetch({ '/api/device/': () => json(200, []) })
    const { setDeviceToken, submitSession, garden, family, reminders, games } = await freshApi()
    setDeviceToken('device-1')
    await submitSession({ patientId: 'p1', gameType: 'KOI_ARE_JUMPING', startedAt: 'x' } as never)
    await garden.state('p1')
    await family.members('p1')
    await reminders.schedule('p1')
    await games.route('p1')
    await games.objects('p1')
    expect(calls.map((c) => c.url)).toEqual([
      '/api/device/sessions',
      '/api/device/garden',
      '/api/device/family/members',
      '/api/device/reminders',
      '/api/device/game/route',
      '/api/device/objects',
    ])
    expect(calls.every((c) => c.auth === 'Bearer device-1')).toBe(true)
    expect(calls.some((c) => c.url.includes('p1'))).toBe(false)
  })
})

describe('redeeming a code', () => {
  it('carries no credential, even if a person is signed in, and names the tablet by its own random id', async () => {
    const calls = installFetch({
      '/api/auth/login': () => json(200, session('access-1')),
      '/api/pairing/redeem': () =>
        json(200, { deviceToken: 'sdt_x', deviceId: 'd1', patient: { patientId: 'p1', firstName: 'Meera', languageCode: 'en', kinshipTerm: 'Aaita' } }),
    })
    const { auth, pairing } = await freshApi()
    await auth.login('a@example.com', 'a-long-password')
    const result = await pairing.redeem('HJ4K2M', 'Living room')
    expect(result.patient.firstName).toBe('Meera')

    const call = calls.find((c) => c.url === '/api/pairing/redeem')!
    expect(call.auth).toBeNull()
    const body = JSON.parse(call.body ?? '{}') as Record<string, string>
    expect(body.code).toBe('HJ4K2M')
    expect(body.deviceLabel).toBe('Living room')
    expect(body.deviceFingerprint).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('turns the server’s answers into reasons a screen can explain', async () => {
    const answers: Record<number, string> = { 404: 'invalid', 400: 'invalid', 429: 'rate-limited', 403: 'forbidden', 503: 'offline' }
    for (const [status, reason] of Object.entries(answers)) {
      installFetch({ '/api/pairing/redeem': () => new Response(null, { status: Number(status) }) })
      const { pairing, PairingError } = await freshApi()
      const err = await pairing.redeem('HJ4K2M', 'x').catch((e: unknown) => e)
      expect(err, `${status}`).toBeInstanceOf(PairingError)
      expect((err as { reason: string }).reason, `${status}`).toBe(reason)
    }
  })

  it('no connection is reported as offline, not as a wrong code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('network down')
    }))
    const { pairing } = await freshApi()
    await expect(pairing.redeem('HJ4K2M', 'x')).rejects.toMatchObject({ reason: 'offline' })
  })
})
