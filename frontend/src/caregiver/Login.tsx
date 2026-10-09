import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { HttpError, OfflineError } from '../lib/api'
import { homeFor, useAuth } from '../lib/auth'
import AuthShell, { Field, fieldStyle } from './AuthShell'

/**
 * The way in for family, doctors and administrators.
 *
 * One door for all three: the server says which kind of person this is, and
 * they are sent to their own home. The patient never sees this screen.
 */
export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const user = await signIn(email, password)
      const from = (location.state as { from?: string } | null)?.from
      navigate(from && from !== '/caregiver/login' ? from : homeFor(user.role), { replace: true })
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="For family & carers" subtitle="Set up her sanctuary, and see how the week has been.">
      <form onSubmit={submit} className="soft-panel flex flex-col gap-4 p-6">
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            className="rounded-full px-4 py-3"
            style={fieldStyle}
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="rounded-full px-4 py-3"
            style={fieldStyle}
          />
        </Field>

        {error && (
          <p className="font-sans" style={{ fontSize: 15, color: 'var(--terracotta)' }} role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="pill mt-2" disabled={busy} style={{ background: 'var(--olive-continue)', color: 'var(--chalk)' }}>
          {busy ? 'One moment…' : 'Sign in'}
        </button>
      </form>

      <p className="font-sans" style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>
        New here?{' '}
        <Link to="/caregiver/register" className="underline" style={{ color: 'var(--chalk)' }}>
          Create an account
        </Link>
      </p>

      {/* Sample data, so the dashboard can be shown with no server behind it. Never in a production build. */}
      {import.meta.env.DEV && (
        <button
          type="button"
          onClick={() => navigate('/caregiver/demo')}
          className="text-left font-sans underline"
          style={{ fontSize: 14, color: 'var(--chalk-dim)', opacity: 0.6 }}
        >
          Show the sample dashboard (development only)
        </button>
      )}

      <Link to="/" className="font-sans underline" style={{ fontSize: 14, color: 'var(--chalk-dim)', opacity: 0.6 }}>
        Back to the pond
      </Link>
    </AuthShell>
  )
}

function messageFor(err: unknown): string {
  if (err instanceof OfflineError) return 'Smaran cannot be reached from here right now. Try again when you have signal.'
  if (err instanceof HttpError) {
    if (err.status === 429) return 'Too many tries just now. Wait a few minutes and try again.'
    if (err.status === 403) return err.message
    if (err.status === 401) return 'That did not match. Check the email and password.'
  }
  return 'Something went wrong on our side. Please try again in a moment.'
}
