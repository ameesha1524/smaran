import { useEffect, useState } from 'react'
import { caregiver } from '../../lib/api'
import type { DashboardView, SessionRow } from '../../lib/types'
import { dayAndTime } from './shared'

/**
 * The latest sessions, and for each one what it said about her and why, in the
 * game's own plain words. The raw trials are never shown, to anyone: they are
 * kept, but nothing here (or anywhere) reads them back out.
 */

export default function SessionTable({
  patientId,
  labels,
  refreshKey,
}: {
  patientId: string
  /** Target id → the words the dashboard uses for it. */
  labels: Record<string, string>
  refreshKey: number
}) {
  const [rows, setRows] = useState<SessionRow[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setFailed(false)
    caregiver
      .sessions(patientId, 15)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [patientId, refreshKey])

  return (
    <section className="soft-panel p-5 lg:col-span-2">
      <h2 className="font-serif" style={{ fontSize: 24 }}>
        Recent sessions
      </h2>
      <p className="mb-3 font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
        What each sitting said, and why. Open one to read the reasons.
      </p>
      {failed ? (
        <p className="font-sans" role="alert" style={{ color: 'var(--chalk-dim)' }}>
          Sessions could not be loaded just now.
        </p>
      ) : rows === null ? (
        <p className="font-sans" style={{ color: 'var(--chalk-dim)' }}>
          One moment…
        </p>
      ) : rows.length === 0 ? (
        <p className="font-sans" style={{ color: 'var(--chalk-dim)' }}>
          She has not played yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} style={{ borderTop: '1px solid rgba(221,234,248,0.1)' }}>
              <details className="py-2">
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-sans" style={{ fontSize: 16 }}>
                    {r.gameTitle}
                    <span style={{ color: 'var(--chalk-dim)', fontSize: 14 }}>
                      {' · '}
                      {dayAndTime(r.startedAt)} · {Math.max(1, Math.round(r.durationMs / 60000))} min
                      {r.abandoned ? ' · left early' : ''}
                    </span>
                  </span>
                  <span className="font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
                    {r.contributions.map((c) => `${labels[c.target] ?? c.target} ${Math.round(c.raw)}`).join(' · ')}
                  </span>
                </summary>
                <ul className="mt-2 flex flex-col gap-2 pl-2">
                  {r.contributions.map((c) => (
                    <li key={c.target} className="font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
                      <strong style={{ color: 'var(--chalk)' }}>{labels[c.target] ?? c.target}</strong> read {Math.round(c.raw)} out of
                      100, with {Math.round(c.confidence * 100)}% confidence. {c.because}
                    </li>
                  ))}
                  <li className="font-sans" style={{ fontSize: 12, color: 'var(--chalk-dim)', opacity: 0.7 }}>
                    {r.scoringTrust === 'server'
                      ? 'Scored on the tablet and checked by the server from the raw rounds.'
                      : 'Scored on the tablet. The server has not re-scored this game.'}
                  </li>
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Target id → label, from the dashboard's own cards. */
export function labelsOf(view: Pick<DashboardView, 'domains' | 'subSignals'>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of [...view.domains, ...view.subSignals]) out[c.target] = c.label
  return out
}
