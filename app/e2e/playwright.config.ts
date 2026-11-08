import { defineConfig } from '@playwright/test'

// Live acceptance against the deployed VM through SSH tunnels; one worker so turns don't overlap.
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 60_000 },
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:7070',
    storageState: '.auth/crew.json',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
})
