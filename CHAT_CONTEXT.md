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

Root routing lives in `frontend/src/App.tsx`. State/gating lives in
`frontend/src/state/SmaranContext.tsx`.

**Patient side** (`/`), three one-time gates in order, each checked via
context state:
1. `/language` → `LanguageChoice` — shown if `languageChosen` is false.
2. `/login` → `PatientLogin` — shown if not yet `registered`.
3. `/welcome` → `Onboarding` — shown if not yet `onboarded`.
4. Once past all three: `Home` — the pixel-art pond scene. Gates a mood
   check-in itself (`needsCheckIn = moodToday === null`) before showing pond
   content.

From Home, four game routes branch off (selection logic via
`deriveGameRoute(profile, moodToday)`):
- `/game/weavers-loom` — WeaversLoom
- `/game/grandmothers-tale` — GrandmothersTale
- `/game/family-grove` — FamilyGrove
- `/game/morning-rituals` — MorningRituals

**Caregiver side**, separate namespace:
- `/caregiver` — Login
- `/caregiver/dashboard` — Dashboard
- `/caregiver/setup` — Setup

Unmatched routes redirect to `/` (the pond), never a 404.

**Known inconsistency, not yet resolved:** only `Home` has been rebuilt in
the new pixel-art style. `LanguageChoice`, `PatientLogin`, `Onboarding`, the
four game screens, and the caregiver screens still use the old vector
"Sanctuary" scene. Also: the six-language button row appears in the reference
bundle's Home template, but the project earlier had a standing instruction to
hide the language selector permanently after first choice, so it was removed
from Home — this discrepancy between the reference art and that instruction
was noticed but never raised with the user.

**Explicit next task from the user:** "work on the app flow." Not yet scoped
— no specifics given yet on what should change (e.g. extend pixel-art style
to other screens, rework gating order, change game-selection logic, etc.).
Needs clarifying questions when resumed.

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

## Open threads / pending items (not started, not scoped)

- **"Work on the app flow"** — the explicit next task, entirely unscoped as
  of this writing. Needs a scoping conversation: what about the flow needs
  work? Candidates based on known gaps below, but none confirmed:
  - Extending the pixel-art treatment to LanguageChoice, Login, Onboarding,
    the four game screens, and/or the caregiver screens (currently all still
    on the old vector "Sanctuary" scene).
  - Reconciling the language-selector-on-Home discrepancy noted above.
  - No Settings screen exists yet.
  - No dynamic time-of-day/sky system (pond is currently always night).
  - RBAC backend implementation status unknown/unverified this session.
- Whether to keep or delete the now-orphaned `pixelScenery.tsx` — leaning
  toward keep, pending user direction.
