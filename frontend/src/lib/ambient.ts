/**
 * The soundscape.
 *
 * Four layers, all synthesised in the Web Audio API so they work offline and
 * weigh nothing:
 *   1. a binaural/solfeggio base tone — 432 Hz calm, 528 Hz emotional grounding
 *   2. nature: river water, bamboo rustle, occasional distant birdsong
 *   3. a regional instrument drone, barely perceptible
 *   4. interaction micro-sounds: frog-plop, petal, chime, rain
 *
 * What never appears: a beep, a buzz, a countdown, a failure jingle, a fanfare,
 * a pop, a ping. Every envelope below has a slow attack and a slow release —
 * there is no sound in this file that can startle someone.
 */

export type Tone = 432 | 528

let ctx: AudioContext | null = null
let master: GainNode | null = null
let base: { osc: OscillatorNode[]; gain: GainNode } | null = null
let nature: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null
let instrument: { osc: OscillatorNode[]; gain: GainNode } | null = null
let birdTimer: number | null = null
let currentTone: Tone = 432

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (ctx) return ctx
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  ctx = new Ctor()
  master = ctx.createGain()
  master.gain.value = 0
  master.connect(ctx.destination)
  return ctx
}

/** Browsers require a gesture; the emotion check-in tap is ours. */
export async function unlockAudio() {
  const c = audio()
  if (!c) return
  if (c.state === 'suspended') await c.resume()
}

function rampTo(param: AudioParam, value: number, seconds: number) {
  const c = audio()
  if (!c) return
  param.cancelScheduledValues(c.currentTime)
  param.setValueAtTime(param.value, c.currentTime)
  // Exponential ramps cannot reach zero; linear keeps the fade honest and slow.
  param.linearRampToValueAtTime(value, c.currentTime + seconds)
}

/* ---------------------------------------------------------- noise beds */

function makeNoiseBuffer(c: AudioContext, seconds: number, brown: boolean): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1
    if (brown) {
      // Brown noise reads as river and rain; white noise reads as static.
      last = (last + 0.02 * white) / 1.02
      data[i] = last * 3.2
    } else {
      data[i] = white
    }
  }
  return buf
}

/* -------------------------------------------------------------- layers */

export function startAmbient(tone: Tone = 432, instrumentName: string = 'none') {
  const c = audio()
  if (!c || !master) return
  currentTone = tone

  if (!base) {
    // Binaural: two detuned oscillators a few Hz apart, summed softly.
    const gain = c.createGain()
    gain.gain.value = 0.055
    const oscA = c.createOscillator()
    const oscB = c.createOscillator()
    oscA.type = 'sine'
    oscB.type = 'sine'
    oscA.frequency.value = tone
    oscB.frequency.value = tone + 6
    oscA.connect(gain)
    oscB.connect(gain)
    gain.connect(master)
    oscA.start()
    oscB.start()
    base = { osc: [oscA, oscB], gain }
  }

  if (!nature) {
    const gain = c.createGain()
    gain.gain.value = 0.1
    const filter = c.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 780
    filter.Q.value = 0.4
    const src = c.createBufferSource()
    src.buffer = makeNoiseBuffer(c, 6, true)
    src.loop = true
    src.connect(filter)
    filter.connect(gain)
    gain.connect(master)
    src.start()
    nature = { src, gain, filter }

    // A bamboo rustle every so often: the same bed, briefly opened up.
    scheduleRustle()
  }

  if (instrumentName !== 'none' && !instrument) startInstrument(instrumentName)

  rampTo(master.gain, 0.72, 6)
}

function scheduleRustle() {
  const c = audio()
  if (!c || !nature) return
  const delay = 9000 + Math.random() * 16000
  birdTimer = window.setTimeout(() => {
    if (!nature || !c) return
    const f = nature.filter.frequency
    f.cancelScheduledValues(c.currentTime)
    f.setValueAtTime(f.value, c.currentTime)
    f.linearRampToValueAtTime(1900, c.currentTime + 2.4)
    f.linearRampToValueAtTime(780, c.currentTime + 6.5)
    if (Math.random() > 0.55) hornbill()
    scheduleRustle()
  }, delay)
}

/** A distant hornbill: two soft descending notes, far away, never sharp. */
function hornbill() {
  const c = audio()
  if (!c || !master) return
  const g = c.createGain()
  g.gain.value = 0
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.value = 420
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 900
  o.connect(lp)
  lp.connect(g)
  g.connect(master)
  const t = c.currentTime
  o.start(t)
  g.gain.linearRampToValueAtTime(0.045, t + 0.35)
  o.frequency.linearRampToValueAtTime(360, t + 0.9)
  g.gain.linearRampToValueAtTime(0, t + 1.6)
  o.frequency.setValueAtTime(400, t + 1.9)
  g.gain.linearRampToValueAtTime(0.035, t + 2.2)
  o.frequency.linearRampToValueAtTime(340, t + 2.8)
  g.gain.linearRampToValueAtTime(0, t + 3.4)
  o.stop(t + 3.6)
}

function startInstrument(name: string) {
  const c = audio()
  if (!c || !master) return
  const gain = c.createGain()
  gain.gain.value = 0.018 // barely perceptible, by design
  gain.connect(master)

  const osc: OscillatorNode[] = []
  const spec: Record<string, { freqs: number[]; type: OscillatorType }> = {
    // A pepa drone sits low and reedy; a gogona shimmers in the upper mids.
    pepa: { freqs: [146.8, 220], type: 'sawtooth' },
    gogona: { freqs: [392, 587.3], type: 'triangle' },
    'chapel-bell': { freqs: [523.3, 784], type: 'sine' },
    'monastery-chime': { freqs: [261.6, 392], type: 'sine' },
  }
  const s = spec[name] ?? spec.pepa
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 1200
  lp.connect(gain)
  for (const f of s.freqs) {
    const o = c.createOscillator()
    o.type = s.type
    o.frequency.value = f
    o.connect(lp)
    o.start()
    osc.push(o)
  }
  instrument = { osc, gain }
}

/**
 * Shift the base tone. Called silently when cognitive load spikes: the room
 * changes key underneath the patient, and nothing on screen says so.
 */
export function setTone(tone: Tone) {
  const c = audio()
  if (!c || !base || tone === currentTone) return
  currentTone = tone
  base.osc[0].frequency.linearRampToValueAtTime(tone, c.currentTime + 8)
  base.osc[1].frequency.linearRampToValueAtTime(tone + 6, c.currentTime + 8)
}

export function currentAmbientTone(): Tone {
  return currentTone
}

export function fadeAmbient(seconds = 4) {
  if (!master) return
  rampTo(master.gain, 0, seconds)
}

export function stopAmbient() {
  if (birdTimer) window.clearTimeout(birdTimer)
  birdTimer = null
  fadeAmbient(2)
  window.setTimeout(() => {
    base?.osc.forEach((o) => o.stop())
    instrument?.osc.forEach((o) => o.stop())
    nature?.src.stop()
    base = null
    instrument = null
    nature = null
  }, 2200)
}

/* ------------------------------------------------- interaction sounds */

type Cue = 'pond-tap' | 'petal' | 'chime' | 'rain' | 'bloom'

/**
 * Every cue is a natural event, not a UI sound:
 *   pond-tap  a frog entering the water
 *   petal     a lotus petal opening (the only "correct" sound in the app)
 *   chime     one wind chime note (a reminder arriving)
 *   rain      gentle rain (the resting phase beginning)
 *   bloom     a fuller petal, for a milestone
 */
export function cue(kind: Cue) {
  const c = audio()
  if (!c || !master) return
  const t = c.currentTime
  const g = c.createGain()
  g.gain.value = 0
  g.connect(master)

  if (kind === 'pond-tap') {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(320, t)
    o.frequency.exponentialRampToValueAtTime(90, t + 0.22)
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 700
    o.connect(lp)
    lp.connect(g)
    o.start(t)
    g.gain.linearRampToValueAtTime(0.16, t + 0.03)
    g.gain.linearRampToValueAtTime(0, t + 0.5)
    o.stop(t + 0.55)
    return
  }

  if (kind === 'rain') {
    const src = c.createBufferSource()
    src.buffer = makeNoiseBuffer(c, 3, true)
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2200
    src.connect(lp)
    lp.connect(g)
    src.start(t)
    g.gain.linearRampToValueAtTime(0.09, t + 1.2)
    g.gain.linearRampToValueAtTime(0, t + 3)
    src.stop(t + 3.1)
    return
  }

  // petal · chime · bloom — struck partials with a long, soft release.
  const partials = kind === 'chime' ? [880, 1318.5, 1760] : kind === 'bloom' ? [523.3, 659.3, 784, 1046.5] : [659.3, 987.8]
  const peak = kind === 'chime' ? 0.1 : 0.075
  const release = kind === 'bloom' ? 3.6 : 2.4
  partials.forEach((f, i) => {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.value = f
    const pg = c.createGain()
    pg.gain.value = 0
    o.connect(pg)
    pg.connect(g)
    o.start(t + i * 0.09)
    pg.gain.linearRampToValueAtTime(peak / (i + 1), t + i * 0.09 + 0.12)
    pg.gain.linearRampToValueAtTime(0, t + i * 0.09 + release)
    o.stop(t + i * 0.09 + release + 0.1)
  })
  g.gain.setValueAtTime(1, t)
}
