import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { caregiver, doctor, patients } from '../lib/api'
import { watchPatient } from '../lib/sse'
import PairingPanel from './PairingPanel'
import AccessPanel from './AccessPanel'
import AlertsList from './dashboard/AlertsList'
import DomainCards from './dashboard/DomainCards'
import ActivityGrid from './dashboard/ActivityGrid'
import MarkersPanel from './dashboard/MarkersPanel'
import SentimentPanel from './dashboard/SentimentPanel'
import SessionTable, { labelsOf } from './dashboard/SessionTable'
import TrendChart from './dashboard/TrendChart'
import { relative } from './dashboard/shared'
import { useAuth } from '../lib/auth'
import { bloomCopy } from '../lib/gardenEngine'
import type { DashboardView, GrovePhase } from '../lib/types'

/**
 * The family's view, and, without the family around her, the doctor's.
 *
 * Its job is to answer four questions quickly, on a phone, in a corridor: is she
 * engaging, is anything below her own usual, is anything worth a doctor's time,
 * and what does the week actually look like.
 *
 * Everything on it is read from what the server stored. It shows what each
 * session said about her and why, never the raw taps, and it says "too early to
 * say" where a few sessions cannot tell a pattern from a bad day. It updates
 * itself when a session arrives.
 */

const PHASE_NAMES: Record<GrovePhase, string> = {
  1: 'Introduction',
  2: 'Recognition',
  3: 'Identification',
  4: 'Recall',
}

interface Choice {
  id: string
  name: string
}

export default function Dashboard() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const params = useParams()
  const [data, setData] = useState<DashboardView | null>(null)
  const [denied, setDenied] = useState<number | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [reportBusy, setReportBusy] = useState(false)
  const [sharedUntil, setSharedUntil] = useState<string | null>(null)
  const [choices, setChoices] = useState<Choice[]>([])
  const [live, setLive] = useState(false)
  // Goes up whenever the server says something changed; every panel reads again when it does.
  const [tick, setTick] = useState(0)

  // A doctor reads and nothing more. The server enforces this; here it only
  // decides which controls are worth showing.
  const readOnly = user?.role === 'DOCTOR'
  const patientId = params.patientId ?? user?.patientIds[0] ?? null

  useEffect(() => {
    if (!patientId) return
    let alive = true
    if (tick === 0) {
      setData(null)
      setDenied(null)
      setUnreachable(false)
    }
    void caregiver.dashboard(patientId).then((result) => {
      if (!alive) return
      if (result.kind === 'ok') setData(result.data)
      else if (result.kind === 'denied') {
        setData(null)
        setDenied(result.status)
      } else setUnreachable(true)
    })
    return () => {
      alive = false
    }
  }, [patientId, tick])

  // New patient: start the counter over so the screen shows "opening" rather than the last patient.
  useEffect(() => setTick(0), [patientId])

  // Live: when the server says a session or alert arrived, read again (once, however many arrive together).
  const timer = useRef<number | null>(null)
  const poke = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setTick((t) => t + 1), 600)
  }, [])
  useEffect(() => {
    if (!patientId || !user) return
    const stop = watchPatient(patientId, () => poke(), setLive)
    return () => {
      stop()
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [patientId, user, poke])

  // The patients this person may switch between.
  useEffect(() => {
    if (!user) return
    let alive = true
    const load =
      user.role === 'DOCTOR'
        ? doctor.patients().then((l) => l.map((p) => ({ id: p.patientId, name: p.name })))
        : user.role === 'CAREGIVER'
          ? patients.mine().then((l) => l.map((p) => ({ id: p.id, name: p.name })))
          : Promise.resolve([] as Choice[])
    load.then((l) => alive && setChoices(l)).catch(() => undefined)
    if (user.role === 'DOCTOR' && patientId) {
      doctor
        .patients()
        .then((l) => alive && setSharedUntil(l.find((p) => p.patientId === patientId)?.sharedUntil ?? null))
        .catch(() => undefined)
    }
    return () => {
      alive = false
    }
  }, [user, patientId])

  const openReport = async () => {
    if (!patientId) return
    setReportBusy(true)
    try {
      const url = URL.createObjectURL(await caregiver.report(patientId))
      window.open(url, '_blank', 'noopener')
      // The new tab has read it by now; do not keep the file in memory.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      /* the button simply does nothing more: there is no report to show */
    } finally {
      setReportBusy(false)
    }
  }

  const leave = async () => {
    await signOut()
    navigate('/caregiver/login', { replace: true })
  }

  const switchTo = (id: string) => navigate(readOnly ? `/doctor/patient/${id}` : `/caregiver/dashboard/${id}`)

  const labels = useMemo(() => (data ? labelsOf(data) : {}), [data])

  if (!data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center" style={{ color: 'var(--chalk-dim)' }}>
        {!patientId ? (
          <>
            <p className="font-sans" style={{ fontSize: 18 }}>
              {readOnly ? 'No patient has been shared with you yet.' : 'You have not added anyone yet.'}
            </p>
            {!readOnly && (
              <Link to="/caregiver/patients/new" className="pill" style={{ background: 'var(--olive-continue)', color: 'var(--chalk)' }}>
                Add the person you care for
              </Link>
            )}
          </>
        ) : denied !== null ? (
          <p className="font-sans" role="alert" style={{ fontSize: 18 }}>
            {denied === 401
              ? 'Please sign in again.'
              : 'She was not found, or you no longer have access to her. If a family member shared her with you, the sharing may have ended.'}
          </p>
        ) : unreachable ? (
          <p className="font-sans" role="alert" style={{ fontSize: 18 }}>
            Smaran cannot be reached from here right now. Her dashboard needs a connection.
          </p>
        ) : (
          <p className="font-sans">Opening her week…</p>
        )}
        {user && (
          <button type="button" onClick={() => void leave()} className="font-sans underline" style={{ fontSize: 14, opacity: 0.7 }}>
            Sign out
          </button>
        )}
      </div>
    )
  }

  const chartable = [...data.domains, ...data.subSignals]

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
              addressed as {data.patient.kinshipTerm} · {bloomCopy(data.garden).toLowerCase()}
              {live && (
                <span style={{ marginLeft: 12, fontSize: 13 }} aria-live="polite">
                  <span style={{ color: '#9fb28a' }}>●</span> live
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {choices.length > 1 && (
              <label className="font-sans">
                <span className="sr-only">Switch patient</span>
                <select
                  value={patientId ?? ''}
                  onChange={(e) => switchTo(e.target.value)}
                  className="rounded-full px-4 py-2"
                  style={{ background: 'rgba(8,15,30,0.7)', border: '1px solid rgba(221,234,248,0.2)', color: 'var(--chalk)', fontSize: 16 }}
                >
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!readOnly && import.meta.env.DEV && (
              <Link to="/caregiver/setup" className="pill stone" style={{ padding: '10px 22px', fontSize: 17 }}>
                Setup
              </Link>
            )}
            <button
              type="button"
              onClick={() => void openReport()}
              disabled={reportBusy}
              className="pill"
              style={{ background: 'var(--olive-continue)', color: 'var(--chalk)', padding: '10px 22px', fontSize: 17 }}
            >
              {reportBusy ? 'One moment…' : 'PDF for the doctor'}
            </button>
            {!readOnly && (
              <Link to="/caregiver/patients/new" className="pill stone" style={{ padding: '10px 22px', fontSize: 17 }}>
                Add another person
              </Link>
            )}
            {user && (
              <button type="button" onClick={() => void leave()} className="pill stone" style={{ padding: '10px 22px', fontSize: 17 }}>
                Sign out
              </button>
            )}
          </div>
        </header>

        {readOnly && (
          <p className="font-sans" role="status" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
            Read-only.{' '}
            {sharedUntil
              ? `Shared with you until ${new Date(sharedUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.`
              : 'Shared with you by her family.'}{' '}
            <Link to="/doctor" className="underline">
              All your patients
            </Link>
          </p>
        )}

        {/* ------------------------------------------------------- alerts */}
        <AlertsList patientId={data.patient.id} alerts={data.alerts} canAcknowledge={!readOnly} onChanged={() => setTick((t) => t + 1)} />

        {/* --------------------------------------------------- stat cards */}
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Sessions this week" value={String(data.sessionsLast7Days)} />
          <Stat label="Garden" value={`Stage ${data.garden.bloomStage} · ${data.garden.bloomCount} blooms`} />
          <Stat label="Last active" value={relative(data.lastActive)} />
          <Stat label="Mood lately" value={commonMood(data)} />
        </section>

        {/* ------------------------------------------------- domain cards */}
        <DomainCards
          cards={data.domains}
          title="Where she is"
          note="Each card compares her latest sessions with her own usual. Until a domain has about five readings, it says it is too early to tell."
        />

        {/* ---------------------------------------------------- the trend */}
        <TrendChart patientId={data.patient.id} options={chartable} alerts={data.alerts} refreshKey={tick} />

        <MarkersPanel markers={data.markers} />
        <DomainCards cards={data.subSignals} title="What the games measure along the way" />

        <div className="grid gap-5 lg:grid-cols-2">
          <SessionTable patientId={data.patient.id} labels={labels} refreshKey={tick} />

          <ActivityGrid cells={data.activity} />
          <SentimentPanel patientId={data.patient.id} refreshKey={tick} />

          {/* ------------------------------------------- family phase map */}
          {!data.doctorView && data.familyPhases.length > 0 && (
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
                          style={{ flex: 1, height: 8, borderRadius: 999, background: p <= f.phase ? 'var(--gold)' : 'rgba(221,234,248,0.16)' }}
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
          )}

          {/* ---------------------------------------------- voice trend */}
          <section className="soft-panel p-5">
            <h2 className="font-serif" style={{ fontSize: 24 }}>
              Voice, 30 days
            </h2>
            <p className="mb-3 font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
              Acoustic features only — no recording of her voice is stored anywhere.
            </p>
            {data.acousticTrend.length === 0 ? (
              <p className="font-sans" style={{ color: 'var(--chalk-dim)' }}>
                No voice readings yet.
              </p>
            ) : (
              <div style={{ width: '100%', height: 200 }}>
                <ResponsiveContainer>
                  <LineChart data={data.acousticTrend.map((r) => ({ ...r, label: r.date.slice(5) }))} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
                    <CartesianGrid stroke="rgba(221,234,248,0.1)" vertical={false} />
                    <XAxis dataKey="label" stroke="#b8b49e" tick={{ fontSize: 12 }} minTickGap={30} />
                    <YAxis stroke="#b8b49e" tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: '#0b1728', border: '1px solid rgba(221,234,248,0.2)', borderRadius: 14, fontSize: 14 }} />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Line type="monotone" dataKey="jitter" name="Jitter" stroke="#e8c84a" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="shimmer" name="Shimmer" stroke="#c8773a" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {!readOnly && (
            <>
              <PairingPanel patientId={data.patient.id} />
              <AccessPanel patientId={data.patient.id} />
            </>
          )}
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

function commonMood(data: DashboardView): string {
  const counts = new Map<string, number>()
  for (const m of data.moodTrend) counts.set(m.mood, (counts.get(m.mood) ?? 0) + 1)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  return top ? top[0].replace(/_/g, ' ').toLowerCase() : '—'
}
