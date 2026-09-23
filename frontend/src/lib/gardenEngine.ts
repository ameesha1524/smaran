/**
 * The Heritage Garden — what replaces XP, streaks, leaderboards and scores.
 *
 * Design constraints that this file exists to enforce:
 *   · growth only ever goes up. A missed day never subtracts.
 *   · a missed day puts the garden into moonlight sleep. Sleep is a state, not
 *     a punishment, and the copy for it must never imply fault.
 *   · the caregiver is told after three missed days. The patient is never told.
 *
 * The same arithmetic runs in GardenStateService.java; this local copy is what
 * lets the garden bloom instantly and offline while the server catches up.
 */

import type { GameType, GardenState } from './types'

export const STAGE_THRESHOLDS = [0, 6, 16, 32] as const

export const STAGE_NAMES: Record<1 | 2 | 3 | 4, string> = {
  1: 'bare soil',
  2: 'bamboo shoots',
  3: 'orchids',
  4: 'full grove',
}

/** Completing anything at all waters the garden. Completing it well waters more. */
export function growthFor(gameType: GameType, completionRate: number): number {
  const base: Record<GameType, number> = {
    WEAVERS_LOOM: 2,
    GRANDMOTHERS_TALE: 2,
    FAMILY_GROVE: 3, // the emotional core earns a little more
    MORNING_RITUALS: 2,
  }
  // Floor of 1: showing up is itself worth something.
  return Math.max(1, Math.round(base[gameType] * Math.max(0.5, completionRate)))
}

export function stageFor(growthPoints: number): 1 | 2 | 3 | 4 {
  if (growthPoints >= STAGE_THRESHOLDS[3]) return 4
  if (growthPoints >= STAGE_THRESHOLDS[2]) return 3
  if (growthPoints >= STAGE_THRESHOLDS[1]) return 2
  return 1
}

/** 0–1 within the current stage, for the bloom bar (never labelled with a number). */
export function stageProgress(growthPoints: number): number {
  const stage = stageFor(growthPoints)
  if (stage === 4) return 1
  const from = STAGE_THRESHOLDS[stage - 1]
  const to = STAGE_THRESHOLDS[stage]
  return Math.min(1, Math.max(0, (growthPoints - from) / (to - from)))
}

export interface WaterResult {
  next: GardenState
  /** True when the bloom crossed into a new stage — fires the family WebSocket. */
  milestone: boolean
  /** True when the garden just woke from moonlight sleep. */
  awoke: boolean
}

export function water(state: GardenState, gameType: GameType, completionRate: number): WaterResult {
  const before = stageFor(state.growthPoints)
  const growthPoints = state.growthPoints + growthFor(gameType, completionRate)
  const bloomStage = stageFor(growthPoints)

  return {
    next: {
      ...state,
      growthPoints,
      bloomStage,
      bloomCount: state.bloomCount + 1,
      restingPhase: false,
      lastActivity: new Date().toISOString(),
    },
    milestone: bloomStage > before,
    awoke: state.restingPhase,
  }
}

export function daysSince(iso: string | null | undefined, now = Date.now()): number {
  if (!iso) return 0
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 0
  return Math.floor((now - then) / 86_400_000)
}

/** Resting phase is entered quietly, by the clock, with nothing said to anyone. */
export function applyRest(state: GardenState, now = Date.now()): GardenState {
  const missed = daysSince(state.lastActivity, now)
  if (missed >= 1 && !state.restingPhase) return { ...state, restingPhase: true }
  return state
}

/** The only threshold that reaches a human: three days, and only the caregiver. */
export function caregiverShouldBeAlerted(state: GardenState, now = Date.now()): boolean {
  return daysSince(state.lastActivity, now) >= 3
}

/**
 * The sky follows the garden, not the wall clock alone: a patient who plays at
 * night should still see her pond wake up. Night is rest, never failure.
 */
export function phaseFor(state: GardenState | null, now = new Date()): 'night' | 'dawn' | 'day' {
  if (!state || state.restingPhase) return 'night'
  const hour = now.getHours()
  const playedToday = daysSince(state.lastActivity, now.getTime()) === 0
  if (playedToday && state.bloomCount > 0) return hour >= 5 && hour < 17 ? 'day' : 'dawn'
  return hour >= 6 && hour < 16 ? 'dawn' : 'night'
}

/** Warm, specific, and never a number. */
export function bloomCopy(state: GardenState | null): string {
  if (!state) return 'Your garden is waiting'
  if (state.restingPhase) return 'Your garden is sleeping in the moonlight'
  switch (state.bloomStage) {
    case 1:
      return 'The soil is ready'
    case 2:
      return 'Bamboo shoots are up'
    case 3:
      return 'The orchids are opening'
    case 4:
      return 'The grove is full'
  }
}

export function emptyGarden(patientId: string): GardenState {
  return {
    patientId,
    bloomStage: 1,
    growthPoints: 0,
    restingPhase: false,
    lastActivity: new Date().toISOString(),
    bloomCount: 0,
  }
}
