/**
 * Small pure helpers the game modules share. Nothing here knows about a game.
 */

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export const round2 = (v: number): number => Math.round(v * 100) / 100

export const round3 = (v: number): number => Math.round(v * 1000) / 1000

export function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

/** A finite number, or null. Raw trials come from a game and are never trusted to be well-formed. */
export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * How sure a session is, from how many trials it had.
 *
 * `full` trials is full confidence; fewer scales it down, with a floor so one
 * trial still counts for a little. No trials means no evidence at all, which is
 * 0, and a contribution with confidence 0 is not sent.
 */
export function trialConfidence(trials: number, full: number, floor = 0.15): number {
  if (trials <= 0) return 0
  return Math.max(floor, Math.min(1, trials / full))
}

/** A secondary signal is trusted a little less than the primary one it rides on (Appendix A.2: 0.5 to 0.7). */
export const SECONDARY = { weak: 0.4, half: 0.5, firm: 0.6 } as const

export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many
}
