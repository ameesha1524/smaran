# Smaran — Full Project Context

The complete state of the Smaran project: what it is, how it's built, every
decision made across the build conversations, and what's still open. Paste or
attach this file to start a new chat with full context.

Last updated **2026-09-29**. Repo: https://github.com/ameesha1524/smaran
(branch `master`).

---

## Contents

1. [What Smaran is](#1-what-smaran-is)
2. [Tech stack](#2-tech-stack)
3. [Repository layout](#3-repository-layout)
4. [Running it](#4-running-it)
5. [App flow and routing](#5-app-flow-and-routing)
6. [The games](#6-the-games)
7. [The cognitive mapping system](#7-the-cognitive-mapping-system)
8. [Routing: `deriveGameRoute`](#8-routing-derivegameroute)
9. [Device pairing](#9-device-pairing)
10. [Backend API](#10-backend-api)
11. [State, storage and sync](#11-state-storage-and-sync)
12. [Pixel-art system and assets](#12-pixel-art-system-and-assets)
13. [Caregiver side](#13-caregiver-side)
14. [Journal and pond overlays](#14-journal-and-pond-overlays)
15. [Testing and verification](#15-testing-and-verification)
16. [Standing constraints and lessons](#16-standing-constraints-and-lessons)
17. [Git history and uncommitted work](#17-git-history-and-uncommitted-work)
18. [Open items](#18-open-items)

---

## 1. What Smaran is

A dementia-care companion app for elderly patients in **North East India**.
Two audiences, two registers:

- **The patient** uses a tablet. She plays gentle games on a pixel-art night
  pond. She never logs in, never sees a score, a timer, a number, a failure
  state or clinical language. Six languages: English, Assamese (অসমীয়া),
  Meitei/Manipuri (মৈতৈলোন্, Bengali script), Mizo, Hindi, and Nagamese.
- **The family and carers** use a conventional app: setup, a dashboard of
  cognitive trends, alerts, a PDF for the doctor, and tablet pairing.

Every game session quietly feeds a **six-domain cognitive profile**. That
profile drives which game is suggested each day and what the caregiver
dashboard shows.

**Design principles (non-negotiable):**
- No failure states. A wrong tap never punishes; a miss is never marked.
- No visible timers, scores or streaks. Growth is a garden, not a number.
- Sounds are world events (a frog entering water, a petal opening), never UI
  beeps.
- Reduced motion is honoured through the OS setting and the app's own
  "stillness" toggle.
- The art should read as "made by Indian artists", not "vibe-coded".

---

## 2. Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 5, TypeScript 5, Tailwind 3, react-router 6, Recharts |
| PWA | vite-plugin-pwa (`injectManifest`, hand-written `src/service-worker.ts` for offline reminders; SW disabled in dev) |
| Offline store | IndexedDB (`lib/db.ts`) and localStorage |
| Audio | Web Audio API, all synthesised (no audio files) — `lib/ambient.ts` |
| Backend | Spring Boot 3.3.4, Java 21, Spring Security (stateless JWT, jjwt), Spring Data JPA, WebFlux (SSE), WebSocket |
| Database | PostgreSQL 16 in production; H2 in-memory in the `dev` profile |
| Cache | Redis 7 (optional; excluded in dev) |
| PDF | OpenPDF (doctor's report) |
| Deployment shape | `docker-compose.yml`: Postgres, Redis, backend (:8080), PWA behind nginx (:8081) |

There is **no Flutter**, despite anything older docs imply.

**Local tooling notes (this Windows machine):**
- Maven isn't on PATH. Use
  `C:\Users\amees\.m2\wrapper\dists\apache-maven-3.9.16\0daed3be…\bin\mvn.cmd`,
  offline (`-o`) works. JDK 21 (Temurin) is on PATH.
- Python with Pillow is `python` (Python 3.14), not `python3`.
- In Git Bash, `$HOME` is wrong; use `/c/Users/amees`. PowerShell 5.1 has no `&&`.

---

## 3. Repository layout

```
Smaran/
├── CHAT_CONTEXT.md          ← this file
├── LOTUS-FROG.md            Lotus Frog integration notes (Phase 1 analysis + fixes)
├── docs/rbac-architecture.md  RBAC design (roles, schema, pairing, migration plan)
├── docker-compose.yml
├── backend/                 Spring Boot
│   └── src/main/java/org/smaran/
│       ├── config/   AccessGuard, JwtService, JwtAuthFilter, SecurityConfig,
│       │             DemoDataSeeder (dev only), StartupChecks, WebSocketConfig
│       ├── domain/   entities + Enums + DomainReading + DevicePairing
│       ├── repo/     one Spring Data repository per entity
│       ├── service/  CognitiveMap, CognitiveProfileService, SessionService,
│       │             PairingService, DashboardService, GardenStateService,
│       │             ReportService, SyncService, AudioBiomarkerService, …
│       └── web/      controllers + Dto.java (every wire payload)
└── frontend/
    ├── public/       pond-pixel.png, duck-pond.png, duck-lilies.png, icons/
    └── src/
        ├── App.tsx               routes + patient entry gates
        ├── state/SmaranContext.tsx   all app state and actions
        ├── lib/                  types, cognitiveMap, cognitiveProfile, api, db,
        │                         gardenEngine, ambient, speechEngine,
        │                         journalAnalysis, demoData, affect, federated
        ├── screens/              Home, GamesMenu, LanguageChoice, Journal
        │                         (+ orphaned Login, Onboarding)
        ├── games/                DuckRollCall, KoiAreJumping, LotusFrog (+ lotus-frog/
        │                         engine), GrandmothersTale, FamilyGrove,
        │                         MorningRituals, games.css (+ orphaned WeaversLoom)
        ├── caregiver/            Login, Dashboard, Setup, PairDevice, PairingPanel,
        │                         sampleDashboard
        ├── components/           GameShell (+Progress), PondOverlays, VoiceStone, …
        ├── scenes/               PixelPond (+useStageScale), Sanctuary (old vector
        │                         scene), orphaned pixelScenery
        └── i18n/strings.ts
```

Items not tracked in git: `.claude/`, `Claude outputs/` (the Froggie cognitive
module deliverables), and `froggie-with-cognitive.tgz`.

**Orphaned files, kept deliberately.** The convention is that files aren't deleted without asking. Bodies are line-commented out, with a header note.
- `screens/Login.tsx` and `screens/Onboarding.tsx` — patient login and onboarding were removed.
- `games/WeaversLoom.tsx` — retired game.
- `scenes/pixelScenery.tsx` — procedural pond, replaced by `pond-pixel.png`.

---

## 4. Running it

**Frontend** (from `frontend/`):
```
npm run dev              # Vite on :5173, proxies /api → VITE_API_TARGET or :8080
npm run build            # tsc -b && vite build
npx tsc --noEmit -p .    # typecheck only
```
In past sessions, port **5174** has been the user's own dev server and **5175**
the one Claude starts.

**Backend** (from `backend/`):
```
mvn -o test
mvn -o package -DskipTests
java -jar target/smaran-backend-0.1.0.jar --spring.profiles.active=dev
```
- **`dev` profile:** H2 in memory, demo data seeded, Redis excluded, and
  `open-demo: true`, which means **auth is off**.
- **To test real auth:** add `--smaran.security.open-demo=false`.
- **Demo caregiver:** `rupa@example.com` / `smaran`. Demo patient id:
  `demo-patient`.

**Full stack:** `docker compose up --build`.

---

## 5. App flow and routing

Routes live in `frontend/src/App.tsx`; state lives in `state/SmaranContext.tsx`.

**Patient entry (`/`)** has two one-time gates, and neither belongs to the patient:
1. **Caregiver setup.** If `caregiverSetupComplete` is false, go to
   **`/caregiver/pair`**. The family pairs the tablet with a code, or taps "Set up
   on this tablet only" to reach `/caregiver/setup` and "Hand it to her".
2. **Language.** If `languageConfirmed` is false, go to `/language`. This is a
   *confirmation* ("Yes, this is my language" plus a smaller "Change
   language" that opens the six-flower picker), not a selection.
3. Otherwise she sees **Home** (the pond), always.

There's no patient login and no mood gate.

**Onboarding is silent.** It's the first two sessions, handled inside
`deriveGameRoute` on both device and server:
- **Session 0:** Duck Roll Call at span 3 (working memory, tap accuracy, hesitation).
- **Session 1:** Family Grove at phase 1 (affect).
- **Session 2 onwards:** the full routing rules apply.

**One door to the games.** Home has a single "Today's quiet things" button that
opens `/games` (`GamesMenu`). The menu always lists all six games in a fixed
order:
1. Duck Roll Call
2. Grandmother's Tale
3. Family Grove
4. Morning Rituals
5. The Lotus Frog
6. The Koi Are Jumping

Routing only adds a small "suggested today" tag to `route.games[0]`. She picks.

| Route | Screen |
|---|---|
| `/` | PatientEntry → Home |
| `/language` | LanguageChoice |
| `/games` | GamesMenu |
| `/journal` | Journal |
| `/preview-home` | Home, bypassing the gates (for headless screenshots; permanent) |
| `/game/duck-roll-call` | DuckRollCall |
| `/game/grandmothers-tale` | GrandmothersTale |
| `/game/family-grove` | FamilyGrove |
| `/game/morning-rituals` | MorningRituals |
| `/game/lotus-frog` | LotusFrog |
| `/game/koi-are-jumping` | KoiAreJumping |
| `/caregiver` | caregiver Login |
| `/caregiver/dashboard` | Dashboard (includes the "Her tablet" pairing panel) |
| `/caregiver/setup` | Setup |
| `/caregiver/pair` | PairDevice (tablet side: enter code) |
| `*` | redirects to `/`, never a 404 |

Duck Roll Call and Koi Are Jumping return to `/games`. The older games still
return to `/`.

---

## 6. The games

Every game ends with a single `completeSession(draft)` call per sitting. That
call waters the garden, updates the profile, and queues or posts the session
(see §11). The six games, the six domains they read and their routes are
defined in one table in `lib/cognitiveMap.ts`.

| Game | Primary domain | Reads | Notes |
|---|---|---|---|
| Duck Roll Call | executiveFunction | executiveFunction | pixel, working-memory span |
| Grandmother's Tale | language | language | older vector style |
| Family Grove | affective | affective | older vector style; emotional core (+1 garden growth) |
| Morning Rituals | temporal | temporal | older vector style |
| The Lotus Frog | visualSemantic | visualSemantic, motor, affective, temporal | canvas port of open-source Froggie |
| The Koi Are Jumping | motor | motor | pixel, vigilance/response |
| *(Weaver's Loom)* | — | — | **retired**; Java keeps the enum value for old rows |

### Duck Roll Call — `games/DuckRollCall.tsx`
Visuospatial working-memory span (Domain 6, Executive Function).

**Mechanic.** Numbers flash on all the ducklings at once. They vanish, and she taps the ducklings in ascending order from memory. These decisions are locked:
- **Parallel encoding.** The numbers appear at once, not one after another.
- **Not audio-based.** Nothing is spoken and no sound marks a number, so the reading isn't confounded by hearing or fluency.
- **No recall timer.**
- **Wrong taps.** A wrong tap shakes the duckling once and doesn't count. A round never fails; `wasCorrect` only means "no retries".

**Difficulty.** Span runs 3→6 and flash time 2000→800 ms, one lever at a time:
- Two clean rounds raise span first. Flash time only tightens once span reaches 6.
- Two rough rounds ease one lever back.
- Span, flash time and a 60-round history persist in `smaran.duckRollCall.*`.

**`breakdownSpan`.** The span at which rolling accuracy first drops below 70%. It's now sent in the session's `metrics`.

**Errorless mode.** On when `profile.anxietyThreshold <= 0.5` (Claude's judgment call). After one wrong tap, a faint hint arrow appears.

**Reference fidelity.** Built from `Downloads/Game — Duck Roll Call (pixel, playable)-html/`. Its pond is 144×81 art on a 10 px grid.
- `duck-pond.png` is the reference pond with only its two corner lotuses painted out.
- `duck-lilies.png` is a 1440×810 layer of the implementation's own lily art in three depth tiers.
- A live render matched the reference at 98–99% over sky, moon, bamboo and shoreline.
- The CSS is `drc-` prefixed to avoid colliding with `.bob` in `pond.css`.

**Readings.** `duckReadings(rounds)`: half accuracy and half level (level is 80% span and 20% flash speed). A flawless span-3 sitting reads 0.5, a neutral score, because everyone starts there. Confidence is rounds/4.

### The Koi Are Jumping — `games/KoiAreJumping.tsx`
Vigilance and response initiation (motor domain). Built from the user's
`Downloads/Koi Are Jumping — {start,game,end} screen-html/` references. The
background PNG turned out to be **byte-identical to `pond-pixel.png`** and is
reused as-is.

**A sitting.**
- **Intro:** "Watch the water. Tap the koi when they leap" and a BEGIN stone.
- **Six leaps.**
- **Outro:** "The pond is quiet now."
- The back link is always available and banks whatever leaps she saw.

**A leap.** A ripple warns 1.3 s ahead. Then a creature follows a nose-first semicircle, always tangent to the arc ("like a dolphin dives"), 32 discrete CSS steps (`koiArc` keyframes).
- **Every leap is re-rolled (user request, 2026-09-29):**
  - radius 110–170 px (the arc keyframes take `--r` as a CSS custom property);
  - 1.5–2.2 s in the air (×1.5 under reduced motion);
  - direction left→right or right→left, done by mirroring a zero-size anchor with `scaleX(-1)`.
- **Creatures:** 50% koi, the rest split between silverfish, frog and turtle. A run of three of the same creature is broken.
- **Tapping:** the tap zone is the whole arc plus a margin. Tapping shows the creature's name in her language. A koi also opens a small lotus. A miss is silent.
- **Timing game:** it is filtered out of routing for a SUPPORTED motor tier.

**Readings.** `koiReadings(rounds)`:
- `0.7 × hit rate + 0.3 × speed`, where speed is how early in each leap she tapped, relative to that leap's own air time.
- Reaction time is measured at the tap.
- Confidence is rounds/6.

**Open design question.** The user's art-direction sheet labels non-koi "leave it", which suggests a go/no-go rule (tap only koi). It's **not implemented**: tapping any creature counts, matching the original playable prototype. Ask before changing this.

### The Lotus Frog — `games/LotusFrog.tsx` + `games/lotus-frog/**`
A port of open-source Froggie (github.com/MrinaliBhardwaj/froggie): a canvas engine with a frog on lily pads, tap bugs, and no score. Web Audio synthesis, and `World.progress.lushness` as a progression seam.
- **Tracking.** `cognitive/CognitiveTracker.ts` watches the visit and emits a `FrogSessionReport` with four domain readings (confidence-weighted), raw behaviour and highlights. The action→domain weights are in `tuning.ts`.
- **Handoff.** `cognitive/smaran.ts` → `toSessionDraft(report, mood)` puts `frogReadings(report)` on the draft, with confidence ×0.4 when the visit was abandoned. It also sends raw data and highlights as `metrics`. The frog **no longer writes the profile itself**; see §7.
- **Filtering.** Visits under 5 s are ignored. The last 20 reports are kept in `smaran.lotusFrog.reports`.
- **Frog fixes.** `lowestSeatY()` and the `computeAnchor` clamp stop the frog being cropped at the bottom edge. Details are in `LOTUS-FROG.md`.

### Older games
Grandmother's Tale, Family Grove and Morning Rituals still use the old vector
"Sanctuary" scene. They report `completionRate` only, which is read against their
primary domain.

---

## 7. The cognitive mapping system

Rebuilt on 2026-09-29 as one system shared by the device and the server.

**Six domains:** `language`, `visualSemantic`, `motor`, `affective`,
`temporal`, `executiveFunction`. They start neutral at 0.6 (affective 0.7).

**One model for every game:**
1. **Readings.** A session produces `domainReadings: { [domain]: { score 0–1,
   confidence 0–1 } }` for the domains it actually measured. Duck, Koi and the
   frog build rich readings from round-level data. Any other session is read as
   `{ primaryDomain: { score: completionRate, confidence: 1 } }`.
2. **Sanitising.** Unknown domains, non-finite numbers and zero confidence are
   dropped; scores and confidence are clamped to 0–1. The device and the server
   apply the same filter.
3. **One exponential moving average (EMA).**
   `next = prior·(1−α) + score·α`, where `α = 0.25 × confidence`. At full
   confidence this is exactly the old `prior·0.75 + score·0.25` rule, so one
   bad afternoon never rewrites a person and a thin reading only nudges. A
   domain missing from an older profile starts at 0.6.

There are **no per-game special cases** in `updateProfile`. The old
`if (LOTUS_FROG) return profile` and the frog's own `applyFrogReport` path are
gone.

**Where the code lives:**
- **Shared rules:**
  - `frontend/src/lib/cognitiveMap.ts` holds the tables (`PRIMARY_DOMAIN`, `READS`, `DOMAIN_GAME`, `ROUTE_GAMES`, `LOW_EFFORT`, `TIMING_GAMES`, `MAX_STEP`), `sanitizeReadings`, `readingsFor`, `applyReadings`, `weakestDomainFromHistory`, and the builders `duckReadings` and `koiReadings`.
  - `backend/.../service/CognitiveMap.java` is its mirror: tables, sanitize, readingsFor, apply, and weakestDomain.
  - Parity vectors are documented at the bottom of the TS file and asserted in `CognitiveMapTest.java`. The same numbers were checked in Node.
- **Device update:** `lib/cognitiveProfile.ts` → `updateProfile()` calls `applyReadings(readingsFor(result))`.
- **Device context:** `SmaranContext.completeSession` resolves the readings once, updates the profile from a ref (so a stale closure in a game's unmount can't clobber it), and appends to `smaran.readingHistory`. It then **sends the resolved readings** with the session, so the server applies exactly the same update.
- **Server:**
  - `SessionService.submit` resolves the readings and stores them as JSON on `GameSession.domainReadings` (plus `metrics`).
  - `CognitiveProfileService.updateFromSession` applies them.
  - Rows stored before readings existed fall back to their completion rate.
- **Dashboard trend:** `DashboardService.domainTrend` plots all six domains per day from the stored readings, using a confidence-weighted daily mean. Rest days carry the previous value forward. A frog visit therefore lands on four lines.
- **Doctor's PDF:** `ReportService` includes an executive-function row.

**Weakest-domain rule (identical on both sides).** It needs at least three sessions in the last 7 days and at least two readings of the domain. The trend is the last reading minus the first; the steepest fall below −0.05 wins. A multi-domain session counts toward every domain it read.

**Known gap.** No active game produces `objectResults` (the per-object semantic-cluster recognition data; Weaver's Loom did). Cluster accuracy and the CLUSTER_DECLINE alert only work with seeded demo data.

---

## 8. Routing: `deriveGameRoute`

The rules are the same on the device (`lib/cognitiveProfile.ts`) and the server
(`CognitiveProfileService.deriveGameRoute`, exposed as `GET /api/game/{id}/route`).
They apply in this order:

0. **Onboarding.** Sessions 0 and 1 are fixed (see §5). The server counts stored sessions.
1. **Outside her peak window.** Keep low-effort games only (Family Grove,
   Morning Rituals, Koi, Lotus Frog) and drop the tier by 1. The window has an
   hour of grace either side.
4. **SUPPORTED motor tier.** Drop timing games (Koi). This runs *before* rules 2 and 3 so a
   filtered game can't be reordered back in.
2. **Low mood** (A_LITTLE_LOW, WORRIED, RESTLESS). Family Grove first at 432 Hz,
   tier −1. If Family Grove leads anyway, the tone is 528 Hz.
3. **Weakest domain this week.** Its `DOMAIN_GAME` moves to second place, but
   only if it survived the filters above.

The tap target is set by motor tier: FLUID 60 px, MODERATE 76 px, SUPPORTED 96 px.
The difficulty tier is clamped to 1–3. Each route carries a `rationale[]` for
caregivers.

---

## 9. Device pairing

Built on 2026-09-29, following `docs/rbac-architecture.md` §2, §3 and §6, on the
**current** account model (Caregiver entity). The full RBAC migration (users,
families, roles tables, Flyway) is **not** done.

**Flow:**
1. **Family phone.** Dashboard → "Her tablet" → **Get a pairing code**. A code
   like `ABCD-EFGH` appears with a countdown.
2. **Tablet.** On first run it goes to `/caregiver/pair`. The family types the
   code and an optional label, and taps **Pair tablet**.
3. **Server.** It redeems the code once and returns a long-lived **device
   token** (role PATIENT, scoped to that one patient) along with her record
   and profile.
4. **Tablet takes over.** `adoptPairing()` stores the token, takes on the
   patient and profile, marks setup complete, and then asks for language
   confirmation before showing the pond.
5. **Removal.** The family can see paired tablets (label, when paired, last
   seen) and remove one. Removal is refused on the tablet's next request; the
   tablet quietly falls back to its offline copy and she never sees an error.

**Guarantees** (`PairingService`):
- **Codes aren't stored.** A code is 8 symbols from `ABCDEFGHJKMNPQRSTVWXYZ23456789` (no I/L/O/U/0/1), about 39 bits. **Only an HMAC-SHA-256 of it**, keyed with the server secret, is stored.
- **Short-lived and single-use:**
  - A code lasts 10 minutes and redeems once. A conditional UPDATE (`claim`) is the race-proof single-use guarantee.
  - Issuing a new code retires any unused one for that patient.
- **Rate limiting.** After 10 failed redemptions per client IP in 15 minutes, redemption returns 429, even for a valid code. The limiter is in memory.
- **Uniform failure.** Unknown, expired, used and superseded codes all get the same 404.
- **Device token.** It lasts 180 days and never refreshes. Its `did` claim names the pairing row, and `JwtAuthFilter` checks that row via `isDeviceActive()`. The check is cached for 30 s per node, and removal clears the cache locally. `last_seen_at` is written at most every 10 minutes.
- **Who can pair.**
  - Minting codes and listing or removing devices needs access to the patient **and** role CAREGIVER or ADMIN.
  - A doctor gets 403. The tablet's own token gets 403.
  - With no access to the patient at all, the answer is 404.
- **Configuration.** `smaran.pairing.*` in `application.yml` (code TTL, device TTL, max failures, window).

**Files:**
- Backend:
  - `domain/DevicePairing.java` (table `device_pairing`)
  - `repo/DevicePairingRepository.java`
  - `service/PairingService.java`
  - `web/PairingController.java`
  - `JwtService.issueDevice`
  - the `JwtAuthFilter` device check
  - `SecurityConfig` permits `POST /api/devices/redeem`
- Frontend:
  - `caregiver/PairDevice.tsx` (tablet)
  - `caregiver/PairingPanel.tsx` (family, on the Dashboard)
  - `lib/api.ts` `pairing.*`, with a `PairingError` whose reasons map to plain sentences
  - `SmaranContext.adoptPairing` and `devicePairing`

**Security bug found and fixed along the way.** `/error` wasn't in
`permitAll`. Spring re-dispatches a thrown status to `/error` without the
caller's token, so **every 404 and 401 reached clients as a bare 403**. That
included AccessGuard's deliberate "404, not 403" and failed logins. `/error` is
now permitted.

---

## 10. Backend API

All routes sit under `/api`. Auth is a JWT bearer token. `AccessGuard.requireAccessTo(patientId)`
is the single patient-scope check: caregivers see their assigned patients, a
device token sees its own patient, ADMIN sees everyone, and anything else gets
**404**.

**Auth and pairing:**

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login`, `/auth/refresh` | Caregiver login (15-minute access token, 7-day refresh) |
| POST | `/patients/{id}/pairing-codes` | Issue a pairing code |
| GET | `/patients/{id}/devices` | List paired tablets |
| DELETE | `/patients/{id}/devices/{deviceId}` | Remove a tablet |
| POST | `/devices/redeem` | Tablet redeems a code (public) |

**Patient:**
- `/patient/{id}/profile` (GET, PATCH)
- `/patient/{id}/objects` (GET, PUT)
- `/patient/{id}/mood` (POST)

**Sessions and games:**

| Method | Path | Purpose |
|---|---|---|
| POST | `/session` | Idempotent by (patientId, startedAt). Accepts `domainReadings` and `metrics` |
| POST | `/sync/sessions` | Offline queue drain |
| GET | `/game/{id}/route` | Today's route |
| POST | `/cognitive/sample` | Load samples |
| GET | `/cognitive/stream/{sessionId}` | Server-sent events that ease difficulty |

**Garden, family and media:**
- `/garden/{id}` (GET)
- `/garden/{id}/water` (POST)
- `/family/{id}/members` (GET), and `/family/{id}/member/{mid}/result` (POST)
- `/api/media/**`

**Reminders and biomarkers:**
- `/reminder/{id}/schedule` (GET, PUT)
- `/reminder/trigger` (POST)
- `/biomarker/vector` (POST), `/biomarker/{id}/trend` (GET)

**Caregiver and reporting:**
- `/caregiver/dashboard/{id}` (CAREGIVER, DOCTOR or ADMIN)
- `/report/patient/{id}` (PDF)
- `/fl/gradients` (federated learning, phase 2)

**Not built:** `/api/journal/analyse` (see §14).

`GameType` enum (Java): DUCK_ROLL_CALL, GRANDMOTHERS_TALE, FAMILY_GROVE,
MORNING_RITUALS, LOTUS_FROG, KOI_ARE_JUMPING, and `@Deprecated` WEAVERS_LOOM
for legacy rows. Schema changes are made by JPA `ddl-auto` (`update` by default,
`create-drop` in dev). The design doc recommends adding Flyway before the RBAC migration.

---

## 11. State, storage and sync

**`SmaranContext` exposes:**
- **State:** patient, profile, gardenState, route, language, moodToday, phase, tapTarget, online/pending/syncedAt, motorTier, stillness, devicePairing.
- **Gates and counters:** caregiverSetupComplete, languageConfirmed, sessionCount.
- **Content:** journalEntries, caregiverVoiceNotes.
- **Actions:** setLanguage, checkIn, completeSession, setProfile, setPatient, completeCaregiverSetup, adoptPairing, confirmLanguage, addJournalEntry, markVoiceNoteListened, setStillness, sync.

**`completeSession(draft)`** runs these steps:
1. Water the garden locally.
2. Resolve the readings and update the profile.
3. Append to the reading history.
4. POST `/session`, or queue it in IndexedDB `pending_sessions` if offline.
5. Post the watering separately (so the family WebSocket still fires).
6. Increment `sessionCount`.
7. Play a cue.

**localStorage keys** (`smaran.*`):
- Setup and gates: `caregiverSetupComplete`, `languageConfirmed`, `sessionCount`, `stillness`.
- Content: `journal`, `voiceNotes`.
- Cognitive data: `readingHistory` (last 60 sessions or 30 days), `devicePairing`.
- Per game: `duckRollCall.span|flashMs|history`, `lotusFrog.reports`.
- Tokens: `smaran.token`, `smaran.refresh`.

**IndexedDB** holds the cached patient, profile and garden, plus the
`pending_sessions`, `pending_vectors` and `pending_blooms` queues, drained by
`syncNow()` and Background Sync.

**Offline contract.** The patient must never be able to tell whether she's
online. Reads fall back to the cache and writes queue up. Pairing is the one
exception: it needs the server once and says so to the caregiver.

**Garden** (`lib/gardenEngine.ts`, mirrored by `GardenStateService`):
- Growth only goes up. Stages: 0, 6, 16 and 32 points.
- Family Grove earns 3 base points; everything else earns 2, with a floor of 1.
- A missed day puts the garden into "moonlight sleep", never a penalty. The
  caregiver is alerted after 3 missed days; the patient is never told.

---

## 12. Pixel-art system and assets

- **Stage.** A 1440×810 stage scaled uniformly by `useStageScale()` (in `scenes/PixelPond.tsx`) to cover the viewport. `SAFE_H` is 775.
- **Home pond.** `pond-pixel.png` (360×203, 4 px per art pixel) is the literal reference artwork. It was extracted from the user's bundler-format HTML export with a script (`extract_pixel_png.py`), never hand-transcribed. `PixelPond.tsx` draws it as an SVG `<image>` with an animated sprite overlay on the same 360×203 grid: koi, a duck family, dragonflies, about 28 fireflies ("jugnus") and glints.
- **Two-layer rule.** A static background plus a thin animated overlay is the pattern for any pixel scene.
- **Discipline:**
  - `image-rendering: pixelated` on images and `shapeRendering="crispEdges"` on SVGs;
  - `steps(n)` for every animation;
  - uniform scale only, never a non-uniform stretch.
- **CSS prefixes.** Game CSS lives in `games/games.css`, prefixed per game (`drc-`, `koi-`). Every animation has a reduced-motion override and a `.px-viewport.still` override.
- **Pixel style coverage.** Only Home, GamesMenu, LanguageChoice, Journal, Duck Roll Call and Koi use it; Lotus Frog is its own canvas. Grandmother's Tale, Family Grove, Morning Rituals and the caregiver screens still use the old vector Sanctuary scene.

---

## 13. Caregiver side

- **Login** (`/caregiver`). An email and password form that stores tokens.
- **Setup** (`/caregiver/setup`). Runs on the tablet itself. Sets up the patient, family members, objects and stillness, then "Hand it to her" sets `caregiverSetupComplete`.
- **Dashboard** (`/caregiver/dashboard`):
  - alerts;
  - stat cards;
  - a 30-day **six-line** domain trend chart;
  - a "when she plays" heatmap;
  - a per-game table (retired games show as "Weaver's loom (retired)");
  - a family phase map;
  - a 30-day voice trend (jitter and shimmer);
  - **Her tablet** (the pairing panel).

  When the backend is unreachable, it falls back to `sampleDashboard.ts` and says so.
- **PDF for the doctor.** `ReportService` (OpenPDF): engagement, domains including executive function, games, and alerts. Every alert is phrased as an observation, never a diagnosis.

---

## 14. Journal and pond overlays

- **Pond overlays** (`components/PondOverlays.tsx`), composed into Home:
  - **MoodDrift:** optional mood emoji that fade in and out when mood isn't set; never a gate.
  - **JournalButton:** a gold dot when there's an unheard voice note.
  - **VoiceNoteCard:** plays a caregiver voice note inline.
- **Journal** (`screens/Journal.tsx`). Typed or dictated (`dictate()` in `speechEngine.ts`). Entries are localStorage-only for now.
- **Sentiment analysis** (`lib/journalAnalysis.ts`) POSTs to **`/api/journal/analyse`, which doesn't exist yet**. Until then the entry saves with `sentimentSignals: null`.
  - **Request:** `{ text, patientId, languageCode, systemPrompt, model: 'claude-sonnet-5' }`.
  - **Response:** `{ signals: SentimentSignals }`, where SentimentSignals is valence −1..1, arousal 0..1, themes, concernFlags (CONFUSION, DISTRESS, LONELINESS or PAIN) and summary.
  - The model call **must stay server-side**: a browser bundle can't hold a key, and this is a patient's private writing.
  - `JOURNAL_SYSTEM_PROMPT` was written by Claude because the user's own spec was truncated. The user should review or replace it.

---

## 15. Testing and verification

- **Backend unit tests** (`mvn -o test`): **32 pass**.
  - `CognitiveMapTest` (15): the TS parity vectors, sanitising, the EMA, table consistency and the weakest domain.
  - `PairingServiceTest` (13): code shape, normalisation, keyed hash, issue, single use, uniform failure, rate limit, revoke, cache, expiry and labels.
  - `GardenStateServiceTest` (4).
- **TS↔Java parity.** `cognitiveMap.ts` compiled with esbuild and run in Node against the same vectors: 14/14 match.
- **End-to-end check** (`e2e_pairing.py` in the Claude scratchpad; not in the repo). Run against the real jar (dev profile, `open-demo=false`, port 8089): **30/30 pass**. It covered:
  - login and code issue;
  - wrong-code 404 and single use;
  - device scoping (own profile yes; other patient 404; mint code 403; caregiver dashboard 403);
  - a Koi session moving motor by exactly the EMA;
  - a duplicate session ignored;
  - the completion-rate fallback;
  - the route listing only current games;
  - the dashboard's six-domain trend;
  - device list and removal (next request refused);
  - superseded codes;
  - the rate limit.
- **Frontend.** `tsc` is clean and `npm run build` passes. The Koi game was driven headlessly through Chrome DevTools Protocol from Python: begin → ripple → leap (both directions and varied radius confirmed) → tap → bloom → six rounds → outro.
- **Not yet checked in a browser:** the new PairDevice and PairingPanel screens. The session limit hit while starting Vite against the backend.
- **Headless screenshots.** Chrome `--headless=new --disable-features=WebAppInstallation --screenshot=… --window-size=…` against `/preview-home` or a game route. For interaction, use CDP over `websockets` in Python and click elements with `Runtime.evaluate(...click())`, not coordinates: the stage transform makes coordinates unreliable.

---

## 16. Standing constraints and lessons

- **Never hand-transcribe base64 or large binary through a tool call.** Extract from the file on disk with a script; this has corrupted assets silently before.
- **Prefer the real asset over an approximation** when the user supplies one. They iterate on pixel-exact fidelity with side-by-side screenshots.
- **Keep the device and server rule copies in lockstep.** The cognitive map, routing and garden are duplicated on purpose, and tests assert parity.
- **Don't delete orphaned files** without asking; comment them out and flag them.
- **Fixed patient-facing rules:** no failure signals, no timers, no numbers, no clinical words; reduced motion always honoured.
- **Heredocs.** Long inline Python in Git Bash heredocs can break on quoting. Write the script to a scratch file and run it instead.
- **Stale closures.** Games often call `completeSession` from unmount cleanups, so anything that must read the latest state uses refs.

---

## 17. Git history and uncommitted work

```
c8ffb50  Koi Are Jumping: shorter, faster, two-way leaps with an even creature mix
3f66d7d  Add The Koi Are Jumping (Domain 3: Motor)
15adf11  Add Duck Roll Call, Lotus Frog, games menu, journal and new app flow
ccda457  Initial commit
```

**Uncommitted as of this writing:** the whole cognitive-mapping rebuild (§7), the
routing changes (§8), device pairing (§9), the `/error` fix and the new tests,
across both frontend and backend. They build and pass their tests but haven't
been committed or pushed.

Note that **`backend/target/` is tracked in git** (compiled classes and the jar
show up as modified). It should be added to `.gitignore` and removed from the
index.

---

## 18. Open items

**Pairing and accounts**
- Visually check PairDevice and PairingPanel in a browser.
- Full RBAC migration per `docs/rbac-architecture.md`: Flyway first, then the users, roles, families and caregiver_assignments tables, the permission matrix, shadow mode, and an audit log. Pairing currently uses CAREGIVER/ADMIN as its stand-in for `device.pair`.
- The failure limiter and device cache are per node; a multi-node deployment would want Redis.

**Cognitive data**
- Nothing produces `objectResults` any more, so cluster accuracy only works with seeded demo data.
- The dashboard doesn't yet show the per-game `metrics` (Duck `breakdownSpan` and span history, Koi reaction times, frog highlights). They're stored but not displayed.
- Koi go/no-go ("leave it" for non-koi) is undecided.
- Morning Rituals is now the only temporal game; Lotus Frog is the only visual-semantic one.

**Journal and voice notes**
- The `/api/journal/analyse` endpoint isn't built, and journal entries don't sync to the backend.
- Caregiver voice notes have nothing that creates them.

**Visual**
- Pixel-art treatment for Grandmother's Tale, Family Grove, Morning Rituals and the caregiver screens.
- The GamesMenu leaf and games icons read as blobs.
- The right side of the Duck Roll Call scene is a little crowded.
- No time-of-day sky (always night) and no Settings screen.

**Housekeeping**
- Decide whether to keep or delete the orphaned `pixelScenery.tsx`, `Login.tsx`, `Onboarding.tsx` and `WeaversLoom.tsx`.
- Untrack `backend/target/`.
- The Koi and Duck translations were written by Claude and haven't been checked by native speakers.
