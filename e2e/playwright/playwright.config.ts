import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests of a running Smaran stack.
 *
 *   BASE_URL=http://localhost:8081 npx playwright test
 *
 * The stack is whatever BASE_URL answers: `docker compose up --build` in development, and the same
 * compose in CI. Traces are kept when a test fails (and uploaded by CI), so a failure can be replayed.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:8081',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
