import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSmaran } from '../state/SmaranContext'
import { buildGreeting, t, translateKinshipTerm } from '../i18n/strings'
import { dictate, listeningSupported } from '../lib/speechEngine'
import { analyseJournalEntry } from '../lib/journalAnalysis'

/**
 * "Today" — the one place in Smaran she writes rather than taps.
 *
 * The input mode is chosen for her rather than offered as a preference. A
 * supported hand opens straight into dictation, because handing that person a
 * keyboard is handing them a failure; a fluid or moderate hand gets the text
 * area with dictation one tap away. Either way the other mode is always
 * reachable, because the tier is an estimate and estimates are wrong.
 *
 * Nothing here is validated, corrected or scored. An entry of three words is a
 * complete entry. The analysis that runs on save is for her family to read
 * later, and never returns to this screen.
 */

const BG = '#080f1e'

function MicGlyph({ live }: { live: boolean }) {
  return (
    <svg width="44" height="44" viewBox="0 0 11 11" shapeRendering="crispEdges" aria-hidden="true">
      <path
        fill={live ? '#f0c94a' : '#dbe1ee'}
        d="M4 0h3v1h-3zM3 1h1v1h-1zM7 1h1v1h-1zM3 2h1v1h-1zM7 2h1v1h-1zM3 3h1v1h-1zM7 3h1v1h-1zM3 4h1v1h-1zM7 4h1v1h-1zM4 5h3v1h-3zM2 4h1v1h-1zM8 4h1v1h-1zM2 5h1v1h-1zM8 5h1v1h-1zM3 6h1v1h-1zM7 6h1v1h-1zM4 7h3v1h-3zM5 8h1v1h-1zM3 9h5v1h-5z"
      />
    </svg>
  )
}

export default function Journal() {
  const { patient, language, motorTier, addJournalEntry } = useSmaran()
  const navigate = useNavigate()

  const voiceFirst = motorTier === 'SUPPORTED'
  const [voiceMode, setVoiceMode] = useState(voiceFirst && listeningSupported())
  const [text, setText] = useState('')
  const [interim, setInterim] = useState('')
  const [saving, setSaving] = useState(false)
  const stopRef = useRef<(() => void) | null>(null)

  const kin = translateKinshipTerm(patient.name?.trim() || patient.kinshipTerm, language)
  const greeting = buildGreeting(language, kin)

  const stopDictation = useCallback(() => {
    stopRef.current?.()
    stopRef.current = null
    setInterim('')
  }, [])

  // The microphone follows voiceMode, and is always released on the way out —
  // a mic left open on a screen nobody is looking at is the worst bug here.
  useEffect(() => {
    if (!voiceMode) {
      stopDictation()
      return
    }
    const base = text ? text.trimEnd() + ' ' : ''
    stopRef.current = dictate(
      language,
      (settled, live) => {
        setText(base + settled)
        setInterim(live)
      },
      () => setVoiceMode(false),
    )
    return stopDictation
    // `text` is deliberately not a dependency: it changes on every syllable,
    // and re-running this would restart the recogniser mid-sentence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceMode, language, stopDictation])

  const done = async () => {
    stopDictation()
    const body = text.trim()
    if (!body) {
      navigate('/', { replace: true })
      return
    }
    setSaving(true)
    // Saving must not wait on the network, but reading the entry needs it; the
    // entry is stored either way, with null signals if the call could not run.
    const signals = await analyseJournalEntry({
      text: body,
      patientId: patient.id,
      languageCode: language,
    })
    addJournalEntry(body, signals)
    navigate('/', { replace: true })
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        background: BG,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '40px 24px 32px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ width: '100%', maxWidth: 760, display: 'flex', flexDirection: 'column', flex: 1 }}>
        <button
          type="button"
          onClick={() => {
            stopDictation()
            navigate('/', { replace: true })
          }}
          style={{
            alignSelf: 'flex-start',
            minHeight: 56,
            padding: '10px 4px',
            background: 'none',
            border: 0,
            color: '#c4cce0',
            fontFamily: "'VT323', monospace",
            fontSize: 24,
            cursor: 'pointer',
          }}
        >
          ← {t(language, 'goHome')}
        </button>

        <h1
          style={{
            margin: '18px 0 0 0',
            fontFamily: "'Pixelify Sans', 'Noto Sans Bengali', 'Noto Sans Devanagari', sans-serif",
            fontSize: 'clamp(30px, 4.6vw, 46px)',
            lineHeight: 1.15,
            color: '#f5f0e6',
            textShadow: '4px 4px 0 #04070f',
          }}
        >
          {greeting.greeting}
        </h1>
        <p
          style={{
            margin: '10px 0 0 0',
            fontFamily: "'Noto Sans', system-ui, sans-serif",
            fontSize: 20,
            color: '#a9b3c9',
          }}
        >
          {PROMPT[language] ?? PROMPT.en}
        </p>

        <div style={{ position: 'relative', marginTop: 26, flex: 1, display: 'flex' }}>
          <textarea
            value={text + (interim ? (text ? ' ' : '') + interim : '')}
            onChange={(e) => setText(e.target.value)}
            readOnly={voiceMode}
            placeholder={voiceMode ? '' : (PLACEHOLDER[language] ?? PLACEHOLDER.en)}
            aria-label={PROMPT[language] ?? PROMPT.en}
            style={{
              flex: 1,
              minHeight: 260,
              width: '100%',
              boxSizing: 'border-box',
              padding: '20px 20px 72px',
              background: '#0d1830',
              border: '4px solid #2b3a6f',
              borderRadius: 0,
              color: '#f3efe6',
              fontFamily: "'Noto Sans', system-ui, sans-serif",
              fontSize: 22,
              lineHeight: 1.55,
              resize: 'none',
              outline: 'none',
            }}
          />

          {listeningSupported() && (
            <button
              type="button"
              onClick={() => setVoiceMode((v) => !v)}
              aria-label={voiceMode ? 'Stop speaking' : 'Speak instead of typing'}
              aria-pressed={voiceMode}
              style={{
                position: 'absolute',
                right: 16,
                bottom: 16,
                width: 64,
                height: 64,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: voiceMode ? '#2a2208' : '#121b44',
                border: `4px solid ${voiceMode ? '#f0c94a' : '#3a4c8c'}`,
                borderRadius: 0,
                boxShadow: '4px 4px 0 #04070f',
                cursor: 'pointer',
              }}
            >
              <MicGlyph live={voiceMode} />
            </button>
          )}
        </div>

        {voiceMode && (
          <p
            style={{
              margin: '14px 0 0 0',
              fontFamily: "'VT323', monospace",
              fontSize: 24,
              color: '#f0c94a',
            }}
          >
            {LISTENING[language] ?? LISTENING.en}
          </p>
        )}

        <button
          type="button"
          onClick={() => void done()}
          disabled={saving}
          style={{
            marginTop: 26,
            alignSelf: 'center',
            minHeight: 88,
            minWidth: 240,
            padding: '20px 44px',
            background: '#121b44',
            border: '4px solid #3a4c8c',
            borderRadius: 0,
            boxShadow: '4px 4px 0 #04070f, inset 0 4px 0 #22306a',
            color: saving ? '#8d97ad' : '#f3efe6',
            fontFamily: "'Noto Sans', system-ui, sans-serif",
            fontSize: 24,
            cursor: saving ? 'default' : 'pointer',
          }}
        >
          {saving ? (SAVING[language] ?? SAVING.en) : (DONE[language] ?? DONE.en)}
        </button>
      </div>
    </div>
  )
}

/* Journal-only copy. It lives here rather than in the UI pack because no other
   screen says any of it, and the pack is already long. */

const PROMPT: Record<string, string> = {
  en: 'How was today?',
  as: 'আজিৰ দিনটো কেনে আছিল?',
  mni: 'ঙসিগী নুমিৎ অদু করম্না লৈখিবগে?',
  lus: 'Vawiin hi engtin nge a kal?',
  hi: 'आज का दिन कैसा रहा?',
  nag: 'Aji laga din kenekoi thakise?',
}

const PLACEHOLDER: Record<string, string> = {
  en: 'Anything you like. A few words is enough.',
  as: 'যি ইচ্ছা। দুটামান শব্দই যথেষ্ট।',
  mni: 'অদোম্না পাম্বা অমা। ৱাহৈ খরা ওইরবসু য়াই।',
  lus: 'I duh apiang. Ṭawngkam tlêm tê pawh a tâwk.',
  hi: 'जो मन में हो। दो-चार शब्द भी काफ़ी हैं।',
  nag: 'Ki mon ase. Duita kotha bhi hobo.',
}

const LISTENING: Record<string, string> = {
  en: 'listening…',
  as: 'শুনি আছোঁ…',
  mni: 'তারি…',
  lus: 'ka ngaithla…',
  hi: 'सुन रहे हैं…',
  nag: 'huni ase…',
}

const DONE: Record<string, string> = {
  en: 'Done',
  as: 'হ’ল',
  mni: 'লোইরে',
  lus: 'A tâwp',
  hi: 'हो गया',
  nag: 'Hoise',
}

const SAVING: Record<string, string> = {
  en: 'Keeping it…',
  as: 'ৰাখি আছোঁ…',
  mni: 'থমলি…',
  lus: 'ka dah…',
  hi: 'रख रहे हैं…',
  nag: 'Rakhi ase…',
}
