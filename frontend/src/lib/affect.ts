/**
 * Affective computing — the layer that lets a game get easier without anyone
 * being told it got easier.
 *
 * Smaran does not run an emotion classifier. It reads four proxy signals from
 * MediaPipe Face Mesh landmark geometry, entirely in the browser, and no frame
 * of video is ever encoded, stored or transmitted:
 *
 *   brow furrow distance      → frustration proxy
 *   eye openness ratio        → fatigue proxy
 *   gaze fixation per target  → hesitation
 *   tap-to-target latency     → cognitive load trend
 *
 * The camera is optional and always secondary. With no camera (or a refused
 * permission — the common case) the behavioural half alone drives the load
 * score, and the adaptation still works.
 */

const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14'

export interface LoadSample {
  at: number
  /** 0 (settled) … 1 (overloaded). */
  score: number
  browFurrow: number | null
  eyeOpenness: number | null
  fixationMs: number | null
  latencyMs: number | null
}

/* ----------------------------------------------------- behavioural half */

/**
 * The behavioural meter. Feed it every tap and every hesitation; it keeps a
 * short rolling window and reports a load score that rises when the patient
 * starts taking longer than her own baseline (not longer than a stranger's).
 */
export class LoadMeter {
  private latencies: number[] = []
  private baseline: number | null = null
  private hesitations = 0
  private replays = 0
  private corrections = 0

  /** ms between the target appearing and the tap landing. */
  recordTap(latencyMs: number) {
    this.latencies.push(latencyMs)
    if (this.latencies.length > 12) this.latencies.shift()
    // Baseline is the median of the first handful of taps in this session.
    if (this.baseline === null && this.latencies.length >= 3) {
      this.baseline = median(this.latencies)
    }
    if (this.baseline && latencyMs > this.baseline * 2.2) this.hesitations++
  }

  recordReplay() {
    this.replays++
  }

  /** A tap that landed and then drifted back — a near miss, never called wrong. */
  recordCorrection() {
    this.corrections++
  }

  reset() {
    this.latencies = []
    this.baseline = null
    this.hesitations = 0
    this.replays = 0
    this.corrections = 0
  }

  score(): number {
    if (!this.latencies.length) return 0
    const recent = median(this.latencies.slice(-5))
    const base = this.baseline ?? recent
    const slowdown = base > 0 ? clamp01((recent / base - 1) / 1.4) : 0
    const hesitation = clamp01(this.hesitations / 4)
    const replay = clamp01(this.replays / 3)
    const correction = clamp01(this.corrections / 4)
    return round(slowdown * 0.45 + hesitation * 0.25 + replay * 0.15 + correction * 0.15)
  }
}

/* ---------------------------------------------------------- vision half */

interface Landmark {
  x: number
  y: number
  z: number
}

type FaceLandmarkerLike = {
  detectForVideo(video: HTMLVideoElement, ts: number): { faceLandmarks: Landmark[][] }
  close(): void
}

export interface AffectHandle {
  /** Latest reading, or nulls when no face is available. */
  read(): { browFurrow: number | null; eyeOpenness: number | null }
  stop(): void
  /** False when the camera is absent or refused — the common, fine case. */
  active: boolean
}

/**
 * Start face-geometry tracking. Loaded from CDN at runtime rather than bundled:
 * it must never be on the critical path of a tablet opening the sanctuary, and
 * a device that cannot reach the CDN simply runs without it.
 */
export async function startAffect(video: HTMLVideoElement): Promise<AffectHandle> {
  const inactive: AffectHandle = {
    read: () => ({ browFurrow: null, eyeOpenness: null }),
    stop: () => undefined,
    active: false,
  }

  if (!navigator.mediaDevices?.getUserMedia) return inactive

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' } })
  } catch {
    return inactive
  }

  let landmarker: FaceLandmarkerLike
  try {
    const vision = (await import(/* @vite-ignore */ `${MEDIAPIPE_CDN}/vision_bundle.mjs`)) as {
      FilesetResolver: { forVisionTasks(path: string): Promise<unknown> }
      FaceLandmarker: {
        createFromOptions(fileset: unknown, opts: unknown): Promise<FaceLandmarkerLike>
      }
    }
    const fileset = await vision.FilesetResolver.forVisionTasks(`${MEDIAPIPE_CDN}/wasm`)
    landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
    })
  } catch {
    stream.getTracks().forEach((t) => t.stop())
    return inactive
  }

  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play().catch(() => undefined)

  let latest = { browFurrow: null as number | null, eyeOpenness: null as number | null }
  let raf = 0
  let stopped = false

  const tick = () => {
    if (stopped) return
    try {
      const res = landmarker.detectForVideo(video, performance.now())
      const marks = res.faceLandmarks?.[0]
      if (marks?.length) {
        // Face Mesh indices: 107/336 inner brows, 168 nasion (the scale ruler),
        // 159/145 right lid pair, 386/374 left lid pair.
        const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y)
        const faceScale = dist(marks[168], marks[152]) || 1
        const brow = dist(marks[107], marks[336]) / faceScale
        const lidR = dist(marks[159], marks[145]) / faceScale
        const lidL = dist(marks[386], marks[374]) / faceScale
        latest = { browFurrow: round(brow), eyeOpenness: round((lidR + lidL) / 2) }
      }
    } catch {
      /* a dropped frame is not an event */
    }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  return {
    read: () => latest,
    active: true,
    stop() {
      stopped = true
      cancelAnimationFrame(raf)
      try {
        landmarker.close()
      } catch {
        /* ignore */
      }
      stream.getTracks().forEach((t) => t.stop())
      video.srcObject = null
    },
  }
}

/**
 * Composite load score. The vision signals are *relative to this patient's own*
 * settled baseline, collected over the first seconds of the session — absolute
 * brow distances mean nothing across different faces.
 */
export class CompositeLoad {
  private browBase: number | null = null
  private eyeBase: number | null = null
  private samples = 0

  constructor(private meter: LoadMeter) {}

  sample(vision: { browFurrow: number | null; eyeOpenness: number | null }, fixationMs: number | null): LoadSample {
    const behavioural = this.meter.score()
    let visual = 0
    let weight = 0

    if (vision.browFurrow !== null) {
      this.samples++
      if (this.samples <= 30) {
        this.browBase = this.browBase === null ? vision.browFurrow : this.browBase * 0.9 + vision.browFurrow * 0.1
        this.eyeBase =
          this.eyeBase === null || vision.eyeOpenness === null
            ? this.eyeBase ?? vision.eyeOpenness
            : this.eyeBase * 0.9 + vision.eyeOpenness * 0.1
      } else if (this.browBase) {
        // Brows drawing together = furrow; lids narrowing = fatigue.
        const furrow = clamp01((this.browBase - vision.browFurrow) / (this.browBase * 0.22))
        const droop =
          this.eyeBase && vision.eyeOpenness !== null
            ? clamp01((this.eyeBase - vision.eyeOpenness) / (this.eyeBase * 0.35))
            : 0
        visual = furrow * 0.6 + droop * 0.4
        weight = 0.4
      }
    }

    const fixation = fixationMs !== null ? clamp01((fixationMs - 2500) / 5000) : 0
    const fixWeight = fixationMs !== null ? 0.15 : 0
    const behaviouralWeight = 1 - weight - fixWeight

    return {
      at: Date.now(),
      score: round(behavioural * behaviouralWeight + visual * weight + fixation * fixWeight),
      browFurrow: vision.browFurrow,
      eyeOpenness: vision.eyeOpenness,
      fixationMs,
      latencyMs: null,
    }
  }
}

/* --------------------------------------------------- the WebFlux stream */

export interface DifficultyEaseEvent {
  sessionId: string
  loadScore: number
  /** 432 when the room should change key underneath her. */
  ambientHz: 432 | 528
  reason: string
}

/**
 * Subscribe to the server's view of this session's load. The server may ease
 * the game from signals the device cannot see on its own (a cross-session
 * trend, a federated threshold). Returns an unsubscribe function.
 */
export function subscribeCognitiveStream(
  sessionId: string,
  onEase: (event: DifficultyEaseEvent) => void,
): () => void {
  if (typeof EventSource === 'undefined') return () => undefined
  let es: EventSource
  try {
    es = new EventSource(`/api/cognitive/stream/${encodeURIComponent(sessionId)}`)
  } catch {
    return () => undefined
  }
  es.addEventListener('ease', (e) => {
    try {
      onEase(JSON.parse((e as MessageEvent).data) as DifficultyEaseEvent)
    } catch {
      /* malformed frame — ignore, never surface */
    }
  })
  es.onerror = () => {
    // Offline is the normal state here. Close quietly; local adaptation continues.
    es.close()
  }
  return () => es.close()
}

/** Push a load sample upstream. Fire-and-forget: it must never block a game. */
export function reportLoad(sessionId: string, sample: LoadSample) {
  const body = JSON.stringify({ sessionId, ...sample })
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/cognitive/sample', new Blob([body], { type: 'application/json' }))
      return
    }
  } catch {
    /* fall through */
  }
  void fetch('/api/cognitive/sample', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined)
}

/* ------------------------------------------------------------- helpers */

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

function round(n: number) {
  return Number(n.toFixed(4))
}

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
