import { useState } from 'react'
import { caregiver } from '../../lib/api'
import type { AlertView } from '../../lib/types'
import { SEVERITY_COLOUR, dayAndTime } from './shared'

/**
 * What the dashboard noticed. Each one is an observation with its evidence,
 * never a conclusion. A family member can mark one as seen; a doctor reads them
 * and cannot. Marking one seen does not close it: it closes itself when she is
 * back to her own usual.
 */

export default function AlertsList({
  patientId,
  alerts,
  canAcknowledge,
  onChanged,
}: {
  patientId: string
  alerts: AlertView[]
  canAcknowledge: boolean
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)

  if (alerts.length === 0) return null

  const acknowledge = async (id: string) => {
    setBusy(id)
    try {
      await caregiver.acknowledge(patientId, id)
      onChanged()
    } catch {
      /* the button simply stays; nothing was marked */
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-label="What was noticed">
      {alerts.map((a) => {
        const colour = SEVERITY_COLOUR[a.severity] ?? '#e0a03c'
        return (
          <div
            key={a.id}
            className="flex flex-wrap items-start gap-3 rounded-2xl px-5 py-4"
            style={{ background: `${colour}1a`, border: `1px solid ${colour}66` }}
            role="status"
          >
            <span style={{ color: colour, fontSize: 20 }} aria-hidden="true">
              ◆
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="font-sans" style={{ fontSize: 16, color: 'var(--chalk)' }}>
                {a.message}
              </p>
              <p className="font-sans" style={{ fontSize: 13, color: 'var(--chalk-dim)' }}>
                First noticed {dayAndTime(a.openedAt)}
                {a.acknowledgedAt ? ` · seen ${dayAndTime(a.acknowledgedAt)}` : ''}
              </p>
            </div>
            {canAcknowledge && !a.acknowledgedAt && (
              <button
                type="button"
                className="pill stone"
                disabled={busy === a.id}
                onClick={() => void acknowledge(a.id)}
                style={{ padding: '6px 16px', fontSize: 15 }}
              >
                I’ve seen this
              </button>
            )}
          </div>
        )
      })}
    </section>
  )
}
