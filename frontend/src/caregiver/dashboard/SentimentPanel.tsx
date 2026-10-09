import { useEffect, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { caregiver } from '../../lib/api'
import type { SentimentPoint } from '../../lib/types'

/**
 * How her journal entries have read over the last month: how warm each one felt, from -1 to 1. Only these
 * readings are shown, never her words and not the model's one-line gist. A line that slowly sinks is worth a
 * conversation; one low day is not.
 */

export default function SentimentPanel({ patientId, refreshKey }: { patientId: string; refreshKey: number }) {
  const [points, setPoints] = useState<SentimentPoint[] | null>(null)

  useEffect(() => {
    let alive = true
    caregiver
      .sentiment(patientId, 30)
      .then((p) => alive && setPoints(p))
      .catch(() => alive && setPoints([]))
    return () => {
      alive = false
    }
  }, [patientId, refreshKey])

  const data = (points ?? []).map((p) => ({ t: Date.parse(p.at), valence: Number(p.valence.toFixed(2)), flags: p.concernFlags }))
  const flagged = data.filter((d) => d.flags.length > 0).length

  return (
    <section className="soft-panel p-5">
      <h2 className="font-serif" style={{ fontSize: 24 }}>
        How her writing reads
      </h2>
      <p className="mb-3 font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
        Her journal, read for how it feels. Her words are never kept or shown; only this reading is.
      </p>
      {points === null ? (
        <p className="font-sans" style={{ color: 'var(--chalk-dim)' }}>
          One moment…
        </p>
      ) : data.length === 0 ? (
        <p className="font-sans" style={{ color: 'var(--chalk-dim)' }}>
          No journal entries have been read yet.
        </p>
      ) : (
        <>
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
                <CartesianGrid stroke="rgba(221,234,248,0.1)" vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                  stroke="#b8b49e"
                  tick={{ fontSize: 12 }}
                  minTickGap={30}
                />
                <YAxis domain={[-1, 1]} stroke="#b8b49e" tick={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke="rgba(221,234,248,0.25)" strokeDasharray="4 6" />
                <Tooltip
                  contentStyle={{ background: '#0b1728', border: '1px solid rgba(221,234,248,0.2)', borderRadius: 14, fontSize: 14 }}
                  labelFormatter={(t: number) => new Date(t).toLocaleString()}
                  formatter={(v: number) => [v, 'warmth']}
                />
                <Line type="monotone" dataKey="valence" stroke="#e8c84a" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {flagged > 0 && (
            <p className="mt-2 font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
              {flagged} of {data.length} {data.length === 1 ? 'entry' : 'entries'} carried a note of concern. Worth mentioning to her doctor if it
              keeps happening.
            </p>
          )}
        </>
      )}
    </section>
  )
}
