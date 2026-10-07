# Smaran — Progress Log

Read this at the start of every session, after `docs/MASTER_PROMPT.md`.
All patient data in this repository is synthetic or demo data.

Last updated: 2026-10-06 (end of Phase 0).

## Phase status

| Phase | Status | Branch | Notes |
|---|---|---|---|
| 0. Recon, baseline, plan | **Done** | `phase-0-recon` | Plan in `docs/PLAN.md`; baseline green |
| 1. Foundation: database, contracts, scoring | Not started | | Blocked in part by Docker (see "Needs the human") |
| 2. Authentication and RBAC | Not started | | |
| 3. Device pairing | Not started | | A working version exists; it is reworked to spec |
| 4. Games to dashboards | Not started | | |
| 5. Data science | Not started | | |
| 6. DevOps | Not started | | |
| 7. Hardening and showcase | Not started | | |

**Next:** Phase 1, P0 item 2 onward (shared contract, scoring engine, golden
vectors), which needs no Docker. Item 1 (Postgres and Flyway) can be written
but not run on this machine until Docker is installed.

## Needs the human

| # | What | Why | Until then |
|---|---|---|---|
| H1 | **Install Docker Desktop** on this machine | Postgres, Testcontainers, the compose stack, `make demo` and the end-to-end job all need it | Those are written but unverified here; CI would be the first place they run |
| H2 | **Confirm or change the four defaults** in `docs/PLAN.md` section 2 (D1–D4) | They change what Phases 1 and 3 build | Work proceeds on the defaults |
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

## Known issues

Found during recon. Each is scheduled in `docs/PLAN.md`.

1. **Auth is off in the only runnable profile.** `dev` sets `open-demo: true`.
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
12. **No tests on the frontend; no integration or security tests on the backend.**
13. **The earlier end-to-end pairing script is not in the repo.** It lived in a scratch folder. Phase 2 and 3 replace it with tests that are.

## Files left untracked on purpose

`.claude/`, `Claude outputs/` and `froggie-with-cognitive.tgz` are in the
working folder and not in git. They are not ignored either; decide whether to
keep them out or commit them.
