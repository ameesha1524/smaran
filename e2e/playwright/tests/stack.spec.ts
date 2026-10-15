import { expect, test, type Page } from '@playwright/test'

/**
 * The stack as a person meets it: the app loads cleanly, a family adds her and pairs a tablet, the
 * tablet reaches her pond, and removing the tablet shuts it out. Phase 7 extends this to the whole
 * showcase script (games, dashboards, the doctor); this is the part that proves the deployed shape
 * (nginx, the proxy, security headers, the API behind them) holds together.
 */

const PASSWORD = 'correct horse battery staple'

// Trying the production stack on one machine means a certificate made by Caddy's own local authority, which a
// browser will not let a Service Worker use. That is the only thing excused, and only for localhost.
const LOCAL_CERT = (process.env.BASE_URL ?? '').startsWith('https://localhost') ? '|SSL certificate error' : ''
// In a template literal a single backslash is dropped, so each dot is escaped twice to reach the RegExp.
const NOT_OURS = new RegExp(`fonts\\.(googleapis|gstatic)|jsdelivr|storage\\.googleapis|ERR_|Failed to load resource${LOCAL_CERT}`)

function watchForTrouble(page: Page, into: string[]) {
  page.on('console', (m) => {
    if (m.type() === 'error') into.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => into.push(`pageerror: ${e.message}`))
}

test('the app loads with its security headers and without a single policy violation', async ({ page, request }) => {
  const trouble: string[] = []
  watchForTrouble(page, trouble)
  page.on('securitypolicyviolation' as never, () => trouble.push('csp violation'))

  const response = await page.goto('/')
  expect(response?.status()).toBe(200)
  const h = response!.headers()
  expect(h['content-security-policy']).toContain("default-src 'self'")
  expect(h['x-content-type-options']).toBe('nosniff')
  expect(h['x-frame-options']).toBe('DENY')

  // An untouched tablet is sent to pair; the page must have drawn something.
  await expect(page.getByText('Pair this tablet').first()).toBeVisible()

  // The Service Worker is what lets a tablet work with no signal, and must never be cached.
  const sw = await request.get('/service-worker.js')
  expect(sw.status()).toBe(200)
  expect(sw.headers()['cache-control']).toMatch(/no-cache/)

  // Only health and info are reachable from outside.
  expect((await request.get('/actuator/health')).status()).toBe(200)
  expect((await request.get('/actuator/prometheus')).status()).toBe(404)
  expect((await request.get('/actuator/env')).status()).toBe(404)
  expect((await request.get('/api/caregiver/dashboard/anyone')).status()).toBe(401)

  // Failures to reach Google Fonts or the MediaPipe CDN (a runner may have no outside access) are not ours.
  const ours = trouble.filter((t) => !NOT_OURS.test(t))
  expect(ours).toEqual([])
})

test('a family adds her, pairs a tablet, and removing the tablet shuts it out', async ({ browser }) => {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const patientName = `Pond Tester ${Date.now() % 100000}`

  const family = await (await browser.newContext()).newPage()
  const tablet = await (await browser.newContext()).newPage()
  const trouble: string[] = []
  watchForTrouble(family, trouble)
  watchForTrouble(tablet, trouble)

  // --- the family
  await family.goto('/caregiver/register')
  await family.getByLabel('Your name').fill('Rupa Sharma')
  await family.getByLabel('Email').fill(email)
  await family.getByLabel('Password').fill(PASSWORD)
  await family.getByRole('button', { name: 'Create account' }).click()
  await expect(family.getByText('You have not added anyone yet')).toBeVisible()
  await family.getByText('Add the person you care for').click()
  await family.getByLabel('Her name').fill(patientName)
  await family.getByRole('checkbox').check()
  await family.getByLabel('Your name, as her guardian').fill('Rupa Sharma')
  await family.getByRole('button', { name: 'Add her' }).click()
  await expect(family.getByText(patientName.split(' ')[0]).first()).toBeVisible()

  await family.goto('/caregiver/dashboard')
  await expect(family.getByText('Her tablet')).toBeVisible()
  await family.getByRole('button', { name: /Get a (new )?pairing code|Get a new code/ }).click()
  const codeText = await family.getByText(/^[A-Z0-9]{4}-[A-Z0-9]{2}$/).first().innerText()

  // --- the tablet, a different browser with nothing in common
  await tablet.goto('/')
  await expect(tablet).toHaveURL(/\/pair$/)
  await tablet.getByLabel('Pairing code: six letters and numbers').fill(codeText.toLowerCase())
  await tablet.getByRole('button', { name: 'Pair this tablet' }).click()
  await expect(tablet).toHaveURL(/\/language$/)
  await tablet.locator('.plaque-fade button').first().click()
  await expect(tablet).toHaveURL(/\/$/)

  // --- the family sees it, and removes it
  await family.goto('/caregiver/dashboard')
  await expect(family.getByText('Paired just now')).toBeVisible()
  await family.getByRole('button', { name: 'Remove' }).click()
  await family.getByRole('button', { name: 'Yes, remove access' }).click()
  await expect(family.getByText('None yet')).toBeVisible()

  // --- the tablet is refused on its next request, and says nothing alarming about it
  const status = await tablet.evaluate(async () => {
    const token = localStorage.getItem('smaran.deviceToken')
    const r = await fetch('/api/device/me', { headers: { Authorization: `Bearer ${token}` } })
    return r.status
  })
  expect(status).toBe(401)

  const ours = trouble.filter((t) => !NOT_OURS.test(t) && !/401/.test(t))
  expect(ours).toEqual([])
})
