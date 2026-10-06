import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Sanctuary from '../scenes/Sanctuary'
import { PairingError, pairing, type PairingFailure } from '../lib/api'
import { useSmaran } from '../state/SmaranContext'

/**
 * The tablet's first screen: pair it with the family's account.
 *
 * Operated by the family member setting the tablet up, never by her, so it is
 * in the caregiver register — a plain form, plain errors. The family generates
 * a code on their own phone (Dashboard → "Her tablet"), types it here once,
 * and the tablet takes on her record, her profile and a device token scoped to
 * her alone. Nothing about accounts ever reaches the patient side.
 *
 * Pairing needs the server exactly once. A family with no account, or no
 * signal, can still set the tablet up locally — the link at the bottom.
 */

const MESSAGES: Record<PairingFailure, string> = {
  invalid: 'That code didn’t work. Codes last ten minutes and work once — ask for a fresh one on the family phone.',
  'rate-limited': 'Too many codes tried from here. Wait fifteen minutes, then try again with a fresh code.',
  offline: 'Pairing needs an internet connection, just this once. Check the Wi-Fi and try again.',
  forbidden: 'This code can’t be used here. Ask for a fresh one on the family phone.',
  unknown: 'Something went wrong on our side. Please try again in a moment.',
}

/** Uppercase, strip everything but letters and digits, and group as XXXX-XXXX. */
function formatCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean
}

export default function PairDevice() {
  const navigate = useNavigate()
  const { adoptPairing } = useSmaran()
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const complete = code.replace('-', '').length === 8

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!complete || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await pairing.redeem(code, label.trim() || 'Her tablet')
      await adoptPairing(result)
      // From here the patient entry takes over: language, then the pond.
      navigate('/', { replace: true })
    } catch (err) {
      setError(MESSAGES[err instanceof PairingError ? err.reason : 'unknown'])
    } finally {
      setBusy(false)
    }
  }

  const field = {
    background: 'rgba(8,15,30,0.7)',
    border: '1px solid rgba(221,234,248,0.2)',
    color: 'var(--chalk)',
  } as const

  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      <Sanctuary phase="night" bloomStage={2} recede />

      <div className="relative z-20 mx-auto flex min-h-screen max-w-md flex-col justify-center gap-7 px-6 py-10">
        <div>
          <h1 className="inscription font-serif" style={{ fontSize: 40 }}>
            Pair this tablet
          </h1>
          <p className="mt-2 font-sans" style={{ fontSize: 16, color: 'var(--chalk-dim)' }}>
            On your own phone, open Smaran for family, go to <strong>Her tablet</strong>, and choose{' '}
            <strong>Get a pairing code</strong>. Type the code it shows here.
          </p>
        </div>

        <form onSubmit={submit} className="soft-panel flex flex-col gap-4 p-6">
          <label className="flex flex-col gap-2">
            <span style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>Pairing code</span>
            <input
              value={code}
              onChange={(e) => setCode(formatCode(e.target.value))}
              placeholder="ABCD-EFGH"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              maxLength={9}
              required
              aria-describedby="pair-hint"
              className="rounded-2xl px-4 py-3 text-center"
              style={{ ...field, fontFamily: "'VT323', monospace", fontSize: 38, letterSpacing: '0.18em' }}
            />
            <span id="pair-hint" style={{ fontSize: 13, color: 'var(--chalk-dim)' }}>
              Eight letters and numbers. Capitals don’t matter.
            </span>
          </label>

          <label className="flex flex-col gap-2">
            <span style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>What should we call this tablet? (optional)</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value.slice(0, 120))}
              placeholder="Living-room tablet"
              autoComplete="off"
              className="rounded-full px-4 py-3"
              style={{ ...field, fontSize: 18 }}
            />
          </label>

          {error && (
            <p className="font-sans" style={{ fontSize: 15, color: 'var(--terracotta)' }} role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!complete || busy}
            className="pill"
            style={{
              background: 'var(--olive-continue)',
              color: 'var(--chalk)',
              padding: '14px 22px',
              fontSize: 18,
              opacity: !complete || busy ? 0.55 : 1,
              cursor: !complete || busy ? 'default' : 'pointer',
            }}
          >
            {busy ? 'Pairing…' : 'Pair tablet'}
          </button>
        </form>

        <p className="font-sans" style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>
          No family account, or no internet here?{' '}
          <Link to="/caregiver/setup" style={{ color: 'var(--chalk)', textDecoration: 'underline' }}>
            Set up on this tablet only
          </Link>
          . Nothing will be shared until you pair it later.
        </p>
      </div>
    </div>
  )
}
