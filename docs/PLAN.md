# Smaran — Build Plan

Written in Phase 0 (2026-10-06) from a read of the code, not of the README.
It maps what exists today, where that differs from `docs/MASTER_PROMPT.md`, and
what each phase will touch. No feature code was written in Phase 0.

All patient data in this repository is synthetic or demo data.

## Contents

1. [Summary](#1-summary)
2. [Decisions the human should confirm](#2-decisions-the-human-should-confirm)
3. [Current state: what truly exists](#3-current-state-what-truly-exists)
4. [The three investigations](#4-the-three-investigations)
5. [Contradictions between the master prompt and the repo](#5-contradictions-between-the-master-prompt-and-the-repo)
6. [Gap list against the mission](#6-gap-list-against-the-mission)
7. [Files per phase](#7-files-per-phase)
8. [Risks](#8-risks)

---

## 1. Summary

The repo is further along than the master prompt assumes, and in a different
shape. The prompt describes the last commit on `master` (`c8ffb50`). On top of
that commit sit 26 changed files of uncommitted work that already:

- replaced the two scoring paths with one shared engine (`cognitiveMap.ts` and
  `CognitiveMap.java`) and removed `applyFrogReport`;
- built device pairing end to end (code, redeem, device token, revoke);
- built Duck Roll Call and Koi Are Jumping, and retired Weaver's Loom.

So several instructions in the prompt ("keep `applyFrogReport`", "build Duck
Roll Call", "pairing is only a design") no longer match the code. Section 5
lists every mismatch with the default I will take. Section 2 lists the four
that are worth a human decision before Phase 1.

**Baseline (2026-10-06):** see `docs/PROGRESS.md` for the commands and output.

## 2. Decisions the human should confirm

Each has a default, and work continues on the default unless told otherwise.

| # | Question | Default I will take | Why it matters |
|---|---|---|---|
| D1 | The uncommitted work already unified scoring and removed `applyFrogReport`. The prompt says to keep `applyFrogReport` and the early return for `LOTUS_FROG`. | **Keep the unified path.** The frog's tuning constants are untouched, and its maths is unchanged (α = 0.25 × confidence, ×0.4 when abandoned). The frog reaches the server as a precomputed reading and is never re-scored, which is the prompt's actual goal. | Reverting would throw away tested work (32 backend tests, TS/Java parity) to restore a second scoring path the prompt then asks me to reconcile. |
| D2 | Pairing codes: the prompt specifies 6 characters and a 72-hour life. The current code uses 8 characters and 10 minutes. | **Decided 2026-10-07: follow the prompt** (6 characters, 27-symbol alphabet, 72 hours), and keep both rate limits. | 6 characters is about 28.5 bits and lives 432 times longer than today's code, so it is weaker against guessing. The per-IP and per-fingerprint limits are what make it acceptable. Say so if you would rather keep 8 characters. |
| D3 | Docker and `make` are not installed on this machine. | **Write everything for Docker anyway**, and verify what can be verified without it. Each unverified item is listed in `PROGRESS.md`. | Postgres, Testcontainers, `make demo`, the compose stack and the end-to-end job all need Docker. Until it is installed, those can be written but not run here. |
| D4 | The default branch is `master`; the prompt says `main`. | **Keep `master` for now** and rename to `main` in Phase 6 when CI and CD are wired. | Renaming the GitHub default branch is a repository setting only the owner should change. |

## 3. Current state: what truly exists

### 3.1 Frontend (React 18, Vite 5, TypeScript 5, Tailwind 3, PWA)

| Area | File(s) | State |
|---|---|---|
| Routing and gates | `App.tsx` | Two gates on `/`: `caregiverSetupComplete` → `/caregiver/pair`; `languageConfirmed` → `/language`. No auth guards on any caregiver route. |
| App state | `state/SmaranContext.tsx` (532 lines) | One context. Holds patient, profile, garden, route, pairing. `completeSession` is the single exit for every game. |
| Scoring | `lib/cognitiveMap.ts`, `lib/cognitiveProfile.ts` | One confidence-weighted EMA on a 0–1 scale. Six camelCase domains. No velocity, status, markers or alert rule. |
| Routing rules | `lib/cognitiveProfile.ts` → `deriveGameRoute` | Onboarding, peak window, motor tier, mood, weakest domain. Mirrored on the server. |
| Garden | `lib/gardenEngine.ts` | Growth-only, mirrored by `GardenStateService`. |
| API client | `lib/api.ts` (371 lines) | Bearer token from `localStorage` (`smaran.token`, `smaran.refresh`). Retries once on 401 via refresh. |
| Offline queue | `lib/db.ts` | IndexedDB v1: `pending_sessions` keyed `[patientId, startedAt]`, `pending_vectors`, `pending_blooms`, caches. |
| Adaptive session | `hooks/useAdaptiveSession.ts` | Used by the three older games. Tap latency, optional face geometry, SSE subscription. |
| Federated learning client | `lib/federated.ts` | Logistic-regression head, six features, AES-GCM upload. A shape, not a protocol. |
| Journal | `screens/Journal.tsx`, `lib/journalAnalysis.ts` | Local only. Calls `/api/journal/analyse`, which does not exist. |
| Caregiver | `caregiver/Login`, `Dashboard`, `Setup`, `PairDevice`, `PairingPanel` | Dashboard reads one patient and falls back to `sampleDashboard.ts` when the server is unreachable. `Setup` runs on the tablet itself. |
| Tests | none | No Vitest, no test files, no lint script. |

### 3.2 What each game emits

Every game ends in `completeSession(draft)` with a `SessionResultDraft`.

| Game | How it finishes | Trial-level data | Readings |
|---|---|---|---|
| Duck Roll Call | Direct call | Per round: `spanLength`, `flashDurationMs`, `wasCorrect`, `attemptsBeforeCorrect`; plus `finalSpan`, `breakdownSpan`, `errorless` | `executiveFunction`, confidence rounds / 4 |
| Koi Are Jumping | Direct call | Per leap: creature, tapped, reaction time, leap time | `motor`, confidence rounds / 6 |
| Lotus Frog | Via `toSessionDraft(report)` | Raw behaviour and highlights from `CognitiveTracker` | Up to four domains, ×0.4 confidence when abandoned |
| Grandmother's Tale | `session.finish(1)` | **None** | Completion rate → `language` |
| Family Grove | `session.finish(1)` | **None** (per-member results go to a separate endpoint) | Completion rate → `affective` |
| Morning Rituals | `session.finish(1)` | **None** | Completion rate → `temporal` |
| Weaver's Loom | Retired; file body commented out | — | — |

**The three older games always pass a completion rate of exactly 1.** Every
session of theirs pushes its domain toward 1.0 at full confidence. They carry
no measurement today. Phase 4 must either record real trials for them or score
them at low confidence and say so.

### 3.3 Backend (Spring Boot 3.3.4, Java 21)

| Area | State |
|---|---|
| Entities | 13 JPA entities. Accounts are one `caregiver` table with a `role` column and an eager `caregiver_patient` collection. |
| Schema | Hibernate `ddl-auto` (`update`, `create-drop` in dev). No Flyway. Readings and metrics are text columns holding JSON. |
| Database | H2 in memory in `dev`. Postgres configured for other profiles; never exercised by a test. |
| Sessions | `POST /api/session` and `POST /api/sync/sessions`. Idempotent on `(patientId, startedAt)`. Garden recomputed from deduplicated history. No `clientSessionId`, no profile snapshots, no late-arrival rebuild. |
| Scoring | `CognitiveMap.java` mirrors the TS engine; parity vectors asserted in `CognitiveMapTest`. |
| Dashboard | `DashboardService` builds one payload per request. Five alert rules computed on read, not stored, not acknowledgeable. |
| Live updates | WebSocket topic `/topic/family/{patientId}` for blooms. SSE only for in-game difficulty easing. Nothing pushes new sessions to the dashboard. |
| Pairing | `PairingService`, `PairingController`, `DevicePairing`. Works; details in section 5. |
| PDF | `ReportService` with OpenPDF. |
| Tests | 32 unit tests in three classes. No controller, security or integration tests. |
| DevOps | A Dockerfile each for backend and frontend, an nginx config, and one `docker-compose.yml`. No CI, no CD, no `.github/`. |

### 3.4 README claims that are no longer true

- "The first screen is the arrival — five steps": onboarding was removed; the first two sessions stand in for it.
- Lists four games including Weaver's Loom; there are six, and Weaver's Loom is retired.
- "`Sanctuary.tsx` is one SVG… No raster asset anywhere": Home is now a pixel-art PNG with a sprite overlay.
- "3:1 weighting toward history": now α = 0.25 × confidence.
- "`useAdaptiveSession` runs behind all four games": it runs behind three; Duck, Koi and the frog adapt on their own.
- "Verified… endpoints exercised end-to-end": true when written, but not reproducible from the repo. No test does it.

The README is rewritten in Phase 7.

## 4. The three investigations

### (a) Two scoring paths

- **At the last commit (`c8ffb50`):** two paths exist, exactly as the prompt
  says. `updateProfile` uses `prior × 0.75 + completionRate × 0.25` and returns
  early for `LOTUS_FROG`; `applyFrogReport` runs its own confidence-weighted EMA.
- **In the working tree:** one path. Every game produces `domainReadings`;
  `applyReadings` folds them in with α = 0.25 × confidence. `applyFrogReport`
  is gone and `updateProfile` has no per-game branch.
- **`cognitiveScoring.ts`:** not in the repo. Neither is `SMARAN_PLAN.md`.
- **What is missing against Appendix A.2:** the 0–100 scale, start at 50,
  baseline and SD over the last 30 raws, velocity, status, domain confidence
  from observation count, sub-signals, markers, and the alert rule.

### (b) What each game returns

See section 3.2.

### (c) Server-side auth today

It exists, and it is partial.

- **Present:** stateless JWT filter, BCrypt, a login and a refresh endpoint,
  `AccessGuard.requireAccessTo(patientId)` called in every controller, 404 for
  patients the caller is not assigned, device tokens checked against the
  pairing row on every request.
- **Missing or weak:**
  - **The `dev` profile turns it all off** (`open-demo: true`), and `dev` is the only profile that runs without Postgres.
  - No registration; accounts exist only through the dev seeder.
  - No endpoint creates a patient.
  - Refresh tokens are stateless JWTs: no rotation tracking, no reuse detection, no logout.
  - No login rate limit or lockout.
  - A doctor is limited only by two URL patterns. `requireAccessTo` lets an assigned doctor through to raw sessions, objects and family media.
  - A tablet holds role `PATIENT`, not a separate `DEVICE` principal.
  - No audit log, no grants with expiry, no consent record.
  - No authorization test of any kind in the repo.
- **Frontend:** caregiver routes have no guard at all. Tokens live in `localStorage`.

## 5. Contradictions between the master prompt and the repo

| # | The prompt says | The repo has | Default |
|---|---|---|---|
| C1 | Keep `applyFrogReport`; keep the `LOTUS_FROG` early return | Both removed in uncommitted work | D1: keep the unified path |
| C2 | Do not modify `cognitive/tuning.ts` | One comment line changed; no constant changed | Leave as is; no further edits |
| C3 | Scores 0–100 starting at 50; domains `LANGUAGE`…`EXECUTIVE` | 0–1 starting at 0.6 (affective 0.7); `language`…`executiveFunction` | Phase 1 moves to the prompt's contract, with a migration for stored profiles |
| C4 | Register `weavers-loom` | Retired; enum kept `@Deprecated` for old rows | Register it as a retired id so old rows render; do not revive the game |
| C5 | Build Duck Roll Call | Built. Logs different trial fields and scores differently from A.5 | Phase 4 adds the missing fields (`firstErrorAtPosition`, `timeToFirstTapMs`) and switches to the A.5 formula; no rebuild |
| C6 | Koi is P2, mapped to EXECUTIVE / INHIBITORY_CONTROL | Built, mapped to motor, no go/no-go rule | Register as it is (MOTOR, REACTION_SPEED). The inhibition version needs the "leave it" rule, which is an open design question |
| C7 | `lotus-frog` primary MOTOR, secondary TEMPORAL | Primary visualSemantic; reads four domains | Keep the frog's own four readings, since they are precomputed and must not be re-scored |
| C8 | `family-grove` primary VISUAL_SEMANTIC, secondary AFFECTIVE | Primary affective | Follow the prompt once the game emits per-member trials |
| C9 | Pairing is only a design | Built: 8 characters, 30-symbol alphabet, 10 minutes, HMAC-SHA-256, JWT device token valid 180 days, 10 failures per IP | D2: rework to the Phase 3 spec; reuse the atomic claim, the tests and the UI |
| C10 | Opaque device token stored as a hash | Signed JWT with a `did` claim | Phase 3 moves to an opaque token; the per-request active check already exists |
| C11 | Redemption returns a minimal bundle | Returns the full patient record and cognitive profile | Phase 3 trims it to first name, language, kinship term |
| C12 | Pairing replaces on-device setup | `Setup.tsx` still offers "Set up on this tablet only" | Phase 3 moves setup to the caregiver's own device; the file stays, unrouted |
| C13 | `POST /api/device/sessions/batch` | `POST /api/session` and `/api/sync/sessions` under a shared namespace | Phase 3 adds `/api/device/**`; the old paths are removed once the tablet has moved |
| C14 | Refresh token in an HttpOnly cookie; access token in memory | Both in `localStorage` | Phase 2 |
| C15 | Roles `ADMIN`, `CAREGIVER`, `DOCTOR`, `DEVICE` | `PATIENT`, `CAREGIVER`, `DOCTOR`, `ADMIN` in one table | Phase 2 adds `users`; `PATIENT` becomes `DEVICE` |
| C16 | Postgres everywhere; H2 not the default | H2 is the only database that has ever run here | Phase 1; blocked locally by D3 |
| C17 | Branch `main` | Branch `master` | D4 |
| C18 | Save the prompt as `docs/MASTER_PROMPT.md` | It was `docs/SMARAN_MASTER_PROMPT.md` | Renamed in Phase 0 |
| C19 | `npm ci` on a fresh clone | `package-lock.json` is git-ignored, so `npm ci` fails on a clone | Fixed in Phase 0: the lockfile is now tracked |
| C20 | No build output in git | 120 files under `backend/target/` and `frontend/tsconfig.tsbuildinfo` are tracked | Fixed in Phase 0: untracked and ignored |
| C21 | Do not delete orphaned files | Four exist: `pixelScenery.tsx`, `screens/Login.tsx`, `screens/Onboarding.tsx`, `games/WeaversLoom.tsx` | Left in place |

Two existing alert rules also deserve a flag, because their names promise more
than they measure:

- **`LANGUAGE_REGRESSION`** fires when the month has more than 10 sessions, one
  of them has a load score above 0.85, and the patient's language is not
  English. It does not observe language at all.
- **`CLUSTER_DECLINE`** depends on per-object results that no active game
  produces. It only ever fires on seeded demo data.

Phase 4 replaces the alert set with `MISSED_DAYS` and `DOMAIN_DECLINE`, and
these two are removed or rebuilt on real signal.

## 6. Gap list against the mission

| Mission item | Exists | Missing |
|---|---|---|
| 1. Server-side RBAC | JWT filter, `AccessGuard`, 404 rule | Users and roles tables, registration, doctor approval, grants with expiry, rotating refresh, lockout, audit log, method security, the authorization matrix test, frontend guards |
| 2. Pairing by code | Working flow and UI, 13 unit tests | The Phase 3 spec (code shape, TTL, opaque token, fingerprint limit, minimal bundle), `/api/device/**`, `/pair` in pond style, wipe-on-different-patient |
| 3. Games → dashboards | Sessions reach the server and the profile; dashboard reads them | Session envelope with trials, game registry, snapshots, late-arrival rebuild, stored alerts, SSE to dashboards, patient selector, doctor dashboard, real data for three games |
| 4. Data science | One EMA with a Java twin and parity vectors | Velocity, status, alert rules, golden-vector file, simulator, Python port, evaluation, export endpoint, seed loader. `data-science/` does not exist |
| 5. DevOps | Two Dockerfiles, nginx config, one compose file | Postgres in dev, Flyway, CI, CD, Caddy, health and smoke scripts, rollback, backups, runbook, observability |

## 7. Files per phase

New files are marked `+`. Everything else is an edit.

**Phase 1 — foundation**
- `docker-compose.yml`; `backend/pom.xml` (Flyway, Testcontainers); `backend/src/main/resources/application.yml` (profiles `dev`, `demo`, `test`, `prod`)
- `+ backend/src/main/resources/db/migration/V1__baseline.sql` and later versions
- `+ frontend/src/lib/scoring/` (`types.ts`, `engine.ts`, `alerts.ts`, `registry.ts`, `golden.ts`)
- `+ golden-vectors.json` at the repo root, read by all three languages
- `+ backend/.../scoring/CognitiveScoringService.java` and contract records; `CognitiveMap.java` retired into it
- `frontend/src/lib/cognitiveMap.ts`, `cognitiveProfile.ts`, `types.ts`, `state/SmaranContext.tsx`
- `frontend/package.json` (Vitest), `+ frontend/src/lib/scoring/*.test.ts`

**Phase 2 — auth and RBAC**
- `+ V2__users_roles_grants_audit.sql`
- `+ domain/User, RefreshToken, DoctorGrant, AuditEvent, ConsentRecord`; `domain/Caregiver.java` migrated
- `config/SecurityConfig.java`, `JwtAuthFilter.java`, `JwtService.java`, `AccessGuard.java`, `StartupChecks.java`
- `web/AuthController.java`; `+ web/GrantController, AdminController, AuditController`; every existing controller gains method security
- `+ src/test/.../AuthorizationMatrixTest.java` and the IDOR, tampering, refresh-reuse and lockout tests
- `frontend/src/lib/api.ts`, `App.tsx`, `caregiver/Login.tsx`; `+ caregiver/Register.tsx`, `+ doctor/*`, `+ lib/auth.tsx`

**Phase 3 — pairing**
- `+ V3__pairing_devices.sql`; `domain/DevicePairing.java` split into `PairingCode`, `Device`, `PairingAttempt`
- `service/PairingService.java`, `web/PairingController.java`; `+ web/DeviceController.java` under `/api/device/**`
- `PairingServiceTest.java` extended; `+` concurrent-redemption integration test
- `frontend/src/App.tsx`, `state/SmaranContext.tsx`, `lib/api.ts`, `lib/db.ts` (v2: device fingerprint)
- `+ frontend/src/screens/Pair.tsx`; `caregiver/PairDevice.tsx` unrouted; `caregiver/PairingPanel.tsx`

**Phase 4 — games to dashboards**
- `+ frontend/src/games/modules/*.ts` (one adapter per game) and the registry
- `games/GrandmothersTale.tsx`, `FamilyGrove.tsx`, `MorningRituals.tsx` (emit trials), `DuckRollCall.tsx` (A.5 fields)
- `state/SmaranContext.tsx` (`completeSession` builds a `SessionEnvelope`), `lib/db.ts`, `lib/api.ts`
- `+ V4__sessions_snapshots_alerts.sql`; `service/SessionService.java`, `SyncService.java`, `DashboardService.java`, `ReportService.java`; `+ service/AlertService, SnapshotService, DashboardEvents`
- `caregiver/Dashboard.tsx` rebuilt on real data; `+ doctor/Dashboard.tsx`; `caregiver/sampleDashboard.ts` removed from the live path
- `+ docs/ADDING_A_GAME.md`

**Phase 5 — data science**
- `+ data-science/` (`README.md`, `requirements.txt`, `src/simulate.py`, `src/scoring_core.py`, `src/evaluate_*.py`, `tests/`, `notebooks/`, `results/`)
- `+ web/AdminExportController.java`; `config/DemoDataSeeder.java` replaced by a loader that goes through ingestion

**Phase 6 — DevOps**
- `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf`
- `+ deploy/docker-compose.prod.yml`, `Caddyfile`, `deploy.sh`, `smoke.sh`, `backup.sh`
- `+ .github/workflows/ci.yml`, `cd.yml`, `security.yml`, `+ .github/dependabot.yml`
- `+ docs/RUNBOOK.md`, `docs/ARCHITECTURE.md`; `Makefile`; `.env.example`

**Phase 7 — hardening**
- `+ e2e/` (Playwright); `README.md`; `backend/pom.xml` (springdoc); `docs/PROGRESS.md` verification report

## 8. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| No Docker on the development machine | Postgres, Testcontainers, compose and the end-to-end job cannot run locally | D3. Until then CI is the only place those run, so CI moves up: a minimal workflow lands with Phase 1 rather than Phase 6 |
| The scale change (0–1 → 0–100) touches every game, the profile, routing thresholds, the dashboard and the PDF | Silent mis-scaling | Golden vectors first; one conversion at the storage boundary; a migration for stored profiles; routing thresholds covered by tests before the change |
| Three games have no trial data | Their dashboard lines would be flat or invented | Record real trials in Phase 4, or score at low confidence and state it on the dashboard |
| Changing auth breaks the offline tablet | A paired tablet stops syncing | The tablet moves to `/api/device/**` in Phase 3 before the old paths are removed; revocation stays silent for the patient |
| The uncommitted work is large and unreviewed | It becomes the foundation without anyone having read it | Committed on its own in Phase 0 so it can be reviewed and, if needed, reverted as one unit |
| Deployment needs a VM, a domain and secrets | CD cannot be shown working | Appendix E is the human's checklist; everything up to the SSH step is built and tested without them |
| Scope: seven phases, each large | A half-built project | All P0 before any P1; the app builds and passes tests at the end of every phase |
| Synthetic-data results read as clinical claims | Misleading a reader | Every write-up states what the numbers do and do not show; the words "validated", "detects" and "diagnoses" are not used |
