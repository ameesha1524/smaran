/**
 * Seed content for a device that has not met a backend yet.
 *
 * Two reasons this file exists:
 *   1. a demo must open into a warm, populated pond, not an empty state;
 *   2. a tablet in a village must work the first time it is switched on, before
 *      anyone has managed to sync anything.
 *
 * Every string here is placeholder content standing in for what a caregiver
 * uploads during setup. The names and objects are fictional. Replace them with
 * the real family's photographs, voices and objects before any pilot — the
 * whole therapeutic claim rests on the content being *this patient's*.
 */

import type { FamilyMember, MeaningfulObject, Patient, ReminderSchedule } from './types'

export const DEMO_PATIENT_ID = 'demo-patient'

export const demoPatient: Patient = {
  id: DEMO_PATIENT_ID,
  name: 'Anima Baruah',
  languageCode: 'as',
  kinshipTerm: 'আইতা',
  region: 'Jorhat, Assam',
  faith: 'Vaishnavite',
  peakWindow: 'MORNING',
  profileVersion: '1.0',
}

/**
 * Objects carry a glyph only until a photograph replaces it. A caregiver-
 * uploaded photo of *her* brass lamp always beats a generic icon.
 */
export const demoObjects: MeaningfulObject[] = [
  { id: 'o1', patientId: DEMO_PATIENT_ID, name: 'Brass lamp', semanticCluster: 'DAILY_LIFE', glyph: '🪔' },
  { id: 'o2', patientId: DEMO_PATIENT_ID, name: 'Dhol', semanticCluster: 'MUSICAL', glyph: '🥁' },
  { id: 'o3', patientId: DEMO_PATIENT_ID, name: 'Gamosa', semanticCluster: 'CRAFT', glyph: '🧣' },
  { id: 'o4', patientId: DEMO_PATIENT_ID, name: 'Tea leaves', semanticCluster: 'FOOD', glyph: '🍃' },
  { id: 'o5', patientId: DEMO_PATIENT_ID, name: 'Kopou phool', semanticCluster: 'NATURE', glyph: '🌺' },
  { id: 'o6', patientId: DEMO_PATIENT_ID, name: 'Xorai', semanticCluster: 'DAILY_LIFE', glyph: '🏺' },
  { id: 'o7', patientId: DEMO_PATIENT_ID, name: 'Pepa', semanticCluster: 'MUSICAL', glyph: '🎺' },
  { id: 'o8', patientId: DEMO_PATIENT_ID, name: 'Rice bowl', semanticCluster: 'FOOD', glyph: '🍚' },
]

export const demoFamily: FamilyMember[] = [
  {
    id: 'f1',
    patientId: DEMO_PATIENT_ID,
    name: 'Rupa',
    relationship: 'Daughter',
    kinshipTermLocal: 'Jiyori',
    contextHint: 'She brings you tea in the blue cup every morning.',
    currentPhase: 3,
  },
  {
    id: 'f2',
    patientId: DEMO_PATIENT_ID,
    name: 'Nabin',
    relationship: 'Son',
    kinshipTermLocal: 'Lora',
    contextHint: 'He fixed the radio that plays Bihu songs.',
    currentPhase: 2,
  },
  {
    id: 'f3',
    patientId: DEMO_PATIENT_ID,
    name: 'Mitali',
    relationship: 'Granddaughter',
    kinshipTermLocal: 'Natini',
    contextHint: 'She lives in Bangalore and calls on Sunday evenings.',
    currentPhase: 1,
  },
  {
    id: 'f4',
    patientId: DEMO_PATIENT_ID,
    name: 'Bhaskar',
    relationship: 'Brother',
    kinshipTermLocal: 'Bhai',
    contextHint: 'You both grew up beside the Bhogdoi river.',
    currentPhase: 1,
  },
  {
    id: 'f5',
    patientId: DEMO_PATIENT_ID,
    name: 'Jyoti',
    relationship: 'Neighbour',
    kinshipTermLocal: 'Baideu',
    contextHint: 'She waters your plants when it is very hot.',
    currentPhase: 1,
  },
]

export interface DemoStory {
  id: string
  /** Read aloud by TTS until the caregiver records her own voice. */
  text: string
  question: string
  options: { id: string; label: string; glyph: string; correct: boolean }[]
}

export const demoStories: DemoStory[] = [
  {
    id: 's1',
    text: 'On Bohag Bihu, before the sun came up, you would bathe the cow and tie a new gamosa around its neck. Then everyone came to the courtyard, and your mother brought out the pitha.',
    question: 'What did your mother bring out?',
    options: [
      { id: 'a', label: 'Pitha', glyph: '🍘', correct: true },
      { id: 'b', label: 'An umbrella', glyph: '☂️', correct: false },
      { id: 'c', label: 'A lantern', glyph: '🏮', correct: false },
      { id: 'd', label: 'A blanket', glyph: '🧶', correct: false },
    ],
  },
  {
    id: 's2',
    text: 'Every evening your father would sit on the veranda and light the brass lamp. The smell of the oil filled the whole house, and the birds went quiet in the bamboo.',
    question: 'What did your father light?',
    options: [
      { id: 'a', label: 'The brass lamp', glyph: '🪔', correct: true },
      { id: 'b', label: 'The stove', glyph: '🔥', correct: false },
      { id: 'c', label: 'A candle', glyph: '🕯️', correct: false },
      { id: 'd', label: 'The radio', glyph: '📻', correct: false },
    ],
  },
]

export const demoReminders: ReminderSchedule[] = [
  {
    id: 'r1',
    patientId: DEMO_PATIENT_ID,
    type: 'MEDICINE',
    scheduledTime: '08:00',
    messageTemplate: '{kin}, it is time for the small white tablet.',
    languageCode: 'as',
  },
  {
    id: 'r2',
    patientId: DEMO_PATIENT_ID,
    type: 'HYDRATION',
    scheduledTime: '10:00',
    messageTemplate: '{kin}, a little water?',
    languageCode: 'as',
  },
  {
    id: 'r3',
    patientId: DEMO_PATIENT_ID,
    type: 'MEDICINE',
    scheduledTime: '20:00',
    messageTemplate: '{kin}, the evening tablet, with food.',
    languageCode: 'as',
  },
]

/** Morning Rituals: gentle, ordinary, in the order a morning actually happens. */
export const demoRituals = [
  { id: 'm1', label: 'Open the window', glyph: '🪟', order: 1 },
  { id: 'm2', label: 'Morning tea', glyph: '🍵', order: 2 },
  { id: 'm3', label: 'The white tablet', glyph: '💊', order: 3 },
  { id: 'm4', label: 'Water the tulsi', glyph: '🪴', order: 4 },
  { id: 'm5', label: 'Sit in the sun', glyph: '🌞', order: 5 },
]
