/**
 * A month of plausible history, generated locally.
 *
 * Used only when the dashboard cannot reach the backend — a demo, a pitch, or a
 * caregiver opening the app on a train. The shape is exactly the payload of
 * GET /api/caregiver/dashboard/{patientId}, so the component never branches.
 *
 * The trend it draws is deliberately not flat: visual-semantic memory declines
 * slowly across the month while the other domains hold, which is the pattern
 * the dashboard exists to make visible.
 */

import type { DashboardSummary, GameType, MoodKey } from '../lib/types'
import { demoFamily, demoPatient } from '../lib/demoData'

function dayKey(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() - offset)
  return d.toISOString().slice(0, 10)
}

function wobble(base: number, seed: number, amplitude = 0.05): number {
  const n = Math.sin(seed * 12.9898) * 43758.5453
  return Number(Math.max(0, Math.min(1, base + (n - Math.floor(n) - 0.5) * amplitude * 2)).toFixed(3))
}

export function sampleDashboard(): DashboardSummary {
  const domainTrend = Array.from({ length: 30 }, (_, i) => {
    const day = 29 - i
    const t = i / 29
    return {
      date: dayKey(day),
      language: wobble(0.74, i + 1),
      // The signal the caregiver is meant to see: 0.90 → 0.70 → 0.55.
      visualSemantic: wobble(0.9 - t * 0.35, i + 2, 0.03),
      motor: wobble(0.66 - t * 0.06, i + 3),
      affective: wobble(0.71, i + 4, 0.08),
      temporal: wobble(0.63, i + 5),
      // Duck Roll Call is new — a gentle upward line as span calibrates.
      executiveFunction: wobble(0.55 + t * 0.12, i + 6, 0.05),
    }
  })

  const moods: MoodKey[] = ['PEACEFUL', 'QUIET', 'JOYFUL', 'A_LITTLE_LOW', 'RESTLESS', 'THINKING', 'SLEEPY']
  const moodTrend = Array.from({ length: 14 }, (_, i) => ({
    date: dayKey(13 - i),
    mood: moods[(i * 3) % moods.length],
  }))

  const heatmap = Array.from({ length: 7 }, (_, i) => ({
    date: dayKey(6 - i),
    minutes: [14, 22, 0, 18, 26, 11, 19][i],
  }))

  const perGame: { gameType: GameType; sessions: number; avgScore: number; trend: 'UP' | 'FLAT' | 'DOWN' }[] = [
    { gameType: 'FAMILY_GROVE', sessions: 11, avgScore: 0.88, trend: 'UP' },
    { gameType: 'DUCK_ROLL_CALL', sessions: 9, avgScore: 0.62, trend: 'UP' },
    { gameType: 'GRANDMOTHERS_TALE', sessions: 7, avgScore: 0.75, trend: 'FLAT' },
    { gameType: 'MORNING_RITUALS', sessions: 6, avgScore: 0.7, trend: 'FLAT' },
  ]

  const acousticTrend = Array.from({ length: 30 }, (_, i) => ({
    date: dayKey(29 - i),
    jitter: Number((0.009 + (i / 29) * 0.004 + Math.sin(i) * 0.0004).toFixed(5)),
    shimmer: Number((0.041 + (i / 29) * 0.013 + Math.cos(i) * 0.001).toFixed(5)),
  }))

  return {
    patient: demoPatient,
    garden: {
      patientId: demoPatient.id,
      bloomStage: 3,
      growthPoints: 21,
      restingPhase: false,
      lastActivity: new Date().toISOString(),
      bloomCount: 33,
    },
    sessionsThisWeek: 5,
    lastActive: new Date(Date.now() - 3 * 3600_000).toISOString(),
    moodTrend,
    domainTrend,
    heatmap,
    perGame,
    familyPhases: demoFamily.map((m) => ({ id: m.id, name: m.name, phase: m.currentPhase })),
    acousticTrend,
    alerts: [
      {
        level: 'AMBER',
        code: 'CLUSTER_DECLINE',
        message:
          'Visual-semantic recognition has fallen from 90% to 55% over 30 days, concentrated in the "Musical" cluster. Other clusters are steady — this looks domain-specific rather than general.',
      },
      {
        level: 'YELLOW',
        code: 'VOICE_BIOMARKER',
        message: 'Possible early vocal fatigue pattern — recommend clinical review. This is a monitoring signal, not a diagnosis.',
      },
    ],
  }
}
