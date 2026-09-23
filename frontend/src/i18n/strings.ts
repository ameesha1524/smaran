/**
 * i18n for Smaran.
 *
 * This file stores more than translated strings: it stores *cultural registers*.
 * A greeting is (kinship term + invitation + the name the patient's family gives
 * to quiet). The kinship term is never assumed by the app — the caregiver sets it
 * during setup and it is substituted into `{kin}` at render time.
 *
 * TRANSLATION STATUS. The Assamese, Manipuri, Mizo and Nagamese lines below are a
 * best attempt taken from the project brief and are marked `reviewed: false`.
 * They must be replaced with a native speaker's phrasing before any pilot. Keys a
 * pack does not provide fall back to English rather than showing an empty string.
 */

import type { LanguageCode } from '../lib/types'

export type UiKey =
  | 'appName'
  | 'continue'
  | 'back'
  | 'speak'
  | 'speaking'
  | 'voiceIdle'
  | 'caregiverLink'
  | 'howAreYou'
  | 'moodJoyful'
  | 'moodQuiet'
  | 'moodLow'
  | 'gardenSeed'
  | 'gardenSprout'
  | 'gardenBloom'
  | 'gardenGrove'
  | 'restingPhase'
  | 'offline'
  | 'syncing'
  | 'syncedJustNow'
  | 'todaysGames'
  | 'playAgain'
  | 'goHome'
  | 'listenAgain'
  | 'wellDone'
  | 'gardenWatered'
  | 'whoIsThis'
  | 'tapWhatYouKnow'
  | 'tapWithTheLeaf'
  | 'whenAreYouMostAlive'
  | 'yourQuietPlaceIsReady'

type UiStrings = Partial<Record<UiKey, string>>

export interface LanguagePack {
  code: LanguageCode
  /** The language's name in its own script — what the lotus bud blooms into. */
  label: string
  /** Latin transliteration, for caregivers who do not read the script. */
  latinLabel: string
  /** BCP-47 tag handed to the Web Speech API; falls back per `speechFallback`. */
  speechLocale: string
  speechFallback: string
  /** `{kin}` is replaced with the caregiver-set kinship term. */
  greeting: string
  /** The italic gold line under the greeting. */
  goldLine: string
  /** Quiet sub-line, Noto Sans, chalk-dim. */
  sub: string
  /** Suggested kinship terms for this region — offered to the caregiver, never forced. */
  kinshipSuggestions: string[]
  /** Barely-perceptible instrument layer chosen by region. */
  ambientInstrument: 'pepa' | 'gogona' | 'chapel-bell' | 'monastery-chime' | 'none'
  reviewed: boolean
  ui: UiStrings
}

const english: UiStrings = {
  appName: 'Smaran',
  continue: 'Continue',
  back: 'Back',
  speak: 'Speak',
  speaking: 'listening to the water…',
  voiceIdle: 'tap the stone to hear me',
  caregiverLink: 'For family & carers',
  howAreYou: 'How is today feeling?',
  moodJoyful: 'Joyful',
  moodQuiet: 'Quiet',
  moodLow: 'A little low',
  gardenSeed: 'The soil is resting',
  gardenSprout: 'Bamboo shoots are up',
  gardenBloom: 'Orchids are opening',
  gardenGrove: 'The grove is full',
  restingPhase: 'Your garden is sleeping in the moonlight',
  offline: 'Offline — your garden is still growing',
  syncing: 'Syncing…',
  syncedJustNow: 'Last synced just now',
  todaysGames: "Today's quiet things",
  playAgain: 'Once more',
  goHome: 'Back to the pond',
  listenAgain: 'Listen again',
  wellDone: 'A lotus opened',
  gardenWatered: 'Your garden drank today',
  whoIsThis: 'Who is speaking?',
  tapWhatYouKnow: 'Touch what you know',
  tapWithTheLeaf: 'Tap along with the leaf',
  whenAreYouMostAlive: 'When do you feel most yourself?',
  yourQuietPlaceIsReady: 'Your quiet place is ready',
}

export const LANGUAGES: Record<string, LanguagePack> = {
  en: {
    code: 'en',
    label: 'English',
    latinLabel: 'English',
    speechLocale: 'en-IN',
    speechFallback: 'en-US',
    greeting: 'Welcome home, {kin}',
    goldLine: 'it is quiet here',
    sub: 'The pond is warm tonight. Stay as long as you like.',
    kinshipSuggestions: ['Grandmother', 'Grandfather', 'Mother', 'Father'],
    ambientInstrument: 'none',
    reviewed: true,
    ui: english,
  },

  as: {
    code: 'as',
    label: 'অসমীয়া',
    latinLabel: 'Assamese',
    speechLocale: 'as-IN',
    speechFallback: 'bn-IN',
    greeting: '{kin}, আহক',
    goldLine: 'এই নীৰৱতাত',
    sub: 'পুখুৰীটো আজি শান্ত। ইচ্ছা হ’লে বহি থাকক।',
    kinshipSuggestions: ['আইতা', 'ককাদেউতা', 'মা', 'দেউতা', 'Aaita', 'Deuta'],
    ambientInstrument: 'pepa',
    reviewed: false,
    ui: {
      continue: 'আগবাঢ়ক',
      back: 'পিছলৈ',
      speak: 'কওক',
      howAreYou: 'আজি কেনে লাগিছে?',
      caregiverLink: 'পৰিয়াল আৰু যত্নকাৰীৰ বাবে',
      listenAgain: 'আকৌ শুনক',
      goHome: 'পুখুৰীলৈ ঘূৰি যাওক',
    },
  },

  mni: {
    code: 'mni',
    label: 'মৈতৈলোন্',
    latinLabel: 'Manipuri (Meiteilon)',
    speechLocale: 'mni-IN',
    speechFallback: 'bn-IN',
    greeting: '{kin}, লাকপা',
    goldLine: 'তোপা শান্তিদা',
    sub: 'পুখ্রী অসি ঙসি ইং-না লৈরি।',
    kinshipSuggestions: ['ইমা', 'ইপা', 'Ima', 'Ipa', 'Abok', 'Apok'],
    ambientInstrument: 'pepa',
    reviewed: false,
    ui: {
      continue: 'মখা চৎলু',
      back: 'হন্দোকপা',
      howAreYou: 'ঙসি করম্না ফাওই?',
    },
  },

  lus: {
    code: 'lus',
    label: 'Mizo ṭawng',
    latinLabel: 'Mizo',
    speechLocale: 'lus-IN',
    speechFallback: 'en-IN',
    greeting: '{kin}, lût rawh',
    goldLine: 'hmun thianghlim ah',
    sub: 'Dâwn hi a muang e. I duh chhûng zawng i awm thei.',
    kinshipSuggestions: ['Pi', 'Pu', 'Nu', 'Pa'],
    ambientInstrument: 'chapel-bell',
    reviewed: false,
    ui: {
      continue: 'Kal zêl rawh',
      back: 'Hnung lam',
      speak: 'Min bia rawh',
      howAreYou: 'Vawiin hi engtin nge i awm?',
      listenAgain: 'Ngaithla leh rawh',
    },
  },

  hi: {
    code: 'hi',
    label: 'हिन्दी',
    latinLabel: 'Hindi',
    speechLocale: 'hi-IN',
    speechFallback: 'hi-IN',
    greeting: '{kin}, आइए',
    goldLine: 'इस शांति में',
    sub: 'तालाब आज शांत है। जितना चाहें, बैठिए।',
    kinshipSuggestions: ['दादी', 'दादा', 'नानी', 'नाना', 'माँ', 'पिताजी'],
    ambientInstrument: 'none',
    reviewed: false,
    ui: {
      continue: 'आगे बढ़ें',
      back: 'पीछे',
      speak: 'बोलिए',
      howAreYou: 'आज कैसा लग रहा है?',
      caregiverLink: 'परिवार और देखभाल करने वालों के लिए',
      listenAgain: 'फिर से सुनें',
      goHome: 'तालाब पर वापस',
      tapWhatYouKnow: 'जो पहचानते हैं उसे छुएँ',
    },
  },

  nag: {
    code: 'nag',
    label: 'Nagamese',
    latinLabel: 'Nagamese',
    speechLocale: 'as-IN',
    speechFallback: 'en-IN',
    greeting: '{kin}, ahibi',
    goldLine: 'yate shanti ase',
    sub: 'Pukhuri aji thanda ase. Kiman mon lage bohibi.',
    kinshipSuggestions: ['Aaita', 'Koka', 'Ama', 'Baba'],
    ambientInstrument: 'chapel-bell',
    reviewed: false,
    ui: {
      continue: 'Age jabi',
      back: 'Pichete',
      howAreYou: 'Aji kenekoi lagise?',
    },
  },
}

/** The six buds at the water's edge, in tap order. */
export const LANGUAGE_ORDER: LanguageCode[] = ['en', 'as', 'mni', 'lus', 'hi', 'nag']

/**
 * A caregiver may add a language that is not on the list. We keep the structure
 * and borrow English speech + UI, because a wrong greeting in the right language
 * is warmer than a right greeting in the wrong one.
 */
export function customPack(label: string, greeting: string, goldLine: string, sub: string): LanguagePack {
  return {
    code: `custom:${label.toLowerCase().replace(/\s+/g, '-')}`,
    label,
    latinLabel: label,
    speechLocale: 'en-IN',
    speechFallback: 'en-IN',
    greeting,
    goldLine,
    sub,
    kinshipSuggestions: [],
    ambientInstrument: 'none',
    reviewed: false,
    ui: {},
  }
}

const customPacks = new Map<string, LanguagePack>()

export function registerCustomPack(pack: LanguagePack) {
  customPacks.set(pack.code, pack)
}

export function getPack(code: LanguageCode): LanguagePack {
  return customPacks.get(code) ?? LANGUAGES[code] ?? LANGUAGES.en
}

/** Greeting with the kinship term substituted. Falls back to a bare invitation. */
export function buildGreeting(code: LanguageCode, kinshipTerm: string) {
  const pack = getPack(code)
  const kin = kinshipTerm?.trim() || pack.kinshipSuggestions[0] || ''
  return {
    greeting: pack.greeting.replace('{kin}', kin).replace(/^,\s*/, ''),
    goldLine: pack.goldLine,
    sub: pack.sub,
  }
}

/**
 * Common kinship words, transliterated per language. The caregiver sets a
 * single kinship term at setup (in whatever script they typed it in); when the
 * patient chooses a different lotus bud, this looks the term up here so the
 * *name she is called* changes with the language, not just the surrounding
 * copy. Unrecognised terms (a name, a nickname) pass through unchanged —
 * that is more honest than guessing a translation.
 */
const KIN_MAP: Record<string, Partial<Record<LanguageCode, string>>> = {
  grandmother: { en: 'Grandmother', as: 'আইতা', mni: 'Ima', lus: 'Pi', hi: 'दादी', nag: 'Aaita' },
  aaita: { en: 'Grandmother', as: 'আইতা', mni: 'Ima', lus: 'Pi', hi: 'दादी', nag: 'Aaita' },
  grandfather: { en: 'Grandfather', as: 'ককাদেউতা', mni: 'Ipa', lus: 'Pu', hi: 'दादा', nag: 'Koka' },
  koka: { en: 'Grandfather', as: 'ককাদেউতা', mni: 'Ipa', lus: 'Pu', hi: 'दादा', nag: 'Koka' },
  mother: { en: 'Mother', as: 'মা', mni: 'Ima', lus: 'Nu', hi: 'माँ', nag: 'Ama' },
  ma: { en: 'Mother', as: 'মা', mni: 'Ima', lus: 'Nu', hi: 'माँ', nag: 'Ama' },
  father: { en: 'Father', as: 'দেউতা', mni: 'Ipa', lus: 'Pa', hi: 'पिताजी', nag: 'Baba' },
  deuta: { en: 'Father', as: 'দেউতা', mni: 'Ipa', lus: 'Pa', hi: 'पिताजी', nag: 'Baba' },
}

/** The kinship term, in the script/word of whichever language is currently chosen. */
export function translateKinshipTerm(term: string, code: LanguageCode): string {
  const key = term?.trim().toLowerCase()
  const entry = key ? KIN_MAP[key] : undefined
  if (!entry) return term
  return entry[code] ?? entry.en ?? term
}

/** UI string with English fallback. `t('continue')` never returns undefined. */
export function t(code: LanguageCode, key: UiKey): string {
  const pack = getPack(code)
  return pack.ui[key] ?? english[key] ?? key
}

/** What the voice assistant reads aloud on the home screen. */
export function spokenGreeting(code: LanguageCode, kinshipTerm: string): string {
  const g = buildGreeting(code, kinshipTerm)
  return `${g.greeting}, ${g.goldLine}. ${g.sub}`
}
