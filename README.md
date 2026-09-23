# Smaran

*Sanskrit: to remember.*

A dementia care companion for elderly patients in North East India. Not a
brain-training app — a living digital sanctuary: a twilight pond at the edge of
a bamboo forest, a sleepy moon, koi drifting under lotus leaves, and a voice
that greets her in her own language using the word her family calls her by.

Clinically-shaped cognitive stimulation is wrapped in enough warmth that the
patient never feels assessed. The AI watches quietly — hesitation, mood, voice
texture, rhythm — and reshapes the experience around what she has kept.

---

## Running it

### Development (nothing to install but Node and a JDK)

```bash
# backend — H2 in memory, demo data seeded, API open for local use
cd backend
mvn -Dspring-boot.run.profiles=dev spring-boot:run     # → :8080

# frontend
cd frontend
npm install
npm run dev                                            # → :5173
```

Open <http://localhost:5173>. The first screen is the arrival — five steps that
build a cognitive profile without asking a single clinical question. The
caregiver dashboard is at `/caregiver` (`rupa@example.com` / `smaran`, or the
"continue without signing in" link).

The PWA also runs with **no backend at all**: every read falls back to the
device cache and then to seeded demo content, and every write queues in
IndexedDB. That is not a demo affordance — it is the same path a tablet takes in
a village with no signal for three days.

### The full stack

```bash
export SMARAN_JWT_SECRET=$(openssl rand -base64 48)
docker compose up --build       # PWA :8081 · API :8080
```

---

## What is here

```
frontend/                      React 18 · Vite · TypeScript · Tailwind · PWA
  src/scenes/Sanctuary.tsx     the whole pond, hand-coded SVG
  src/scenes/sanctuary.css     five breeze cycles, koi, breathing, grain
  src/screens/Home.tsx         greeting · lotus-bud languages · voice stone
  src/screens/Onboarding.tsx   "The Arriving Guest" — five silent measurements
  src/games/                   Weaver's Loom · Grandmother's Tale ·
                               Family Grove · Morning Rituals
  src/caregiver/               setup, dashboard, login
  src/lib/                     api · db (IndexedDB) · speechEngine · ambient ·
                               audioCapture · affect · gardenEngine ·
                               cognitiveProfile · federated
  src/service-worker.ts        offline caching + reminders with zero signal
  src/i18n/strings.ts          greetings, kinship terms, cultural registers

backend/                       Spring Boot 3 · Java 21 · JPA · WebFlux · JWT
  domain/ repo/ service/ web/  entities, repositories, the rules, the API
```

## The parts worth knowing about

**The illustration is the interface.** `Sanctuary.tsx` is one SVG: radial sky
and chalk stars, folk-art hills through a `feTurbulence` roughen filter, three
depth layers of bamboo per side swaying from the root, banana leaves, grasses
with scroll motifs at the waterline, the pond, lily pads with the triangular
notch cut, three koi that turn to face where they are swimming, a sleeping woman
breathing on a 5.5 s cycle, and a fractal-noise grain overlay that makes the
whole thing read as gouache. No raster asset anywhere. Five breeze cycles run at
staggered offsets so nothing ever moves in lockstep, everything is
`ease-in-out`, and `prefers-reduced-motion` stops the pond rather than degrading
it.

**Nothing is a rectangle.** The greeting is chalk against the sky. The languages
are six lotus buds at the water's edge that bloom when chosen. The voice button
is a river stone with a leaf on it. The caregiver link is a quiet underline in
the corner.

**The garden replaces every score.** `gardenEngine.ts` and `GardenStateService`
are deliberate duplicates of each other so a tablet offline for a week blooms
identically to the server. Growth only ever increases — there is no decrement in
either file. A missed day sets `restingPhase`, which is moonlight sleep, not a
penalty; the patient is never told, and the caregiver is told once, after three
consecutive days.

**Adaptation is silent.** `useAdaptiveSession` runs behind all four games. It
watches tap latency against her *own* baseline, adds face-mesh geometry when a
camera is available and permitted (brow furrow, eye openness — never a frame
leaves the device), and subscribes to the server's SSE stream. Two consecutive
readings above her behaviourally-derived anxiety threshold ease all three
difficulty axes at once and shift the ambient tone 528 → 432 Hz. She is never
shown a notification, a change, or a failure screen.

**The profile is built by watching.** Onboarding measures language latency,
semantic recognition, motor rhythm, mood and self-reported peak — as five warm
interactions, not a questionnaire. Every session amends the profile with a 3:1
weighting toward history, so one bad afternoon never rewrites a person.

**Offline is the default case.** Service Worker pre-caches the scene, the games
and the language strings; medicine reminders fire from the device's own clock
with a 45-minute grace window; sessions queue in IndexedDB and sync on
reconnect, deduplicated by `(patientId, startedAt)` with the server record
winning. Garden state is *recomputed* from deduplicated history rather than
accumulated, so a replayed queue cannot inflate it.

**Voice never leaves the device.** `audioCapture.ts` computes five scalars
(jitter, shimmer, mean pause, speech rate, phonation ratio) in memory and
discards the waveform. There is no audio column in `AcousticVector` and no
`MediaRecorder` in that file. A rising jitter *and* shimmer trend over 30 days
produces exactly one sentence — "Possible early vocal fatigue pattern —
recommend clinical review" — whose wording is fixed in code, because the
distinction between a monitoring signal and a diagnosis is the whole clinical
position.

**Family Grove advances per person.** She may recall her daughter unprompted and
still need a cousin's name on screen. Three fluent recognitions advance that one
relationship; a miss drops it immediately, which is errorless learning working
rather than a punishment. A correct answer notifies that family member and asks
them to record a new five-second voice note — which is what she hears next time.

## Things that are deliberately not finished

Stated plainly so nobody mistakes scaffolding for a feature:

- **The NER-language phrasing is unreviewed.** Assamese, Manipuri, Mizo and
  Nagamese greetings are the brief's best attempt, marked `reviewed: false` in
  `i18n/strings.ts` and in `LanguageService`, and the caregiver setup screen
  warns about it. Replace them with a native speaker's phrasing before a pilot.
- **Federated learning is a working shape, not a working protocol.** The device
  trains a logistic-regression head locally (plain TypeScript, ~60 lines, rather
  than a 3 MB TensorFlow.js dependency on a rural tablet — the exchange is
  identical and the swap point is marked), encrypts the gradient delta with
  AES-GCM and posts it. The server stores a hash as a receipt and drops the
  payload. Real key agreement or secure aggregation is the first task of an FL
  pilot; `FederatedAggregationService` says so at the top.
- **Zero-knowledge proof audit logs are not implemented.** Phase 2 in the brief,
  and nothing here pretends otherwise.
- **FCM and Twilio are behind `NotificationService`** and log instead of
  sending until keys are configured. The family WebSocket is real and works.
- **S3 is a local directory** behind the same key-based interface
  (`StorageService`). Two methods to swap.
- **PDF export is OpenPDF**, not JasperReports; the intended `.jrxml` lives in
  `backend/src/main/resources/reports/` with the field list.
- **All demo content is fictional placeholder.** The therapeutic claim rests
  entirely on the content being *this patient's* — her family's faces, her
  family's voices, her objects. Generic content measures nothing.

## Verified

`npm run build` and `tsc -b` are clean; `mvn test` passes; the backend boots on
the dev profile and seeds a month of history. Endpoints exercised end-to-end:
login, game routing, garden state, session submit (including a replay correctly
reported as a duplicate), family members, caregiver dashboard, and the PDF
report. The pond itself has not been reviewed on a screen by a human — look at
it before showing it to anyone, and say what to change.
