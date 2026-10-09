import { clearPatientData } from './db'

/**
 * What a tablet remembers about its own pairing, and what it does with her
 * information when it is handed to someone else.
 *
 * The rule is about whose information is on the glass:
 *
 *   - paired again to the SAME patient (the family removed the tablet, or its
 *     token lapsed, and then paired it again): nothing is lost. Whatever she had
 *     played and not yet sent is still queued and goes up on the next sync.
 *   - paired to a DIFFERENT patient, or to anyone when this tablet cannot say
 *     whose data it holds: everything about the old patient is wiped first.
 *     Another person's journal, family photographs and unsent sessions must
 *     never surface on, or be filed under, a new patient.
 */

const PAIRING_KEY = 'smaran.devicePairing'

/** Everything this app keeps in localStorage that is about a patient or the tablet's state. */
const KEY_PREFIX = 'smaran.'

export interface DevicePairingMeta {
  deviceId: string
  patientId: string
  pairedAt: string
}

export function readPairing(): DevicePairingMeta | null {
  try {
    const raw = localStorage.getItem(PAIRING_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as DevicePairingMeta).deviceId === 'string' &&
      typeof (parsed as DevicePairingMeta).patientId === 'string'
    ) {
      return parsed as DevicePairingMeta
    }
    return null
  } catch {
    return null
  }
}

export function savePairing(meta: DevicePairingMeta): void {
  localStorage.setItem(PAIRING_KEY, JSON.stringify(meta))
}

/**
 * Must the tablet forget what it holds before taking on this patient?
 * Only when it is certain the data is hers does it keep it.
 */
export function mustWipeBefore(previous: DevicePairingMeta | null, nextPatientId: string): boolean {
  return previous === null || previous.patientId !== nextPatientId
}

/**
 * Forget one patient entirely: everything in IndexedDB that is about her,
 * everything this app keeps in localStorage, and any cached copy of her
 * photographs and voice notes. The tablet's own random id is not about her and stays.
 */
export async function wipeLocalData(): Promise<void> {
  await clearPatientData()

  const doomed: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(KEY_PREFIX)) doomed.push(key)
  }
  doomed.forEach((k) => localStorage.removeItem(k))

  try {
    // Her photographs and voices are kept by the service worker; so, in earlier
    // versions, were her API answers. Neither may outlive her on this tablet.
    for (const name of await caches.keys()) {
      if (name.endsWith('-media')) {
        await caches.delete(name)
      } else {
        const cache = await caches.open(name)
        for (const req of await cache.keys()) {
          if (new URL(req.url).pathname.startsWith('/api/')) await cache.delete(req)
        }
      }
    }
  } catch {
    /* No Cache Storage here (tests, or a browser that has it switched off). */
  }
}
