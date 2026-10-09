import type { DomainCard } from '../../lib/types'
import { READINGS_TO_TRUST, STATUS_COLOUR, STATUS_WORDS, colourFor } from './shared'

/**
 * One card per domain: where she is (0 to 100), against her own usual, and how
 * sure the dashboard is. A card with too few readings says so instead of
 * showing a status: a few sessions cannot tell a change from a bad day, and the
 * screen must not pretend they can.
 */

function Spark({ values, colour }: { values: number[]; colour: string }) {
  if (values.length < 2) return <span style={{ width: 96, height: 28 }} aria-hidden="true" />
  const lo = Math.min(...values, 40)
  const hi = Math.max(...values, 60)
  const w = 96
  const h = 28
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4)}`)
    .join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Recent levels, from ${Math.round(values[0])} to ${Math.round(values[values.length - 1])}`}>
      <polyline points={pts} fill="none" stroke={colour} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export default function DomainCards({ cards, title, note }: { cards: DomainCard[]; title: string; note?: string }) {
  if (cards.length === 0) return null
  return (
    <section>
      <h2 className="font-serif" style={{ fontSize: 24 }}>
        {title}
      </h2>
      {note && (
        <p className="mb-3 font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
          {note}
        </p>
      )}
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => {
          const tooFew = c.observations < READINGS_TO_TRUST
          const colour = colourFor(c.target)
          return (
            <article key={c.target} className="soft-panel flex flex-col gap-2 p-4" aria-label={c.label}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-sans" style={{ fontSize: 16, lineHeight: 1.25 }}>
                  {c.label}
                </h3>
                <Spark values={c.spark} colour={colour} />
              </div>
              <div className="flex items-end justify-between gap-3">
                <span className="font-serif" style={{ fontSize: 34, color: colour }}>
                  {c.observations === 0 ? '—' : Math.round(c.level)}
                </span>
                {c.observations > 0 && (
                  <span
                    className="rounded-full px-3 py-1 font-sans"
                    style={{
                      fontSize: 13,
                      color: tooFew ? 'var(--chalk-dim)' : STATUS_COLOUR[c.status],
                      border: `1px solid ${tooFew ? 'rgba(221,234,248,0.2)' : STATUS_COLOUR[c.status] + '88'}`,
                    }}
                  >
                    {tooFew ? 'too early to say' : STATUS_WORDS[c.status]}
                  </span>
                )}
              </div>
              <p className="font-sans" style={{ fontSize: 13, color: 'var(--chalk-dim)' }}>
                {c.observations === 0
                  ? 'Not played yet.'
                  : `Confidence ${Math.round(c.confidence * 100)}%, from ${c.observations} ${c.observations === 1 ? 'reading' : 'readings'}.`}
              </p>
            </article>
          )
        })}
      </div>
    </section>
  )
}
