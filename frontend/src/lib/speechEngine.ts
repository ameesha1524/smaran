/**
 * Web Speech API wrapper.
 *
 * Two rules, both from the brief and both non-negotiable:
 *   · 0.82× rate. Elderly listeners, and a rate that never sounds hurried.
 *   · the app degrades to silence, never to an error. A device with no speech
 *     synthesis shows the same warm screen; it simply does not talk.
 */

import { getPack } from '../i18n/strings'
import type { LanguageCode } from './types'

const RATE = 0.82
const PITCH = 0.95

type Listener = (speaking: boolean) => void
const listeners = new Set<Listener>()

let currentUtterance: SpeechSynthesisUtterance | null = null

export function onSpeakingChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function emit(speaking: boolean) {
  listeners.forEach((l) => l(speaking))
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

function pickVoice(locale: string, fallback: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  const exact = voices.find((v) => v.lang.toLowerCase() === locale.toLowerCase())
  if (exact) return exact
  const byPrefix = voices.find((v) => v.lang.toLowerCase().startsWith(locale.slice(0, 2).toLowerCase()))
  if (byPrefix) return byPrefix
  const fb = voices.find((v) => v.lang.toLowerCase().startsWith(fallback.slice(0, 2).toLowerCase()))
  return fb ?? null
}

/** Voices load asynchronously in most browsers; wait once, briefly. */
function voicesReady(): Promise<void> {
  return new Promise((resolve) => {
    if (!speechSupported()) return resolve()
    if (window.speechSynthesis.getVoices().length) return resolve()
    const done = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', done)
      resolve()
    }
    window.speechSynthesis.addEventListener('voiceschanged', done)
    setTimeout(done, 1200)
  })
}

export interface SpeakOptions {
  language?: LanguageCode
  rate?: number
  /** Interrupt whatever is being said. Default true — she asked for this one. */
  interrupt?: boolean
  onEnd?: () => void
}

export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  if (!speechSupported() || !text.trim()) {
    opts.onEnd?.()
    return
  }
  await voicesReady()

  const pack = getPack(opts.language ?? 'en')
  if (opts.interrupt !== false) window.speechSynthesis.cancel()

  const u = new SpeechSynthesisUtterance(text)
  u.rate = opts.rate ?? RATE
  u.pitch = PITCH
  u.volume = 1
  u.lang = pack.speechLocale
  const voice = pickVoice(pack.speechLocale, pack.speechFallback)
  if (voice) {
    u.voice = voice
    u.lang = voice.lang
  } else {
    // No voice for this script: speak with the fallback locale rather than
    // letting the browser read Assamese text with an American English voice.
    u.lang = pack.speechFallback
  }

  u.onstart = () => emit(true)
  u.onend = () => {
    emit(false)
    currentUtterance = null
    opts.onEnd?.()
  }
  u.onerror = () => {
    emit(false)
    currentUtterance = null
    opts.onEnd?.()
  }

  currentUtterance = u
  window.speechSynthesis.speak(u)
}

export function stopSpeaking() {
  if (!speechSupported()) return
  window.speechSynthesis.cancel()
  currentUtterance = null
  emit(false)
}

export function isSpeaking(): boolean {
  return !!currentUtterance
}

/* ------------------------------------------------------------ listening */

export type VoiceIntent =
  | { kind: 'OPEN_GAMES' }
  | { kind: 'OPEN_FAMILY' }
  | { kind: 'SET_REMINDER'; hour: number }
  | { kind: 'CALL_FAMILY'; who: string }
  | { kind: 'REPEAT' }
  | { kind: 'UNKNOWN'; transcript: string }

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function listeningSupported(): boolean {
  return recognitionCtor() !== null
}

/**
 * One short listen. Smaran never holds the microphone open — it opens it when
 * the stone is pressed and closes it as soon as a sentence lands.
 */
export function listenOnce(language: LanguageCode, onIntent: (intent: VoiceIntent) => void): () => void {
  const Ctor = recognitionCtor()
  if (!Ctor) {
    onIntent({ kind: 'UNKNOWN', transcript: '' })
    return () => undefined
  }
  const pack = getPack(language)
  const rec = new Ctor()
  rec.lang = pack.speechLocale
  rec.continuous = false
  rec.interimResults = false
  rec.maxAlternatives = 1

  rec.onresult = (e) => {
    const transcript = e.results?.[0]?.[0]?.transcript ?? ''
    onIntent(parseIntent(transcript))
  }
  rec.onerror = () => onIntent({ kind: 'UNKNOWN', transcript: '' })

  try {
    rec.start()
  } catch {
    onIntent({ kind: 'UNKNOWN', transcript: '' })
  }
  return () => {
    try {
      rec.stop()
    } catch {
      /* already stopped */
    }
  }
}

/** Deliberately forgiving keyword matching — a dementia patient rephrases. */
export function parseIntent(raw: string): VoiceIntent {
  const s = raw.toLowerCase().trim()
  if (!s) return { kind: 'UNKNOWN', transcript: raw }

  if (/(game|play|khel|খেল)/.test(s)) return { kind: 'OPEN_GAMES' }
  if (/(family|grove|daughter|son|photo|পৰিয়াল|परिवार)/.test(s) && !/call/.test(s)) return { kind: 'OPEN_FAMILY' }
  if (/(again|repeat|once more|ফেৰ|फिर)/.test(s)) return { kind: 'REPEAT' }

  const remind = s.match(/remind.*?(\d{1,2})\s*(am|pm)?/)
  if (remind) {
    let hour = parseInt(remind[1], 10)
    if (remind[2] === 'pm' && hour < 12) hour += 12
    if (remind[2] === 'am' && hour === 12) hour = 0
    return { kind: 'SET_REMINDER', hour }
  }

  const call = s.match(/call (?:my )?(\w+)/)
  if (call) return { kind: 'CALL_FAMILY', who: call[1] }

  return { kind: 'UNKNOWN', transcript: raw }
}
