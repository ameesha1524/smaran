import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { admin, type AdminUser } from '../lib/api'
import { useAuth } from '../lib/auth'

/**
 * The administrator's one job here: let doctors in.
 *
 * A doctor registers on their own and can do nothing until someone approves
 * them. Switching an account off ends its ability to renew its session at
 * once; an access token it already holds lasts until it expires, within
 * fifteen minutes.
 */

export default function AdminHome() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [pending, setPending] = useState<AdminUser[] | null>(null)
  const [everyone, setEveryone] = useState<AdminUser[]>([])
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const all = await admin.users()
      setEveryone(all)
      setPending(all.filter((u) => u.status === 'PENDING'))
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await load()
    } finally {
      setBusy(false)
    }
  }

  const leave = async () => {
    await signOut()
    navigate('/caregiver/login', { replace: true })
  }

  return (
    <div className="min-h-screen w-full px-5 py-8 sm:px-8" style={{ background: 'var(--indigo-deep)' }}>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-serif" style={{ fontSize: 34 }}>
            Administration
          </h1>
          <button type="button" onClick={() => void leave()} className="pill stone" style={{ padding: '8px 20px', fontSize: 16 }}>
            Sign out
          </button>
        </header>

        {failed && (
          <p className="font-sans" role="alert" style={{ color: 'var(--chalk-dim)' }}>
            Smaran cannot be reached from here right now.
          </p>
        )}

        <section className="soft-panel flex flex-col gap-3 p-5">
          <h2 className="font-serif" style={{ fontSize: 24 }}>
            Doctors waiting for approval
          </h2>
          {pending === null ? null : pending.length === 0 ? (
            <p className="font-sans" style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>
              No one is waiting.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {pending.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: 'rgba(8,15,30,0.5)' }}>
                  <span className="font-sans" style={{ fontSize: 16 }}>
                    {u.name}
                    <span style={{ color: 'var(--chalk-dim)', fontSize: 14 }}> · {u.email}</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act(() => admin.approve(u.id))}
                    className="pill"
                    style={{ background: 'var(--olive-continue)', color: 'var(--chalk)', padding: '6px 18px', fontSize: 15 }}
                  >
                    Approve
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="soft-panel flex flex-col gap-3 p-5">
          <h2 className="font-serif" style={{ fontSize: 24 }}>
            Everyone
          </h2>
          <ul className="flex flex-col gap-2">
            {everyone.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 font-sans" style={{ fontSize: 15 }}>
                <span>
                  {u.name} <span style={{ color: 'var(--chalk-dim)' }}>· {u.role.toLowerCase()} · {u.status.toLowerCase()}</span>
                </span>
                {u.status !== 'DISABLED' && u.role !== 'ADMIN' && (
                  <button type="button" disabled={busy} onClick={() => void act(() => admin.disable(u.id))} className="pill stone" style={{ padding: '4px 14px', fontSize: 14 }}>
                    Switch off
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
