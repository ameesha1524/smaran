# Smaran — Session Context

Snapshot of this chat's state, for picking up work in a different conversation
and coming back later. Written 2026-09-24.

## What Smaran is

A dementia-care companion app for elderly patients in North East India.
- Frontend: React 18 + Vite + TypeScript + Tailwind, PWA. Lives in `frontend/`.
- Backend: Spring Boot 3 / Java 21.
- No Flutter, despite what old docs might imply.
- Patient-facing UI is in six regional languages (English, অসমীয়া, মৈতৈলোন্,
  Mizo tawng, हिन्दी, Nagamese) and leans on gentle, non-clinical language
  ("the pond", "the soil is resting", "tap the stone to hear me").

## Current app flow

Reworked 2026-09-24. Root routing lives in `frontend/src/App.tsx`. State
lives in `frontend/src/state/SmaranContext.tsx`.

**Patient side** (`/`), two one-time gates, and neither belongs to the
patient for long:
1. `/caregiver/setup` — if `caregiverSetupComplete` is false. The caregiver
   presses "Hand it to her" in the Setup header, which sets the flag.
2. `/language` → `LanguageChoice` — if `languageConfirmed` is false.
3. Otherwise always `Home`. No login, no onboarding screen, no mood gate.

`LanguageChoice` is now a **confirmation**, not a selection: it greets her in
the language the caregiver already set and offers "Yes, this is my language"
plus a smaller "Change language" that reveals the original six-flower picker.
Retires permanently once answered.

**Patient login is gone.** `screens/Login.tsx` is orphaned — its body is
line-commented out (it called the removed `register()`), header note on line 1.

**Onboarding is now silent.** `screens/Onboarding.tsx` is likewise orphaned
and commented out. What used to be a five-step arrival screen is now the
first two sessions, handled inside `deriveGameRoute`:
- `sessionCount === 0` → Duck Roll Call only, tier 1 (reads working-memory
  span, tap accuracy, hesitation)
- `sessionCount === 1` → Family Grove only, phase 1 (reads affect)
- `sessionCount >= 2` → the full routing rules take over

`sessionCount` lives in context, increments in `completeSession`, persists to
localStorage.

**Games are behind one door (2026-09-25).** Home no longer carries a card per
game. It has a single button ("Today's quiet things") that opens `/games`
(`screens/GamesMenu.tsx`), which lists every game in a fixed order:
Duck Roll Call, Grandmother's Tale, Family Grove, Morning Rituals, The Lotus
Frog. `deriveGameRoute()` still runs — it still sets difficulty, tap size and
ambient tone for whichever game is picked — but it no longer decides which
cards exist; `route.games[0]` only earns a small "suggested today" tag in the
menu. Each individual game's own back button still returns to the pond (`/`),
except Duck Roll Call's, which returns to `/games`.

Game routes: `/game/duck-roll-call`, `/game/grandmothers-tale`,
`/game/family-grove`, `/game/morning-rituals`, `/game/lotus-frog`.

**The Weaver's Loom is retired.** `WEAVERS_LOOM` was removed from the
`GameType` union, its route and every map keyed on it. `games/WeaversLoom.tsx`
is orphaned (body commented out, header note) per the project convention. Its
one shared export, `Progress`, moved to `components/GameShell.tsx`.
`DOMAIN_GAMES.visualSemantic` now points at `LOTUS_FROG`, the only remaining
game that reads that domain — so nothing exercises visualSemantic *except* the
frog, worth knowing before anyone wonders why that domain moves slowly.

**Domain 6 — Executive Function & Working Memory.** `executiveFunction` added
to `DomainScores` (types, `emptyProfile`, `buildProfileV1`, dashboard trend
line + `DashboardSummary.domainTrend`, sample data). Duck Roll Call feeds it
through the ordinary single-domain EMA in `updateProfile()` — unlike the frog,
which owns a bespoke four-domain update. The Java `CognitiveProfile` mirror has
NOT been updated; the comment atop `cognitiveProfile.ts` says the two must not
drift.

### Duck Roll Call (`games/DuckRollCall.tsx`)

Visuospatial working-memory span. All ducklings flash a number at once, the
numbers vanish, she taps them back in ascending order. Locked design decisions:
parallel (not sequential) encoding; **deliberately not audio-based** (no
`speak()`, no sound on the numbers — so the reading is not confounded by
language fluency or hearing); no visible timer in recall; a wrong tap shakes
the duckling once and simply doesn't count; **a round has no hard failure** —
she retries the same position until it lands, and `wasCorrect` only means
"no retries needed".

Difficulty: span 3→6 (capped at the six ducklings) and flash 2000ms→800ms,
one lever at a time (two clean rounds raises span first; timing only tightens
once span is 6; two rough rounds ease exactly one lever back). Span, flash
and a 60-round history persist in localStorage
(`smaran.duckRollCall.span|flashMs|history`). `breakdownSpan` (span at which
rolling-window accuracy first drops below 70%, needs 3+ rounds at that span) is
the single longitudinal number; it is computed from the history and shown in
the DEV-only panel, but is **not yet sent anywhere** — no backend endpoint and
no dashboard chart consume it.

Errorless mode is `profile.anxietyThreshold <= 0.5` (the 0.5 cutoff is a
judgment call; thresholds range 0.35–0.85 and lower means easier-to-overload):
after one wrong tap the correct duckling gets a faint hint arrow.

One `completeSession()` call per *sitting* (on leaving), aggregating that
visit's rounds; nothing is recorded if no round was finished. The onboarding
route now uses Duck Roll Call for session one (was the Weaver's Loom).

**Reference fidelity.** The scene was built from a design export
(`Downloads/Game — Duck Roll Call (pixel, playable)-html/`). Its pond is a
**144×81** image on a **10px** grid — a different grid from the Home pond's
360×203/4px. Committed assets in `frontend/public/`:
- `duck-pond.png` — the reference pond, byte-identical except the two corner
  lotuses were painted out (803 of 11,664 art pixels, all at y≥62, verified).
- `duck-lilies.png` — 1440×810 transparent layer of the *implementation's own*
  lily art (cut from `pond-pixel.png`), in three depth tiers: two large
  corner-cropped foreground lotuses, medium edge-framing ones, small far ones.
  Live render measures 98–99% identical to the reference over sky, moon,
  bamboo, grass and shoreline (the rest is sub-pixel seams from the stage's
  non-integer scale).
The scripts that produced them were scratchpad-only and are not in the repo; to
regenerate, re-derive from the reference PNG + `pond-pixel.png`.

All game CSS for this screen is `drc-` prefixed on purpose: `scenes/pond.css`
already defines a bare `.bob`, and the reference's own generic class names
(`.bob .halo .hint .shake .duck`) would have collided.

**New patient routes:**
- `/journal` → `screens/Journal.tsx`
- `/preview-home` → `Home`, permanent now (bypasses gates for headless
  screenshots; no longer temporary scaffolding to revert)

**Caregiver side**, unchanged namespace: `/caregiver`, `/caregiver/dashboard`,
`/caregiver/setup`.

Unmatched routes redirect to `/` (the pond), never a 404.

### Pond overlays (`components/PondOverlays.tsx`)

Three non-blocking additions composed into `Home.tsx`, not into the SVG —
they need DOM for audio playback and navigation, and Home was already the
established place for stage-coordinate DOM overlays:
- `MoodDrift` — three emoji fade in after 3s if `moodToday === null`, fade
  out after 10 more. No retry, no penalty, never appears if mood is set.
- `JournalButton` — bottom-left, localised "Today", gold dot when an unheard
  caregiver voice note exists.
- `VoiceNoteCard` — "morning dew"; plays inline via HTML5 audio and marks the
  note listened on play. Only renders when an unheard note exists.

### Context shape (changed)

Removed: `registered`, `onboarded`, `languageChosen`, `needsCheckIn`,
`register()`, `chooseLanguage()`.
Added: `caregiverSetupComplete`, `languageConfirmed`, `sessionCount`,
`motorTier` (mirrors `profile.motorTier`, single source of truth),
`journalEntries`, `caregiverVoiceNotes`, `completeCaregiverSetup()`,
`confirmLanguage()`, `addJournalEntry()`, `markVoiceNoteListened()`.
`moodToday` kept but no longer a gate.

**Known inconsistency, not yet resolved:** only `Home`, `LanguageChoice` and
`Journal` use the pixel-art style. The four game screens and the caregiver
screens still use the old vector "Sanctuary" scene.

## Pixel-art pond (Home) — how it's built, and how it just changed

Two-layer architecture in `frontend/src/scenes/`:
- **`PixelPond.tsx`** — the outer component. SVG stage, `viewBox="0 0 360
  203"`, scaled 4x on screen (`STAGE_W=1440`, `SRC_H*4=812`). Renders the
  static background, then an overlay of everything that moves: koi (2 of
  them, mirrored), a mother duck + 6 ducklings, 3 dragonflies, ~28 hand-placed
  fireflies ("jugnus"), 10 moonlight glints on the water. Sprite positions are
  hand-placed/hardcoded in source-pixel coordinates against the 360×203 grid.
- **`pixelScenery.tsx`** — previously the static background layer (sky, moon,
  hills, bamboo, vegetation, rock shoreline, water bands, lily pads, lotuses),
  all procedurally generated via seeded PRNG + hand-built pixel-run helpers
  (`runs()`, `padRuns()`, `petalRuns()`, `lotusLayers()`, Bayer-dithered glow,
  etc.). **As of this session, this file is no longer used** — see below.

### What changed this session

The user pasted a full **bundler-format artifact** (a self-contained HTML
export from the platform's own tooling) containing the *actual* reference PNG
as a literal embedded base64 asset in a `<script type="__bundler/manifest">`
tag — not just a screenshot. Saved on disk at:
`C:\Users\amees\OneDrive\Desktop\Smaran\Smaran Sanctuary — art direction – Landing — pixel art version.html`
(also `Landing — pixel art version@2x.png` sits alongside it in the same
folder).

Used the pre-built script
`extract_pixel_png.py` (parses the manifest, base64-decodes, writes to disk —
avoids ever hand-transcribing large base64 through a tool call, which
previously caused silent corruption / token-limit failures) to extract the
asset losslessly to:

**`frontend/public/pond-pixel.png`** — 360×203 RGB, 19,796 bytes, verified
with PIL (`.verify()` + dimension check). This is the literal reference
artwork, pixel-for-pixel.

Then edited `PixelPond.tsx`:
- Removed `import PixelScenery from './pixelScenery'`.
- Replaced `<PixelScenery />` with:
  ```tsx
  <image
    href="/pond-pixel.png"
    x={0}
    y={0}
    width={SRC_W}
    height={SRC_H}
    style={{ imageRendering: 'pixelated' }}
  />
  ```
  Since the SVG viewBox was already `0 0 360 203` (matching the PNG's native
  size) and all sprite coordinates were already tuned to that same grid, no
  other coordinates needed to change.

Verified via headless Chrome screenshot (see workflow below) — pond now
matches the reference exactly, since it *is* the reference image, with sprites
correctly overlaid on top.

**`frontend/src/scenes/pixelScenery.tsx` is now an orphaned file** — nothing
imports it. Left in place deliberately (not deleted) per the project's
pattern of not removing orphaned files without being asked. It contains a lot
of genuinely good procedural-art code (lotus/pad/vegetation generation,
Bayer dithering, seeded scatter) that could be useful again if the user ever
wants a *generative* variant (e.g. a different time of day, a different
season, procedurally varied ponds) rather than the fixed reference bitmap.
Ask before deleting.

## Headless screenshot verification workflow

Used repeatedly through this project to visually check the pond without the
user needing to open a browser themselves:

1. Ensure Vite dev server is running on port 5175 (`npm run dev -- --port
   5175` from `frontend/`, checked first via `netstat`).
2. Temporarily add a bypass route in `App.tsx`:
   ```tsx
   <Route path="/preview-home" element={<Home />} />
   ```
3. Temporarily default the mood check-in in `SmaranContext.tsx`:
   ```tsx
   const [moodToday, setMoodToday] = useState<MoodKey | null>('PEACEFUL')
   ```
4. Screenshot with headless Chrome:
   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new \
     --disable-features=WebAppInstallation \
     --screenshot="<scratchpad>\pond_check.png" \
     --window-size=2000,1125 \
     http://localhost:5175/preview-home
   ```
   (`--disable-features=WebAppInstallation` suppresses a noisy but harmless
   stderr install-prompt error. Do NOT pass
   `--default-background-color=0` — it errors; omit it or use a real hex
   value.)
5. Read the resulting PNG with the Read tool to visually inspect.
6. **Always revert steps 2 and 3 immediately after** — both are
   verification-only scaffolding, never meant to ship.

## Hard-won lessons / standing constraints for this project

- **Never hand-transcribe large base64/binary blobs through a tool call.** A
  single dropped or swapped character silently corrupts the asset with no
  visible error, and very long ones have previously hit output token limits
  outright. Always look for a way to extract/copy the asset programmatically
  from an on-disk file instead (e.g. `extract_pixel_png.py`). If the user
  pastes something as chat text that contains embedded binary data, ask them
  to save it as a real file first.
- **Pixel-art rendering discipline:** `image-rendering: pixelated` (or
  `imageRendering: 'pixelated'` in React style objects), `shapeRendering:
  "crispEdges"` on SVGs, `steps(n)` CSS timing for any animation, and always
  scale uniformly (one scale factor for both axes) — a non-uniform stretch
  breaks the pixel grid and is the one thing this art style can't survive.
- **Two-layer scene architecture** (static background + thin animated
  overlay) is the established pattern for any pixel-art scene in this app —
  keeps repaint cost low and mirrors how original pixel artists worked in
  layers. Follow it for any other screen brought into this style.
- **Deterministic seeded PRNG** for any procedural scatter (vegetation,
  rocks, ripples) — reproducible across renders/machines. See `rng()` in the
  (now orphaned but reusable) `pixelScenery.tsx` if resurrecting procedural
  generation elsewhere.
- Don't delete orphaned files without being asked — leave them in place and
  flag them.
- The user iterates on visual fidelity by pasting reference images/bundles
  and screenshots side by side and asking for exact, sometimes pixel-exact,
  matches. When a real source asset is available (as opposed to only a
  screenshot), prefer using it directly over hand-coded approximation —
  approximation was explicitly deprioritized once a real asset became
  available this session.
- A design-direction brief was captured earlier via the `/design` skill: the
  user wants the visual style to read as "made by Indian artists," not
  "vibe-coded" — worth keeping in mind for any new screens or art brought
  into this style.

## Journal analysis — backend endpoint still needed

`frontend/src/lib/journalAnalysis.ts` POSTs to **`/api/journal/analyse`**,
which does not exist on the Spring Boot side yet. The frontend is written and
degrades safely: if the endpoint is missing or the device is offline,
`analyseJournalEntry()` returns null and the entry is still saved with
`sentimentSignals: null`.

**Deliberate architecture decision:** the Anthropic call is server-side, NOT
in the browser. A Vite bundle cannot hold a secret — an API key shipped to
the client is readable in devtools — and journal entries are a dementia
patient's private writing that should not go to a third party straight from
her tablet. Do not "simplify" this by calling Anthropic from the frontend.

Request body the frontend sends:
`{ text, patientId, languageCode, systemPrompt, model: 'claude-sonnet-5' }`

Expected response: `{ signals: SentimentSignals }` (a bare `SentimentSignals`
object also works — the client coerces either shape).

`SentimentSignals` (see `lib/types.ts`): `valence` -1..1, `arousal` 0..1,
`themes` string[], `concernFlags` subset of
CONFUSION/DISTRESS/LONELINESS/PAIN, `summary` string. The client clamps
ranges and filters unknown flags, so a slightly-off model response degrades
rather than corrupts.

The system prompt lives in `JOURNAL_SYSTEM_PROMPT` in that same file,
deliberately next to the type it must satisfy. **The user's original spec for
this prompt was truncated mid-sentence**, so the current prompt is written
from scratch and should be reviewed/replaced when they supply theirs.

## Open threads / pending items (not started, not scoped)

- **`/api/journal/analyse` backend endpoint** — see above. The only thing
  blocking journal sentiment from working end to end.
- **Journal entries are localStorage-only.** No backend sync yet; noted as
  "backend sync later" in the spec.
- **Duck Roll Call data goes nowhere yet.** Per-round history and
  `breakdownSpan` live only in localStorage — no backend session-history
  endpoint, no Domain-6 dashboard view beyond the EMA'd `executiveFunction`
  line. Java-side `GameType` enum and `CognitiveProfile` domain scores still
  need `DUCK_ROLL_CALL` / `executiveFunction` and the removal of
  `WEAVERS_LOOM`.
- **Caregiver voice notes have no producer.** `caregiverVoiceNotes` is read
  by the pond overlay but nothing writes to it yet — the caregiver Setup /
  Dashboard side needs a way to record and attach one.
- Extending pixel-art treatment to the four game screens and the caregiver
  screens (still on the old vector "Sanctuary" scene).
- No Settings screen exists yet.
- No dynamic time-of-day/sky system (pond is currently always night).
- RBAC backend implementation status unknown/unverified.
- Whether to keep or delete the now-orphaned `pixelScenery.tsx` — leaning
  toward keep, pending user direction. Same question now applies to the
  commented-out `screens/Login.tsx` and `screens/Onboarding.tsx`.
