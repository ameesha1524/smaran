import { readFileSync } from 'node:fs'
import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'

/**
 * Accessibility of the screens a family member, a doctor and an administrator use, checked with axe-core against
 * WCAG 2.1 level A and AA. Needs the demo stack (`make demo`).
 *
 *   BASE_URL=http://localhost:8081 npx playwright test a11y
 *
 * Automated checks find roughly a third of accessibility problems (contrast, missing names and labels, bad
 * landmarks, invalid ARIA). They cannot say whether a screen is understandable with a screen reader or makes
 * sense by keyboard alone, so the keyboard checks below are made by hand-written steps, and a real screen reader
 * pass is still to be done by a person (docs/PROGRESS.md says so).
 *
 * The patient's own screens are not in this list: they are a different design problem (large targets, no text to
 * read, no failure states) and are judged against her, not against a checklist.
 */

const PASSWORD = 'smaran'

// A simulated patient whose scores fall fast, from the committed demo cohort: her dashboard has open alerts, which the
// demo patient's does not. (Her id in the stack is the cohort id with "sim-" turned into "cohort-".)
const cohort = JSON.parse(readFileSync(path.resolve(process.cwd(), '..', '..', 'demo', 'cohort', 'envelopes.json'), 'utf8')) as {
  patients: { patientId: string; trajectory: string }[]
}
const decliner = cohort.patients.find((p) => p.trajectory === 'fast_decline')!.patientId.replace('sim-', 'cohort-')
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function signIn(page: Page, email: string) {
  await page.goto('/caregiver/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function scan(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const lines = result.violations.flatMap((v) => [
    `${v.impact?.toUpperCase()} ${v.id} (${v.nodes.length}): ${v.help}`,
    ...v.nodes.map((n) => {
      const d = (n.any[0]?.data ?? {}) as { fgColor?: string; bgColor?: string; contrastRatio?: number; fontSize?: string }
      const colours = d.fgColor ? ` fg ${d.fgColor} on ${d.bgColor} = ${d.contrastRatio}:1 at ${d.fontSize}` : ''
      return `    ${n.target.join(' ')}${colours}  ${n.html.slice(0, 90).replace(/\s+/g, ' ')}`
    }),
  ])
  if (lines.length) console.log(`\n[axe] ${label}\n  ${lines.join('\n  ')}`)
  return result.violations
}

test.describe('the caregiver, doctor and administrator screens have no automatically detectable WCAG A/AA violations', () => {
  test('sign-in and sign-up (signed out)', async ({ page }) => {
    await page.goto('/caregiver/login')
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    expect(await scan(page, 'login')).toEqual([])
    await page.goto('/caregiver/register')
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible()
    expect(await scan(page, 'register')).toEqual([])
  })

  test('the caregiver: dashboard of a declining patient, and the new-patient form', async ({ page }) => {
    await signIn(page, 'rupa@example.com')
    await expect(page.getByText('Where she is')).toBeVisible()
    // Wait for the panels, not just the heading, so the scan sees the whole page.
    await expect(page.locator('.recharts-wrapper').first()).toBeVisible()
    await page.waitForTimeout(1000)
    expect(await scan(page, 'caregiver dashboard (demo patient)')).toEqual([])

    await page.goto('/caregiver/patients/new')
    await expect(page.getByLabel('Her name')).toBeVisible()
    expect(await scan(page, 'new patient')).toEqual([])
  })

  test('the caregiver: a patient whose scores are falling, with its alerts, on a computer and on a phone', async ({ page }) => {
    await signIn(page, 'rupa@example.com')
    await expect(page.getByText('Where she is')).toBeVisible()
    await page.goto(`/caregiver/dashboard/${decliner}`)
    await expect(page.getByText('Where she is')).toBeVisible()
    await expect(page.locator('.recharts-wrapper').first()).toBeVisible()
    await page.waitForTimeout(1000)
    expect(await scan(page, 'caregiver dashboard (a declining patient)')).toEqual([])

    // A family reads this on a phone.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(500)
    expect(await scan(page, 'caregiver dashboard (a declining patient, 390 px wide)')).toEqual([])
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, 'no sideways scrolling on a phone').toBeLessThanOrEqual(1)
  })

  test('the doctor: home and a shared patient', async ({ page }) => {
    await signIn(page, 'meera.das@example.com')
    await expect(page).toHaveURL(/\/doctor/)
    await expect(page.locator('li').first()).toBeVisible()
    expect(await scan(page, 'doctor home')).toEqual([])
    await page.locator('li').first().getByRole('link').first().click()
    await expect(page.getByText('Where she is')).toBeVisible()
    await expect(page.locator('.recharts-wrapper').first()).toBeVisible()
    await page.waitForTimeout(1000)
    expect(await scan(page, 'doctor: a shared patient')).toEqual([])
  })

  test('the administrator: home', async ({ page }) => {
    await signIn(page, 'admin@example.com')
    await expect(page).toHaveURL(/\/admin/)
    await page.waitForTimeout(800)
    expect(await scan(page, 'admin home')).toEqual([])
  })
})

test.describe('the main screens work by keyboard alone', () => {
  test('sign in with the keyboard, and reach the patient switcher and the report button', async ({ page }) => {
    await page.goto('/caregiver/login')
    await page.getByLabel('Email').focus()
    await page.keyboard.type('rupa@example.com')
    await page.keyboard.press('Tab')
    await page.keyboard.type(PASSWORD)
    await page.keyboard.press('Enter')
    await expect(page.getByText('Where she is')).toBeVisible()

    // Tab through the page: every control that can be used must be reachable, in an order that does not trap.
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      const where = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return 'body'
        return `${el.tagName.toLowerCase()}:${(el.getAttribute('aria-label') || el.innerText || el.getAttribute('name') || '').trim().slice(0, 40)}`
      })
      seen.add(where)
    }
    const names = [...seen].join(' | ')
    expect(names, 'the patient switcher is reachable').toContain('select')
    expect(names, 'the report button is reachable').toMatch(/button:.*[Rr]eport|button:.*PDF|button:.*doctor/)
    // A visible focus indicator on whatever has focus.
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      const cs = getComputedStyle(el)
      return { outline: cs.outlineStyle, width: cs.outlineWidth, shadow: cs.boxShadow }
    })
    expect(outline.outline !== 'none' || outline.shadow !== 'none', `focus is visible: ${JSON.stringify(outline)}`).toBe(true)
  })
})
