import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { caregiver } from '../lib/api'
import { sampleDashboard } from './sampleDashboard'
import { useSmaran } from '../state/SmaranContext'
import { bloomCopy } from '../lib/gardenEngine'
import type { DashboardAlert, DashboardSummary, GameType, GrovePhase } from '../lib/types'

/**
 * The caregiver's view.
 *
 * Its job is to answer four questions quickly, on a phone, in a corridor:
 * is she engaging, is anything declining, is anything worth a doctor's time,
 * and what does the week actually look like.
 *
 * It shows aggregate trends, not raw session telemetry — the caregiver has no
 * clinical need for every tap, and data minimisation is part of the DPDP story.
 */

const GAME_NAMES: Record<GameType, string> = {
  WEAVERS_LOOM: "The Weaver's Loom",
  GRANDMOTHERS_TALE: "Grandmother's Tale",
  FAMILY_GROVE: 'Family Grove',
  MORNING_RITUALS: 'Morning Rituals',
}

const DOMAIN_LINES = [
  { key: 'language', name: 'Language', colour: '#e8c84a' },
  { key: 'visualSemantic', name: 'Visual-semantic', colour: '#c8773a' },
  { key: 'motor', name: 'Motor', colour: '#7a9bd4' },
  { key: 'affective', name: 'Affective', colour: '#ddeaf8' },
  { key: 'temporal', name: 'Temporal', colour: '#5a7840' },
] as const

const ALERT_COLOUR: Record<DashboardAlert['level'], string> = {
  ORANGE: '#c8773a',
  AMBER: '#e0a03c',
  YELLOW: '#e8c84a',
}

const PHASE_NAMES: Record<GrovePhase, string> = {
  1: 'Introduction',
  2: 'Recognition',
  3: 'Identification',
  4: 'Recall',
}

export default function Dashboard() {
  const { patient } = useSmaran()
  const [data, setData] = useState<DashboardSummary | null>(null)
  const [usingSample, setUsingSample] = useState(false)

  useEffect(() => {
    let alive = true
    void caregiver.dashboard(patient.id).then((fresh) => {
      if (!alive) return
      if (fresh) {
        setData(fresh)
      } else {
        setData(sampleDashboard())
        setUsingSample(true)
      }
    })
    return () => {
      alive = false
    }
  }, [patient.id])

  const chartData = useMemo(
    () =>
      (data?.domainTrend ?? []).map((row) => ({
        ...row,
        label: row.date.slice(5),
      })),
    [data],
  )

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ color: 'var(--chalk-dim)' }}>
        Opening her week…
      </div>
    )
  }

  const maxMinutes = Math.max(1, ...data.heatmap.map((h) => h.minutes))

  return (
    <div className="min-h-screen w-full px-5 py-7 sm:px-8" style={{ background: 'var(--indigo-deep)' }}>
      <div className="mx-auto flex max-w-6xl flex-col gap-7">
        {/* ------------------------------------------------------- header */}
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif" style={{ fontSize: 38 }}>
              {data.patient.name}
            </h1>
            <p className="font-sans" style={{ fontSize: 16, color: 'var(--chalk-dim)' }}>
              {data.patient.region} · addressed as {data.patient.kinshipTerm} · {bloomCopy(data.garden).toLowerCase()}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/caregiver/setup" className="pill stone" style={{ padding: '10px 22px', fontSize: 17 }}>
              Setup
            </Link>
            <a
              href={caregiver.reportUrl(patient.id)}
              target="_blank"
              rel="noreferrer"
              className="pill"
              style={{ background: 'var(--olive-continue)', color: 'var(--chalk)', padding: '10px 22px', fontSize: 17 }}
            >
              PDF for the doctor
            </a>
            <Link to="/" className="pill stone" style={{ padding: '10px 22px', fontSize: 17 }}>
              Her sanctuary
            </Link>
          </div>
        </header>

        {usingSample && (
          <p className="font-sans" style={{ fontSize: 13, color: 'var(--chalk-dim)', opacity: 0.6 }}>
            Showing sample data — the backend is not reachable from this device right now.
          </p>
        )}

        {/* ------------------------------------------------------- alerts */}
        {data.alerts.length > 0 && (
          <section className="flex flex-col gap-3">
            {data.alerts.map((a) => (
              <div
                key={a.code}
                className="flex items-start gap-3 rounded-2xl px-5 py-4"
                style={{ background: `${ALERT_COLOUR[a.level]}1a`, border: `1px solid ${ALERT_COLOUR[a.level]}66` }}
                role="status"
              >
                <span style={{ color: ALERT_COLOUR[a.level], fontSize: 20 }} aria-hidden="true">
                  ◆
                </span>
                <p className="font-sans" style={{ fontSize: 16, color: 'var(--chalk)' }}>
                  {a.message}
                </p>
              </div>
            ))}
          </section>
        )}

        {/* --------------------------------------------------- stat cards */}
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Sessions this week" value={String(data.sessionsThisWeek)} />
          <Stat label="Garden" value={`Stage ${data.garden.bloomStage} · ${data.garden.bloomCount} blooms`} />
          <Stat label="Last active" value={data.lastActive ? relative(data.lastActive) : 'not yet'} />
          <Stat label="Mood lately" value={commonMood(data)} />
        </section>

        {/* ---------------------------------------------- cognitive trend */}
        <section className="soft-panel p-5">
          <h2 className="font-serif" style={{ fontSize: 24 }}>
            Cognitive trend, 30 days
          </h2>
          <p className="mb-3 font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
            One line per domain. A single line falling while the others hold is the pattern worth a conversation.
          </p>
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
                <CartesianGrid stroke="rgba(221,234,248,0.1)" vertical={false} />
                <XAxis dataKey="label" stroke="#b8b49e" tick={{ fontSize: 12 }} minTickGap={24} />
                <YAxis domain={[0, 1]} stroke="#b8b49e" tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    background: '#0b1728',
                    border: '1px solid rgba(221,234,248,0.2)',
                    borderRadius: 14,
                    fontSize: 14,
                  }}
                  labelStyle={{ color: '#b8b49e' }}
                />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                {DOMAIN_LINES.map((d) => (
                  <Line
                    key={d.key}
                    type="monotone"
                    dataKey={d.key}
                    name={d.name}
                    stroke={d.colour}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* ------------------------------------------------- heatmap */}
          <section className="soft-panel p-5">
            <h2 className="font-serif" style={{ fontSize: 24 }}>
              When she plays
            </h2>
            <div className="mt-4 flex items-end gap-3">
              {data.heatmap.map((h) => (
                <div key={h.date} className="flex flex-1 flex-col items-center gap-2">
                  <div
                    style={{
                      width: '100%',
                      height: 12 + (h.minutes / maxMinutes) * 110,
                      borderRadius: 12,
                      background:
                        h.minutes === 0
                          ? 'rgba(221,234,248,0.1)'
                          : `rgba(232,200,74,${0.25 + (h.minutes / maxMinutes) * 0.6})`,
                    }}
                    title={`${h.minutes} minutes`}
                  />
                  <span className="font-sans" style={{ fontSize: 12, color: 'var(--chalk-dim)' }}>
                    {weekday(h.date)}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
              A quiet day is a resting day. The garden does not lose anything.
            </p>
          </section>

          {/* -------------------------------------------- per-game table */}
          <section className="soft-panel p-5">
            <h2 className="font-serif" style={{ fontSize: 24 }}>
              By game
            </h2>
            <table className="mt-3 w-full text-left">
              <thead>
                <tr style={{ color: 'var(--chalk-dim)', fontSize: 14 }}>
                  <th className="pb-2">Game</th>
                  <th className="pb-2">Sessions</th>
                  <th className="pb-2">Average</th>
                  <th className="pb-2">Trend</th>
                </tr>
              </thead>
              <tbody>
                {data.perGame.map((g) => (
                  <tr key={g.gameType} style={{ borderTop: '1px solid rgba(221,234,248,0.12)' }}>
                    <td className="py-2" style={{ fontSize: 16 }}>
                      {GAME_NAMES[g.gameType]}
                    </td>
                    <td style={{ fontSize: 16 }}>{g.sessions}</td>
                    <td style={{ fontSize: 16 }}>{Math.round(g.avgScore * 100)}%</td>
                    <td style={{ fontSize: 18, color: g.trend === 'DOWN' ? 'var(--terracotta)' : 'var(--olive-light)' }}>
                      {g.trend === 'UP' ? '↑' : g.trend === 'DOWN' ? '↓' : '→'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* ------------------------------------------- family phase map */}
          <section className="soft-panel p-5">
            <h2 className="font-serif" style={{ fontSize: 24 }}>
              Who she still knows
            </h2>
            <p className="mb-3 font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
              Each person advances on their own. Phase 4 means she recalls them without a prompt.
            </p>
            <ul className="flex flex-col gap-3">
              {data.familyPhases.map((f) => (
                <li key={f.id} className="flex items-center gap-3">
                  <span style={{ fontSize: 17, minWidth: 120 }}>{f.name}</span>
                  <span className="flex flex-1 gap-1">
                    {[1, 2, 3, 4].map((p) => (
                      <span
                        key={p}
                        style={{
                          flex: 1,
                          height: 8,
                          borderRadius: 999,
                          background: p <= f.phase ? 'var(--gold)' : 'rgba(221,234,248,0.16)',
                        }}
                      />
                    ))}
                  </span>
                  <span className="font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)', minWidth: 110 }}>
                    {PHASE_NAMES[f.phase]}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* ---------------------------------------------- voice trend */}
          <section className="soft-panel p-5">
            <h2 className="font-serif" style={{ fontSize: 24 }}>
              Voice, 30 days
            </h2>
            <p className="mb-3 font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
              Acoustic features only — no recording of her voice is stored anywhere.
            </p>
            <div style={{ width: '100%', height: 200 }}>
              <ResponsiveContainer>
                <LineChart data={data.acousticTrend.map((r) => ({ ...r, label: r.date.slice(5) }))} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
                  <CartesianGrid stroke="rgba(221,234,248,0.1)" vertical={false} />
                  <XAxis dataKey="label" stroke="#b8b49e" tick={{ fontSize: 12 }} minTickGap={30} />
                  <YAxis stroke="#b8b49e" tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: '#0b1728', border: '1px solid rgba(221,234,248,0.2)', borderRadius: 14, fontSize: 14 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 13 }} />
                  <Line type="monotone" dataKey="jitter" name="Jitter" stroke="#e8c84a" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="shimmer" name="Shimmer" stroke="#c8773a" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        <footer className="pb-8 pt-2 font-sans" style={{ fontSize: 13, color: 'var(--chalk-dim)', opacity: 0.55 }}>
          Smaran shows trends, not diagnoses. Anything flagged here is a prompt for a conversation with a clinician.
        </footer>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ fragments */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="soft-panel px-5 py-4">
      <p className="font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
        {label}
      </p>
      <p className="mt-1 font-serif" style={{ fontSize: 24 }}>
        {value}
      </p>
    </div>
  )
}

function relative(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}

function weekday(date: string): string {
  return new Date(date).toLocaleDateString(undefined, { weekday: 'short' })
}

function commonMood(data: DashboardSummary): string {
  const counts = new Map<string, number>()
  for (const m of data.moodTrend) counts.set(m.mood, (counts.get(m.mood) ?? 0) + 1)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  return top ? top[0].replace(/_/g, ' ').toLowerCase() : '—'
}
