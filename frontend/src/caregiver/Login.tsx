import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Sanctuary from '../scenes/Sanctuary'
import { auth, setTokens } from '../lib/api'

/**
 * The caregiver's way in.
 *
 * Deliberately a different register from the patient app: this person is tired,
 * probably on a phone, probably in another city, and needs a form that behaves
 * like a form. The pond is still behind them, receded — it is the same house.
 */

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await auth.login(email, password)
      setTokens(res.accessToken, res.refreshToken)
      navigate('/caregiver/dashboard')
    } catch {
      setError('That did not work. Check the email and password, or try again when you have signal.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      <Sanctuary phase="night" bloomStage={2} recede />

      <div className="relative z-20 mx-auto flex min-h-screen max-w-md flex-col justify-center gap-7 px-6">
        <div>
          <h1 className="inscription font-serif" style={{ fontSize: 40 }}>
            For family &amp; carers
          </h1>
          <p className="mt-2 font-sans" style={{ fontSize: 16, color: 'var(--chalk-dim)' }}>
            Set up her sanctuary, and see how the week has been.
          </p>
        </div>

        <form onSubmit={submit} className="soft-panel flex flex-col gap-4 p-6">
          <label className="flex flex-col gap-2">
            <span style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              className="rounded-full px-4 py-3"
              style={{ background: 'rgba(8,15,30,0.7)', border: '1px solid rgba(221,234,248,0.2)', color: 'var(--chalk)', fontSize: 18 }}
            />
          </label>

          <label className="flex flex-col gap-2">
            <span style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="rounded-full px-4 py-3"
              style={{ background: 'rgba(8,15,30,0.7)', border: '1px solid rgba(221,234,248,0.2)', color: 'var(--chalk)', fontSize: 18 }}
            />
          </label>

          {error && (
            <p className="font-sans" style={{ fontSize: 15, color: 'var(--terracotta)' }} role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="pill mt-2" disabled={busy} style={{ background: 'var(--olive-continue)', color: 'var(--chalk)' }}>
            {busy ? 'One moment…' : 'Sign in'}
          </button>
        </form>

        {/* A demo must be openable on a stage with no backend behind it. */}
        <button
          type="button"
          onClick={() => navigate('/caregiver/dashboard')}
          className="font-sans underline"
          style={{ fontSize: 14, color: 'var(--chalk-dim)', opacity: 0.6 }}
        >
          Continue without signing in (demo data)
        </button>

        <Link to="/" className="font-sans underline" style={{ fontSize: 14, color: 'var(--chalk-dim)', opacity: 0.6 }}>
          Back to the pond
        </Link>
      </div>
    </div>
  )
}
