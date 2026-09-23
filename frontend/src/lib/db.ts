/**
 * IndexedDB — the reason Smaran works in a village with no signal for three days.
 *
 * Stores (mirrors the technical doc):
 *   pending_sessions  [patientId, startedAt]   queued game session results
 *   pending_vectors   [patientId, capturedAt]  queued acoustic feature vectors
 *   pending_blooms    autoinc                  queued garden water events
 *   garden_state      patientId                last known garden state
 *   family_members    patientId                cached family list + phases
 *   cache             key                      profile, route, objects, reminders
 *   sync_meta         patientId                last sync timestamp, queue depth
 *
 * Everything here is plain IndexedDB on purpose: one less dependency to fail to
 * install on a low-end Android tablet.
 */

const DB_NAME = 'smaran'
const DB_VERSION = 1

export type StoreName =
  | 'pending_sessions'
  | 'pending_vectors'
  | 'pending_blooms'
  | 'garden_state'
  | 'family_members'
  | 'cache'
  | 'sync_meta'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('pending_sessions')) {
        db.createObjectStore('pending_sessions', { keyPath: ['patientId', 'startedAt'] })
      }
      if (!db.objectStoreNames.contains('pending_vectors')) {
        db.createObjectStore('pending_vectors', { keyPath: ['patientId', 'capturedAt'] })
      }
      if (!db.objectStoreNames.contains('pending_blooms')) {
        db.createObjectStore('pending_blooms', { keyPath: 'id', autoIncrement: true })
      }
      if (!db.objectStoreNames.contains('garden_state')) {
        db.createObjectStore('garden_state', { keyPath: 'patientId' })
      }
      if (!db.objectStoreNames.contains('family_members')) {
        db.createObjectStore('family_members', { keyPath: 'patientId' })
      }
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache', { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains('sync_meta')) {
        db.createObjectStore('sync_meta', { keyPath: 'patientId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function put<T>(store: StoreName, value: T): Promise<void> {
  try {
    await tx(store, 'readwrite', (s) => s.put(value as unknown as object) as IDBRequest<IDBValidKey>)
  } catch {
    /* A device with storage disabled still gets a working sanctuary. */
  }
}

export async function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  try {
    return (await tx(store, 'readonly', (s) => s.get(key) as IDBRequest<T>)) ?? undefined
  } catch {
    return undefined
  }
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  try {
    return (await tx(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)) ?? []
  } catch {
    return []
  }
}

export async function remove(store: StoreName, key: IDBValidKey): Promise<void> {
  try {
    await tx(store, 'readwrite', (s) => s.delete(key) as IDBRequest<undefined>)
  } catch {
    /* ignore */
  }
}

export async function clear(store: StoreName): Promise<void> {
  try {
    await tx(store, 'readwrite', (s) => s.clear() as IDBRequest<undefined>)
  } catch {
    /* ignore */
  }
}

/** Small key/value cache for profile, route, objects, reminder schedule. */
export async function cacheSet<T>(key: string, value: T): Promise<void> {
  await put('cache', { key, value, at: Date.now() })
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const row = await get<{ key: string; value: T }>('cache', key)
  return row?.value
}

export async function queueDepth(): Promise<number> {
  const [s, v, b] = await Promise.all([
    getAll('pending_sessions'),
    getAll('pending_vectors'),
    getAll('pending_blooms'),
  ])
  return s.length + v.length + b.length
}
