import { defineConfig } from 'vitest/config'

// Kept apart from vite.config.ts: unit tests cover pure logic and need
// neither React nor the PWA plugin.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
