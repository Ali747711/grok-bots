import { mkdirSync } from 'node:fs'

import { chromium } from '@playwright/test'

import { crewLoginUrl, deleteTestBots } from './helpers.js'

/** Log in to Crew once with a fresh one-use link and save the cookie for every test. */
export default async function globalSetup(): Promise<void> {
  await deleteTestBots()
  mkdirSync('.auth', { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(crewLoginUrl())
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15_000 })
  await page.context().storageState({ path: '.auth/crew.json' })
  await browser.close()
}
