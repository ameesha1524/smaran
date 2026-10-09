import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { doctor, type SharedPatient } from '../lib/api'
import { useAuth } from '../lib/auth'

/**
 * A doctor's starting point: the patients a family has chosen to share, and
 * until when. From here a doctor can open a patient's trends and the one-page
 * report. That is all a doctor is given; the server refuses everything else.
 */

function until(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function DoctorHome() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [patients, setPatients] = useState<SharedPatient[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    doctor
      .patients()
      .then((list) => alive && setPatients(list))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])

  const leave = async () => {
    await signOut()
    navigate('/caregiver/login', { replace: true })
  }

  return (
    <div className="min-h-screen w-full px-5 py-8 sm:px-8" style={{ background: 'var(--indigo-deep)' }}>
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif" style={{ fontSize: 34 }}>
              {user ? `Dr. ${user.name.replace(/^dr\.?\s+/i, '')}` : 'Doctor'}
            </h1>
            <p className="font-sans" style={{ fontSize: 16, color: 'var(--chalk-dim)' }}>
              The patients shared with you
            </p>
          </div>
          <button type="button" onClick={() => void leave()} className="pill stone" style={{ padding: '8px 20px', fontSize: 16 }}>
            Sign out
          </button>
        </header>

        {failed ? (
          <p className="font-sans" role="alert" style={{ color: 'var(--chalk-dim)' }}>
            Smaran cannot be reached from here right now.
          </p>
        ) : patients === null ? (
          <p className="font-sans" style={{ color: 'var(--chalk-dim)' }}>
            One moment…
          </p>
        ) : patients.length === 0 ? (
          <div className="soft-panel p-6">
            <p className="font-sans" style={{ fontSize: 17 }}>
              No patient has been shared with you yet.
            </p>
            <p className="mt-2 font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
              A family member shares a patient with you by your email address, for a time they choose. It appears here as soon as they do.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {patients.map((p) => (
              <li key={p.patientId} className="soft-panel flex flex-wrap items-center justify-between gap-3 p-5">
                <div>
                  <p className="font-serif" style={{ fontSize: 24 }}>
                    {p.name}
                  </p>
                  <p className="font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
                    Shared until {until(p.sharedUntil)}
                  </p>
                </div>
                <Link
                  to={`/doctor/patient/${p.patientId}`}
                  className="pill"
                  style={{ background: 'var(--olive-continue)', color: 'var(--chalk)', padding: '8px 22px', fontSize: 16 }}
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
