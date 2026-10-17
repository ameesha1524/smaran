import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'

/**
 * The showcase script (docs/MASTER_PROMPT.md, section 4, steps 2 to 7), run by real browsers against the demo
 * stack (`make demo`: the backend in the demo profile with the 12-patient synthetic cohort loaded).
 *
 *   make demo
 *   cd e2e/playwright && BASE_URL=http://localhost:8081 npx playwright test showcase
 *
 * Three browser profiles that share nothing, as three devices would not: the family's phone, the patient's
 * tablet and a doctor's computer. They run in order and hand each other what they made, so the file is one
 * story told in steps, and a step that fails says which part of the story broke.
 *
 * Everything in the demo is synthetic. The demo accounts have the published password below and exist only
 * in the dev and demo profiles.
 */

const PASSWORD = 'smaran'
const REPO = path.resolve(process.cwd(), '..', '..')
const RUN = `${Date.now() % 1_000_000}`

// ------------------------------------------------------------------------------------------------------------
// Reading Duck Roll Call. The numbers flash as pixel-art glyphs, so the test reads each digit by its glyph,
// parsed from the game's own source: if the glyphs change, this fails loudly instead of misreading.
// ------------------------------------------------------------------------------------------------------------
const duckSource = readFileSync(path.join(REPO, 'frontend', 'src', 'games', 'DuckRollCall.tsx'), 'utf8')
const glyphBlock = /const DIGIT_GLYPH[^{]*\{([\s\S]*?)\n\}/.exec(duckSource)?.[1] ?? ''
const glyphToDigit = new Map<string, number>()
for (const m of glyphBlock.matchAll(/(\d):\s*'([^']+)'/g)) glyphToDigit.set(m[2], Number(m[1]))

/**
 * Ask the page until it answers with something. Not `page.waitForFunction`: that polls through `eval`, and the app's
 * Content Security Policy (which is a property worth having, and is tested) forbids `unsafe-eval`. `evaluate` is not
 * affected.
 */
async function until<T>(tablet: Page, ask: () => Promise<T | null>, what: string, timeoutMs = 8000): Promise<T> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const answer = await ask()
    if (answer !== null) return answer
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await tablet.waitForTimeout(100)
  }
}

async function duckRound(tablet: Page, wrongFirst = false): Promise<number> {
  await tablet.evaluate(() => (document.querySelector('.drc-btn') as HTMLElement).click())
  const digits = await until(
    tablet,
    () =>
      tablet.evaluate(() => {
        const out: { i: number; d: string }[] = []
        document.querySelectorAll('.px-stage button[aria-label="Duckling"]').forEach((btn, i) => {
          const svg = btn.parentElement?.querySelector('svg[width="90"]')
          const d = svg?.querySelectorAll('path')[2]?.getAttribute('d')
          if (d) out.push({ i, d })
        })
        return out.length ? out : null
      }),
    'the numbers to flash',
  )
  // The game shows the digits 1 to 6. Every glyph on screen must be one the source defines, or the order below
  // would be a guess.
  expect(glyphToDigit.size, 'the glyph table was read from the game source').toBeGreaterThanOrEqual(6)
  expect(digits.every((x) => glyphToDigit.has(x.d)), 'every flashed glyph is one the game defines').toBe(true)
  const order = [...digits].sort((a, b) => glyphToDigit.get(a.d)! - glyphToDigit.get(b.d)!)
  // The numbers vanish: that is the recall phase.
  await until(
    tablet,
    async () => ((await tablet.evaluate(() => document.querySelectorAll('.px-stage svg[width="90"]').length)) === 0 ? true : null),
    'the numbers to vanish',
  )
  await tablet.waitForTimeout(300)
  const tap = (i: number) =>
    tablet.evaluate((n) => (document.querySelectorAll('.px-stage button[aria-label="Duckling"]')[n] as HTMLElement).click(), i)
  if (wrongFirst && order.length > 1) {
    await tap(order[1].i)
    await tablet.waitForTimeout(200)
  }
  for (const item of order) {
    await tap(item.i)
    await tablet.waitForTimeout(150)
  }
  await tablet.waitForTimeout(600)
  return order.length
}

// ------------------------------------------------------------------------------------------------------------
// Morning Rituals: put the morning in order by trying icons in each place, wrong tries included.
// ------------------------------------------------------------------------------------------------------------
async function playRituals(tablet: Page) {
  await tablet.waitForSelector('div.slot-waiting', { timeout: 10_000 })
  const total = await tablet.locator('div.slot-waiting').count()
  for (let slot = 0; slot < total; slot++) {
    let placed = false
    const icons = await tablet.locator('button.petal-card').count()
    for (let k = 0; k < icons && !placed; k++) {
      const before = await tablet.locator('div.slot-waiting').count()
      await tablet.locator('button.petal-card').nth(k).click()
      await tablet.locator('div.slot-waiting').first().click()
      await tablet.waitForTimeout(500)
      if ((await tablet.locator('div.slot-waiting').count()) < before) placed = true
      else await tablet.waitForTimeout(1100) // the misplaced icon drifts home
    }
    expect(placed, `something fits in slot ${slot}`).toBe(true)
  }
  await tablet.waitForTimeout(3200) // the game finishes itself after a moment
}

async function pendingSessions(tablet: Page): Promise<unknown[]> {
  return tablet.evaluate(
    () =>
      new Promise<unknown[]>((resolve) => {
        const open = indexedDB.open('smaran')
        open.onerror = () => resolve([])
        open.onsuccess = () => {
          const all = open.result.transaction('pending_sessions').objectStore('pending_sessions').getAll()
          all.onsuccess = () => resolve(all.result as unknown[])
          all.onerror = () => resolve([])
        }
      }),
  )
}

/** A short-lived access token for whoever is signed in in this browser (the refresh cookie travels with it). */
async function accessToken(context: BrowserContext): Promise<string> {
  const r = await context.request.post('/api/auth/refresh')
  expect(r.ok(), 'the browser holds a session').toBe(true)
  return ((await r.json()) as { accessToken: string }).accessToken
}

async function api(request: APIRequestContext, token: string, method: 'GET' | 'POST', url: string, data?: unknown) {
  return request.fetch(url, { method, headers: { Authorization: `Bearer ${token}` }, data })
}

/**
 * A row of the "Recent sessions" list for a game. Not just text on the page: a game's name is on the dashboard
 * before it is ever played (as a signal's label), so only a row in the list shows a session arrived.
 */
const sessionRow = (page: Page, game: string) => page.locator('details summary').filter({ hasText: game })

/** The games the server holds sessions of, for a patient, as the family's account reads them. */
async function gamesOf(context: BrowserContext, patientId: string): Promise<string[]> {
  const r = await api(context.request, await accessToken(context), 'GET', `/api/caregiver/patients/${patientId}/sessions`)
  expect(r.status()).toBe(200)
  const rows = (await r.json()) as { gameId: string }[]
  return rows.map((x) => x.gameId)
}

async function signIn(page: Page, email: string) {
  await page.goto('/caregiver/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

function watchForTrouble(page: Page, who: string, into: string[]) {
  page.on('console', (m) => {
    if (m.type() === 'error') into.push(`${who} console: ${m.text()}`)
  })
  page.on('pageerror', (e) => into.push(`${who} pageerror: ${e.message}`))
}

// Fonts and the on-device vision model load from public CDNs; a missing one is the sandbox's, not ours. A 401 is
// expected after a tablet is removed.
const NOT_OURS = /fonts\.(googleapis|gstatic)|jsdelivr|storage\.googleapis|ERR_|Failed to load resource|401/

test.describe.serial('the showcase: a family, a tablet and a doctor', () => {
  const patientName = `Mira Sengupta ${RUN}`
  const trouble: string[] = []
  let family: Page, tablet: Page, doctor: Page
  let familyCtx: BrowserContext, tabletCtx: BrowserContext, doctorCtx: BrowserContext
  let patientId = ''
  let deviceToken = ''

  test.beforeAll(async ({ browser }) => {
    familyCtx = await browser.newContext()
    // The tablet has no service worker here: Playwright's offline switch and its request routing do not reach
    // requests a service worker makes, and the offline behaviour under test is the app's own queue.
    tabletCtx = await browser.newContext({ serviceWorkers: 'block' })
    doctorCtx = await browser.newContext()
    family = await familyCtx.newPage()
    tablet = await tabletCtx.newPage()
    doctor = await doctorCtx.newPage()
    watchForTrouble(family, 'family', trouble)
    watchForTrouble(tablet, 'tablet', trouble)
    watchForTrouble(doctor, 'doctor', trouble)
  })

  test.afterAll(async () => {
    await Promise.all([familyCtx?.close(), tabletCtx?.close(), doctorCtx?.close()])
  })

  // ---------------------------------------------------------------------------------------------- step 2
  test('2. the caregiver signs in and sees a populated dashboard', async () => {
    await signIn(family, 'rupa@example.com')
    await expect(family).toHaveURL(/\/caregiver\/dashboard/)
    await expect(family.getByText('Where she is')).toBeVisible()
    await expect(family.getByText('Recent sessions')).toBeVisible()
    expect(await family.locator('article[aria-label]').count(), 'a card for each domain and sub-signal').toBeGreaterThanOrEqual(7)
    await expect(family.getByText('Confidence').first()).toBeVisible()
    await expect(family.locator('.recharts-wrapper').first()).toBeVisible()

    // The cohort is hers too: the switcher lists the demo patient and the twelve simulated ones.
    const options = await family.locator('select option').count()
    expect(options, 'the demo patient and the 12 of the cohort').toBeGreaterThanOrEqual(13)
  })

  // ---------------------------------------------------------------------------------------------- step 3
  test('3. she adds a new patient with the guardian’s consent, mints a code, and a second browser pairs with it', async () => {
    await family.goto('/caregiver/patients/new')
    await family.getByLabel('Her name').fill(patientName)
    await family.getByRole('checkbox').check()
    await family.getByLabel('Your name, as her guardian').fill('Rupa Baruah')
    await family.getByRole('button', { name: 'Add her' }).click()
    await expect(family.getByText(patientName.split(' ')[0]).first()).toBeVisible()

    const token = await accessToken(familyCtx)
    const list = (await (await api(familyCtx.request, token, 'GET', '/api/patients')).json()) as { id: string; name: string }[]
    patientId = list.find((p) => p.name === patientName)?.id ?? ''
    expect(patientId, 'the new patient is in her list').not.toBe('')

    await family.goto(`/caregiver/dashboard/${patientId}`)
    await expect(family.getByText('Her tablet')).toBeVisible()
    await family.getByRole('button', { name: /Get a (new )?pairing code|Get a new code/ }).click()
    const code = (await family.getByText(/^[A-Z0-9]{4}-[A-Z0-9]{2}$/).first().innerText()).toLowerCase()

    await tablet.goto('/')
    await expect(tablet).toHaveURL(/\/pair$/)
    await tablet.getByLabel('Pairing code: six letters and numbers').fill(code)
    await tablet.getByRole('button', { name: 'Pair this tablet' }).click()
    await expect(tablet).toHaveURL(/\/language$/)
    await tablet.locator('.plaque-fade button').first().click()
    await expect(tablet).toHaveURL(/\/$/)
    deviceToken = (await tablet.evaluate(() => localStorage.getItem('smaran.deviceToken'))) ?? ''
    expect(deviceToken.length, 'the tablet holds its own token').toBeGreaterThan(20)

    await family.goto(`/caregiver/dashboard/${patientId}`)
    await expect(family.getByText('She has not played yet.')).toBeVisible()
    await expect(family.locator('[aria-live="polite"]').filter({ hasText: 'live' })).toBeVisible()
  })

  // ---------------------------------------------------------------------------------------------- step 4
  test('4. games played on the tablet appear on the dashboard within seconds (Duck Roll Call and the Lotus Frog)', async () => {
    // Nothing has been played, so no game's name is on her page yet: what shows up next is what the tablet sent.
    for (const game of ['Duck Roll Call', 'Lotus Frog', 'Morning Rituals']) {
      await expect(sessionRow(family, game), `no ${game} session in her list before she plays`).toHaveCount(0)
    }
    expect(await gamesOf(familyCtx, patientId)).toEqual([])

    await tablet.goto('/game/duck-roll-call')
    await expect(tablet.locator('.drc-btn')).toBeVisible()
    const first = await duckRound(tablet)
    expect(first, 'numbers were flashed and read').toBeGreaterThanOrEqual(3)
    await tablet.evaluate(() => (document.querySelector('.drc-btn') as HTMLElement).click())
    await tablet.waitForTimeout(400)
    await duckRound(tablet)
    await tablet.evaluate(() => (document.querySelector('.drc-btn') as HTMLElement).click())
    await tablet.waitForTimeout(400)
    await duckRound(tablet, true) // one wrong tap, as a person makes
    await tablet.evaluate(() => (document.querySelector('.drc-back') as HTMLElement).click())

    const started = Date.now()
    await expect(sessionRow(family, 'Duck Roll Call').first()).toBeVisible({ timeout: 15_000 })
    const seconds = (Date.now() - started) / 1000
    expect(seconds, 'the dashboard heard about it live, not on a reload').toBeLessThan(15)
    await expect(family.getByText('from 1 reading').first()).toBeVisible()

    // The Lotus Frog is a canvas game. She taps about the pond for a while, then goes home: the visit becomes one
    // session (visits under five seconds are treated as accidental opens).
    await tablet.goto('/game/lotus-frog')
    const canvas = tablet.locator('canvas')
    await expect(canvas).toBeVisible()
    const box = (await canvas.boundingBox())!
    const t0 = Date.now()
    while (Date.now() - t0 < 12_000) {
      await tablet.mouse.click(box.x + box.width * (0.25 + Math.random() * 0.5), box.y + box.height * (0.35 + Math.random() * 0.4))
      await tablet.waitForTimeout(450)
    }
    await tablet.getByRole('button', { name: /Back to the pond/ }).click()
    await expect(sessionRow(family, 'Lotus Frog').first()).toBeVisible({ timeout: 15_000 })
    // And the server holds both, which is what the page is showing.
    expect((await gamesOf(familyCtx, patientId)).sort()).toEqual(['duck-roll-call', 'lotus-frog'])
  })

  // ---------------------------------------------------------------------------------------------- step 5
  test('5. offline play is queued and syncs once; replaying the batch changes nothing', async () => {
    await tablet.goto('/game/morning-rituals')
    await tablet.waitForTimeout(1500)
    await tabletCtx.setOffline(true)
    await playRituals(tablet)
    await expect.poll(async () => (await pendingSessions(tablet)).length, { timeout: 10_000 }).toBe(1)
    const queued = (await pendingSessions(tablet)) as { gameId: string; trials: unknown[]; contributions: { because: string }[] }[]
    expect(queued[0].gameId).toBe('morning-rituals')
    expect(queued[0].trials.length, 'the raw attempts travel with it').toBeGreaterThanOrEqual(3)
    expect(queued[0].contributions[0].because, 'and the reasons').toBeTruthy()

    await tabletCtx.setOffline(false)
    await tablet.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect.poll(async () => (await pendingSessions(tablet)).length, { timeout: 15_000 }).toBe(0)
    await expect(sessionRow(family, 'Morning Rituals').first()).toBeVisible({ timeout: 15_000 })
    expect((await gamesOf(familyCtx, patientId)).sort(), 'one session of each, once').toEqual(['duck-roll-call', 'lotus-frog', 'morning-rituals'])

    const rowsBefore = await family.locator('details').count()
    const replay = await tablet.evaluate(
      async ([token, sessions]) => {
        const r = await fetch('/api/device/sessions/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ sessions }),
        })
        return r.json()
      },
      [deviceToken, queued] as const,
    )
    expect(replay.accepted, 'nothing new was accepted').toBe(0)
    expect(replay.duplicates, 'the one session was recognised').toBe(1)
    await family.waitForTimeout(1500)
    expect(await family.locator('details').count(), 'the list did not grow').toBe(rowsBefore)
    expect(await gamesOf(familyCtx, patientId), 'and the server still holds three sessions').toHaveLength(3)
  })

  // ---------------------------------------------------------------------------------------------- step 6
  test('6. a doctor sees only the patients who shared with her, read-only', async () => {
    await family.getByLabel('Doctor').fill('meera.das@example.com')
    await family.getByRole('button', { name: 'Share' }).click()
    await expect(family.getByText('Meera Das').first()).toBeVisible()

    await signIn(doctor, 'meera.das@example.com')
    await expect(doctor).toHaveURL(/\/doctor/)
    await expect(doctor.getByText(patientName)).toBeVisible()
    expect(await doctor.locator('body').innerText(), 'her home lists only who shared with her, not the cohort').not.toContain('Simulated')
    await doctor.locator('li', { hasText: patientName }).getByRole('link').first().click()
    await expect(doctor).toHaveURL(/\/doctor\/patient\//)
    await expect(doctor.getByText('Where she is')).toBeVisible()
    const text = await doctor.locator('body').innerText()
    expect(text).toContain('Read-only.')
    expect(text).toContain('Shared with you until')
    for (const familyOnly of ['Who she still knows', 'Add another person', 'Her tablet', 'Who can see her']) {
      expect(text, `the family's panel "${familyOnly}" is not on the doctor's page`).not.toContain(familyOnly)
    }
    for (const raw of ['spanlength', 'flashduration', 'correctfirstattempt']) {
      expect(text.toLowerCase(), `no raw trials on the page (${raw})`).not.toContain(raw)
    }

    const token = await accessToken(doctorCtx)
    const sessions = await api(doctorCtx.request, token, 'GET', `/api/caregiver/patients/${patientId}/sessions`)
    expect(sessions.status()).toBe(200)
    const body = await sessions.text()
    expect(body.toLowerCase(), 'sessions without their raw trials').not.toContain('trials')

    // The twelve simulated patients belong to the same family and have not been shared with this doctor (the seeder
    // shares only the demo patient with her, and this run shared the new one): for her they do not exist, and the
    // answer is the same as for an id that never existed.
    const others = (await (await api(familyCtx.request, await accessToken(familyCtx), 'GET', '/api/patients')).json()) as { id: string }[]
    const notShared = others.find((p) => p.id.startsWith('cohort-'))!.id
    expect((await api(doctorCtx.request, token, 'GET', `/api/caregiver/patients/${notShared}/sessions`)).status()).toBe(404)
    expect((await api(doctorCtx.request, token, 'GET', `/api/caregiver/patients/${crypto.randomUUID()}/sessions`)).status()).toBe(404)

    const dash = (await (await api(doctorCtx.request, token, 'GET', `/api/caregiver/dashboard/${patientId}`)).json()) as {
      doctorView: boolean
      familyPhases: unknown[]
    }
    expect(dash.doctorView).toBe(true)
    expect(dash.familyPhases).toEqual([])
    expect((await api(doctorCtx.request, token, 'POST', `/api/patients/${patientId}/pairing-codes`)).status(), 'a doctor cannot mint a code').toBe(403)
  })

  // ---------------------------------------------------------------------------------------------- step 7
  test('7. the caregiver revokes the tablet; it is refused and goes quiet without alarming her', async () => {
    await family.goto(`/caregiver/dashboard/${patientId}`)
    // The heading, not the text: once the list has loaded, the tablet's own name ("Her tablet") is on the page too.
    await expect(family.getByRole('heading', { name: 'Her tablet' })).toBeVisible()
    await family.getByRole('button', { name: 'Remove' }).click()
    await family.getByRole('button', { name: 'Yes, remove access' }).click()
    await expect(family.getByText('None yet')).toBeVisible()

    const status = await tablet.evaluate(async (token) => {
      const r = await fetch('/api/device/sessions/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sessions: [] }),
      })
      return r.status
    }, deviceToken)
    expect(status, 'its next sync is refused').toBe(401)

    await tablet.goto('/')
    await tablet.waitForTimeout(2500)
    const text = (await tablet.locator('body').innerText()).toLowerCase()
    expect(new URL(tablet.url()).pathname, 'she is still at her pond').toBe('/')
    for (const alarming of ['revoked', 'removed', 'unauthor', 'error', 'denied']) {
      expect(text, `nothing on her screen says "${alarming}"`).not.toContain(alarming)
    }
    expect(await tablet.evaluate(() => localStorage.getItem('smaran.deviceSuspendedAt')), 'it has quietly stopped asking').not.toBeNull()
  })

  test('no uncaught errors in any of the three pages', () => {
    expect(trouble.filter((t) => !NOT_OURS.test(t))).toEqual([])
  })
})
