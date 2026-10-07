# Smaran — Progress Log

Read this at the start of every session, after `docs/MASTER_PROMPT.md`.
All patient data in this repository is synthetic or demo data.

Last updated: 2026-10-06 (end of Phase 1).

## Phase status

| Phase | Status | Branch | Notes |
|---|---|---|---|
| 0. Recon, baseline, plan | **Done** | `phase-0-recon` | PR #1, open. Plan in `docs/PLAN.md` |
| 1. Foundation: database, contracts, scoring | **P0 and P1 done** | `phase-1-foundation` | PR #2, open, CI green; Docker stack verified locally |
| 2. Authentication and RBAC | Not started | | |
| 3. Device pairing | Not started | | A working version exists; it is reworked to spec |
| 4. Games to dashboards | Not started | | |
| 5. Data science | Not started | | |
| 6. DevOps | Not started | | |
| 7. Hardening and showcase | Not started | | |

**Next:** Phase 2 (authentication and RBAC).

## Needs the human

| # | What | Why | Until then |
|---|---|---|---|
| H1 | ~~Install Docker Desktop~~ | Done 2026-10-06 | none |
| H2 | **Merge PR #1 (Phase 0), then the Phase 1 PR** | Merging to `master` is the owner's call | Phase 1 is stacked on the Phase 0 branch |
| H6 | ~~Pairing code format~~ | Decided 2026-10-07: 6 characters, 72 hours (the prompt's spec) | none |
| H3 | Install `make` (optional) | `make` is not on PATH | Run the commands under each Makefile target by hand |
| H4 | Review the commit `f388fe8` | It is 37 files of earlier work that nobody has read as a diff | It is the base for Phase 1 |
| H5 | Everything in Appendix E of the master prompt (VM, domain, secrets, branch protection) | Needed for deployment in Phase 6 | Not blocking before Phase 6 |

## Decisions made

| Date | Decision | Reason |
|---|---|---|
| 2026-10-06 | Renamed `docs/SMARAN_MASTER_PROMPT.md` to `docs/MASTER_PROMPT.md` | The prompt's own step 1, and the path later sessions are told to read |
| 2026-10-06 | Committed the earlier uncommitted work as one commit (`f388fe8`) before any Phase 0 change | So it can be reviewed or reverted as a unit |
| 2026-10-06 | Track `frontend/package-lock.json` | `npm ci` fails without it |
| 2026-10-06 | Untrack `backend/target/` and `frontend/tsconfig.tsbuildinfo` | Build output |
| 2026-10-06 | Keep the unified scoring path rather than restore `applyFrogReport` (default D1) | See `PLAN.md` section 2 |
| 2026-10-06 | PRs target `master` until the branch is renamed in Phase 6 (default D4) | Renaming the default branch is the owner's setting |
| 2026-10-07 | D2 decided by the human: pairing codes are 6 characters, valid 72 hours | Follows the prompt. Weaker against guessing than 8 characters / 10 minutes, so Phase 3 keeps both rate limits and the hash-only storage |
| 2026-10-06 | Phase 1 went ahead on defaults D1, D3, D4 after "go ahead with phase 1" | The human's instruction |
| 2026-10-06 | Baseline for velocity is trailing: it excludes the score being judged | Otherwise a drop pulls its own baseline down and hides part of itself |
| 2026-10-06 | SD floor of 3 points (`minSd`) | The spec is silent on identical scores, which give SD 0 and a division by zero |
| 2026-10-06 | CUSUM: `k` 0.5, `h` 4; `decline` at `h`, `watch` at `h / 2` | The spec names `k` and `h` only; the watch level is an addition |
| 2026-10-06 | `domainScores` (0–1) kept as a derived view of the engine's levels | Routing, the dashboard and the PDF keep working until Phase 4 rebuilds them on the engine |
| 2026-10-06 | New profiles start at 50 in every domain (was 0.6, affective 0.7) | Appendix A.2 |
| 2026-10-06 | Removed the server-only 10% affective cut for eased sessions | A second scoring path the device never applied |
| 2026-10-06 | Embedded PostgreSQL (zonky) beside Testcontainers | The only way to verify on real Postgres with no Docker; Testcontainers is used when Docker exists |
| 2026-10-06 | No CHECK constraint on `game_session.game_type` | Adding a game must not need a migration |
| 2026-10-06 | Unit tests under `mvn test`; `*IT` classes under `mvn verify` | Keeps the fast loop fast |
| 2026-10-06 | Any profile other than dev, demo or test is treated as production by `StartupChecks` | A forgotten or misspelt profile must fail closed |
| 2026-10-06 | H2 removed entirely | Migrations use PostgreSQL features; an `h2` profile was not trivial |
| 2026-10-06 | A minimal CI workflow added now, not in Phase 6 | It is where the Testcontainers path first runs |

## Baseline — 2026-10-06

Machine: Windows 11, Node v24.14.1, npm 11.11.0, OpenJDK 21.0.12, Maven 3.9.16.
Run on branch `phase-0-recon` with the working tree as committed in `f388fe8`.

### Frontend

```
cd frontend
npm ci            → exit 0
npx tsc -b        → exit 0, no output
npm run build     → exit 0
```

Build output (trimmed):

```
dist/manifest.webmanifest                          0.47 kB
dist/index.html                                    1.22 kB │ gzip:   0.58 kB
dist/assets/index-7o-J4Dfc.css                    33.98 kB │ gzip:   8.03 kB
dist/assets/workbox-window.prod.es5-BqEJf4Xk.js    5.71 kB │ gzip:   2.34 kB
dist/assets/index-BLlJ8Ziq.js                    825.83 kB │ gzip: 250.36 kB
✓ built in 1m 19s
PWA v0.20.5  mode injectManifest  precache 12 entries (889.23 KiB)
```

`npm ci` reported **14 known vulnerabilities (1 low, 6 moderate, 7 high)** in
dependencies, including `esbuild`, `react-router`, `braces` and
`serialize-javascript`. Not fixed in Phase 0 (no behavioural changes). Phase 6
makes the audit a CI gate, so they must be resolved by then.

### Backend

```
cd backend
mvn -o test       → exit 0, BUILD SUCCESS
```

```
Tests run: 15, Failures: 0, Errors: 0, Skipped: 0 -- CognitiveMapTest
Tests run:  4, Failures: 0, Errors: 0, Skipped: 0 -- GardenStateServiceTest
Tests run: 13, Failures: 0, Errors: 0, Skipped: 0 -- PairingServiceTest
Tests run: 32, Failures: 0, Errors: 0, Skipped: 0
```

Run with `-o` (offline) because every dependency was already in the local
Maven cache. A machine with an empty cache needs `mvn test` without `-o`.

### Not run in Phase 0

- Nothing was opened in a browser.
- No endpoint was called; the backend was not started.
- Nothing that needs Docker or Postgres.

Nothing needed fixing to reach green.

## Phase 1 — 2026-10-06

Branch `phase-1-foundation`, stacked on `phase-0-recon`. Same machine as the
baseline. No Docker.

### What was built

- `frontend/src/lib/scoring/`: contract types, the engine, alert rules,
  markers, the 0–1 bridge, the golden-vector generator.
- `golden-vectors.json` at the repo root: 16 cases.
- `backend/.../scoring/`: `Contract`, `ScoringConfig`, `ScoringEngine`,
  `LegacyScores`, `CognitiveScoringService`.
- Both profile updates (`updateProfile` on the device,
  `CognitiveProfileService.updateFromSession` on the server) go through the
  engine. The old EMA is gone from `cognitiveMap.ts` and `CognitiveMap.java`.
- Flyway `V1__baseline.sql` and `V2__accounts_devices_sessions_alerts.sql`;
  `ddl-auto: validate`; profiles `dev`, `demo`, `test`, `prod`; H2 removed.
- `StartupChecks` fail-fast rules; `LocalDevApplication` for running with no
  Docker; `DemoDataSeeder` now feeds its history through the real update.
- Vitest, fast-check, `.github/workflows/ci.yml`.

### Commands and results

```
cd frontend
npx tsc -b                      → exit 0
npx tsc -p tsconfig.test.json   → exit 0
npm test                        → 3 files, 50 tests passed
npm run golden && git diff --quiet golden-vectors.json   → no difference
npm run build                   → exit 0, 828.78 kB JS, precache 12 entries
```

```
cd backend
mvn -o verify                   → BUILD SUCCESS
```

```
Tests run:  7 -- StartupChecksTest
Tests run:  7 -- CognitiveScoringServiceTest
Tests run:  4 -- ContractTest
Tests run: 17 -- ScoringEngineGoldenTest      (16 golden cases + 1)
Tests run: 10 -- CognitiveMapTest
Tests run:  4 -- GardenStateServiceTest
Tests run: 13 -- PairingServiceTest
Tests run: 62, Failures: 0, Errors: 0, Skipped: 0     unit

Tests run:  2 -- DemoSeedIT
Tests run:  9 -- SchemaAndIngestionIT
Tests run: 11, Failures: 0, Errors: 0, Skipped: 0     integration, PostgreSQL 16 (embedded)
```

Flyway, from the integration run:

```
Successfully validated 2 migrations
Migrating schema "public" to version "1 - baseline"
Migrating schema "public" to version "2 - accounts devices sessions alerts"
Successfully applied 2 migrations to schema "public", now at version v2
```

**End to end.** The backend was started with `LocalDevApplication` in the
`demo` profile (authentication on) on embedded PostgreSQL, and the 30-check
pairing and scoring script from the earlier session was run against it over
HTTP: **30 of 30 passed**. That run was before the seeder change below; the
integration tests cover the seeder since. The script is still not in the
repo; Phases 2 and 3 replace it with tests that are.

**Browser.** With the backend in `dev` and Vite on :5175, headless Chrome
loaded `/caregiver/dashboard`, `/games` and `/game/koi-are-jumping` with 0
console errors. The dashboard showed the seeded patient and its alert. No
game was played through.

### Done-when, checked

| Criterion | Result |
|---|---|
| The app builds on Postgres | Yes: boots, migrates and validates on PostgreSQL 16 |
| Golden-vector tests pass in TypeScript and Java | Yes: 16 of 16 in each |
| Nothing about the existing games regressed | Type-check, build and the 30-check script pass; pages load. Not proven by playing each game |

### Docker verification — 2026-10-06

Run after Docker Desktop 4.94.0 (Engine 29.8.2) was installed. It verified
everything that was listed as unverified, and found three real problems, all
fixed.

```
docker compose up --build -d     → db, redis, backend, frontend up; backend healthy
GET :8080/actuator/health        → {"status":"UP"}
GET :8080/actuator/env, /metrics → 403 (only health is reachable)
GET :8081/                       → 200 (nginx serves the PWA)
POST :8081/api/auth/login        → 200 with tokens, through the nginx /api proxy
docker compose exec backend id   → smaran (not root)
backend logs                     → profile demo; Flyway applied 2 migrations; seeded synthetic demo data
SPRING_PROFILES_ACTIVE=prod, built-in secret → refuses to start (StartupChecks)
SPRING_PROFILES_ACTIVE=prod, real secret     → starts, does not seed
SMARAN_TEST_DB=docker mvn verify → 62 unit + 11 integration, BUILD SUCCESS, on postgres:16-alpine
```

Found and fixed:

1. **`/actuator/health` did not exist.** The Dockerfile health check and
   `SecurityConfig` both used it, but the Actuator dependency was never in the
   pom, so the backend container always reported unhealthy. Added
   `spring-boot-starter-actuator` (health only; Redis excluded from the check
   because nothing reads Redis).
2. **Testcontainers could not talk to Docker 29** (HTTP 400: the engine's
   minimum API version is newer than the 1.19 library speaks). Pinned
   `testcontainers.version` to 1.21.4. Version 1.21.3 still failed.
3. **Port 5432 is used by a PostgreSQL 18 Windows service on this machine.**
   The compose database port is now `${SMARAN_DB_PORT:-5432}`; a git-ignored
   `.env` sets 5433 here. That service was not touched.

Also added `smaran.build.dir` to the pom so the build can run outside OneDrive
(`-Dsmaran.build.dir=C:/Users/amees/smaran-build`). Without it, the VS Code Java
extension and OneDrive intermittently removed class files from `backend/target`
mid-build and `mvn` failed with "bad class file".

### CI

Run 37417779385 on `phase-1-foundation` (GitHub Actions, PR #2): `frontend`
and `backend` both succeeded. The backend job forces Testcontainers
(`SMARAN_TEST_DB=docker`), so the container path of `TestPostgres` is verified
there, on PostgreSQL 16.

### Not done in Phase 1

- The tablet still sends 0–1 `domainReadings`, not a `SessionEnvelope`. That
  is Phase 4 by design.
- No entity maps the `V2` tables yet.

## Known issues

Found during recon. Each is scheduled in `docs/PLAN.md`.

1. **Auth is off in `dev`.** It sets `open-demo: true`. The new `demo` profile has the same data with auth on.
2. **Three games report no measurement.** Grandmother's Tale, Family Grove and Morning Rituals always send a completion rate of 1.
3. **Two alert rules do not measure what they are named for** (`LANGUAGE_REGRESSION`, `CLUSTER_DECLINE`).
4. **Caregiver routes have no frontend guard**, and tokens are kept in `localStorage`.
5. **A doctor assigned to a patient can reach raw sessions, objects and media.** Only the dashboard and report URLs are role-restricted.
6. **No patient can be created through the API.** Patients exist only through the dev seeder.
7. **The dashboard silently shows sample data** when the server is unreachable (it does say so on screen).
8. **`/api/journal/analyse` does not exist**; the journal calls it and saves without signals.
9. **The README describes an earlier app.** Details in `PLAN.md` section 3.4.
10. **14 dependency vulnerabilities** in the frontend toolchain.
11. **The JS bundle is one 826 kB chunk.** Not a correctness problem; worth splitting for a low-end tablet.
12. **No security tests on the backend, and no component tests on the frontend.** The frontend now has 50 unit tests of pure logic; the backend has 11 integration tests.
13. **The earlier end-to-end pairing script is not in the repo.** It lived in a scratch folder. Phase 2 and 3 replace it with tests that are.

## Found in Phase 1

14. **`watch` is noisy by construction.** At −0.8 SD, a stable patient lands
    there about one session in five by chance. Visible in the golden cases.
    Phase 5 measures the false-alarm rate of each alert rule.
15. **The demo seeder used to bypass scoring.** Its 30 days of sessions were
    written straight to the table, so the demo profile ignored them. Fixed.
16. **Redis is configured and used by no code.** The dependency and the
    compose service can go unless a later phase needs them.
17. **`mvn clean` can fail on this machine** when the VS Code Java extension
    holds `backend/target`. Run without `clean`, or close the Java project.
18. **PostgreSQL processes that are not part of this project run on this
    machine.** They were left alone.

## Files left untracked on purpose

`.claude/`, `Claude outputs/` and `froggie-with-cognitive.tgz` are in the
working folder and not in git. They are not ignored either; decide whether to
keep them out or commit them.
