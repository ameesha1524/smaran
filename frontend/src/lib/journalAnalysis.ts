/**
 * Reading a journal entry for its emotional weather.
 *
 * The call goes to our own Spring Boot backend, never to Anthropic directly.
 * A browser bundle cannot hold a secret: an API key shipped to the client is
 * readable by anyone who opens devtools, and these entries are a dementia
 * patient's private writing, which should not travel to a third party straight
 * from her tablet. The backend holds the key and makes the call.
 *
 * The contract with the Journal screen is that this never throws. An entry is
 * worth keeping whether or not it was successfully read, so a failure here
 * returns null and the entry is stored with `sentimentSignals: null`.
 */

import type { LanguageCode, SentimentSignals } from './types'

/**
 * The instruction the backend gives the model.
 *
 * Kept on this side so the prompt lives next to the type it must satisfy — if
 * the shape of `SentimentSignals` changes, the two are edited together. The
 * backend forwards it verbatim as the system prompt.
 */
export const JOURNAL_SYSTEM_PROMPT = `You read short journal entries written by elderly people living with dementia in North East India, and report the emotional weather of each one.

You are not a clinician and you are not diagnosing. You are helping a family member notice, over weeks, how their parent or grandparent is doing.

Return ONLY a JSON object, no prose around it, with exactly these keys:

{
  "valence": number from -1 to 1, where -1 is bleak, 0 is even, 1 is bright,
  "arousal": number from 0 to 1, where 0 is settled and calm, 1 is agitated or distressed,
  "themes": array of 1-4 short lowercase noun phrases naming what the entry is actually about, drawn from the writer's own words where possible (e.g. "the garden", "my son", "the old house"),
  "concernFlags": array containing only the values that genuinely apply, from: "CONFUSION", "DISTRESS", "LONELINESS", "PAIN". Use an empty array when none apply,
  "summary": one warm sentence, written for the family member to read, describing how the writer seems today
}

Guidance:
- Be conservative with concernFlags. A wistful memory is not DISTRESS. Missing someone who has died is not necessarily LONELINESS. Flag only what is plainly present in the text.
- CONFUSION means disorientation in the writing itself (contradictory times, places or people), not the writer saying they felt confused about something ordinary.
- The entry may be in English, Assamese, Manipuri (Meiteilon), Mizo, Hindi or Nagamese, or a mix. Read it in whatever language it arrives in, and always write "summary" in English.
- Never quote a distressing line back in the summary. Describe, gently.
- If the entry is too short or empty to read, return valence 0, arousal 0, empty arrays, and a summary saying there was not enough written to tell.`

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

export async function analyseJournalEntry({
  text,
  patientId,
  languageCode,
}: AnalyseInput): Promise<SentimentSignals | null> {
  if (!text.trim()) return null

  try {
    const res = await fetch('/api/journal/analyse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(localStorage.getItem('smaran.token')
          ? { Authorization: `Bearer ${localStorage.getItem('smaran.token')}` }
          : {}),
      },
      body: JSON.stringify({
        text,
        patientId,
        languageCode,
        systemPrompt: JOURNAL_SYSTEM_PROMPT,
        model: 'claude-sonnet-5',
      }),
    })
    if (!res.ok) return null
    const body = (await res.json()) as AnalyseResponse
    return coerce(body.signals ?? body)
  } catch {
    // Offline, or the endpoint is not deployed yet. The entry still saves.
    return null
  }
}
