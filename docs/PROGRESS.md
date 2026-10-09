# Smaran — Progress Log

Read this at the start of every session, after `docs/MASTER_PROMPT.md`.
All patient data in this repository is synthetic or demo data.

Last updated: 2026-10-09 (end of Phase 2).

## Phase status

| Phase | Status | Branch | Notes |
|---|---|---|---|
| 0. Recon, baseline, plan | **Done** | `phase-0-recon` | PR #1 merged. Plan in `docs/PLAN.md` |
| 1. Foundation: database, contracts, scoring | **P0 and P1 done** | `phase-1-foundation` | PR #2 merged into `phase-0-recon` by mistake; PR #3 carries it to `master` |
| 2. Authentication and RBAC | **P0 and P1 done** | `phase-2-auth` | Stacked on `phase-0-recon` (which holds Phase 1). Verified; see "Phase 2" below |
| 3. Device pairing | Not started | | A working version exists; it is reworked to spec |
| 4. Games to dashboards | Not started | | |
| 5. Data science | Not started | | |
| 6. DevOps | Not started | | |
| 7. Hardening and showcase | Not started | | |

**Next:** Phase 3 (device pairing, reworked to the prompt's spec).

## Needs the human

| # | What | Why | Until then |
|---|---|---|---|
| H1 | ~~Install Docker Desktop~~ | Done 2026-10-06 | none |
| H2 | **Merge PR #3 (Phase 1 onto `master`), then the Phase 2 PR** | Merging to `master` is the owner's call | Phase 2 is built on top of the Phase 1 branch |
| H6 | ~~Pairing code format~~ | Decided 2026-10-07: 6 characters, 72 hours (the prompt's spec) | none |
| H7 | Choose real `ADMIN_EMAIL` and `ADMIN_PASSWORD` for any deployment | The first administrator is created from these on first start; nothing in source can create one | Dev and demo use seeded demo accounts (see below); local runs set nothing |
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
| 2026-10-09 | Refresh token is an opaque 256-bit random value stored as SHA-256, rotating, with family revocation on reuse; it travels only in an HttpOnly, SameSite=Strict cookie scoped to `/api/auth` | Prompt's auth decision; a script cannot read it and another site's requests do not carry it |
| 2026-10-09 | Access token carries role and identity, never a patient list | Ownership is read from the database on every request, so removing access takes effect on the next call |
| 2026-10-09 | Every endpoint declares one capability: CAREGIVE, PLAY or CLINICAL_READ. Role is checked first (403), ownership second (404) | 403 depends on no patient, so it leaks nothing about who exists; 404 for someone else's patient equals 404 for a missing one |
| 2026-10-09 | A doctor may use CLINICAL_READ only, and only on GET | Read-only by construction, not only by which endpoints exist |
| 2026-10-09 | Admin is audited, may reach any patient that exists; a missing patient is 404 | An unguarded admin path produced a database error in the matrix test |
| 2026-10-09 | Unauthenticated requests get 401 (Spring defaults to 403) | A client must tell "sign in" from "you may not" |
| 2026-10-09 | Every failure to sign in looks the same (wrong password, unknown email, locked, disabled), with a hash comparison in every case | No account enumeration by response or timing |
| 2026-10-09 | Lockout: 5 failures, 15 minutes. Per-address limit: 20 failures per 15 minutes. Both in memory | Prompt asks for rate limiting and lockout; Redis is the upgrade for several nodes |
| 2026-10-09 | Sign-up limit (10 per address per hour) counts only attempts that pass validation | A typo must not use up the allowance; found when repeated test runs locked me out |
| 2026-10-09 | The tablet keeps its token under `smaran.deviceToken`; a person's access token is held in memory only | The two have opposite needs: one must persist, the other must not be in storage. The old key is migrated |
| 2026-10-09 | A refusal on the dashboard is shown as a refusal, never replaced with sample data | A doctor whose access ended must not see a plausible-looking week |
| 2026-10-09 | The server returns the reason for deliberate status errors only (`{"message": ...}`) | So "use at least 10 characters" reaches a person; unexpected exceptions still return a bare status |
| 2026-10-09 | `smaran.local.pg.dir` for the no-Docker database folder | A live database in a OneDrive folder was locked by sync |
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

## Phase 2 — 2026-10-09

Branch `phase-2-auth`, built on `phase-0-recon` (which contains Phase 1).

### What was built

**Backend**

- Migration `V3`: accounts move from the `caregiver` table to `app_user`. A patient's owner is now a foreign key. A doctor's old assigned patients became 90-day grants. `caregiver` and `caregiver_patient` are dropped.
- `AuthService`: register (doctors start `PENDING`), sign in, refresh, logout. `AuthController`: `/api/auth/register|login|refresh|logout|me`.
- `AccessGuard` with `Capability`, replacing `requireAccessTo`. All 25 patient endpoints converted. `@EnableMethodSecurity` and `@PreAuthorize("@roles.any(...)")` on the new role-gated controllers.
- `PatientAccessService`: patient creation with recorded guardian consent; doctor grants with expiry (1 to 365 days), revoke, replace.
- `AuditService`: append-only `audit_event`. Records every read or write of patient data by a caregiver, doctor or admin, every refused attempt, every grant and revoke, sign-ins and failures. A tablet's routine reads are not recorded.
- `AdminService`, `AdminBootstrap` (first admin from `ADMIN_EMAIL` and `ADMIN_PASSWORD`, once), `PasswordPolicy`, `AttemptLimiter`, `ApiExceptionHandler`.
- `DemoDataSeeder` creates three demo accounts (`rupa@example.com` caregiver, `meera.das@example.com` doctor with a one-year grant, `admin@example.com` admin; all with the password `smaran`) and a consent record. It runs only in `dev` and `demo`, and refuses to run beside `prod`.

**Frontend**

- Access token in memory; silent renewal from the cookie, one at a time (refresh tokens are single use).
- `AuthProvider`, `RequireRole`, and screens: sign in, register, add a patient (with the consent step), doctor home, admin home, a "Who can see her / who has looked" panel.
- The doctor dashboard is read-only, shows "shared until", and hides tablet pairing and sharing. The PDF is fetched with the token (a plain link cannot send it).

### Commands and results

```
cd backend
mvn -o verify -Dsmaran.build.dir=C:/Users/amees/smaran-build   → BUILD SUCCESS

Unit tests: 74, 0 failures
  incl. PasswordPolicyTest 4, AttemptLimiterTest 3, AdminBootstrapTest 5
Integration tests (PostgreSQL 16, embedded process): 283, 0 failures
  AuthorizationMatrixIT  241   every endpoint as every caller
  AuthFlowIT              18   registration, sign-in, lockout, refresh rotation and reuse, tampering
  GrantsAndAuditIT        11   consent, grants, expiry, doctor read-only, audit
  SchemaAndIngestionIT    11
  DemoSeedIT               2
```

```
cd frontend
npx tsc -b && npx tsc -p tsconfig.test.json   → clean
npm test                                       → 4 files, 63 tests passed (13 new, in api.test.ts)
npm run build                                  → exit 0
```

**The matrix can fail.** The caregiver ownership check in `AccessGuard` was deliberately replaced with `true`. The matrix then failed with named cases, for example `POST /api/patients/{p}/pairing-codes as OTHER_CAREGIVER ==> expected: <404> but was: <200>`. The change was reverted.

**Browser, end to end.** `e2e/phase2_ui_flow.py` drives headless Chrome against the real backend (demo profile, authentication on, PostgreSQL) and the Vite dev server: **37 of 37 checks passed.** It covers sign in, reload staying signed in, no token in storage, sign out, registration with a weak and a common password, adding a patient (button disabled until consent), sharing with a doctor and with a stranger, the doctor's read-only view, being turned away from other areas, revoking, the doctor losing access, doctor registration waiting for approval, and the admin approving. It is a Windows-only developer script; Phase 7 replaces it with Playwright.

### Defects found by the tests and fixed in this phase

1. An admin asking for a patient that does not exist caused a database foreign-key error (500). It is now a 404.
2. `POST /api/session` and the batch sync crashed with a 500 when `startedAt` or `gameType` was missing. The first returns 400; the second skips the row.
3. Spring hid every error message, so "use at least 10 characters" never reached a person. `ApiExceptionHandler` passes through the reason of deliberate status errors only.
4. The sign-up limit counted attempts that failed validation, so mistyping a few times locked someone out for an hour.
5. While the sharing list was loading, the panel said "No doctor can see her right now". That is false until known; it now shows a loading line, and a failed load shows an error.

### Done-when, checked

| Criterion | Result |
|---|---|
| The matrix test passes | Yes, 241 of 241 |
| A stolen or tampered token fails | Yes: altered payload, damaged signature, `alg=none`, a different secret, an expired token and garbage all give 401 |
| The frontend cannot reach data its role should not see by editing client code | Yes by construction: the server decides; confirmed for doctor, other-caregiver and tablet tokens against every endpoint |

### Not done in Phase 2

- Item 9's "validation on every request body" is not done. I added checks where the matrix found a crash (sessions, sync) and the account and patient forms. Jakarta Validation across all DTOs is left for Phase 4, when the session payload changes anyway.
- Security headers (CSP, HSTS, frame options): not done. They belong with the Caddy and nginx work in Phase 6.
- Request size limits: only the existing multipart limit.
- The caregiver `Setup` screen (on-tablet setup) still calls caregiver endpoints with the tablet's token. In `dev` this works; elsewhere the server correctly refuses it. Phase 3 replaces it.
- The tablet's token is still a signed JWT with role `PATIENT`. Phase 3 makes it an opaque `DEVICE` token.

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

## Found in Phase 2

19. **A disabled account's access token works for up to 15 minutes.** Its refresh tokens are revoked at once, but there is no per-request status check. A cached check (as for tablets) would close it.
20. **Registration answers 409 for an existing email**, so it can be used to test whether an email has an account. The sign-up limit slows it; it does not stop it.
21. **Account lockout can be used to keep a known email from signing in.** Mitigated by the per-address limit; not eliminated.
22. **Two browser tabs refreshing at the same moment can sign the person out.** Refreshes are serialised inside one tab, but not across tabs, and a reused refresh token is treated as theft.
23. **Limiters are in memory and per node.** A restart clears them and two servers do not share them.
24. **A doctor can see the family members' names and phases** (the dashboard payload carries them). The prompt says a doctor sees a read-only subset without family media; the dashboard needs a doctor variant. Phase 4 rebuilds the dashboard.
25. **The audit list on the dashboard says "looked at" without saying at what.** The stored record has the path; the screen does not show it yet.
26. **CSRF protection relies on `SameSite=Strict` and on the access token being a header.** There is no CSRF token. Safe for current browsers; worth a note in a security review.
27. **Embedded PostgreSQL is fragile when its process is killed** (a stale `postmaster.pid`), and **`mvn` collides with OneDrive and the VS Code Java extension on `backend/target`.** Use `-Dsmaran.build.dir` and `-Dsmaran.local.pg.dir` outside OneDrive.
28. **The 404 for "no approved doctor with that email" lets any caregiver test whether a doctor account exists.** It is the price of sharing by email.


## Files left untracked on purpose

`.claude/`, `Claude outputs/` and `froggie-with-cognitive.tgz` are in the
working folder and not in git. They are not ignored either; decide whether to
keep them out or commit them.
