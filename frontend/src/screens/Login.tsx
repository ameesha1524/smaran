// Orphaned — patient login removed from flow.
//
// Kept for reference only. The body is commented out rather than left live
// because it still calls register(), which no longer exists on the context:
// a screen nothing routes to should not hold the typecheck hostage.
export {}

// import { useMemo, useState } from 'react'
// import { useNavigate } from 'react-router-dom'
// import Sanctuary from '../scenes/Sanctuary'
// import LotusBuds from '../components/LotusBuds'
// import { useSmaran } from '../state/SmaranContext'
// import { getPack, t, translateKinshipTerm } from '../i18n/strings'
//
// /**
//  * The first screen a device ever shows: who is sitting down at the pond.
//  *
//  * It asks for two things and neither is a credential. There is no password,
//  * no email, no account — a patient who cannot reliably recall a password is
//  * exactly the person this app exists for. The name is what the greeting will
//  * use from then on, and the kinship term is what the voice will call her.
//  */
//
// export default function Login() {
//   const { language, setLanguage, setPatient, register } = useSmaran()
//   const navigate = useNavigate()
//
//   const [name, setName] = useState('')
//   const [kin, setKin] = useState('')
//
//   const pack = useMemo(() => getPack(language), [language])
//   const suggestions = pack.kinshipSuggestions.slice(0, 4)
//
//   const ready = name.trim().length > 0
//
//   const submit = (e: React.FormEvent) => {
//     e.preventDefault()
//     if (!ready) return
//     const chosenKin = kin.trim() || suggestions[0] || name.trim()
//     register(name.trim(), chosenKin)
//     setPatient({ name: name.trim(), kinshipTerm: chosenKin, languageCode: language })
//     navigate('/', { replace: true })
//   }
//
//   return (
//     <div className="relative min-h-screen w-full overflow-hidden">
//       <Sanctuary phase="night" bloomStage={1} recede />
//
//       <div className="plaque-fade absolute inset-0 z-20 flex flex-col items-center justify-center px-6 text-center">
//         <span
//           className="font-sans"
//           style={{ fontSize: 14, letterSpacing: '0.14em', color: 'var(--chalk-dim)', opacity: 0.8 }}
//         >
//           {t(language, 'appName')}
//         </span>
//
//         <h1
//           className="inscription font-serif mt-3"
//           style={{ fontSize: 'clamp(26px, 4vw, 48px)', color: 'var(--chalk)', lineHeight: 1.25 }}
//         >
//           What shall I call you?
//         </h1>
//         <p className="mt-3 font-sans" style={{ fontSize: 16, color: 'var(--chalk-dim)', maxWidth: 560 }}>
//           Only a name. Nothing else is asked, and nothing leaves this device.
//         </p>
//
//         <form onSubmit={submit} className="mt-8 flex w-full max-w-lg flex-col items-center">
//           <input
//             type="text"
//             value={name}
//             onChange={(e) => setName(e.target.value)}
//             placeholder="Your name"
//             autoFocus
//             autoComplete="name"
//             aria-label="Your name"
//             className="name-field w-full text-center font-serif"
//             style={{ fontSize: 'clamp(22px, 3vw, 32px)' }}
//           />
//
//           {suggestions.length > 0 && (
//             <>
//               <p className="mt-8 font-sans" style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>
//                 And what does your family call you?
//               </p>
//               <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
//                 {suggestions.map((s) => {
//                   const active = kin === s
//                   return (
//                     <button
//                       key={s}
//                       type="button"
//                       onClick={() => setKin(active ? '' : s)}
//                       className="choice-card px-5 py-2"
//                       style={{
//                         fontSize: 17,
//                         minHeight: 0,
//                         color: active ? 'var(--gold-soft)' : 'var(--chalk)',
//                         borderColor: active ? 'rgba(232,200,74,0.7)' : undefined,
//                       }}
//                     >
//                       {s}
//                     </button>
//                   )
//                 })}
//               </div>
//             </>
//           )}
//
//           <button
//             type="submit"
//             disabled={!ready}
//             className="pill mt-10"
//             style={{
//               background: ready ? 'rgba(232,200,74,0.16)' : 'rgba(221,234,248,0.06)',
//               border: `1px solid ${ready ? 'rgba(232,200,74,0.6)' : 'rgba(221,234,248,0.2)'}`,
//               color: ready ? 'var(--gold-soft)' : 'var(--chalk-dim)',
//             }}
//           >
//             {t(language, 'continue')}
//           </button>
//
//           {ready && (
//             <p className="mt-6 font-serif italic" style={{ fontSize: 18, color: 'var(--chalk-dim)' }}>
//               {pack.greeting.replace('{kin}', translateKinshipTerm(name.trim(), language)).replace(/^,\s*/, '')}
//             </p>
//           )}
//         </form>
//       </div>
//
//       {/* The language is chosen before the name, so the question itself can be
//           read in her own script the moment she picks a bud. */}
//       <div className="absolute inset-x-0 bottom-[5vh] z-20 px-4">
//         <LotusBuds value={language} onChange={setLanguage} size={58} />
//       </div>
//     </div>
//   )
// }
//
