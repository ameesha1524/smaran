import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'

/**
 * Takes the pictures the README shows, from the demo stack. Skipped unless asked for:
 *
 *   make demo
 *   cd e2e/playwright && SCREENSHOTS=1 BASE_URL=http://localhost:8081 npx playwright test screenshots
 *
 * They are written to docs/screenshots/. Everything in them is synthetic: the people are the simulator's, the
 * names are "Simulated 0010" and the demo family's. Re-take them when a screen changes.
 */

const REPO = path.resolve(process.cwd(), '..', '..')
const OUT = path.join(REPO, 'docs', 'screenshots')
const PASSWORD = 'smaran'

const cohort = JSON.parse(readFileSync(path.join(REPO, 'demo', 'cohort', 'envelopes.json'), 'utf8')) as {
  patients: { patientId: string; trajectory: string }[]
}
const idOf = (trajectory: string) => cohort.patients.find((p) => p.trajectory === trajectory)!.patientId.replace('sim-', 'cohort-')

test.skip(!process.env.SCREENSHOTS, 'screenshots are taken on request (SCREENSHOTS=1)')

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/caregiver/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('the family dashboard: a patient whose scores are falling, on a computer and on a phone', async ({ browser }) => {
  const desktop = await (await browser.newContext({ viewport: { width: 1280, height: 1500 } })).newPage()
  await signIn(desktop, 'rupa@example.com')
  await expect(desktop.getByText('Where she is')).toBeVisible()
  await desktop.goto(`/caregiver/dashboard/${idOf('fast_decline')}`)
  await expect(desktop.getByText('Where she is')).toBeVisible()
  await expect(desktop.locator('.recharts-wrapper').first()).toBeVisible()
  await desktop.waitForTimeout(1500)
  await desktop.screenshot({ path: path.join(OUT, 'family-dashboard.png'), animations: 'disabled' })
  await desktop.context().close()

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage()
  await signIn(phone, 'rupa@example.com')
  await expect(phone.getByText('Where she is')).toBeVisible()
  await phone.goto(`/caregiver/dashboard/${idOf('slow_decline')}`)
  await expect(phone.getByText('Where she is')).toBeVisible()
  await expect(phone.locator('.recharts-wrapper').first()).toBeVisible()
  await phone.waitForTimeout(1500)
  await phone.screenshot({ path: path.join(OUT, 'family-dashboard-phone.png'), animations: 'disabled' })
  await phone.context().close()
})

test('the doctor’s read-only view', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1300 } })).newPage()
  await signIn(page, 'meera.das@example.com')
  await expect(page).toHaveURL(/\/doctor/)
  await page.locator('a[href$="demo-patient"]').click()
  await expect(page.getByText('Read-only.')).toBeVisible()
  await expect(page.locator('.recharts-wrapper').first()).toBeVisible()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: path.join(OUT, 'doctor-view.png'), animations: 'disabled' })
  await page.context().close()
})

test('the tablet: pairing, her pond, and a game', async ({ browser }) => {
  const family = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  const tabletCtx = await browser.newContext({ viewport: { width: 1024, height: 768 }, serviceWorkers: 'block' })
  const tablet = await tabletCtx.newPage()

  await signIn(family, 'rupa@example.com')
  await expect(family.getByText('Where she is')).toBeVisible()
  await family.goto('/caregiver/patients/new')
  await family.getByLabel('Her name').fill('Anima Gogoi')
  await family.getByRole('checkbox').check()
  await family.getByLabel('Your name, as her guardian').fill('Rupa Baruah')
  await family.getByRole('button', { name: 'Add her' }).click()
  await expect(family.getByText('Anima').first()).toBeVisible()
  await family.getByRole('button', { name: /Get a (new )?pairing code|Get a new code/ }).click()
  const code = (await family.getByText(/^[A-Z0-9]{4}-[A-Z0-9]{2}$/).first().innerText()).toLowerCase()

  await tablet.goto('/')
  await expect(tablet).toHaveURL(/\/pair$/)
  await tablet.getByLabel('Pairing code: six letters and numbers').fill(code)
  await tablet.screenshot({ path: path.join(OUT, 'tablet-pairing.png'), animations: 'disabled' })
  await tablet.getByRole('button', { name: 'Pair this tablet' }).click()
  await expect(tablet).toHaveURL(/\/language$/)
  await tablet.locator('.plaque-fade button').first().click()
  await expect(tablet).toHaveURL(/\/$/)
  await tablet.waitForTimeout(3000)
  await tablet.screenshot({ path: path.join(OUT, 'tablet-pond.png') })

  await tablet.goto('/game/duck-roll-call')
  await expect(tablet.locator('.drc-btn')).toBeVisible()
  await tablet.waitForTimeout(1200)
  await tablet.screenshot({ path: path.join(OUT, 'tablet-game.png') })
  await family.context().close()
  await tabletCtx.close()
})
