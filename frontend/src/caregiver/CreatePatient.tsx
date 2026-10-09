import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { HttpError, OfflineError, patients } from '../lib/api'
import { useAuth } from '../lib/auth'
import AuthShell, { Field, fieldStyle } from './AuthShell'

/**
 * Adding the person you care for.
 *
 * Nothing about her is recorded until the guardian has consented, and the
 * consent is itself recorded: which notice, by whom, when. The checkbox is not
 * pre-ticked and the button stays disabled until it is.
 */

const LANGUAGES: [string, string][] = [
  ['en', 'English'],
  ['as', 'অসমীয়া (Assamese)'],
  ['mni', 'মৈতৈলোন্ (Meitei)'],
  ['lus', 'Mizo'],
  ['hi', 'हिन्दी (Hindi)'],
  ['nag', 'Nagamese'],
]

export default function CreatePatient() {
  const navigate = useNavigate()
  const { reload } = useAuth()
  const [name, setName] = useState('')
  const [kinshipTerm, setKinshipTerm] = useState('')
  const [region, setRegion] = useState('')
  const [languageCode, setLanguageCode] = useState('en')
  const [guardianName, setGuardianName] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!consent) return
    setBusy(true)
    setError(null)
    try {
      const created = await patients.create({
        name,
        kinshipTerm,
        region,
        languageCode,
        guardianName,
        guardianConsent: consent,
      })
      await reload()
      navigate(`/caregiver/dashboard/${created.id}`, { replace: true })
    } catch (err) {
      setError(
        err instanceof OfflineError
          ? 'Smaran cannot be reached from here right now. Try again when you have signal.'
          : err instanceof HttpError && err.status === 400
            ? err.message
            : 'Something went wrong on our side. Please try again in a moment.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Who do you care for?" subtitle="This sets up her sanctuary. You can change all of it later.">
      <form onSubmit={submit} className="soft-panel flex flex-col gap-4 p-6">
        <Field label="Her name">
          <input value={name} onChange={(e) => setName(e.target.value)} required className="rounded-full px-4 py-3" style={fieldStyle} />
        </Field>
        <Field label="What does the family call her?" hint="Aaita, Ima, Pui… the word she answers to. Smaran uses exactly this, and never guesses.">
          <input value={kinshipTerm} onChange={(e) => setKinshipTerm(e.target.value)} className="rounded-full px-4 py-3" style={fieldStyle} />
        </Field>
        <Field label="Her language">
          <select value={languageCode} onChange={(e) => setLanguageCode(e.target.value)} className="rounded-full px-4 py-3" style={fieldStyle}>
            {LANGUAGES.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Where she lives">
          <input value={region} onChange={(e) => setRegion(e.target.value)} className="rounded-full px-4 py-3" style={fieldStyle} />
        </Field>

        <div className="flex flex-col gap-3 rounded-2xl p-4" style={{ background: 'rgba(8,15,30,0.5)', border: '1px solid rgba(221,234,248,0.15)' }}>
          <p className="font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
            Smaran records how she plays: her scores, how quickly she answers, her mood, and acoustic features of her voice. It never keeps a
            recording of her voice or a picture of her face. You choose who else can see this, and you can see who has looked. It is a
            companion, not a medical device, and it does not diagnose.
          </p>
          <Field label="Your name, as her guardian">
            <input value={guardianName} onChange={(e) => setGuardianName(e.target.value)} className="rounded-full px-4 py-3" style={fieldStyle} />
          </Field>
          <label className="flex items-start gap-3 font-sans" style={{ fontSize: 15, color: 'var(--chalk)' }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 4, width: 18, height: 18 }} />
            <span>I am her guardian, I have read this, and I agree to Smaran recording this on her behalf.</span>
          </label>
        </div>

        {error && (
          <p className="font-sans" style={{ fontSize: 15, color: 'var(--terracotta)' }} role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="pill mt-2"
          disabled={busy || !consent || !name.trim()}
          style={{ background: 'var(--olive-continue)', color: 'var(--chalk)', opacity: consent && name.trim() ? 1 : 0.5 }}
        >
          {busy ? 'One moment…' : 'Add her'}
        </button>
      </form>

      <Link to="/caregiver/dashboard" className="font-sans underline" style={{ fontSize: 14, color: 'var(--chalk-dim)', opacity: 0.7 }}>
        Not now
      </Link>
    </AuthShell>
  )
}
