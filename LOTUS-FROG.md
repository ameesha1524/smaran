# Lotus Frog — Architecture Analysis & Migration Status

Froggie (`github.com/MrinaliBhardwaj/froggie`) ported into Smaran as a
therapeutic activity with cognitive tracking. Written 2026-09-25.

## Phase 1 — Architecture analysis of Froggie

Upstream is ~5,000 lines of TypeScript across 47 files, **zero runtime
dependencies and zero binary assets**. Vite + `tsc` only. That property is why
the port was clean: there was nothing to bundle, license, or copy.

### Rendering pipeline

Two-stage, and the whole visual identity rests on it:

1. Everything draws into a **small internal backing store**. `Renderer`
   picks a virtual pixel size from the window height —
   `pixelSize = clamp(round(innerHeight / 232), 2, 6)` — then sets
   `canvas.width/height` to `innerSize / pixelSize`. At 900px tall that is a
   ~400×232 buffer.
2. CSS stretches that buffer to `100%/100%` with
   `imageSmoothingEnabled = false`, so the browser upscales nearest-neighbour.

Consequences worth knowing before touching it:
- Fill rate is tiny (~93k pixels/frame), which is why it runs on weak tablets.
- Context is created with `{ alpha: false }` — no per-frame compositing cost.
- **All art is procedural.** No spritesheets, no PNGs. `render/pixels.ts` and
  `render/color.ts` draw rectangles; `StaticLayer` pre-renders content that
  never changes. Nothing to migrate asset-wise.
- Coordinates are *virtual* pixels throughout, including input.

### Game loop

`Game` owns a `requestAnimationFrame` loop and delegates all content to
`Scene`. `Clock` produces a **clamped delta** (`maxDelta = 1/15s`): a
backgrounded tab resumes without teleporting the simulation forward. `World.t`
accumulates elapsed seconds and every oscillator reads from it, so animation is
time-based rather than frame-based — frame drops slow nothing down.

### Input system

`Input` listens to pointer events on the canvas, converts client coords into
internal pixel space via `getBoundingClientRect()` / scale, and pushes
**edge-triggered clicks into a queue** that `Scene` drains once per frame with
`takeClicks()`. Each `ClickEvent` carries `sincePrev` (ms since the previous
click anywhere), which is how double-tap → "big croak" is detected without a
separate gesture recogniser. `touchstart` is `preventDefault`ed so the page
cannot scroll or zoom under the canvas.

The drained-queue design is what made cognitive tracking easy to add: every
meaningful interaction already funnels through one place in `Scene.update()`.

### State management

One mutable **per-frame blackboard**, `World`: `t`, `dt`, `width`, `height`,
`ctx`, plus services (`rng`, `camera`) and a `progress` object
(`bugsResolved`, `lushness`). Systems read context from `World` instead of
threading parameters. There is no store, no event bus, and deliberately no
React state inside the loop — React only mounts the canvas.

`progress.lushness` (0..1) already drives flower bloom, firefly counts and
colour richness, and upstream comments flag it as the intended hook for a
progression system. **That is exactly the seam the Memory Garden feature
should use.**

### Scene graph & parallax

`Layer` is a named bucket of `SceneElement`s sharing a depth. `Scene` builds a
back-to-front stack; each layer translates by `-camera * parallax`, rounded to
whole virtual pixels so nothing shimmers sub-pixel. Elements expose optional
`update()` and an `alive` flag; dead ones are reaped each frame. Adding content
means dropping an element into a layer — no wiring.

### Animation system

`anim/` is a small toolkit, not a framework: `Tween`, `easing`, `math`
(`clamp`, `lerp`, `smoothstep`, `damp`), `noise`, `oscillate` (`bob`, `osc01`).
The frog is the only complex actor — a behaviour vocabulary (blink, look
around, croak, stretch, yawn, scratch, wave, doze) selected on gentle random
timers, with pose drawing separated into `FrogPose.ts` so `Frog.ts` is pure
behaviour.

### Physics

None, in the engine sense. No bodies, no solver. Motion is damped following
(`damp()`), tweened hops, and distance checks for bug hit-testing. This is a
deliberate simplification and it is why the game feels unhurried.

### Audio

`Ambience` synthesises **everything at runtime via Web Audio** — water lapping,
night wind, crickets, distant frogs, plus event sounds (splash, croak, gulp).
No audio files. Gated behind a user gesture (`installUnlock`), every call
wrapped so audio can never break the render loop, and it no-ops entirely if Web
Audio is missing. Press `m` to mute.

### Performance notes

- Small backing store + `alpha: false` + pixel snapping = cheap frames.
- No allocation in hot paths (`Input` returns a shared `EMPTY` array).
- Delta clamping prevents catch-up spirals.
- `StaticLayer` avoids redrawing unchanging scenery.

## Phases 2–3 — Migration status: COMPLETE

`frontend/src/games/lotus-frog/` contains **every upstream `src/` file**
(verified by tree diff against a fresh clone), plus the five cognitive files.

Deviations from upstream, all intentional:
- `main.ts` is stubbed — the standalone bootstrap is replaced by the React
  screen `frontend/src/games/LotusFrog.tsx`.
- `Game.ts` gained a 4th constructor param (`onSessionEnd`), session lifecycle
  flags, `endSession()` and `dispose()`.
- `Scene.ts` owns a `CognitiveTracker`, routes input to it, and exposes
  `beginSession()` / `endSession()`.
- `Bugs.ts` exposes `list()`; `Frog.ts` exposes `hopCount` and `centerPoint()`.

All wiring from the integration guide is present and `tsc --noEmit` passes
clean across the whole frontend. The game renders correctly in-app at
`/game/lotus-frog` and is reachable from a Home card.

### Cognitive module (Phase 3) — COMPLETE, per guide

`cognitive/` is 781 lines: `domains.ts`, `tuning.ts` (the ACTION_MODEL),
`report.ts`, `CognitiveTracker.ts`, `smaran.ts`. `language` is always null.
`applyFrogReport` folds the reading in with a confidence-weighted EMA capped at
`baseAlpha = 0.25`, matching Smaran's own `updateProfile` step, damped to 40%
for abandoned sessions. **Do not modify the tuning or the EMA.**

`LotusFrog.tsx` ignores sessions under 5s (guards against accidental opens and
React StrictMode's dev double-mount) and keeps the last 20 reports in
localStorage under `smaran.lotusFrog.reports`.

## Fixed 2026-09-25

### The frog was being cropped at the bottom edge

Intermittent, and worse on short viewports. Diagnosis took two wrong guesses
before instrumenting — worth recording so nobody re-treads it:

- It was **not** the hero pad (that sits at 87% of height and is fine).
- It was **not** the camera (it drifts ±3px and pointer-lean is off headless).
- The frog hops onto **scatter pads**, which are placed at
  `waterlineY + waterH * (0.12 + depth * 0.8)` — up to ~96% of screen height.
- The actual trigger is `padPos()` adding **`pad.press`**, the landing spring
  dip. A pad that passed a naive height check gets pushed *below* the screen
  after the frog lands on it. Logging showed `ay` reaching ~229 against
  `h = 225`.

Two changes in `world/frog/Frog.ts`, both needed:
1. `lowestSeatY()` — `planHop()` now skips pads below `h - bw * 1.6`. The
   margin is deliberately larger than the frog so it covers the dip and bob
   that land *after* the hop is chosen. Low pads stay as scenery.
2. `computeAnchor()` clamps the seat to `h - round(scale * 0.5)` regardless of
   how it was derived. The frog's lowest drawn pixel is `seatY + 0.1·bodyH`,
   so this guarantees it stays on screen through any dip, bob or hop arc.

Verified across six timed samples at 1600×900 — frog fully seated in all.

### `LOTUS_FROG` is now a real `GameType`

Added to the union in `lib/types.ts`, which surfaced four exhaustive maps that
needed entries: `gardenEngine.growthFor` (2 points, same as the other calm
games), `Dashboard.GAME_NAMES`, `Home.GAME_ROUTES`, and
`cognitiveProfile.updateProfile`.

`Home.tsx` no longer needs its `GameType | 'LOTUS_FROG'` shim, and
`smaran.ts`'s loosely-typed `SmaranGameSessionLike` is gone — replaced by
`toSessionDraft()`, which returns a real `SessionResultDraft`.

**Frog sessions now flow through `completeSession()`**, so a visit waters the
garden, advances `sessionCount` and queues to the backend like any other.

Two guards make that safe, and both matter:
- `updateProfile()` **returns early for `LOTUS_FROG`**. The frog already folded
  in a four-domain reading via `applyFrogReport`; running the single-domain EMA
  as well would count the same visit twice, from a completion rate the pond
  does not really have.
- `completeSession()` only writes the profile back **when `updateProfile`
  returned a different object**. Otherwise it would overwrite the frog's richer
  reading with the profile its closure captured beforehand.

Ordering in `LotusFrog.tsx` is therefore load-bearing: `applyFrogReport` →
`setProfile` → `completeSession`. There is a comment saying so.

## Known gaps / outstanding work

### Phases not started
- **Phase 5** — dementia-focused observations (attention span, engagement,
  motor stability, processing-speed trend, exploration behaviour). `RawSignals`
  currently carries the guide's fields only.
- **Phase 6** — `PatientCognitiveSnapshot`; historical storage beyond the
  20-entry localStorage ring.
- **Phase 7** — caregiver dashboard view, trend charts, neutral-language
  observations.
- **Phase 9** — accessibility audit for the game itself (tap targets, contrast,
  forgiving interactions).
- **Phase 10** — RBAC. **Decided 2026-09-25: frontend-only for now.** Gate the
  dashboard UI by role in React; keep frog data on-device. No Spring Boot
  changes — real enforcement arrives with the separate RBAC effort. Do not
  build server-side role checks here without revisiting that decision.
- **Memory Garden progression** — tie `World.progress.lushness` to engagement
  and consistency over weeks. The seam already exists (see State management).
- Backend: DB schema updates and API endpoints for session history.
