// A small load test of the two paths that matter most: families reading dashboards, and tablets sending sessions.
//
//   make demo                                   (a stack with the demo accounts and the synthetic cohort)
//   docker run --rm -i -e BASE_URL=http://host.docker.internal:8081 grafana/k6 run - < loadtest/smaran.k6.js
//   (or, with k6 installed:  BASE_URL=http://localhost:8081 k6 run loadtest/smaran.k6.js)
//
// Aim it at a stack you can throw away, never at production: it pairs tablets to the demo patients and writes
// sessions into them. It signs in as the demo caregiver, so it only works in the demo profile.
//
// What the numbers are, and are not: they are for the machine and the stack they ran on (loadtest/README.md has
// the ones this was last run with). They say how this code behaves on that machine under this mix, not how a
// deployment would behave.

import http from 'k6/http'
import { check, fail } from 'k6'
import { randomBytes } from 'k6/crypto'

const BASE = __ENV.BASE_URL || 'http://localhost:8081'
const TABLETS = Number(__ENV.TABLETS || 8)
const DURATION = __ENV.DURATION || '60s'
// How the sessions arrive. 'in-order' (the default): each is the newest the patient has, as from a tablet that is
// online. 'late': each starts at a random time in the past, as a tablet's queue does when it was offline for a day,
// which makes the server rebuild the patient's profile from her history every time (the expensive path).
const ARRIVAL = __ENV.ARRIVAL || 'in-order'
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export const options = {
  scenarios: {
    // Families: a handful of people with a dashboard open, each refreshing as they look from patient to patient.
    dashboards: {
      executor: 'constant-vus',
      vus: Number(__ENV.READERS || 10),
      duration: DURATION,
      exec: 'readDashboard',
    },
    // Tablets: sessions arriving at a steady rate (each a one-session batch, as a tablet that is online sends).
    tablets: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 5),
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 20,
      maxVUs: 60,
      exec: 'sendSession',
    },
  },
  // Thresholds that make the run a pass or a fail. They are generous on purpose: this is a smoke-level load test.
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:dashboard}': ['p(95)<1500'],
    'http_req_duration{kind:ingest}': ['p(95)<800'],
    checks: ['rate>0.99'],
  },
}

function call(method, path, body, token, tags) {
  const headers = Object.assign({}, JSON_HEADERS, token ? { Authorization: `Bearer ${token}` } : {})
  return http.request(method, `${BASE}${path}`, body ? JSON.stringify(body) : null, { headers, tags })
}

export function setup() {
  const login = call('POST', '/api/auth/login', { email: 'rupa@example.com', password: 'smaran' })
  if (login.status !== 200) fail(`the demo caregiver cannot sign in (HTTP ${login.status}): is this the demo stack?`)
  const token = login.json('accessToken')

  const patients = call('GET', '/api/patients', null, token).json().map((p) => p.id)
  if (patients.length < 2) fail('the demo stack has no cohort: run make demo and wait for it to load')

  // One tablet per patient, for as many as asked.
  const tablets = []
  for (const patientId of patients.slice(0, TABLETS)) {
    const minted = call('POST', `/api/patients/${patientId}/pairing-codes`, null, token)
    if (minted.status !== 201 && minted.status !== 200) fail(`could not mint a code for ${patientId}: HTTP ${minted.status}`)
    const code = minted.json('code')
    const redeemed = call('POST', '/api/pairing/redeem', { code, deviceLabel: 'load-test tablet', deviceFingerprint: `k6-${patientId}-${Date.now()}` })
    if (redeemed.status !== 200 && redeemed.status !== 201) fail(`could not pair a tablet to ${patientId}: HTTP ${redeemed.status}`)
    tablets.push({ patientId, deviceToken: redeemed.json('deviceToken') })
  }
  return { token, patients, tablets }
}

export function readDashboard(data) {
  const id = data.patients[Math.floor(Math.random() * data.patients.length)]
  const r = call('GET', `/api/caregiver/dashboard/${id}`, null, data.token, { kind: 'dashboard' })
  check(r, { 'dashboard 200': (x) => x.status === 200, 'dashboard has domains': (x) => x.body && x.body.indexOf('domains') >= 0 })
}

let counter = 0
// A session id only has to be new, but it is made from the crypto source so nothing here looks like a guessable id.
function hex(n) {
  let s = ''
  for (const b of new Uint8Array(randomBytes(Math.ceil(n / 2)))) s += b.toString(16).padStart(2, '0')
  return s.slice(0, n)
}

export function sendSession(data) {
  const t = data.tablets[Math.floor(Math.random() * data.tablets.length)]
  counter += 1
  // Unique for the patient (a second session with the same start is dropped as a duplicate) and not in the future.
  const startedAt =
    ARRIVAL === 'late'
      ? new Date(Date.now() - 600000 - ((__VU * 1000003 + counter * 7919) % 86400000)).toISOString()
      : new Date(Date.now() - 5000).toISOString()
  const envelope = {
    clientSessionId: `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`,
    patientId: t.patientId,
    gameId: 'duck-roll-call',
    startedAt,
    durationMs: 120000,
    completed: true,
    abandoned: false,
    hourOfDay: 10,
    moodAtStart: 'PEACEFUL',
    difficulty: { tier: 2, params: {} },
    trials: [],
    contributions: [{ target: 'EXECUTIVE', raw: 40 + Math.random() * 40, confidence: 0.6, because: 'Load test.' }],
    markers: null,
    precomputedReading: true,
    engineVersion: '1.0.0',
  }
  const r = call('POST', '/api/device/sessions/batch', { sessions: [envelope] }, t.deviceToken, { kind: 'ingest' })
  check(r, { 'ingest 200': (x) => x.status === 200, 'ingest accepted it': (x) => x.json('accepted') === 1 })
}
