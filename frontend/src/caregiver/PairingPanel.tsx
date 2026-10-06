import { useCallback, useEffect, useState } from 'react'
import { PairingError, pairing, type PairingFailure } from '../lib/api'
import type { PairedDevice, PairingCode } from '../lib/types'

/**
 * "Her tablet" — the family side of pairing.
 *
 * Generates the one-time code the tablet redeems, shows it large enough to
 * read across a room, counts it down, and lists the tablets that currently
 * hold access so any of them can be removed. Removing a tablet takes effect
 * on its very next request; the tablet itself falls back to its offline copy
 * and never shows her an error.
 */

const MESSAGES: Record<PairingFailure, string> = {
  offline: 'Pairing needs the Smaran server, which isn’t reachable from here right now.',
  forbidden: 'Only a family account signed in on this phone can pair a tablet.',
  invalid: 'Her record wasn’t found on the server. Try signing out and in again.',
  'rate-limited': 'Too many requests just now — wait a minute and try again.',
  unknown: 'Something went wrong on our side. Please try again in a moment.',
}

function errorText(err: unknown): string {
  return MESSAGES[err instanceof PairingError ? err.reason : 'unknown']
}

function remaining(expiresAt: string, now: number): number {
  return Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000))
}

function ago(iso: string | null): string {
  if (!iso) return 'not yet'
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}

export default function PairingPanel({ patientId }: { patientId: string }) {
  const [code, setCode] = useState<PairingCode | null>(null)
  const [devices, setDevices] = useState<PairedDevice[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const loadDevices = useCallback(async () => {
    try {
      setDevices(await pairing.devices(patientId))
    } catch (err) {
      setDevices(null)
      setError(errorText(err))
    }
  }, [patientId])

  useEffect(() => {
    void loadDevices()
  }, [loadDevices])

  // Tick only while a code is on screen.
  useEffect(() => {
    if (!code) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [code])

  const secondsLeft = code ? remaining(code.expiresAt, now) : 0
  const expired = !!code && secondsLeft === 0

  // Once the code expires, a tablet may well have just used it — refresh the list.
  useEffect(() => {
    if (expired) void loadDevices()
  }, [expired, loadDevices])

  const newCode = async () => {
    setBusy(true)
    setError(null)
    try {
      const fresh = await pairing.createCode(patientId)
      setCode(fresh)
      setNow(Date.now())
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (deviceId: string) => {
    setBusy(true)
    setError(null)
    try {
      await pairing.revoke(patientId, deviceId)
      setConfirming(null)
      await loadDevices()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const mm = Math.floor(secondsLeft / 60)
  const ss = String(secondsLeft % 60).padStart(2, '0')

  return (
    <section className="soft-panel p-5" aria-labelledby="her-tablet">
      <h2 id="her-tablet" className="font-serif" style={{ fontSize: 24 }}>
        Her tablet
      </h2>
      <p className="mb-4 font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
        Pair the tablet she uses so her games reach this dashboard. On the tablet, open Smaran and type the code below.
        A code works once and lasts ten minutes.
      </p>

      {code && !expired && (
        <div className="mb-4 flex flex-col items-center gap-1 rounded-2xl px-4 py-5" style={{ background: 'rgba(8,15,30,0.6)' }}>
          <span
            aria-live="polite"
            style={{ fontFamily: "'VT323', monospace", fontSize: 52, letterSpacing: '0.2em', color: 'var(--chalk)' }}
          >
            {code.code}
          </span>
          <span className="font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
            Expires in {mm}:{ss}
          </span>
        </div>
      )}
      {expired && (
        <p className="mb-4 font-sans" style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>
          That code has expired. If the tablet didn’t pair in time, get a new one.
        </p>
      )}

      <button
        type="button"
        onClick={newCode}
        disabled={busy}
        className="pill"
        style={{ background: 'var(--olive-continue)', color: 'var(--chalk)', padding: '10px 22px', fontSize: 16, opacity: busy ? 0.6 : 1 }}
      >
        {code ? 'Get a new code' : 'Get a pairing code'}
      </button>

      {error && (
        <p className="mt-3 font-sans" style={{ fontSize: 14, color: 'var(--terracotta)' }} role="alert">
          {error}
        </p>
      )}

      <h3 className="mt-6 font-serif" style={{ fontSize: 18 }}>
        Paired tablets
      </h3>
      {devices === null ? (
        <p className="mt-2 font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
          —
        </p>
      ) : devices.length === 0 ? (
        <p className="mt-2 font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
          None yet.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-3">
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3">
              <span>
                <span style={{ fontSize: 16 }}>{d.label || 'Tablet'}</span>
                <span className="block font-sans" style={{ fontSize: 13, color: 'var(--chalk-dim)' }}>
                  Paired {ago(d.pairedAt)} · last seen {ago(d.lastSeenAt)}
                </span>
              </span>
              {confirming === d.id ? (
                <span className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void revoke(d.id)}
                    disabled={busy}
                    className="pill"
                    style={{ background: 'var(--terracotta)', color: 'var(--chalk)', padding: '6px 14px', fontSize: 14 }}
                  >
                    Yes, remove access
                  </button>
                  <button type="button" onClick={() => setConfirming(null)} className="pill stone" style={{ padding: '6px 14px', fontSize: 14 }}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirming(d.id)} className="pill stone" style={{ padding: '6px 14px', fontSize: 14 }}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
