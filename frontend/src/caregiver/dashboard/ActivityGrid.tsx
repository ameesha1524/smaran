import type { DashboardView } from '../../lib/types'

/**
 * When she plays: a week laid out by weekday and hour, over the last 90 days. A darker cell is more sittings.
 * It is for noticing a pattern (she always plays in the morning; the afternoons have gone quiet), not for
 * counting. A quiet cell is a resting one.
 */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const FIRST_HOUR = 5
const LAST_HOUR = 22

function hourLabel(h: number): string {
  if (h === 12) return '12pm'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

export default function ActivityGrid({ cells }: { cells: DashboardView['activity'] }) {
  const grid = new Map<number, number>()
  let max = 1
  for (const c of cells) {
    grid.set(c.weekday * 24 + c.hour, c.sessions)
    max = Math.max(max, c.sessions)
  }
  const hours = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i)
  const total = cells.reduce((a, c) => a + c.sessions, 0)

  return (
    <section className="soft-panel p-5">
      <h2 className="font-serif" style={{ fontSize: 24 }}>
        When she plays
      </h2>
      <p className="mb-3 font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
        The last 90 days, by day of the week and hour of the day.
      </p>
      {total === 0 ? (
        <p className="font-sans" style={{ color: 'var(--chalk-dim)' }}>
          Nothing yet.
        </p>
      ) : (
        <div role="img" aria-label={`${total} sittings in the last 90 days, by weekday and hour`} className="overflow-x-auto">
          <div style={{ display: 'grid', gridTemplateColumns: `34px repeat(${hours.length}, minmax(14px, 1fr))`, gap: 3, minWidth: 360 }}>
            <span />
            {hours.map((h) => (
              <span key={h} className="font-sans" style={{ fontSize: 10, color: 'var(--chalk-dim)', textAlign: 'center' }}>
                {h % 3 === 0 ? hourLabel(h) : ''}
              </span>
            ))}
            {DAYS.map((d, wd) => (
              <div key={d} style={{ display: 'contents' }}>
                <span className="font-sans" style={{ fontSize: 12, color: 'var(--chalk-dim)' }}>
                  {d}
                </span>
                {hours.map((h) => {
                  const n = grid.get(wd * 24 + h) ?? 0
                  return (
                    <span
                      key={h}
                      title={`${d} ${hourLabel(h)}: ${n} ${n === 1 ? 'sitting' : 'sittings'}`}
                      style={{
                        height: 18,
                        borderRadius: 4,
                        background: n === 0 ? 'rgba(221,234,248,0.07)' : `rgba(232,200,74,${0.25 + (n / max) * 0.65})`,
                      }}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
