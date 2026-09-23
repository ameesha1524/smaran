/**
 * Voice biomarker extraction, Web Audio API.
 *
 * The privacy contract, which the whole DPDP-compliance story rests on:
 * **no audio buffer written here ever leaves this module.** We compute five
 * scalar features from the waveform in-memory and emit those. There is no
 * recording, no upload, no blob, and no MediaRecorder anywhere in this file.
 *
 *   jitter            cycle-to-cycle pitch perturbation  → tremor, motor fatigue
 *   shimmer           cycle-to-cycle amplitude variation → vocal fatigue
 *   pauseDurationAvg  mean silence between phonations    → word-finding difficulty
 *   speechRate        voiced segments per second         → processing speed
 *   phonationRatio    voiced time / total time           → sustained phonation
 */

import type { AcousticVector } from './types'

const FRAME = 2048
const HOP_MS = 32
/** Below this RMS a frame is silence, not a very quiet voice. */
const VOICED_RMS = 0.012

export interface CaptureHandle {
  stop(): Promise<AcousticVector | null>
}

interface Frame {
  t: number
  rms: number
  f0: number | null
}

/** Autocorrelation pitch detection, limited to the human speaking range. */
function detectF0(buf: Float32Array, sampleRate: number): number | null {
  const minLag = Math.floor(sampleRate / 400) // 400 Hz ceiling
  const maxLag = Math.floor(sampleRate / 60) //  60 Hz floor
  let bestLag = -1
  let bestCorr = 0
  let energy = 0
  for (let i = 0; i < buf.length; i++) energy += buf[i] * buf[i]
  if (energy < 1e-4) return null

  for (let lag = minLag; lag <= maxLag && lag < buf.length; lag++) {
    let corr = 0
    for (let i = 0; i < buf.length - lag; i++) corr += buf[i] * buf[i + lag]
    corr /= buf.length - lag
    if (corr > bestCorr) {
      bestCorr = corr
      bestLag = lag
    }
  }
  if (bestLag < 0 || bestCorr < 0.0025) return null
  return sampleRate / bestLag
}

function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

/** Relative average perturbation — the standard shape for jitter and shimmer. */
function relativePerturbation(xs: number[]): number {
  if (xs.length < 3) return 0
  let diff = 0
  for (let i = 1; i < xs.length; i++) diff += Math.abs(xs[i] - xs[i - 1])
  diff /= xs.length - 1
  const m = mean(xs)
  return m > 0 ? diff / m : 0
}

function summarise(frames: Frame[], patientId: string, sessionId?: string): AcousticVector | null {
  const voiced = frames.filter((f) => f.rms >= VOICED_RMS)
  if (voiced.length < 6) return null // too little speech to say anything honest

  const f0s = voiced.map((f) => f.f0).filter((f): f is number => f !== null)
  const amps = voiced.map((f) => f.rms)

  // Pauses: runs of silent frames between voiced ones.
  const pauses: number[] = []
  let runStart: number | null = null
  let seenVoice = false
  for (const f of frames) {
    const isVoiced = f.rms >= VOICED_RMS
    if (isVoiced) {
      if (runStart !== null && seenVoice) pauses.push(f.t - runStart)
      runStart = null
      seenVoice = true
    } else if (runStart === null) {
      runStart = f.t
    }
  }

  const totalMs = frames.length ? frames[frames.length - 1].t - frames[0].t + HOP_MS : 0
  const voicedMs = voiced.length * HOP_MS

  // A "syllable" ≈ a voiced run; counting runs is more robust than counting peaks.
  let runs = 0
  let prev = false
  for (const f of frames) {
    const v = f.rms >= VOICED_RMS
    if (v && !prev) runs++
    prev = v
  }

  return {
    patientId,
    sessionId,
    capturedAt: new Date().toISOString(),
    jitter: Number(relativePerturbation(f0s).toFixed(5)),
    shimmer: Number(relativePerturbation(amps).toFixed(5)),
    pauseDurationAvg: Number(mean(pauses.filter((p) => p >= HOP_MS * 2)).toFixed(1)),
    speechRate: Number((totalMs > 0 ? (runs * 1000) / totalMs : 0).toFixed(3)),
    phonationRatio: Number((totalMs > 0 ? voicedMs / totalMs : 0).toFixed(3)),
  }
}

/**
 * Start listening for features only. Returns a handle; `stop()` resolves with
 * the vector (or null when the patient said too little for a reading).
 *
 * Callers must have microphone permission already, and must be prepared for
 * null: a refused microphone is a normal state, not an error.
 */
export async function captureFeatures(patientId: string, sessionId?: string): Promise<CaptureHandle | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
    })
  } catch {
    return null
  }

  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) {
    stream.getTracks().forEach((t) => t.stop())
    return null
  }

  const ctx = new Ctor()
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = FRAME
  source.connect(analyser)

  const buf = new Float32Array(analyser.fftSize)
  const frames: Frame[] = []
  const t0 = performance.now()

  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    const rms = Math.sqrt(sum / buf.length)
    frames.push({
      t: performance.now() - t0,
      rms,
      f0: rms >= VOICED_RMS ? detectF0(buf, ctx.sampleRate) : null,
    })
  }, HOP_MS)

  return {
    async stop() {
      window.clearInterval(timer)
      stream.getTracks().forEach((t) => t.stop())
      try {
        await ctx.close()
      } catch {
        /* already closed */
      }
      return summarise(frames, patientId, sessionId)
    },
  }
}

/**
 * 30-day rolling trend. Returned to the caregiver dashboard as a *monitoring
 * signal*, never as a diagnosis — the wording matters and is fixed here.
 */
export function trendFlag(vectors: AcousticVector[]): { rising: boolean; message: string | null } {
  if (vectors.length < 8) return { rising: false, message: null }
  const sorted = [...vectors].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
  const half = Math.floor(sorted.length / 2)
  const early = sorted.slice(0, half)
  const late = sorted.slice(half)

  const avg = (xs: AcousticVector[], k: 'jitter' | 'shimmer') => xs.reduce((a, b) => a + b[k], 0) / xs.length
  const jitterUp = avg(late, 'jitter') > avg(early, 'jitter') * 1.18
  const shimmerUp = avg(late, 'shimmer') > avg(early, 'shimmer') * 1.18

  if (jitterUp && shimmerUp) {
    return {
      rising: true,
      message: 'Possible early vocal fatigue pattern — recommend clinical review.',
    }
  }
  return { rising: false, message: null }
}
