import type { DomainCard } from '../../lib/types'

/** How a reading is described, in words a family member would use. Never a diagnosis. */
export const STATUS_WORDS: Record<DomainCard['status'], string> = {
  stable: 'steady',
  watch: 'a little below her usual',
  decline: 'well below her usual',
  improving: 'above her usual',
}

export const STATUS_COLOUR: Record<DomainCard['status'], string> = {
  stable: '#9fb28a',
  watch: '#e0a03c',
  decline: '#c8773a',
  improving: '#e8c84a',
}

/** Alert severities share the palette. `info` is for things like a quiet week. */
export const SEVERITY_COLOUR: Record<string, string> = {
  watch: '#e0a03c',
  decline: '#c8773a',
  info: '#7a9bd4',
}

export const TARGET_COLOUR: Record<string, string> = {
  LANGUAGE: '#e8c84a',
  VISUAL_SEMANTIC: '#c8773a',
  MOTOR: '#7a9bd4',
  AFFECTIVE: '#ddeaf8',
  TEMPORAL: '#8fb36a',
  EXECUTIVE: '#a87fd0',
}

/** The domain a sub-signal belongs beside, for colour only. */
export function colourFor(target: string): string {
  return TARGET_COLOUR[target] ?? '#b8b49e'
}

export function relative(iso: string | null): string {
  if (!iso) return 'not yet'
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}

export function dayAndTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Until a domain has this many readings, the dashboard says it cannot yet tell a pattern from a bad day. */
export const READINGS_TO_TRUST = 5
