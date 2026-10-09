# Adding a game

A game plugs into Smaran in four places. None of them is a controller, a migration
or a dashboard. This page follows the real example: Duck Roll Call.

## What a game owes the rest of the system

When she finishes, a game hands `completeSession` a **draft**:

```ts
{
  gameType: 'DUCK_ROLL_CALL',
  startedAt, durationMs, completionRate, difficultyTier, cognitiveLoadScore, moodAtStart,
  completed, abandoned,           // did she finish, or leave in the middle of a round
  trials: [ ...one entry per round, in the game's own shape... ],
}
```

The pipeline (`lib/sessionPipeline.ts`) then:

1. asks the game's **module** to score the trials into contributions,
2. folds the contributions into her local profile with the scoring engine, once,
3. builds a `SessionEnvelope` and queues it,
4. sends it to `/api/device/sessions` (or, after being offline, `/api/device/sessions/batch`).

The server checks the envelope, stores the raw trials, folds the same contributions into her
profile, writes a snapshot, raises or ends alerts, and tells any open dashboard.

## The four places

### 1. The module: `frontend/src/games/modules/yourGame.ts`

```ts
export const yourGame: GameModule = {
  id: 'your-game',                 // lower-case slug; also the route /game/your-game
  gameType: 'YOUR_GAME',           // the enum name
  title: 'Your Game',              // what the dashboards call it
  route: '/game/your-game',
  primaryDomains: ['LANGUAGE'],
  targets: ['LANGUAGE', 'SUSTAINED_ATTENTION'],   // everything it may ever say; the server refuses any other
  scoreSession: (trials, ctx) => [ { target, raw, confidence, because } ],
  markers: (trials) => ({ workingMemorySpan: 4 }),  // optional
}
```

Rules for `scoreSession`:

- **`raw`** is 0 to 100 for this sitting only. **`confidence`** is 0 to 1 and comes from how many trials there were
  (`trialConfidence(trials, full)` in `modules/helpers.ts`). A short or abandoned sitting scores low and moves the level less.
- **`because`** is one plain sentence a family member can read, with the numbers in it. It is shown on the dashboard.
- A secondary signal is trusted less than the primary one: 0.5 to 0.7 of its confidence (`SECONDARY`).
- Take junk without throwing. Trials come from a game; skip what is not well-formed, return `[]` for nothing.
- Say what the score cannot tell in the file's comment. Each module does.

A game that keeps no round-by-round record can still be read from how much she did, at low confidence: the pipeline
does this automatically and the contribution says so in its own words. Every game should send trials instead.

### 2. The registry line: `frontend/src/games/registry.ts`

One line in `GAME_MODULES`.

### 3. The server's registry: `backend/src/main/resources/game-registry.json`

The same id, title, route, domains and targets. The server accepts a session only for a game listed here, and only with
contributions to the targets listed for it. A test on each side (`modules.test.ts` and `GameRegistryTest`) fails if the two copies
differ.

### 4. The enum: `Enums.GameType` in the backend

One value. Sessions are stored with it. There is deliberately no database constraint on it, so this needs no migration.

## What you do not touch

- **No dashboard change.** Titles and domains reach the dashboards from the server's registry, and a session appears in the
  sessions list with its reasons.
- **No controller or endpoint.** Every game goes through the same two.
- **No migration.** Trials are stored as JSON.

## Checking it

- Unit-test the module the way `games/modules/modules.test.ts` does: hand-worked numbers, and the property test that
  every module passes (never throws on junk, only says what it is allowed to say).
- If the server can score the game from its raw trials, write the Java twin and add it to `Rescorer` (one `case`). Then
  put the rules in a Python script that writes shared vectors, as `scripts/make_duck_vectors.py` does, and test both
  implementations against that file. The server then re-scores every session of the game, marks the ones it agrees with
  `scoring_trust = server`, and counts the ones it cannot reproduce in `scoring_mismatch_total`.
- Play it. `e2e/phase4_games_flow.py` plays Duck Roll Call through its real screen and is the pattern to copy.

## Two things a new game should decide early

- **What a trial is.** Record it at the finest grain that is still honest, in the game's own words. The scores can be
  changed later; trials you did not record cannot be.
- **What it cannot tell.** If a score is a weak proxy (Family Grove's AFFECTIVE line is recognition, not mood), weight it as
  one and say so in `because`.
