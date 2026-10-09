import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PixelPond, { useStageScale } from '../scenes/PixelPond'
import { PairingError, pairing, type PairingFailure } from '../lib/api'
import { PAIRING_CODE_LENGTH, isComplete, normaliseTyped } from '../lib/pairingCode'
import { useSmaran } from '../state/SmaranContext'

/**
 * The tablet's first screen: pair it with the family's account.
 *
 * Whoever holds the tablet types the code the family's phone is showing. The
 * code is six symbols, shown as HJ4K-2M, and works once, for three days.
 * Pairing needs the internet exactly once; after that the tablet works without it.
 *
 * It is drawn on the pond so that the first thing the tablet shows is already
 * hers, and so the touch targets are the large ones the rest of her screens use.
 * Errors are gentle and never say which way a code failed: a wrong code, an old
 * one and one already used all read the same.
 */

const MESSAGES: Record<PairingFailure, string> = {
  invalid:
    'That code didn’t work. Please look at it again, or ask for a new one on the family phone. A code works once, and lasts three days.',
  'rate-limited': 'Let’s take a little rest. Please try again in a few minutes.',
  offline: 'Pairing needs the internet, just this once. Please check the Wi-Fi and try again.',
  forbidden: 'That code didn’t work. Please ask for a new one on the family phone.',
  unknown: 'Something went wrong on our side. Please try again in a moment.',
}

const PIXEL = "'Pixelify Sans', 'Noto Sans Bengali', 'Noto Sans Devanagari', sans-serif"
const SANS = "'Noto Sans', system-ui, sans-serif"

/** One square of the code: empty, filled, or the one waiting for the next symbol. */
function Cell({ char, active }: { char: string; active: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 'clamp(52px, 11vw, 84px)',
        height: 'clamp(68px, 14vw, 104px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#121b44',
        border: `4px solid ${active ? '#f0c94a' : '#3a4c8c'}`,
        boxShadow: '4px 4px 0 #070d26, inset 0 4px 0 #22306a',
        fontFamily: PIXEL,
        fontSize: 'clamp(34px, 6.5vw, 58px)',
        color: '#f0c94a',
        textShadow: '3px 3px 0 #3a2c08',
      }}
    >
      {char}
    </span>
  )
}

export default function Pair() {
  const navigate = useNavigate()
  const scale = useStageScale()
  const { adoptPairing, devicePaired, legacyLocalSetup } = useSmaran()
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const complete = isComplete(code)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!complete || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await pairing.redeem(code, label.trim() || 'Her tablet')
      await adoptPairing(result)
      // From here the patient entry takes over: her language, then the pond.
      navigate('/', { replace: true })
    } catch (err) {
      setError(MESSAGES[err instanceof PairingError ? err.reason : 'unknown'])
      setCode('')
      input.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  const symbols = Array.from({ length: PAIRING_CODE_LENGTH }, (_, i) => code[i] ?? '')

  return (
    <div className="px-viewport">
      <div className="px-stage" style={{ transform: `translateX(-50%) scale(${scale})` }}>
        <PixelPond recede />
      </div>

      <form
        onSubmit={submit}
        className="plaque-fade absolute inset-0 z-20 flex flex-col items-center justify-center overflow-y-auto px-6 py-8"
      >
        <h1
          className="text-center"
          style={{
            fontFamily: PIXEL,
            fontSize: 'clamp(28px, 4.2vw, 52px)',
            color: '#f5f0e6',
            textShadow: '4px 4px 0 #070d26',
          }}
        >
          Pair this tablet
        </h1>
        <p
          className="mt-3 max-w-xl text-center"
          style={{ fontFamily: SANS, fontSize: 20, lineHeight: 1.45, color: '#dbe1ee', textShadow: '2px 2px 0 #070d26' }}
        >
          On the family’s phone, open Smaran, choose <strong>Her tablet</strong>, and ask for a code. Type it here.
        </p>

        {/* One real input sits over the six squares, so typing, pasting and a
            phone's code suggestions all work; the squares only show what it holds. */}
        <div className="relative mt-9">
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            {symbols.slice(0, 4).map((c, i) => (
              <Cell key={i} char={c} active={!busy && i === code.length} />
            ))}
            <span aria-hidden="true" style={{ fontFamily: PIXEL, fontSize: 40, color: '#8f9ac0' }}>
              –
            </span>
            {symbols.slice(4).map((c, i) => (
              <Cell key={i + 4} char={c} active={!busy && i + 4 === code.length} />
            ))}
          </div>
          <input
            ref={input}
            value={code}
            onChange={(e) => setCode(normaliseTyped(e.target.value))}
            aria-label="Pairing code: six letters and numbers"
            autoFocus
            autoComplete="one-time-code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            maxLength={16}
            disabled={busy}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: 0.02,
              fontSize: 28,
              cursor: 'text',
            }}
          />
        </div>
        <p className="mt-4 max-w-md text-center" style={{ fontFamily: SANS, fontSize: 15, color: '#aab4d4' }}>
          Capitals don’t matter. A code never has a 0, O, 1, I, L, 5, S, 8 or B.
        </p>

        <label className="mt-6 flex w-full max-w-sm flex-col gap-2">
          <span style={{ fontFamily: SANS, fontSize: 16, color: '#dbe1ee' }}>Name this tablet (optional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value.slice(0, 120))}
            placeholder="Living-room tablet"
            autoComplete="off"
            disabled={busy}
            style={{
              minHeight: 52,
              padding: '10px 14px',
              background: '#0d1536',
              border: '3px solid #3a4c8c',
              color: '#f3efe6',
              fontFamily: SANS,
              fontSize: 20,
            }}
          />
        </label>

        {error && (
          <p
            role="alert"
            className="mt-6 max-w-md text-center"
            style={{ fontFamily: SANS, fontSize: 19, lineHeight: 1.45, color: '#f6c9b5', textShadow: '2px 2px 0 #070d26' }}
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!complete || busy}
          className="mt-8"
          style={{
            minHeight: 80,
            padding: '18px 44px',
            background: complete ? '#2f4a2a' : '#121b44',
            border: `4px solid ${complete ? '#7ea35a' : '#3a4c8c'}`,
            borderRadius: 0,
            boxShadow: '4px 4px 0 #070d26, inset 0 4px 0 #22306a',
            color: '#f3efe6',
            opacity: complete && !busy ? 1 : 0.6,
            fontFamily: SANS,
            fontSize: 26,
            cursor: complete && !busy ? 'pointer' : 'default',
          }}
        >
          {busy ? 'Pairing…' : 'Pair this tablet'}
        </button>

        {legacyLocalSetup && !devicePaired && (
          <p className="mt-6 max-w-md text-center" style={{ fontFamily: SANS, fontSize: 15, color: '#aab4d4' }}>
            This tablet was set up on its own before. Pairing it replaces what it holds with her information from
            the family’s account.
          </p>
        )}
        {devicePaired && (
          <p className="mt-6 max-w-md text-center" style={{ fontFamily: SANS, fontSize: 15, color: '#aab4d4' }}>
            This tablet is already paired. Type a new code only to pair it again.{' '}
            <Link to="/" style={{ color: '#dbe1ee', textDecoration: 'underline' }}>
              Back to the pond
            </Link>
          </p>
        )}
      </form>
    </div>
  )
}
