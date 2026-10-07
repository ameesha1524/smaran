# Smaran — Master Build Prompt for Claude Code

**How the human uses this file**

1. Save it in the repo as `docs/MASTER_PROMPT.md`.
2. Edit the **Decisions** block (section 3) if any default is wrong.
3. In Claude Code, say: `Read docs/MASTER_PROMPT.md completely, then start Phase 0.`
4. This is too big for one session. Claude Code keeps `docs/PROGRESS.md` up to date; at the start of every new session say: `Read docs/MASTER_PROMPT.md and docs/PROGRESS.md, then continue with the next unfinished phase.`

Everything below this line is addressed to Claude Code.

---

## 1. Mission

Smaran is a dementia-care companion (React 18 + Vite + TypeScript PWA, Spring Boot 3 on Java 21). It already has an offline-first patient app with a pixel-art pond, games, a journal, a garden engine, an adaptive-session hook and a partial caregiver portal. It is **not yet a working end-to-end system**: games do not reliably feed a real dashboard, role checks exist only in the frontend, device pairing is only a design, scoring is split across two paths, and nothing is deployed.

Make it **fully working, end to end, deployed, and defensible as both a data-science project and a web-engineering project**:

1. **Server-side role-based access control** for caregivers and doctors, plus admin and patient-device principals.
2. **Patient device pairing by code**, so a caregiver's setup connects a patient tablet to the caregiver's dashboard.
3. **Games connected to the dashboard**: every game session flows tablet → server → profile → caregiver and doctor dashboards, with live updates.
4. **A genuine data-science layer**: one unified scoring engine with a tested Java twin, a synthetic-cohort simulator with known ground truth, an evaluation of alert rules, and honest reporting.
5. **DevOps**: containers, CI, automated deployment (CD) to a public HTTPS URL, health checks, backups, a runbook.

The user does not want an incomplete project. They can add more games later, so **adding a game must be cheap and must automatically appear on the dashboards** (see the game-module registry in Appendix A).

## 2. Ground rules (read twice)

**Honesty and verification**
- Never claim something works unless you ran it and saw it work. Run builds, type checks and tests after each change and paste the real results into `docs/PROGRESS.md`.
- No invented numbers. Every metric in a README, notebook or report must come from code you ran, with fixed seeds, and be reproducible with one command.
- All patient data in this repo is **synthetic or demo**. Label it so everywhere. Synthetic-data results demonstrate pipeline behaviour, **not clinical validity**; say that in every DS write-up. Never write "clinically validated", "detects dementia" or "diagnoses".
- If something cannot be done (needs a credential, an account, a paid service, a decision), say so, make the best safe default, log it in `docs/PROGRESS.md` under "Needs the human", and move on. Do not stub P0 features with TODOs.

**Project conventions (from CHAT_CONTEXT.md and LOTUS-FROG.md; they still apply)**
- Do **not** delete orphaned files (`pixelScenery.tsx`, `Login.tsx`, `Onboarding.tsx`). Leave them and flag them.
- Pixel-art discipline for any new **patient-facing** screen: `image-rendering: pixelated`, `shapeRendering: crispEdges`, `steps(n)` animation timing, uniform scaling only, two-layer scene architecture. Caregiver and doctor screens use the warm day palette (terracotta and olive on warm chalk), not the night pond.
- The patient never sees a score, timer, streak, failure screen or error alarm. Errors are logged silently.
- **Do not modify the Lotus Frog tuning constants or its EMA** (`cognitive/tuning.ts`, `applyFrogReport`). Integrate around them (see Phase 4). Keep `updateProfile()` returning early for `LOTUS_FROG`, and keep the order `applyFrogReport` → `setProfile` → `completeSession`.
- The Anthropic call for journal analysis is **server-side only**. Never put an API key in the browser.
- Never hand-transcribe large base64 or binary blobs.
- New `GameType` values surface exhaustive maps: `gardenEngine.growthFor`, `Dashboard.GAME_NAMES`, `Home.GAME_ROUTES`, `cognitiveProfile.updateProfile`. Lotus Frog is the worked example.
- **Superseded decision:** `CHAT_CONTEXT.md` / `LOTUS-FROG.md` said RBAC is frontend-only and server-side role checks must not be built without revisiting. The user is now explicitly revisiting that decision: build real server-side enforcement. Frontend gating stays as UX only.

**Security rules**
- Default deny. Authorization is enforced in the service layer (ownership checks), not only on URL patterns.
- No secrets in git, logs or images. Config comes from environment variables; the app **fails at startup in the `prod` profile** if the JWT secret is missing or shorter than 32 bytes.
- Never log journal text, tokens, pairing codes or passwords.

## 3. Decisions (defaults; the human may edit before running)

| Decision | Default |
|---|---|
| Deployment target | One Linux VM (any provider) running Docker Compose behind Caddy (automatic HTTPS). The human creates the VM and DNS; Claude Code never creates accounts or handles credentials |
| Registry | GitHub Container Registry (GHCR) via `GITHUB_TOKEN` |
| CD method | GitHub Actions builds images, then SSHes to the VM, runs `docker compose pull && up -d`, waits for health, rolls back automatically on failure |
| Database | PostgreSQL everywhere (Docker for dev), migrations with Flyway, Testcontainers in tests. H2 is no longer used by default; keep a `h2` profile only if trivial |
| Auth | Access JWT (HS256, 15 min) in memory on the client; rotating opaque refresh token (7 days) in an HttpOnly, Secure, SameSite=Strict cookie scoped to `/api/auth`; BCrypt passwords |
| Tablet setup model | **Pairing replaces on-device caregiver setup.** The caregiver uses their own device and dashboard, creates the patient, and mints a code; the tablet enters the code once. This resolves the earlier conflict between `caregiverSetupComplete` and pairing |
| Doctor onboarding | Doctors self-register as `PENDING`; an admin approves. A doctor sees a patient only after the caregiver grants access (with an expiry the caregiver can change or revoke) |
| Journal AI | Optional. `ANTHROPIC_API_KEY` and `JOURNAL_MODEL` come from env; endpoint degrades gracefully (returns null signals) if the key is absent |
| Python | Used only in `data-science/` (numpy, pandas, scikit-learn, statsmodels, matplotlib, jupyter) |
| Repo | Single monorepo (`frontend/`, `backend/`, `data-science/`, `deploy/`, `docs/`) |

## 4. Definition of done (the showcase script must pass)

A fresh clone must support all of this. Automate as much as possible as a Playwright end-to-end test and as `make demo`.

1. `make demo` starts the full stack (Postgres, backend, frontend) and seeds a **synthetic cohort** (about 12 patients with 60+ days of history, a mix of stable, declining and improving) plus demo accounts (caregiver, doctor, admin). Demo credentials work **only** in the `dev`/`demo` profile and are impossible in `prod`.
2. Caregiver logs in and sees the dashboard populated: domain trends, status chips, markers, alerts, sessions list.
3. Caregiver creates a new patient (with a guardian-consent checkbox recorded), mints a pairing code, and a **second browser profile** (the tablet) pairs with it at `/pair`.
4. On the tablet, play a game (Lotus Frog and Duck Roll Call at minimum); within seconds the caregiver dashboard shows the new session and updated domain scores (live via SSE).
5. Go offline in DevTools, play, go online: queued sessions sync once. Replaying the same batch changes nothing (idempotent).
6. Doctor logs in, sees only patients who granted access, read-only; requesting any other patient returns 404; no journal text, family media or raw trials are exposed.
7. Caregiver revokes the tablet; its next sync is refused and it stops syncing without any alarming screen for the patient.
8. All tests pass and CI is green. A push to `main` builds images, deploys, and the public HTTPS URL passes the smoke test.
9. `data-science/` reproduces its results with one command and its README states plainly what the numbers do and do not show.

## 5. Working method

- **Plan first, then build.** Phase 0 produces a written plan; do not write feature code until it exists.
- **One branch per phase** (`phase-1-foundation` etc.), small conventional commits, open a PR to `main`, merge only when CI is green (once CI exists; before that, run tests locally and record them).
- **Priorities:** every phase lists P0 (must), P1 (should), P2 (stretch). Finish all P0 in all phases **before** starting any P1. Do not leave the project in a half-built state: after each phase the app must still build, run and pass tests.
- **Maintain `docs/PROGRESS.md`**: phase status, decisions made, commands run with real results, known issues, "Needs the human". Read it at the start of every session.
- **After each phase write `docs/explainers/phase-N.md`** in plain language for a non-expert developer: what changed and why, how to demo it in 60 seconds, 5 likely interview questions with honest answers, and the honest limitations. The user relies on AI for the code and must be able to explain every decision.
- Ask the human only when blocked by an account, credential or a truly irreversible choice. Otherwise choose the default and log it.

---

## Phase 0 — Recon, baseline and plan (no feature code)

P0
1. Read `README.md`, `CHAT_CONTEXT.md`, `LOTUS-FROG.md`, `SMARAN_PLAN.md` (if present) and the code. Map: routing and gating (`App.tsx`, `SmaranContext.tsx`), `cognitiveProfile.ts`, `gardenEngine.ts`, each game's session output shape, `completeSession()`, `api.ts`, `db.ts` (IndexedDB queue), the backend entities, services, controllers, security config, and how sessions currently submit and sync.
2. Get a **green baseline**: `npm ci && npx tsc -b && npm run build` and `mvn test`. Record results. Fix only what is needed to get green.
3. Write `docs/PLAN.md`: current-state map (what truly exists vs the README's claims), a gap list against section 1, the exact files you will touch per phase, risks, and any contradictions you found. Specifically investigate and report: (a) two scoring paths (`updateProfile` / `applyFrogReport` vs the standalone `cognitiveScoring.ts` if it is in the repo), (b) what each existing game returns at the end of a session, (c) whether any server-side auth exists today.
4. Create `docs/PROGRESS.md`, `docs/explainers/`, `Makefile` skeleton, `.env.example`, `.gitignore` hygiene (no secrets, no build output).

Deliverable: the plan, a green baseline, and no behavioural changes.

## Phase 1 — Foundation: database, contracts, unified scoring

P0
1. **PostgreSQL + Flyway.** Dev `docker-compose.yml` with Postgres. Flyway migrations for all tables (users, patients, pairing codes, devices, sessions, profile snapshots, alerts, audit events, doctor grants, consent records, refresh tokens, journal signals, voice notes, family members, garden state). Migrations are the only schema source (`ddl-auto=validate`). Profiles: `dev`, `demo`, `test`, `prod`.
2. **Shared contract** (Appendix A): `SessionEnvelope`, `ScoreContribution`, `DomainId` (six domains), `GameModule`. Mirror in TypeScript and Java records; generate or hand-maintain with a test that fails if they drift.
3. **One scoring engine** in `frontend/src/lib/scoring/` implementing, as pure functions, exactly the rules in Appendix A: domain scores 0–100, per-session `confidence`, EMA with `alpha = 0.25 * confidence`, per-domain velocity as a z-score against the patient's own trailing baseline (prior SD 12 until 5 observations), status from velocity with confidence gating, the clinician markers, and the alert rule (two consecutive readings by default; CUSUM selectable).
4. **Java twin** `CognitiveScoringService` implementing the same EMA, velocity, status and alert rules. **Golden vectors:** a checked-in `golden-vectors.json` (inputs → expected outputs) generated by the TypeScript engine and verified by TypeScript tests, Java tests and (Phase 5) Python tests. The test suite fails if any implementation drifts.
5. **Reconcile with existing code** per Appendix A.4: the new engine is the single path for every game except Lotus Frog; Lotus Frog stays on `applyFrogReport` and reaches the server as a precomputed reading, so a visit is never counted twice.

P1
6. Vitest for the TypeScript engine, property tests (e.g. level stays in 0–100, replay-order invariants).

Done when: the app builds on Postgres, golden-vector tests pass in TypeScript and Java, and nothing about the existing games regressed.

## Phase 2 — Authentication and server-side RBAC

P0
1. **Users and roles:** `ADMIN`, `CAREGIVER`, `DOCTOR` (human users) and `DEVICE` (patient tablet principal, Phase 3). Caregiver self-registration is open; doctor registration is `PENDING` until an admin approves; the first admin is created from env on first boot (`ADMIN_EMAIL`, `ADMIN_PASSWORD`), never from source.
2. **Auth endpoints:** register, login, refresh (rotating, with reuse detection that revokes the token family), logout, `GET /api/auth/me`. BCrypt, password policy, login rate limiting and temporary lockout.
3. **Authorization:** Spring Security filter chain (stateless), `@PreAuthorize` method security, and **ownership checks in services**: a caregiver reaches only patients they own; a doctor reaches only patients with an active, unexpired grant and only the read-only subset; admin reaches system functions but patient-level reads are audited. Return **404** (not 403) for resources the caller may not know exist. Full matrix in Appendix B.
4. **Doctor grants:** caregiver grants access by doctor email with an expiry; list and revoke; the doctor sees "shared until X".
5. **Audit log:** append-only `audit_event` for every read of patient data by a caregiver, doctor or admin, and for every grant, revoke, pairing and login event (who, what, when, patient, IP). Viewable by the caregiver for their patients.
6. **Frontend:** in-memory access token, silent refresh, route guards driven by `/api/auth/me` (UI only; the server is the authority), login/register screens for caregivers and doctors, role-aware navigation. The `family & caregiver portal` link on the landing page goes to `/caregiver/login`.
7. **Tests (mandatory):** a parametrised **authorization matrix test** over every endpoint × role × ownership case, asserting the exact status code, plus IDOR tests (caregiver A requesting caregiver B's patient), token tampering, expired token, refresh reuse, lockout.

P1
8. `ConsentRecord`: guardian consent captured at patient creation (notice version, timestamp, who), required before data collection starts.
9. Security headers (CSP, HSTS in prod, frame options), validation with Jakarta Validation on every request body, request size limits.

Done when: the matrix test passes, a stolen or tampered token fails, and the frontend cannot reach data its role should not see even by editing client code.

## Phase 3 — Device pairing

P0
1. **Entities and service** `PairingCode`, `Device`, `PairingAttempt`.
   - Code: 6 characters, case-insensitive, from the **corrected 27-character alphabet** `ACDEFGHJKMNPQRTUVWXYZ234679` (no 0/O, 1/I/L, 5/S, 8/B, and no duplicate characters; a prior draft accidentally repeated `9`). Displayed as `HJ4K-2M`. Input is normalised (case, spaces, dashes ignored).
   - Stored **hashed** (SHA-256 with a server pepper), single-use, 72-hour TTL, **atomic redemption** (unique constraint or `UPDATE ... WHERE redeemed_at IS NULL`) so two simultaneous redemptions cannot both win. Minting a new code invalidates any unredeemed one for that patient.
   - Rate limit: 5 attempts per device fingerprint per 15 minutes **and** per IP. Constant-time comparison where applicable. Generic failure message to the patient; lockout reported gently.
   - Redemption returns an opaque **device token** (stored only as a hash in the database) plus a minimal bundle: patient first name, language code, kinship term.
2. **Endpoints:** `POST /api/caregiver/patients/{id}/pairing-codes` (CAREGIVER, owner), `POST /api/pairing/redeem` (public, rate-limited), `GET /api/caregiver/patients/{id}/devices`, `DELETE .../devices/{deviceId}` (revoke; deletes no patient data).
3. **Device-scoped API** under `/api/device/**` accepting only a `DEVICE` token, scoped to exactly one patient: `GET me`, game route, garden, `POST sessions/batch`, journal analyse, family members, voice notes, reminders, biomarker vectors. A device token must be **unable** to call any caregiver, doctor or admin endpoint (covered by the Appendix B matrix).
4. **Tablet UI `/pair`:** pixel-pond style, six large code cells, large touch targets, gentle error text, no jargon. A random device fingerprint (UUID) is created once in IndexedDB.
5. **Gating rewrite in `App.tsx`:** no device token → `/pair`; token present → load the cached `me` bundle (works offline) → `/language` confirmation if `!languageConfirmed` → Home. Replace `caregiverSetupComplete` with `devicePaired` (keep the old flag readable for migration). Keep `/preview-home`.
6. **Revocation behaviour:** on 401/403 from a device endpoint, pause sync silently, keep local data, show nothing alarming; re-pairing to the **same** patient resumes; re-pairing to a different patient wipes local data first.
7. **Tests:** expiry, reuse, normalisation, rate limit, concurrent redemption, revoked-device refusal, device token denied on non-device endpoints.

P1
8. Caregiver UI to mint, display and copy the code with a countdown, list devices with last-seen, revoke.

Done when: a second browser profile pairs with a freshly minted code and reaches the patient's pond, and revoking it stops its sync.

## Phase 4 — Games to server to dashboards

P0
1. **Game-module registry** (Appendix A.3). Register every existing game with a scoring adapter and the shared contract: `weavers-loom`, `grandmothers-tale`, `family-grove`, `morning-rituals`, `lotus-frog`. Inspect what each game currently emits; map to `ScoreContribution[]` per the table in Appendix A.2, with documented formulas and confidence derived from trial counts. Where a game only produces summary data (completion rate, duration), score from that, set low confidence, and record "no trial-level data" as a limitation in the explainer.
2. **Build Duck Roll Call** as the reference new game (spec in Appendix A.5), proving the plug-in path end to end. Pixel-art discipline applies.
3. **`completeSession()` pipeline:** game finishes → build `SessionEnvelope` (trials, contributions, markers, difficulty, `clientSessionId`, `startedAt`) → update local profile with the shared engine (Frog stays on its own path) → queue in IndexedDB → sync.
4. **Server ingestion** `POST /api/device/sessions/batch`: validate and range-check; **idempotent** on `(patientId, startedAt)` and `clientSessionId` (server wins); store raw trials as JSONB plus contributions; recompute the profile with the Java twin (incremental append when in order, full rebuild when an older session arrives late); write a `profile_snapshot` per session (levels, velocities, statuses) to serve time series; recompute garden state from deduplicated history; emit an SSE event to authorised dashboards. Add a `scoring_trust` note: the server trusts device-computed contributions after sanity checks (documented boundary; P1 re-scores server-side).
5. **Alerts:** `MISSED_DAYS` (3 consecutive days, once) and `DOMAIN_DECLINE` (using the configured rule, with `watch` and `decline` severities and confidence gating). Alerts are idempotent (no duplicates per episode) and acknowledgeable.
6. **Caregiver dashboard (real data, replacing demo data):** patient selector; header stats (last active, sessions in 7 days, garden stage); domain cards (level, status chip, sparkline, confidence); trend chart (Recharts, 30/90 days, selectable domain, annotated alerts); markers panel (working-memory breakdown span, inhibition tier, trajectory precision when present); session table with each game's per-session contributions and its plain-language `because` text; alerts list; devices and pairing; doctor grants; PDF export (use the existing OpenPDF report, now fed from real data). Live updates over SSE.
7. **Doctor dashboard (read-only):** granted-patient list, summary, trend charts, markers, alerts, PDF; banner showing "shared until X".

P1
8. **Journal pipeline:** `POST /api/device/journal/analyse` calls the model server-side (env-configured), validates and clamps the response (`valence -1..1`, `arousal 0..1`, themes, `concernFlags` ⊆ `CONFUSION|DISTRESS|LONELINESS|PAIN`, summary), stores **signals only** (never the text), feeds the AFFECTIVE domain, and shows a sentiment trend (signals only) on the caregiver dashboard. Missing key → returns null signals gracefully.
9. **Caregiver voice notes:** record in the browser, upload through `StorageService`, device fetches them, the existing "morning dew" card plays them and marks them listened.
10. Family members: caregiver uploads photo, 5-second voice note and memory hint; the tablet receives them.
11. Sundowning alert: compare late-afternoon vs morning sessions per patient with an effect-size rule and a minimum-sessions guard.
12. Activity heatmap.
13. Server-side re-scoring of Duck Roll Call (and later games) from raw trials with a parity metric `scoring_mismatch_total`.

P2: Koi Are Jumping (spec in `docs/` if present), voice-trend alert with the fixed non-diagnostic sentence.

Done when: the showcase script steps 2–7 pass.

## Phase 5 — Data science layer

P0 (all in `data-science/`, reproducible by `make ds`)
1. `README.md` first: what is synthetic, what the simulation assumes (every parameter listed and justified as an assumption), what the results do and do not show. Fixed seeds. Pinned `requirements.txt`.
2. **Simulator `src/simulate.py`**: a cohort with **known ground truth**. Latent ability per domain over time, then observed per-session scores. Include: trajectory types (stable, slow decline, fast decline, single-domain decline, improving), a saturating **practice effect**, observation noise per game, session adherence and missed days, abandoned sessions, a time-of-day effect for a sundowning subgroup, and recorded ground-truth change points. Output the same JSON the API ingests and a de-identified CSV.
3. **Python port of the scoring core** (`scoring_core.py`: EMA, velocity, status, alert rules) validated against `golden-vectors.json`.
4. **Evaluation notebooks and scripts** (results to `data-science/results/*.csv` and figures to `results/figures/*.png`):
   - **Alert-rule comparison** (Appendix C): absolute-level threshold vs single-session velocity vs two-consecutive velocity vs CUSUM. Metrics: detection delay, sensitivity within 14 and 30 days of true onset, false alarms per patient-year, ROC or PR via threshold sweeps, bootstrap confidence intervals. The absolute-level rule is the baseline that demonstrates why velocity against a personal baseline matters.
   - **Ablations:** confidence gating on/off, EMA alpha sweep, prior-SD sensitivity.
   - **Reliability:** test-retest ICC on stable simulated patients.
5. **Dataset export** `GET /api/admin/export/sessions.csv` (ADMIN only, de-identified with salted patient hashes, no free text), used by a script that proves the notebooks run on API-exported data.
6. **Seed loader:** load the synthetic cohort **through the real ingestion service** so the demo dashboard exercises the production code path.

P1
7. **Practice-effect modelling:** mixed-effects model (statsmodels) with session index as a covariate, showing how ignoring practice effects masks decline.
8. **Sundowning detection** notebook from time-of-day × performance (effect size, minimum-session guard) evaluated against ground truth.
9. **Federated-learning simulation:** a logistic-regression head predicting next-session abandonment from recent features on non-IID simulated patients; compare local-only, centralised and FedAvg, with convergence curves and communication cost. Match the head's shape to `federated.ts`. State explicitly that **secure aggregation is not implemented** and why it matters.

P2: clustering of profile trajectories (UMAP or PCA), journal-sentiment-vs-performance correlation (on simulated or clearly labelled mock sentiment).

Done when: `make ds` reproduces every table and figure, the README states limits plainly, and a CI job runs a small-N version of the simulation and the golden-vector tests.

## Phase 6 — DevOps: containers, CI, CD, deployment

P0 (spec in Appendix D)
1. **Dockerfiles:** backend multi-stage (Maven build → slim JRE 21, non-root, healthcheck); frontend multi-stage (Vite build → nginx serving static files with correct headers for the service worker, SPA fallback, `/api` reverse proxy so the browser sees a single origin and CORS is unnecessary).
2. **Compose files:** `docker-compose.yml` (dev) and `deploy/docker-compose.prod.yml` (images from GHCR by tag, Caddy for automatic HTTPS, Postgres volume, healthchecks, restart policies, resource limits, no published DB port).
3. **Config and secrets:** twelve-factor env vars, `.env.example` complete and documented, fail-fast on missing prod secrets, no secrets in images or logs.
4. **CI (GitHub Actions)** on every PR and push: frontend (`npm ci`, lint, `tsc -b`, Vitest, build), backend (`mvn verify` with Testcontainers Postgres, the authorization matrix and pairing tests included), data-science (pytest, golden-vector parity, small-N simulation), Docker build, **security scans** (dependency audit, CodeQL, Trivy image scan, gitleaks), and an **end-to-end Playwright job** against the compose stack. Cache dependencies. Fail on high-severity findings.
5. **CD:** on merge to `main` and CI green, build and push images to GHCR (tags: commit SHA and `latest`), then a deploy job in a protected `production` environment: SSH to the VM, `docker compose pull && up -d`, wait for `/actuator/health`, run a smoke test (login with a CI-provisioned smoke user, pair, submit a session, read the dashboard), and **roll back to the previous tag automatically** if health or smoke fails. Keep the previous image tag recorded on the VM.
6. **Observability:** Spring Actuator health and info public; metrics (`/actuator/prometheus`) restricted to internal access or ADMIN; structured JSON logs with a request ID; counters for session ingestion, duplicates dropped, auth failures, pairing failures and scoring mismatches.
7. **Backups:** nightly `pg_dump` with retention and a **tested restore procedure** documented in the runbook.
8. **Docs:** `docs/RUNBOOK.md` (deploy, rollback, rotate secrets, restore, add a game, add a doctor), `docs/ARCHITECTURE.md` with a Mermaid diagram, and the human checklist (Appendix E).

P1: Dependabot, SBOM, branch-protection recommendations, a Grafana/Prometheus compose profile, preview environments per PR.

Done when: pushing to `main` deploys, `https://<domain>` serves the app, the smoke test passes in CI, and a deliberately broken deploy rolls back.

**Note on HTTPS:** service workers, microphone access and camera access require HTTPS (except on localhost). The deployed PWA and the voice features only work behind valid TLS, so a domain with Caddy is required, not optional.

## Phase 7 — Hardening and showcase polish

P0
1. Run the whole showcase script (section 4) and fix what fails. Add the Playwright end-to-end test that automates steps 2–7.
2. `README.md` rewrite: what it is, architecture diagram, screenshots or a short GIF, feature list with an honest **Built / Designed** status, how to run locally in 3 commands, the data-science results, the deployed URL, known limitations, and the ethics and privacy stance (guardian consent, data minimisation, no raw audio or video retention, DPDP-aligned design, not a medical device, not clinically validated).
3. OpenAPI docs via springdoc, served only in non-prod or behind ADMIN.
4. A final **verification report** in `docs/PROGRESS.md`: every command run and its real output, the showcase script result, known issues.

P1: accessibility pass on caregiver and doctor screens (contrast, keyboard, screen-reader labels), load test with a small k6 script and honest numbers.

---

## Appendix A — Contracts and scoring rules

### A.1 Types (TypeScript; mirror in Java records)

```ts
export type DomainId =
  | 'LANGUAGE' | 'VISUAL_SEMANTIC' | 'MOTOR'
  | 'AFFECTIVE' | 'TEMPORAL' | 'EXECUTIVE'

export type SubSignalId =
  | 'WORKING_MEMORY_SPAN' | 'INHIBITORY_CONTROL' | 'COGNITIVE_FLEXIBILITY'
  | 'TRAJECTORY_PREDICTION' | 'REACTION_SPEED' | 'SUSTAINED_ATTENTION'

export interface ScoreContribution {
  target: DomainId | SubSignalId
  raw: number            // 0-100 for this session only
  confidence: number     // 0-1; short sessions score low
  because: string        // plain-language reason shown on the dashboard
}

export interface SessionEnvelope {
  clientSessionId: string          // uuid, generated on device
  patientId: string
  gameId: string                   // registry id
  startedAt: string                // ISO-8601; (patientId, startedAt) is the dedupe key
  durationMs: number
  completed: boolean
  abandoned: boolean
  hourOfDay: number
  moodAtStart: string | null
  difficulty: { tier: number; params: Record<string, number | string> }
  trials: unknown[]                // game-specific raw trials, stored as JSONB
  contributions: ScoreContribution[]
  markers?: { workingMemorySpan?: number; inhibitionBreakdownTier?: number; trajectoryPrecisionMs?: number }
  precomputedReading?: boolean     // true for LOTUS_FROG: contributions come from applyFrogReport
  engineVersion: string
}
```

### A.2 Scoring rules (the single source of truth; implement identically in TS and Java)

Per contribution on a domain or sub-signal, in `startedAt` order:

```
alpha     = 0.25 * confidence
level'    = level * (1 - alpha) + raw * alpha          // starts at 50
baseline  = mean(last <=30 raws)  (use level until 3 observations)
sd        = stddev(last <=30 raws) (use prior 12 until 5 observations)
velocity  = (raw - baseline) / sd
domain confidence = min(1, observations / 12)
status    = confidence < 0.35 ? 'stable'
          : velocity <= -1.5  ? 'decline'
          : velocity <= -0.8  ? 'watch'
          : velocity >=  1.0  ? 'improving' : 'stable'
```

Alert rule (configurable): `TWO_CONSECUTIVE` (default: two consecutive contributions on the same domain at or below the threshold, both at domain confidence ≥ 0.35), `SINGLE`, or `CUSUM` (parameters `k` and `h` in config, documented). Status above remains the single-session reading; **alerts use the configured rule**.

Game mapping (adapt to the real data each game emits; document formulas):

| Game | Primary | Secondary | Notes |
|---|---|---|---|
| weavers-loom | VISUAL_SEMANTIC | MOTOR (small) | recognition accuracy, latency vs window |
| grandmothers-tale | LANGUAGE | SUSTAINED_ATTENTION | correct selection, replay count |
| family-grove | VISUAL_SEMANTIC | AFFECTIVE | per-member phase progress |
| morning-rituals | TEMPORAL | EXECUTIVE | sequence errors, swaps |
| lotus-frog | MOTOR | TEMPORAL (sundowning) | `precomputedReading`, via `applyFrogReport` |
| duck-roll-call | EXECUTIVE / WORKING_MEMORY_SPAN | VISUAL_SEMANTIC (weak) | see A.5 |
| koi-are-jumping (P2) | EXECUTIVE / INHIBITORY_CONTROL | MOTOR, SUSTAINED_ATTENTION | false alarms and misses scored separately |

Secondary contributions use 0.5–0.7 of the primary confidence. Journal sentiment feeds AFFECTIVE (valence mapped to 0–100, confidence from entry length).

### A.3 Game-module registry

```ts
export interface GameModule {
  id: string
  title: string
  route: string
  primaryDomains: DomainId[]
  scoreSession(trials: unknown[], ctx: { hourOfDay: number }): ScoreContribution[]
  markers?(trials: unknown[]): SessionEnvelope['markers']
}
```
Adding a game = one module file + one registry entry. The dashboard reads the registry (titles, domains) and the server accepts any registered `gameId`, so a new game appears on the dashboards with no further wiring. Write `docs/ADDING_A_GAME.md`.

### A.4 Reconciling the two scoring paths

The repo already has `cognitiveProfile.ts` (`updateProfile`, 3:1 history weighting) and Lotus Frog's `applyFrogReport` (confidence-weighted EMA, `baseAlpha = 0.25`, damped to 40% for abandoned sessions). Decision: the **new engine is the single path for every game except Lotus Frog**. Lotus Frog keeps its own path unchanged and is sent to the server as `precomputedReading: true`; the server replays its stored contributions and never re-scores it. Remove or neutralise the old `updateProfile` paths for the other games **without double counting**, and add a test proving one visit changes the profile exactly once.

### A.5 Duck Roll Call (reference new game)

All ducklings flash a number **simultaneously** for a brief window (visual only, no audio), the numbers vanish together, and the patient taps ducklings in ascending order from memory. Start at 3, grow to 6 (reuse the six existing duckling sprites). Difficulty axes: span 3→6, then flash 2000→800 ms; **never raise both at once**. No timer during recall. A wrong tap is a gentle wiggle, never a failure; after one failed attempt and when the profile flags high anxiety, subtly highlight the correct next duckling (errorless mode). Per round, log `spanLength`, `flashDurationMs`, `correctFirstAttempt`, `attempts`, `firstErrorAtPosition`, `timeToFirstTapMs`. Scoring: effective span (clean round = N, retries = N − 0.5, failure = position reached), flash bonus up to +25%, normalised to 0–100 → EXECUTIVE and WORKING_MEMORY_SPAN; retrieval speed → VISUAL_SEMANTIC (weak). Marker `workingMemorySpan` = largest span with ≥70% clean over at least 2 rounds. Confidence `min(1, rounds / 8)`, floor 0.15.

## Appendix B — Authorization matrix (the test oracle)

Rows are resource groups, columns are principals. `owner` means the caregiver owns the patient. `grant` means an active, unexpired doctor grant. Anything not listed is **denied (404 for resources, 401 for unauthenticated)**.

| Resource | Anonymous | CAREGIVER (owner) | CAREGIVER (other) | DOCTOR (grant) | DOCTOR (no grant) | ADMIN | DEVICE (own patient) |
|---|---|---|---|---|---|---|---|
| `POST /api/auth/register`, `login`, `refresh` | allow | allow | allow | allow | allow | allow | deny |
| `POST /api/pairing/redeem` | allow (rate-limited) | allow | allow | allow | allow | allow | n/a |
| Create / list / read own patients | 401 | allow | 404 | 404 | 404 | allow (audited) | deny |
| Pairing codes, devices, revoke | 401 | allow | 404 | deny | deny | allow (audited) | deny |
| Doctor grants (create/revoke) | 401 | allow | 404 | deny | deny | allow (audited) | deny |
| Dashboard, timeseries, sessions, alerts, sentiment signals | 401 | allow | 404 | read-only subset | 404 | allow (audited) | deny |
| PDF report | 401 | allow | 404 | allow | 404 | allow (audited) | deny |
| Journal text, family media, raw trials | 401 | media allow; journal text never stored | 404 | **deny** | deny | deny | write own only |
| `/api/device/**` | 401 | deny | deny | deny | deny | deny | allow (own patient only) |
| Approve doctors, dataset export, audit read-all | 401 | deny | deny | deny | deny | allow | deny |
| `/actuator/health` | allow | allow | allow | allow | allow | allow | allow |
| `/actuator/prometheus` | deny | deny | deny | deny | deny | allow / internal | deny |

Generate the test from this table. Also test: token for patient A cannot read patient B, device token cannot call any non-device endpoint, a revoked device token is refused, an expired grant stops working immediately.

## Appendix C — Alert-rule evaluation spec

- **Ground truth:** each simulated patient has a known onset day (or none) per domain.
- **Rules compared:** (R0) absolute-level threshold, (R1) single-session velocity, (R2) two-consecutive velocity, (R3) CUSUM, with and without confidence gating.
- **Metrics:** detection delay (days from true onset); sensitivity within 14 and 30 days; false alarms per patient-year on stable patients; ROC/PR from threshold sweeps; bootstrap 95% CIs (fixed seeds, at least 1,000 resamples).
- **Expected insight to test, not assume:** R0 flags patients who simply score low and so produces false alarms on stable low scorers; personal-baseline velocity should not. Report whatever the data shows, including if it disagrees.
- **Practice-effect scenario:** show detection with and without modelling the practice curve.
- Save every table as CSV and every figure as PNG with its seed and parameters in the filename or a sidecar JSON.

## Appendix D — CI/CD specification

**Workflows**
- `ci.yml` (PR + push): jobs `frontend`, `backend`, `datascience`, `docker-build`, `security`, `e2e`. Cache npm, Maven and pip. Upload test reports and Playwright traces as artifacts.
- `cd.yml` (push to `main`, needs `ci` success): `build-and-push` (Buildx, GHCR, tags `sha-<short>` and `latest`) → `deploy` (environment `production`, SSH, compose pull and up, health wait, smoke test, auto-rollback) → `notify` (job summary with the deployed SHA and URL).
- `security.yml` (schedule + PR): CodeQL, dependency audit, Trivy, gitleaks.
- `.github/dependabot.yml` for npm, Maven, pip, GitHub Actions and Docker.

**Deploy script `deploy/deploy.sh`** (idempotent): records the current image tag, pulls the new tag, `docker compose up -d`, polls `/actuator/health` with a timeout, runs `deploy/smoke.sh`; on failure, restores the recorded tag and exits non-zero.

**Required GitHub secrets (the human sets these; never commit them):** `VM_HOST`, `VM_USER`, `VM_SSH_KEY`, `DOMAIN`, plus runtime secrets on the VM in a root-only `.env`: `JWT_SECRET`, `POSTGRES_PASSWORD`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, optional `ANTHROPIC_API_KEY`, `JOURNAL_MODEL`.

## Appendix E — Checklist for the human (Claude Code cannot do these)

1. Create a Linux VM (2 GB RAM is enough to start) and note its IP; open ports 22, 80 and 443 only.
2. Point a domain or subdomain (A record) at the VM; Caddy gets the certificate automatically.
3. Install Docker and the Compose plugin on the VM; create a non-root deploy user and an SSH key pair for CI.
4. Add the secrets in Appendix D to the GitHub repository (and a `production` environment with a required reviewer if you want manual approval).
5. Create the VM's root-only `.env` with strong random values (`openssl rand -base64 48`).
6. Enable branch protection on `main` requiring the CI checks.
7. Optional: add `ANTHROPIC_API_KEY` for journal analysis.
8. Before any real patient or caregiver uses the system: legal review of the consent notice and a privacy review. This repository only contains synthetic or demo data, and it is not a medical device.
