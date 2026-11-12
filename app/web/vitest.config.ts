import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['test/setup.ts'],
    // jsdom tests with real timers pass in well under a second alone, but the full suite under load (or beside e2e) crossed the 5 s default.
    testTimeout: 15_000
  }
})
