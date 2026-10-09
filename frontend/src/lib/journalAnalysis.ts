/**
 * Reading a journal entry for its emotional weather.
 *
 * The call goes to our own Spring Boot backend, never to Anthropic directly.
 * A browser bundle cannot hold a secret: an API key shipped to the client is
 * readable by anyone who opens devtools, and these entries are a dementia
 * patient's private writing, which should not travel to a third party straight
 * from her tablet. The backend holds the key, the prompt and the model, checks
 * what comes back, and stores only the signals: never her words.
 *
 * The contract with the Journal screen is that this never throws. An entry is
 * worth keeping whether or not it was successfully read, so a failure here
 * returns null and the entry is stored with `sentimentSignals: null`.
 */

import type { LanguageCode, SentimentSignals } from './types'
import { getDeviceToken } from './api'

interface AnalyseResponse {
  signals?: unknown
}

/** Narrow whatever came back over the wire; the network is not a type system. */
function coerce(raw: unknown): SentimentSignals | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const valence = Number(r.valence)
  const arousal = Number(r.arousal)
  if (!Number.isFinite(valence) || !Number.isFinite(arousal)) return null

  const allowed = ['CONFUSION', 'DISTRESS', 'LONELINESS', 'PAIN'] as const
  const flags = Array.isArray(r.concernFlags)
    ? r.concernFlags.filter((f): f is (typeof allowed)[number] =>
        typeof f === 'string' && (allowed as readonly string[]).includes(f),
      )
    : []

  return {
    valence: Math.max(-1, Math.min(1, valence)),
    arousal: Math.max(0, Math.min(1, arousal)),
    themes: Array.isArray(r.themes) ? r.themes.filter((t): t is string => typeof t === 'string').slice(0, 4) : [],
    concernFlags: [...new Set(flags)],
    summary: typeof r.summary === 'string' ? r.summary : '',
  }
}

export interface AnalyseInput {
  text: string
  patientId: string
  languageCode: LanguageCode
}

export async function analyseJournalEntry({ text }: AnalyseInput): Promise<SentimentSignals | null> {
  if (!text.trim()) return null

  try {
    const res = await fetch('/api/device/journal/analyse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(getDeviceToken() ? { Authorization: `Bearer ${getDeviceToken()}` } : {}),
      },
      // Only her words and the hour on her own clock. The prompt and the model are the server's:
      // a tablet cannot choose them, and the key never leaves the server.
      body: JSON.stringify({ text, localHour: new Date().getHours() }),
    })
    if (!res.ok) return null
    const body = (await res.json()) as AnalyseResponse
    return coerce(body.signals ?? body)
  } catch {
    // Offline, or the endpoint is not deployed yet. The entry still saves.
    return null
  }
}
