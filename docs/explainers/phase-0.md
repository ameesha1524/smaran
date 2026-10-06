# Phase 0 explained — recon, baseline and plan

Phase 0 wrote no feature code. It answered three questions: what is really in
the repo, does it build and pass its tests today, and what will each later
phase change. The answers are in `docs/PLAN.md` and `docs/PROGRESS.md`.

## What changed, and why

| Change | Why |
|---|---|
| `docs/PLAN.md` | A map of the code as it is, the mismatches with the master prompt, and the files each phase will touch. |
| `docs/PROGRESS.md` | The running log. Every new session starts by reading it. |
| `docs/SMARAN_MASTER_PROMPT.md` renamed to `docs/MASTER_PROMPT.md` | The prompt itself says to save it under that name, and every later session is told to read that path. |
| `package-lock.json` is now tracked | It was git-ignored, so `npm ci` failed on a fresh clone and would fail in CI. A lockfile pins exact dependency versions, so everyone builds the same thing. |
| `backend/target/` and `tsconfig.tsbuildinfo` untracked | They are build output. 121 compiled files were being committed, so every build showed up as a change. |
| `.gitignore` tightened | Ignores build output, every `.env` file except the example, key files, uploaded media and Python caches. |
| `.env.example` | Lists every environment variable the code reads, with no real values. |
| `Makefile` | One name per common task. `demo`, `ds` and `e2e` exist as names and fail with a clear message until they are built. |
| The earlier uncommitted work was committed on its own | It unified scoring and added pairing. Keeping it as one commit means it can be reviewed, or reverted, as one unit. |

## How to demo it in 60 seconds

1. Open `docs/PLAN.md` and show section 5, the table of mismatches between the
   prompt and the code.
2. Run the baseline:
   ```
   cd frontend && npm ci && npx tsc -b && npm run build
   cd ../backend && mvn test
   ```
3. Show `docs/PROGRESS.md` with the real output of those commands.

## Five likely interview questions

**1. Why start with a plan instead of code?**
The written brief and the repo had drifted apart. The brief said to build a
game and a pairing flow that already existed, and to keep a function that had
already been removed. Building straight from the brief would have duplicated
or undone working code. Reading first cost a session and saved that.

**2. What is a "green baseline" and why does it matter?**
It means the project installs, type-checks, builds and passes its tests before
any change. If something breaks later, I know my change caused it. Here that
was a clean `npm ci`, `tsc -b`, `vite build` and 32 passing backend tests.

**3. Why commit a lockfile? Isn't `package.json` enough?**
`package.json` gives version ranges such as `^5.4.8`. The lockfile records the
exact versions that were installed. Without it, two machines can install
different versions from the same `package.json`, and `npm ci`, which CI uses,
refuses to run at all.

**4. What was the most important thing the recon found?**
Two things. Auth exists on the server but the only runnable profile switches
it off. And three of the six games always report a completion rate of exactly
1, so their lines on the dashboard carry no measurement. Neither is visible
from the README.

**5. The plan disagrees with the brief in places. Who wins?**
The brief sets the goals. Where it describes code that no longer exists, the
plan records the mismatch and picks a default that still meets the goal. Four
of those are flagged for a human decision in section 2 of the plan.

## Honest limitations

- **Nothing was run in a browser** in this phase. The baseline is install,
  type-check, build and unit tests.
- **Docker is not installed on this machine.** Nothing that needs Postgres or
  a container has been run here, and it cannot be until Docker is installed.
- **The backend has 32 unit tests and no integration tests.** No test starts
  the application, calls an endpoint or checks a permission.
- **The frontend has no tests at all.**
- **The plan's file lists are forecasts.** They will change as each phase meets
  the code.
