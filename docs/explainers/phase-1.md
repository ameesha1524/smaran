# Phase 1 explained — database, contracts, one scoring engine

Phase 1 gave the project three foundations: a real database with a versioned
schema, one written contract for what a game session looks like, and one
scoring engine that exists in TypeScript and Java and is proven to give the
same numbers in both.

All data in this repository is synthetic. Nothing here says anything about
clinical validity; the tests prove the arithmetic is consistent, not that the
scores mean anything about a person.

## What changed, and why

### 1. One scoring engine

| Before | After |
|---|---|
| One moving average on a 0–1 scale, with no notion of "is this unusual for her?" | An engine on a 0–100 scale that tracks, per domain: a level, a personal baseline, a velocity, a status and whether to alert |
| The server quietly cut the affective score by 10% for an eased session; the tablet did not | Removed. The engine is the only thing that moves a level, on both sides |
| New profiles started at 0.6 (affective 0.7) | Every domain starts at 50 and earns its level |

The rules, for each new score in a domain:

1. **Level** moves toward the new score by `0.25 × confidence`. A full-confidence
   session moves it a quarter of the way.
2. **Baseline** is the average of her previous scores in that domain (up to 30).
3. **Velocity** is how far today's score is from that baseline, measured in
   standard deviations. This is a z-score against her own history.
4. **Status** comes from velocity: `decline` at −1.5 or lower, `watch` at −0.8
   or lower, `improving` at +1.0 or higher, otherwise `stable`.
5. **Confidence gating:** until a domain has 5 sessions, status is always
   `stable` and nothing alerts. Too little data to judge.
6. **Alerts** are a separate question from status. Three rules are built in:
   two low readings in a row (the default), a single low reading, or CUSUM,
   which adds up small declines until they cross a threshold.

The existing 0–1 `domainScores` still exist, for routing and the current
dashboard. They are now a view: the engine's level divided by 100.

### 2. Golden vectors

`golden-vectors.json` holds 16 fixed input sequences and the exact output the
TypeScript engine gives for each. The Java engine replays every one and must
match to 9 decimal places. Phase 5's Python port will do the same.

Change the rules in one language and its own tests still pass, but the other
language's tests fail until it is changed to match. That is the point.

### 3. The shared contract

`SessionEnvelope`, `ScoreContribution`, the six domain ids and the six
sub-signal ids are defined in TypeScript and as Java records. The same JSON
file lists them, and a test on each side fails if its copy differs.

### 4. PostgreSQL and Flyway

| Before | After |
|---|---|
| H2, an in-memory stand-in, in the only profile that ran | PostgreSQL 16 everywhere |
| Hibernate created tables at start-up | Flyway migrations are the only source of the schema; Hibernate only checks the entities match and refuses to start if not |
| No foreign keys | Every patient-owned table references the patient |
| Profiles: default and `dev` | `dev` (seeded, auth off), `demo` (seeded, auth on), `test`, `prod` |

Two migrations exist. `V1` is the schema the app already had. `V2` adds the
tables later phases need (accounts, grants, audit log, devices, snapshots,
alerts, journal signals, voice notes).

### 5. Running without Docker

Docker is not installed on the development machine. Tests and local runs use
the same PostgreSQL 16 started as an ordinary process. With Docker present,
tests use a container instead; CI does this.

### 6. Start-up safety

Outside `dev`, `demo` and `test`, the backend refuses to start if the JWT
secret is missing, shorter than 32 bytes, one of the values written in this
repository, or if the API is set to open.

## How to demo it in 60 seconds

```
cd frontend && npm test          # 50 tests, including the golden vectors
cd ../backend && mvn verify      # 62 unit tests + 11 on a real PostgreSQL
```

Then open `golden-vectors.json`, find the case `two-consecutive-decline`, and
show the last four readings: the first low one says `decline` with no alert,
the second raises it.

To see drift caught: change `0.25` to `0.3` in
`frontend/src/lib/scoring/types.ts` and run `npm test`. It fails, naming the
golden file.

## Five likely interview questions

**1. Why implement the same engine twice? Isn't that a maintenance problem?**
The tablet must score offline and instantly; the server must be the authority
for the dashboard. Two copies are unavoidable, so the risk is drift. The
golden-vector file removes that risk: 16 cases, replayed by both, compared to
9 decimal places. A change on one side fails the other's build.

**2. What is velocity, and why not just alert when the score is low?**
Velocity is today's score minus her own recent average, divided by her own
spread. A person who always scores 40 is not declining; a person who drops
from 80 to 60 is. A fixed threshold flags the first and misses the second.
Whether that holds up is exactly what Phase 5 measures on simulated patients.

**3. Why does the baseline exclude today's score?**
If today's score were part of the average it is compared against, a sudden
drop would pull the average down and hide part of itself. The baseline is
"trailing": only what came before.

**4. What does Flyway give you over letting Hibernate create tables?**
A reviewable history of every schema change, the same schema in every
environment, and no surprise changes at start-up. Hibernate's auto-update can
add columns but never renames or removes them safely, and nobody sees what it
did. With `validate`, a mismatch between code and database stops the
application instead of corrupting data.

**5. You have no Docker. How do you know it works on Postgres?**
The integration tests start the whole application against a real PostgreSQL
16 process, apply both migrations to an empty database, and submit sessions
through the real service. One test asserts the server version string starts
with "PostgreSQL 16". The earlier 30-check end-to-end script was also rerun
against it with authentication on, and passed 30 of 30.

## Honest limitations

- **The thresholds are noisy by construction.** `watch` fires at −0.8 standard
  deviations. For a perfectly stable person with normally distributed scores,
  about one session in five lands there by chance. The golden cases show this:
  ordinary noise produces occasional `watch` readings. The two-in-a-row rule
  reduces false alerts but does not remove them. Phase 5 measures the rate.
- **The SD floor of 3 is my addition.** The specification did not say what
  happens when every recent score is identical (SD of 0, division by zero).
  A floor of 3 points is an engineering guard, not a derived number.
- **CUSUM's watch level (half the threshold) is also my choice.** The
  specification names `k` and `h` only.
- **Sessions still travel in the old shape.** The `SessionEnvelope` contract
  is defined and tested, but the tablet still sends 0–1 readings. Phase 4
  moves the wire format over.
- **Sub-signals are supported by the engine and used by no game yet.**
- **The `V2` tables are a first design.** No code uses them yet. Later phases
  will adjust them with further migrations.
- **Nothing that needs Docker was run:** not `docker compose`, not the
  Dockerfiles, not Testcontainers. The CI workflow is written and has not run.
- **In the browser I loaded pages; I did not play a game through.** The pond,
  the games menu, a game's start screen and the dashboard load against the
  new backend with no console errors.
- **The demo profile's numbers moved.** The seeded history now goes through
  the engine instead of being skipped, and new profiles start at 50, so demo
  levels differ from before.
- **14 known dependency vulnerabilities** in the frontend toolchain remain.
