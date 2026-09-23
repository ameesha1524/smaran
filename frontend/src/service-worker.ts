/// <reference lib="webworker" />

/**
 * Smaran's Service Worker.
 *
 * It does two jobs, and the second one is the one that matters in a village
 * with no signal:
 *
 *   1. caching, so the sanctuary, the games, the language strings and the
 *      family photographs all open instantly and work with the radio off;
 *   2. reminders, which fire from *this device's own clock*. Her tablet must
 *      tell her about her 8 am tablet whether or not anything is reachable.
 *
 * Written by hand rather than generated: the reminder logic below has no
 * equivalent in a caching library, and a medicine reminder is not something to
 * leave to a default strategy.
 */

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[]
  registration: ServiceWorkerRegistration & {
    periodicSync?: { register(tag: string, opts: { minInterval: number }): Promise<void> }
  }
}

const VERSION = 'smaran-v1'
const SHELL = `${VERSION}-shell`
const RUNTIME = `${VERSION}-runtime`
const MEDIA = `${VERSION}-media`
const STATE = `${VERSION}-state`

const SYNC_TAG = 'smaran-sync'
const REMINDER_TAG = 'smaran-reminders'

/* ------------------------------------------------------------- install */

const manifest = self.__WB_MANIFEST ?? []

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL)
      // Pre-cache everything the sanctuary needs to draw itself: the SVG scene,
      // the keyframes, the language strings, the fonts. None of it ever changes
      // between sessions, and none of it may ever depend on a network.
      const urls = manifest.map((e) => e.url)
      await Promise.allSettled(urls.map((u) => cache.add(u)))
      await self.skipWaiting()
    })(),
  )
})

/* ------------------------------------------------------------ activate */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
      await self.clients.claim()

      // Ask for periodic wake-ups where the browser supports them.
      try {
        await self.registration.periodicSync?.register(REMINDER_TAG, { minInterval: 15 * 60 * 1000 })
      } catch {
        /* Not supported — the in-page timer and the fetch hook cover it. */
      }
      await checkReminders()
    })(),
  )
})

/* --------------------------------------------------------------- fetch */

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // Navigations: the app shell, always, instantly, online or not.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req)
          const cache = await caches.open(SHELL)
          void cache.put('/index.html', fresh.clone())
          return fresh
        } catch {
          const cached = await caches.match('/index.html')
          return cached ?? new Response('Offline', { status: 503 })
        }
      })(),
    )
    return
  }

  // API reads: stale-while-revalidate, so her last known state is on screen
  // before the request even resolves.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(staleWhileRevalidate(req))
    return
  }

  // Family photographs and voice notes: cache-first and kept. The grove has to
  // work offline or it is not a grove, it is a gallery of broken images.
  if (/\.(?:png|jpe?g|webp|gif|svg|mp3|wav|webm|ogg|m4a)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(req, MEDIA))
    return
  }

  event.respondWith(cacheFirst(req, RUNTIME))
})

async function cacheFirst(req: Request, cacheName: string): Promise<Response> {
  const cached = await caches.match(req)
  if (cached) return cached
  try {
    const fresh = await fetch(req)
    if (fresh.ok || fresh.type === 'opaque') {
      const cache = await caches.open(cacheName)
      void cache.put(req, fresh.clone())
    }
    return fresh
  } catch {
    return cached ?? new Response('', { status: 504 })
  }
}

async function staleWhileRevalidate(req: Request): Promise<Response> {
  const cache = await caches.open(RUNTIME)
  const cached = await cache.match(req)
  const network = fetch(req)
    .then((res) => {
      if (res.ok) void cache.put(req, res.clone())
      return res
    })
    .catch(() => undefined)
  return cached ?? (await network) ?? new Response(JSON.stringify(null), { headers: { 'Content-Type': 'application/json' } })
}

/* ---------------------------------------------------------------- sync */

self.addEventListener('sync', (event) => {
  const e = event as ExtendableEvent & { tag: string }
  if (e.tag !== SYNC_TAG) return
  // The page owns the queue (it has IndexedDB open and the token); the worker's
  // job is to wake it up the moment the radio comes back.
  e.waitUntil(notifyClients({ type: 'SYNC_NOW' }))
})

self.addEventListener('periodicsync', (event) => {
  const e = event as ExtendableEvent & { tag: string }
  if (e.tag === REMINDER_TAG) e.waitUntil(checkReminders())
  if (e.tag === SYNC_TAG) e.waitUntil(notifyClients({ type: 'SYNC_NOW' }))
})

async function notifyClients(message: unknown) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
  clients.forEach((c) => c.postMessage(message))
}

/* ----------------------------------------------------------- reminders */

interface StoredReminder {
  id: string
  type: 'MEDICINE' | 'HYDRATION' | 'APPOINTMENT'
  scheduledTime: string
  messageTemplate: string
  photoUrl?: string
}

interface ReminderState {
  kinshipTerm: string
  languageCode: string
  /** Sundowning: no game reminders after 16:00 for this patient. */
  sundowning: boolean
  reminders: StoredReminder[]
  /** id → yyyy-mm-dd of the last time it fired, so it fires once a day. */
  fired: Record<string, string>
}

const EMPTY_STATE: ReminderState = {
  kinshipTerm: '',
  languageCode: 'en',
  sundowning: false,
  reminders: [],
  fired: {},
}

async function readState(): Promise<ReminderState> {
  try {
    const cache = await caches.open(STATE)
    const res = await cache.match('/__smaran_reminders')
    if (!res) return EMPTY_STATE
    return { ...EMPTY_STATE, ...((await res.json()) as Partial<ReminderState>) }
  } catch {
    return EMPTY_STATE
  }
}

async function writeState(state: ReminderState) {
  try {
    const cache = await caches.open(STATE)
    await cache.put('/__smaran_reminders', new Response(JSON.stringify(state), { headers: { 'Content-Type': 'application/json' } }))
  } catch {
    /* A device that cannot store the schedule still runs the app. */
  }
}

self.addEventListener('message', (event) => {
  const data = event.data as { type: string; [k: string]: unknown }
  if (!data?.type) return

  if (data.type === 'SCHEDULE_REMINDERS') {
    event.waitUntil(
      (async () => {
        const state = await readState()
        await writeState({
          ...state,
          reminders: (data.reminders as StoredReminder[]) ?? [],
          kinshipTerm: (data.kinshipTerm as string) ?? state.kinshipTerm,
          languageCode: (data.languageCode as string) ?? state.languageCode,
          sundowning: (data.sundowning as boolean) ?? state.sundowning,
        })
        await checkReminders()
      })(),
    )
  }

  if (data.type === 'CHECK_REMINDERS') event.waitUntil(checkReminders())
  if (data.type === 'SKIP_WAITING') void self.skipWaiting()
})

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Fire anything due. Runs on activate, on every periodic sync, and whenever the
 * page asks — a reminder half an hour late is worth far more than no reminder.
 */
async function checkReminders() {
  const state = await readState()
  if (!state.reminders.length) return

  const now = new Date()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const today = todayKey()
  let changed = false

  for (const r of state.reminders) {
    if (state.fired[r.id] === today) continue

    const [h, m] = r.scheduledTime.split(':').map(Number)
    if (Number.isNaN(h) || Number.isNaN(m)) continue
    const due = h * 60 + m

    // A 45-minute grace window: a tablet switched on late still gets told.
    if (nowMinutes < due || nowMinutes > due + 45) continue

    // Sundowning patients are left alone in the late afternoon.
    if (state.sundowning && h >= 16 && r.type !== 'MEDICINE') continue

    const body = r.messageTemplate.replace('{kin}', state.kinshipTerm || '')
    try {
      await self.registration.showNotification('Smaran', {
        body,
        icon: r.photoUrl ?? '/icons/lotus-192.svg',
        // The photograph of the actual pill, when the caregiver uploaded one.
        image: r.type === 'MEDICINE' ? r.photoUrl : undefined,
        badge: '/icons/lotus-192.svg',
        tag: `smaran-${r.id}`,
        // Never vibrate, never make a sound the OS chooses: a wind chime plays
        // in-app when she opens it. Nothing here may startle her.
        silent: true,
        requireInteraction: false,
        data: { reminderId: r.id, type: r.type },
      } as NotificationOptions)
      state.fired[r.id] = today
      changed = true
    } catch {
      /* Notifications not permitted — the in-app nudge still happens. */
    }
  }

  if (changed) {
    // Keep the ledger small: only today's marks matter.
    state.fired = Object.fromEntries(Object.entries(state.fired).filter(([, d]) => d === today))
    await writeState(state)
  }
}

/* -------------------------------------------------------------- push */

self.addEventListener('push', (event) => {
  const e = event as ExtendableEvent & { data?: { json(): unknown } }
  let payload: { title?: string; body?: string; image?: string } = {}
  try {
    payload = (e.data?.json() as typeof payload) ?? {}
  } catch {
    /* a push with no body is still a nudge */
  }
  e.waitUntil(
    self.registration.showNotification(payload.title ?? 'Smaran', {
      body: payload.body ?? 'Your garden is waiting.',
      icon: '/icons/lotus-192.svg',
      badge: '/icons/lotus-192.svg',
      silent: true,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  const e = event as Event & { notification: Notification; waitUntil(p: Promise<unknown>): void }
  e.notification.close()
  e.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = clients.find((c) => 'focus' in c)
      if (existing) {
        await existing.focus()
        existing.postMessage({ type: 'REMINDER_OPENED', data: e.notification.data })
        return
      }
      await self.clients.openWindow('/')
    })(),
  )
})
