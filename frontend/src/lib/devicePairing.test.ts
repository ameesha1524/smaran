import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PAIRING_ALPHABET, formatCode, isComplete, normaliseTyped } from './pairingCode'
import { mustWipeBefore, readPairing, savePairing, wipeLocalData } from './devicePairing'

function installStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  })
  return store
}

beforeEach(() => {
  installStorage()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('whose information is on this tablet', () => {
  const was = { deviceId: 'd1', patientId: 'p1', pairedAt: '2026-10-01T00:00:00Z' }

  it('is kept when the tablet is paired again to the same patient', () => {
    expect(mustWipeBefore(was, 'p1')).toBe(false)
  })

  it('is wiped when the tablet is paired to a different patient', () => {
    expect(mustWipeBefore(was, 'p2')).toBe(true)
  })

  it('is wiped when the tablet cannot say whose it was', () => {
    expect(mustWipeBefore(null, 'p1')).toBe(true)
  })
})

describe('remembering a pairing', () => {
  it('round-trips', () => {
    const meta = { deviceId: 'd1', patientId: 'p1', pairedAt: '2026-10-01T00:00:00Z' }
    savePairing(meta)
    expect(readPairing()).toEqual(meta)
  })

  it('does not trust what is in storage', () => {
    for (const junk of ['not json', '{}', '[]', '{"deviceId":1}', 'null', '{"deviceId":"d"}']) {
      localStorage.setItem('smaran.devicePairing', junk)
      expect(readPairing(), junk).toBeNull()
    }
  })
})

describe('wiping a tablet before it is given to another patient', () => {
  it('removes everything the app keeps about her, including the old token, and nothing else', async () => {
    const store = installStorage({
      'smaran.deviceToken': 'sdt_old',
      'smaran.devicePairing': '{"deviceId":"d1","patientId":"p1","pairedAt":"x"}',
      'smaran.journal': '[{"text":"a private thought"}]',
      'smaran.voiceNotes': '[]',
      'smaran.sessionCount': '12',
      'smaran.languageConfirmed': 'true',
      'smaran.deviceSuspendedAt': '123',
      'smaran.caregiverSetupComplete': 'true',
      'unrelated.key': 'kept',
    })
    await wipeLocalData()
    expect([...store.keys()]).toEqual(['unrelated.key'])
  })
})

describe('what a pairing code looks like when typed', () => {
  it('uses the same 27 symbols as the server', () => {
    expect(PAIRING_ALPHABET).toBe('ACDEFGHJKMNPQRTUVWXYZ234679')
    expect(new Set(PAIRING_ALPHABET).size).toBe(27)
    for (const c of '01OIL5SB8') expect(PAIRING_ALPHABET).not.toContain(c)
  })

  it('reads a code however it is typed or pasted', () => {
    expect(normaliseTyped('hj4k-2m')).toBe('HJ4K2M')
    expect(normaliseTyped(' HJ4K 2M ')).toBe('HJ4K2M')
    expect(normaliseTyped('H J 4 K - 2 M')).toBe('HJ4K2M')
  })

  it('drops symbols that can never be in a code, and stops at six', () => {
    expect(normaliseTyped('HJ0O1I')).toBe('HJ')
    expect(normaliseTyped('HJ4K2MXYZ')).toBe('HJ4K2M')
    expect(normaliseTyped('<script>')).toBe('CRPT')
    expect(normaliseTyped('')).toBe('')
  })

  it('is shown as HJ4K-2M, and complete only at six', () => {
    expect(formatCode('HJ4K2M')).toBe('HJ4K-2M')
    expect(formatCode('HJ4')).toBe('HJ4')
    expect(isComplete('HJ4K2')).toBe(false)
    expect(isComplete('HJ4K2M')).toBe(true)
  })
})
