// Converted to silent logic — see deriveGameRoute in cognitiveProfile.ts
//
// There is no arrival screen any more. Sessions one and two ARE the
// onboarding: the Weaver's Loom at tier 1 reads tap latency, object
// recognition and hesitation; the Family Grove at phase 1 reads affect.
// By session three the profile has enough signal to route on its own.
//
// The old five-step flow is preserved below, commented out, for reference.
export {}

// import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// import { useNavigate } from 'react-router-dom'
// import Sanctuary from '../scenes/Sanctuary'
// import LotusBuds from '../components/LotusBuds'
// import MoodCheckIn from '../components/MoodCheckIn'
// import VoiceStone from '../components/VoiceStone'
// import { useSmaran } from '../state/SmaranContext'
// import { buildProfileV1, PEAK_LABELS, tapTargetFor, type OnboardingSignals } from '../lib/cognitiveProfile'
// import { games as gamesApi } from '../lib/api'
// import { demoObjects } from '../lib/demoData'
// import { cue, unlockAudio } from '../lib/ambient'
// import { t } from '../i18n/strings'
// import type { CognitiveObjectResult, LanguageCode, MeaningfulObject, MoodKey, PeakWindow } from '../lib/types'
//
// /**
//  * "The Arriving Guest" — five steps that build a cognitive profile without one
//  * clinical question being asked.
//  *
//  * Step 1 measures language and selection latency by asking her to choose a
//  * language. Step 2 measures semantic memory and reaction latency by asking her
//  * to touch what she recognises. Step 3 measures motor coordination, attention
//  * and anxiety by asking her to tap along with a leaf. Step 4 asks how she
//  * feels, in warm words. Step 5 asks when she feels most herself.
//  *
//  * She is never told that any of these are measurements. They aren't lies — they
//  * are all things you would ask a guest arriving at your house.
//  */
//
// const STEPS = 5
// const BEAT_MS = 1200
// const BEAT_COUNT = 12
//
// export default function Onboarding() {
//   const { patient, language, setLanguage, setProfile, setPatient, phase, gardenState, stillness } = useSmaran()
//   const navigate = useNavigate()
//
//   const [step, setStep] = useState(0)
//   const [objects, setObjects] = useState<MeaningfulObject[]>(demoObjects)
//
//   // Collected signals — every one of them a by-product of a warm interaction.
//   const shownAt = useRef(Date.now())
//   const [languageLatencyMs, setLanguageLatencyMs] = useState(0)
//   const [objectTaps, setObjectTaps] = useState<Record<string, number>>({})
//   const [rhythmOffsets, setRhythmOffsets] = useState<number[]>([])
//   const [rhythmStarted, setRhythmStarted] = useState(false)
//   const [mood, setMood] = useState<MoodKey | null>(null)
//   const [peak, setPeak] = useState<PeakWindow | null>(null)
//
//   useEffect(() => {
//     shownAt.current = Date.now()
//   }, [step])
//
//   useEffect(() => {
//     void gamesApi.objects(patient.id).then((list) => {
//       if (list?.length) setObjects(list)
//     })
//   }, [patient.id])
//
//   const tapTarget = tapTargetFor('SUPPORTED') // the most generous size, until we know better
//
//   /* ------------------------------------------------------------- step 1 */
//
//   const chooseLanguage = (code: LanguageCode) => {
//     if (!languageLatencyMs) setLanguageLatencyMs(Date.now() - shownAt.current)
//     setLanguage(code)
//   }
//
//   /* ------------------------------------------------------------- step 2 */
//
//   const tapObject = async (id: string) => {
//     await unlockAudio()
//     cue('petal')
//     setObjectTaps((prev) => (prev[id] ? prev : { ...prev, [id]: Date.now() - shownAt.current }))
//   }
//
//   const objectResults: CognitiveObjectResult[] = useMemo(
//     () =>
//       objects.map((o) => ({
//         objectName: o.name,
//         semanticCluster: o.semanticCluster,
//         tappedMs: objectTaps[o.id] ?? 0,
//         // Recognition is self-declared here: touching it *is* the recognition.
//         wasCorrect: Boolean(objectTaps[o.id]),
//       })),
//     [objects, objectTaps],
//   )
//
//   /* ------------------------------------------------------------- step 3 */
//
//   const beatTimes = useRef<number[]>([])
//   const beatTimer = useRef<number | null>(null)
//   const [pulse, setPulse] = useState(false)
//
//   const startRhythm = useCallback(async () => {
//     await unlockAudio()
//     setRhythmStarted(true)
//     beatTimes.current = []
//     let n = 0
//     const tick = () => {
//       if (n >= BEAT_COUNT) {
//         if (beatTimer.current) window.clearInterval(beatTimer.current)
//         beatTimer.current = null
//         return
//       }
//       n++
//       beatTimes.current.push(performance.now())
//       cue('pond-tap')
//       setPulse(true)
//       window.setTimeout(() => setPulse(false), 320)
//     }
//     tick()
//     beatTimer.current = window.setInterval(tick, BEAT_MS)
//   }, [])
//
//   useEffect(() => () => {
//     if (beatTimer.current) window.clearInterval(beatTimer.current)
//   }, [])
//
//   const tapLeaf = () => {
//     if (!rhythmStarted || !beatTimes.current.length) return
//     const now = performance.now()
//     // Offset from the nearest beat — early is negative, late is positive.
//     let nearest = beatTimes.current[0]
//     for (const b of beatTimes.current) if (Math.abs(b - now) < Math.abs(nearest - now)) nearest = b
//     setRhythmOffsets((o) => [...o, Math.round(now - nearest)])
//   }
//
//   /* ---------------------------------------------------------- completion */
//
//   const signals: OnboardingSignals | null = useMemo(() => {
//     if (!mood || !peak) return null
//     return {
//       patientId: patient.id,
//       languageCode: language,
//       languageLatencyMs: languageLatencyMs || 4000,
//       objectResults,
//       rhythmOffsets,
//       rhythmAbandoned: rhythmStarted && rhythmOffsets.length < 4,
//       mood,
//       peakWindow: peak,
//     }
//   }, [mood, peak, patient.id, language, languageLatencyMs, objectResults, rhythmOffsets, rhythmStarted])
//
//   const profile = useMemo(() => (signals ? buildProfileV1(signals) : null), [signals])
//
//   const finish = () => {
//     if (!profile || !peak) return
//     setProfile(profile)
//     setPatient({ languageCode: language, peakWindow: peak, profileVersion: '1.0' })
//     navigate('/')
//   }
//
//   /* -------------------------------------------------------------- gating */
//
//   const canContinue = [
//     true, // a language is always selected; latency is the measurement
//     Object.keys(objectTaps).length >= 1,
//     // Never trap her in the rhythm step: it can be passed through, and passing
//     // through is itself the "supported" signal.
//     true,
//     mood !== null,
//     peak !== null,
//   ][step]
//
//   const spoken = [
//     'Choose the language you would like me to speak.',
//     'Touch the things you know.',
//     'A leaf is beating. Tap along with it, if you like.',
//     'How are you feeling today?',
//     'When in the day do you feel most yourself?',
//   ][step]
//
//   return (
//     <div className="relative min-h-screen w-full overflow-hidden">
//       <Sanctuary phase={phase} bloomStage={gardenState.bloomStage} still={stillness} recede />
//
//       {/* progress: five soft segments, never numbered steps */}
//       <div className="absolute inset-x-0 top-0 z-30 flex gap-1 px-4 pt-4">
//         {Array.from({ length: STEPS }, (_, i) => (
//           <div
//             key={i}
//             style={{
//               height: 3,
//               flex: 1,
//               borderRadius: 999,
//               background: i <= step ? 'var(--olive-light)' : 'rgba(221,234,248,0.16)',
//               boxShadow: i === step ? '0 0 10px rgba(90,120,64,0.9)' : 'none',
//               transition: 'background 900ms ease-in-out, box-shadow 900ms ease-in-out',
//             }}
//           />
//         ))}
//       </div>
//
//       <div className="relative z-20 mx-auto flex min-h-screen w-full max-w-4xl flex-col items-center justify-center gap-10 px-6 py-16">
//         {step === 0 && (
//           <section className="plaque-fade flex flex-col items-center gap-8 text-center">
//             <h1 className="inscription font-serif" style={{ fontSize: 'clamp(26px, 4vw, 46px)' }}>
//               Which words feel like home?
//             </h1>
//             <LotusBuds value={language} onChange={chooseLanguage} size={84} />
//           </section>
//         )}
//
//         {step === 1 && (
//           <section className="plaque-fade flex flex-col items-center gap-8 text-center">
//             <h1 className="inscription font-serif" style={{ fontSize: 'clamp(26px, 4vw, 46px)' }}>
//               {t(language, 'tapWhatYouKnow')}
//             </h1>
//             <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
//               {objects.map((o) => {
//                 const tapped = Boolean(objectTaps[o.id])
//                 return (
//                   <button
//                     key={o.id}
//                     type="button"
//                     onClick={() => void tapObject(o.id)}
//                     className="petal-card flex flex-col items-center justify-center gap-2 p-4"
//                     data-state={tapped ? 'correct' : undefined}
//                     style={{ minWidth: Math.max(tapTarget, 116), minHeight: Math.max(tapTarget, 116) }}
//                   >
//                     {o.imageUrl ? (
//                       <img src={o.imageUrl} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: '40%' }} />
//                     ) : (
//                       <span style={{ fontSize: 38 }} aria-hidden="true">
//                         {o.glyph ?? '🪷'}
//                       </span>
//                     )}
//                     <span style={{ fontSize: 16, color: 'var(--chalk)' }}>{o.name}</span>
//                   </button>
//                 )
//               })}
//             </div>
//             <p className="font-sans" style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>
//               Touch as many or as few as you like.
//             </p>
//           </section>
//         )}
//
//         {step === 2 && (
//           <section className="plaque-fade flex flex-col items-center gap-8 text-center">
//             <h1 className="inscription font-serif" style={{ fontSize: 'clamp(26px, 4vw, 46px)' }}>
//               {t(language, 'tapWithTheLeaf')}
//             </h1>
//
//             <button
//               type="button"
//               onClick={rhythmStarted ? tapLeaf : () => void startRhythm()}
//               className="flex items-center justify-center"
//               style={{ width: 210, height: 210 }}
//               aria-label="Tap the leaf"
//             >
//               <svg width="200" height="200" viewBox="0 0 200 200" aria-hidden="true">
//                 <g
//                   style={{
//                     transformOrigin: '100px 100px',
//                     transform: pulse ? 'scale(1.12)' : 'scale(1)',
//                     transition: 'transform 320ms ease-in-out',
//                   }}
//                 >
//                   <circle cx="100" cy="100" r="86" fill="none" stroke="var(--gold)" strokeWidth="1" opacity={pulse ? 0.7 : 0.2} />
//                   <path
//                     d="M100,176 C48,144 40,72 100,24 C160,72 152,144 100,176 Z"
//                     fill="var(--olive)"
//                     fillOpacity={pulse ? 0.55 : 0.32}
//                     stroke="var(--olive-light)"
//                     strokeWidth="2"
//                   />
//                   <path d="M100,176 C94,128 94,72 100,24" fill="none" stroke="var(--olive-light)" strokeWidth="1.6" />
//                 </g>
//               </svg>
//             </button>
//
//             <p className="font-sans" style={{ fontSize: 16, color: 'var(--chalk-dim)' }}>
//               {!rhythmStarted
//                 ? 'Touch the leaf to begin.'
//                 : rhythmOffsets.length
//                   ? 'That is lovely. Keep going, or move on whenever you like.'
//                   : 'Tap it each time it breathes.'}
//             </p>
//           </section>
//         )}
//
//         {step === 3 && (
//           <section className="plaque-fade">
//             <MoodCheckIn variant="eight" value={mood} onPick={setMood} prompt={t(language, 'howAreYou')} tapTarget={tapTarget} />
//           </section>
//         )}
//
//         {step === 4 && (
//           <section className="plaque-fade flex flex-col items-center gap-8 text-center">
//             <h1 className="inscription font-serif" style={{ fontSize: 'clamp(26px, 4vw, 46px)' }}>
//               {t(language, 'whenAreYouMostAlive')}
//             </h1>
//             <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
//               {(Object.keys(PEAK_LABELS) as PeakWindow[]).map((w) => {
//                 const meta = PEAK_LABELS[w]
//                 const active = peak === w
//                 return (
//                   <button
//                     key={w}
//                     type="button"
//                     onClick={() => setPeak(w)}
//                     className="petal-card flex flex-col items-center justify-center gap-1 px-5 py-4"
//                     data-state={active ? 'correct' : undefined}
//                     style={{ minWidth: Math.max(tapTarget, 150), minHeight: Math.max(tapTarget, 116) }}
//                   >
//                     <span style={{ fontSize: 30 }} aria-hidden="true">
//                       {meta.glyph}
//                     </span>
//                     <span style={{ fontSize: 18, color: 'var(--chalk)' }}>{meta.name}</span>
//                     <span style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>{meta.sub}</span>
//                   </button>
//                 )
//               })}
//             </div>
//           </section>
//         )}
//
//         {/* -------------------------------------------------- the derived profile */}
//         {step === STEPS && profile && (
//           <section className="plaque-fade flex w-full flex-col items-center gap-6 text-center">
//             <h1 className="inscription font-serif" style={{ fontSize: 'clamp(26px, 4vw, 46px)' }}>
//               {t(language, 'yourQuietPlaceIsReady')}
//             </h1>
//             <p className="font-serif italic" style={{ fontSize: 20, color: 'var(--gold-soft)' }}>
//               Everything below was learned by watching, not by asking.
//             </p>
//
//             <dl className="grid w-full max-w-2xl grid-cols-2 gap-x-8 gap-y-3 text-left">
//               {[
//                 ['Language', language],
//                 ['Objects recognised', `${objectResults.filter((r) => r.wasCorrect).length} of ${objectResults.length}`],
//                 ['Hand', profile.motorTier.toLowerCase()],
//                 ['Mood today', mood?.replace(/_/g, ' ').toLowerCase() ?? '—'],
//                 ['Most herself', peak ? PEAK_LABELS[peak].name : '—'],
//                 ['Family Grove starts at', `phase ${profile.startingPhase}`],
//               ].map(([k, v]) => (
//                 <div key={k} className="flex items-baseline justify-between gap-4" style={{ borderBottom: '1px solid rgba(221,234,248,0.12)' }}>
//                   <dt className="font-sans" style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>
//                     {k}
//                   </dt>
//                   <dd className="font-sans" style={{ fontSize: 17, color: 'var(--chalk)' }}>
//                     {v}
//                   </dd>
//                 </div>
//               ))}
//             </dl>
//
//             <button type="button" onClick={finish} className="pill mt-4" style={{ background: 'var(--olive-continue)', color: 'var(--chalk)' }}>
//               Go to the pond
//             </button>
//           </section>
//         )}
//       </div>
//
//       {/* ------------------------------------------------------ the controls */}
//       {step < STEPS && (
//         <div className="absolute inset-x-0 bottom-6 z-30 flex items-center justify-between px-6">
//           <button
//             type="button"
//             onClick={() => setStep((s) => Math.max(0, s - 1))}
//             className="pill stone"
//             disabled={step === 0}
//           >
//             {t(language, 'back')}
//           </button>
//
//           <VoiceStone language={language} text={spoken} size={88} autoSpeakAfterMs={1400} />
//
//           <button
//             type="button"
//             onClick={() => setStep((s) => s + 1)}
//             className="pill"
//             disabled={!canContinue}
//             style={{ background: 'var(--olive-continue)', color: 'var(--chalk)' }}
//           >
//             {t(language, 'continue')}
//           </button>
//         </div>
//       )}
//     </div>
//   )
// }
//
