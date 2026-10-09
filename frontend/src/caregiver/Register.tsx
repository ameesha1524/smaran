import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { HttpError, OfflineError } from '../lib/api'
import { homeFor, useAuth } from '../lib/auth'
import AuthShell, { Field, fieldStyle } from './AuthShell'

/**
 * Creating an account, as a family member or as a doctor.
 *
 * A family member is signed in straight away. A doctor is told, plainly, that
 * an administrator has to approve them first: until then they can see
 * nothing, and no patient can be shared with them.
 */
export default function Register() {
  const navigate = useNavigate()
  const { signUp } = useAuth()
  const [role, setRole] = useState<'CAREGIVER' | 'DOCTOR'>('CAREGIVER')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [waiting, setWaiting] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await signUp({ name, email, password, role })
      if (result.session) {
        navigate(homeFor(result.session.role), { replace: true })
      } else {
        setWaiting(result.message)
      }
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  if (waiting) {
    return (
      <AuthShell title="Thank you" subtitle="Your account has been created.">
        <div className="soft-panel flex flex-col gap-4 p-6" role="status">
          <p className="font-sans" style={{ fontSize: 17, color: 'var(--chalk)' }}>
            {waiting}
          </p>
          <Link to="/caregiver/login" className="pill" style={{ background: 'var(--olive-continue)', color: 'var(--chalk)', textAlign: 'center' }}>
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Create an account" subtitle="For the people who look after her, and the doctors who see her.">
      <form onSubmit={submit} className="soft-panel flex flex-col gap-4 p-6">
        <fieldset className="flex gap-3" aria-label="I am a">
          {(
            [
              ['CAREGIVER', 'Family or carer'],
              ['DOCTOR', 'Doctor'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={role === value}
              onClick={() => setRole(value)}
              className="pill stone flex-1"
              style={{
                padding: '10px 14px',
                fontSize: 16,
                outline: role === value ? '2px solid var(--chalk)' : 'none',
                opacity: role === value ? 1 : 0.65,
              }}
            >
              {label}
            </button>
          ))}
        </fieldset>

        <Field label="Your name">
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required className="rounded-full px-4 py-3" style={fieldStyle} />
        </Field>
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required className="rounded-full px-4 py-3" style={fieldStyle} />
        </Field>
        <Field label="Password" hint="At least 10 characters. A few ordinary words together work well.">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={10}
            required
            className="rounded-full px-4 py-3"
            style={fieldStyle}
          />
        </Field>

        {role === 'DOCTOR' && (
          <p className="font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
            An administrator approves doctors before they can sign in. A family then chooses which patients to share with you, and for how long.
          </p>
        )}
        {error && (
          <p className="font-sans" style={{ fontSize: 15, color: 'var(--terracotta)' }} role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="pill mt-2" disabled={busy} style={{ background: 'var(--olive-continue)', color: 'var(--chalk)' }}>
          {busy ? 'One moment…' : 'Create account'}
        </button>
      </form>

      <p className="font-sans" style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>
        Already have one?{' '}
        <Link to="/caregiver/login" className="underline" style={{ color: 'var(--chalk)' }}>
          Sign in
        </Link>
      </p>
    </AuthShell>
  )
}

function messageFor(err: unknown): string {
  if (err instanceof OfflineError) return 'Smaran cannot be reached from here right now. Try again when you have signal.'
  if (err instanceof HttpError) {
    if (err.status === 429) return 'Too many sign-ups from here. Try again later.'
    // 400 and 409 carry a sentence the server wrote for a person: use it as it is.
    if (err.status === 400 || err.status === 409) return err.message
  }
  return 'Something went wrong on our side. Please try again in a moment.'
}
