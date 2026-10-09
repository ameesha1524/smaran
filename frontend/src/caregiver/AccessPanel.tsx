import { useCallback, useEffect, useState } from 'react'
import { HttpError, caregiver, type AuditEntry, type DoctorGrant } from '../lib/api'

/**
 * "Who can see her" and "who has looked".
 *
 * A doctor sees a patient only because a family member chose to share her, for
 * a stated time, and can stop it at any moment. Below the sharing controls is
 * the trail of who has opened her information: every read by a family member,
 * doctor or administrator is recorded, as is every refused attempt.
 */

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const ACTION_WORDS: Record<string, string> = {
  PATIENT_READ: 'looked at',
  PATIENT_WRITE: 'changed',
  ACCESS_DENIED: 'was refused',
  GRANT_CREATED: 'shared her with a doctor',
  GRANT_REVOKED: 'stopped sharing with a doctor',
  PATIENT_CREATED: 'added her',
}

export default function AccessPanel({ patientId }: { patientId: string }) {
  const [grants, setGrants] = useState<DoctorGrant[] | null>(null)
  const [audit, setAudit] = useState<AuditEntry[] | null>(null)
  const [email, setEmail] = useState('')
  const [days, setDays] = useState(90)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [g, a] = await Promise.all([caregiver.grants(patientId), caregiver.audit(patientId, 15)])
      setGrants(g)
      setAudit(a)
    } catch {
      setGrants(null)
      setAudit(null)
      setError('Who can see her could not be loaded just now.')
    }
  }, [patientId])

  useEffect(() => {
    void load()
  }, [load])

  const share = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await caregiver.grant(patientId, email.trim(), days)
      setEmail('')
      await load()
    } catch (err) {
      setError(err instanceof HttpError && (err.status === 404 || err.status === 400) ? err.message : 'That did not work. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const stop = async (id: string) => {
    setBusy(true)
    try {
      await caregiver.revokeGrant(patientId, id)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const live = (grants ?? []).filter((g) => g.live)

  return (
    <section className="soft-panel flex flex-col gap-5 p-5 lg:col-span-2">
      <div>
        <h2 className="font-serif" style={{ fontSize: 24 }}>
          Who can see her
        </h2>
        <p className="font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
          A doctor sees her trends and report, nothing else: not her journal, her photographs or her family’s voices.
        </p>
      </div>

      {grants === null ? (
        // Say nothing until it is known: "no one can see her" must never be a guess.
        <p className="font-sans" style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>
          One moment…
        </p>
      ) : live.length === 0 ? (
        <p className="font-sans" style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>
          No doctor can see her right now.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {live.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: 'rgba(8,15,30,0.5)' }}>
              <span className="font-sans" style={{ fontSize: 16 }}>
                {g.doctorName ?? g.doctorEmail}
                <span style={{ color: 'var(--chalk-dim)', fontSize: 14 }}> · until {day(g.expiresAt)}</span>
              </span>
              <button type="button" className="pill stone" disabled={busy} onClick={() => void stop(g.id)} style={{ padding: '6px 16px', fontSize: 15 }}>
                Stop sharing
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={share} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1" style={{ minWidth: 200 }}>
          <span style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>Doctor’s email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="rounded-full px-4 py-2"
            style={{ background: 'rgba(8,15,30,0.7)', border: '1px solid rgba(221,234,248,0.2)', color: 'var(--chalk)', fontSize: 16 }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>For</span>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-full px-4 py-2"
            style={{ background: 'rgba(8,15,30,0.7)', border: '1px solid rgba(221,234,248,0.2)', color: 'var(--chalk)', fontSize: 16 }}
          >
            <option value={7}>1 week</option>
            <option value={30}>1 month</option>
            <option value={90}>3 months</option>
            <option value={365}>1 year</option>
          </select>
        </label>
        <button type="submit" className="pill" disabled={busy} style={{ background: 'var(--olive-continue)', color: 'var(--chalk)', padding: '8px 22px', fontSize: 16 }}>
          Share
        </button>
      </form>
      {error && (
        <p className="font-sans" style={{ fontSize: 14, color: 'var(--terracotta)' }} role="alert">
          {error}
        </p>
      )}

      <div>
        <h3 className="font-serif" style={{ fontSize: 20 }}>
          Who has looked
        </h3>
        {audit === null ? null : audit.length === 0 ? (
          <p className="font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
            Nothing yet.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {audit.map((a) => (
              <li key={a.id} className="font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
                {when(a.at)} · {a.actorType.toLowerCase()} {ACTION_WORDS[a.action] ?? a.action.toLowerCase().replace(/_/g, ' ')}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
