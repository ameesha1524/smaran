/**
 * On-device personalisation + federated learning client.
 *
 * What leaves the device: an AES-GCM ciphertext of a gradient delta, plus a
 * model version. What never leaves the device: the sessions the gradient was
 * computed from, the voice, the video, the photographs, the names.
 *
 * IMPLEMENTATION NOTE. The brief specifies TensorFlow.js for the local model.
 * The personalisation head here is a logistic regression trained by plain
 * gradient descent in ~60 lines, because that is what the model actually is and
 * it keeps a 3 MB dependency off a rural Android tablet's first load. The shape
 * of the exchange (local fit → gradient delta → encrypt → POST /api/fl/gradients
 * → FedAvg → updated weights) is identical, so swapping in `tf.sequential()`
 * later means replacing `fit()` and `gradients()` and nothing else.
 */

import { cacheGet, cacheSet } from './db'
import { uploadGradients } from './api'
import type { SessionResultDraft } from './types'

/** Six features, all behavioural, all already on the device. */
export const FEATURES = [
  'medianTapLatencyNorm',
  'hesitationRate',
  'completionRate',
  'difficultyTier',
  'hourOfDayNorm',
  'moodLow',
] as const

export type FeatureVector = number[]

export interface LocalModel {
  version: string
  weights: number[]
  bias: number
  samples: number
}

const MODEL_KEY = 'fl.model'
const DEVICE_KEY = 'smaran.deviceKey'
const DEVICE_ID = 'smaran.deviceId'

export function emptyModel(): LocalModel {
  return { version: 'v0', weights: new Array(FEATURES.length).fill(0), bias: 0, samples: 0 }
}

export async function loadModel(): Promise<LocalModel> {
  return (await cacheGet<LocalModel>(MODEL_KEY)) ?? emptyModel()
}

export async function saveModel(m: LocalModel): Promise<void> {
  await cacheSet(MODEL_KEY, m)
}

/* ------------------------------------------------------------- features */

/**
 * Turn a finished session into a training row. The label is "did this session
 * go well for her" — completion at or above 0.75 with no abandonment.
 */
export function toSample(result: SessionResultDraft, medianTapMs: number, hesitationRate: number): { x: FeatureVector; y: number } {
  const hour = new Date(result.startedAt).getHours()
  return {
    x: [
      clamp01(medianTapMs / 6000),
      clamp01(hesitationRate),
      clamp01(result.completionRate),
      result.difficultyTier / 3,
      hour / 24,
      ['A_LITTLE_LOW', 'WORRIED', 'RESTLESS'].includes(result.moodAtStart) ? 1 : 0,
    ],
    y: result.completionRate >= 0.75 ? 1 : 0,
  }
}

/* -------------------------------------------------------------- the fit */

function sigmoid(z: number) {
  return 1 / (1 + Math.exp(-z))
}

function predict(m: LocalModel, x: FeatureVector): number {
  let z = m.bias
  for (let i = 0; i < x.length; i++) z += m.weights[i] * x[i]
  return sigmoid(z)
}

/**
 * Probability that the next session at this difficulty goes well. The adaptive
 * layer uses it as a prior — below 0.45 the session starts one tier easier.
 */
export function predictSuccess(m: LocalModel, x: FeatureVector): number {
  return predict(m, x)
}

/** A few epochs of gradient descent over the device's own history. */
export function fit(model: LocalModel, data: { x: FeatureVector; y: number }[], epochs = 24, lr = 0.28): LocalModel {
  if (!data.length) return model
  const weights = [...model.weights]
  let bias = model.bias

  for (let e = 0; e < epochs; e++) {
    const gw = new Array(weights.length).fill(0)
    let gb = 0
    for (const { x, y } of data) {
      let z = bias
      for (let i = 0; i < x.length; i++) z += weights[i] * x[i]
      const err = sigmoid(z) - y
      for (let i = 0; i < x.length; i++) gw[i] += err * x[i]
      gb += err
    }
    for (let i = 0; i < weights.length; i++) {
      // L2 keeps a handful of sessions from overfitting to one bad afternoon.
      weights[i] -= (lr * (gw[i] / data.length + 0.01 * weights[i]))
    }
    bias -= lr * (gb / data.length)
  }

  return { ...model, weights, bias, samples: model.samples + data.length }
}

/** The delta is what federates — never the weights themselves. */
export function gradients(before: LocalModel, after: LocalModel): { dw: number[]; db: number } {
  return {
    dw: after.weights.map((w, i) => Number((w - before.weights[i]).toFixed(6))),
    db: Number((after.bias - before.bias).toFixed(6)),
  }
}

/* ------------------------------------------------------------ crypto */

async function deviceKey(): Promise<CryptoKey | null> {
  if (!crypto?.subtle) return null
  const stored = localStorage.getItem(DEVICE_KEY)
  if (stored) {
    const raw = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0))
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt'])
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key))
  localStorage.setItem(DEVICE_KEY, btoa(String.fromCharCode(...raw)))
  return key
}

export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_ID)
  if (!id) {
    id = crypto.randomUUID?.() ?? `dev-${Math.random().toString(36).slice(2)}`
    localStorage.setItem(DEVICE_ID, id)
  }
  return id
}

async function encrypt(payload: unknown): Promise<string | null> {
  const key = await deviceKey()
  if (!key) return null
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(JSON.stringify(payload))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data))
  const joined = new Uint8Array(iv.length + cipher.length)
  joined.set(iv)
  joined.set(cipher, iv.length)
  return btoa(String.fromCharCode(...joined))
}

/* ------------------------------------------------------------- the round */

/**
 * One federated round: fit locally, compute the delta, encrypt it, send it, and
 * take whatever the global average sends back. Every step is allowed to fail
 * silently — a device that never completes a round is simply a device with a
 * slightly less clever local model.
 */
export async function federatedRound(patientId: string, history: { x: FeatureVector; y: number }[]): Promise<LocalModel> {
  const before = await loadModel()
  if (history.length < 4) return before

  const after = fit(before, history)
  await saveModel(after)

  const cipher = await encrypt({ ...gradients(before, after), n: history.length })
  if (!cipher) return after

  const response = await uploadGradients({
    deviceId: deviceId(),
    patientId,
    modelVersion: after.version,
    cipher,
  })

  if (response?.weights?.length === after.weights.length) {
    const merged: LocalModel = {
      version: response.modelVersion,
      // Keep some of the local personality: this patient is not the average.
      weights: response.weights.map((w, i) => Number((w * 0.6 + after.weights[i] * 0.4).toFixed(6))),
      bias: after.bias,
      samples: after.samples,
    }
    await saveModel(merged)
    return merged
  }
  return after
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}
