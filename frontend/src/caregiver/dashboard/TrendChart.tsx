import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { caregiver } from '../../lib/api'
import type { AlertView, DomainCard, TimePoint } from '../../lib/types'
import { SEVERITY_COLOUR, colourFor } from './shared'

/**
 * Her level in one domain over 30 or 90 days, with each alert marked where it
 * began. The level is the engine's running level after each session (0 to 100,
 * starting at 50), so the line is what the engine concluded at the time, not a
 * chart drawn afterwards.
 */

const RANGES = [30, 90] as const

export default function TrendChart({
  patientId,
  options,
  alerts,
  refreshKey,
}: {
  patientId: string
  options: DomainCard[]
  alerts: AlertView[]
  /** Changes when the dashboard is told something happened, so the chart reads again. */
  refreshKey: number
}) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30)
  const [target, setTarget] = useState(options[0]?.target ?? 'LANGUAGE')
  const [points, setPoints] = useState<TimePoint[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setFailed(false)
    caregiver
      .timeseries(patientId, days)
      .then((p) => alive && setPoints(p))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [patientId, days, refreshKey])

  const data = useMemo(
    () =>
      (points ?? [])
        .filter((p) => typeof p.levels[target] === 'number')
        .map((p) => ({ t: Date.parse(p.at), level: Number(p.levels[target].toFixed(1)), status: p.statuses[target] })),
    [points, target],
  )

  const since = Date.now() - days * 86_400_000
  const marks = alerts.filter((a) => a.target === target && Date.parse(a.openedAt) >= since)
  const colour = colourFor(target)
  const label = options.find((o) => o.target === target)?.label ?? target

  return (
    <section className="soft-panel p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif" style={{ fontSize: 24 }}>
            Over time
          </h2>
          <p className="font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
            One line at a time. A line falling while the others hold is the pattern worth a conversation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
            <span className="sr-only">Domain</span>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="rounded-full px-4 py-2"
              style={{ background: 'rgba(8,15,30,0.7)', border: '1px solid rgba(221,234,248,0.2)', color: 'var(--chalk)', fontSize: 15 }}
            >
              {options.map((o) => (
                <option key={o.target} value={o.target}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setDays(r)}
              aria-pressed={days === r}
              className="pill"
              style={{
                padding: '6px 16px',
                fontSize: 15,
                background: days === r ? 'var(--olive-continue)' : 'rgba(11,23,40,0.7)',
                border: '1px solid rgba(221,234,248,0.16)',
              }}
            >
              {r} days
            </button>
          ))}
        </div>
      </div>

      <div style={{ width: '100%', height: 300 }} className="mt-4">
        {failed ? (
          <p className="font-sans" role="alert" style={{ color: 'var(--chalk-dim)' }}>
            The trend could not be loaded just now.
          </p>
        ) : points === null ? (
          <p className="font-sans" style={{ color: 'var(--chalk-dim)' }}>
            One moment…
          </p>
        ) : data.length === 0 ? (
          <p className="font-sans" style={{ color: 'var(--chalk-dim)' }}>
            Nothing has read {label.toLowerCase()} in the last {days} days yet.
          </p>
        ) : (
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -12 }}>
              <CartesianGrid stroke="rgba(221,234,248,0.1)" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={[since, Date.now()]}
                tickFormatter={(t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                stroke="#b8b49e"
                tick={{ fontSize: 12 }}
                minTickGap={36}
              />
              <YAxis domain={[0, 100]} stroke="#b8b49e" tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={{ background: '#0b1728', border: '1px solid rgba(221,234,248,0.2)', borderRadius: 14, fontSize: 14 }}
                labelFormatter={(t: number) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                formatter={(v: number) => [v, label]}
              />
              <ReferenceLine y={50} stroke="rgba(221,234,248,0.25)" strokeDasharray="4 6" />
              {marks.map((a) => (
                <ReferenceLine
                  key={a.id}
                  x={Date.parse(a.openedAt)}
                  stroke={SEVERITY_COLOUR[a.severity] ?? '#e0a03c'}
                  strokeDasharray="3 3"
                  label={{ value: 'alert', position: 'insideTopRight', fill: SEVERITY_COLOUR[a.severity] ?? '#e0a03c', fontSize: 12 }}
                />
              ))}
              <Line type="monotone" dataKey="level" stroke={colour} strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 5 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  )
}
