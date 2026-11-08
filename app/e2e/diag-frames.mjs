// Diagnostic (not a test): record WebSocket frames between the Crew page and Hermes for N seconds.
// Usage: node diag-frames.mjs <seconds>
import { chromium } from '@playwright/test'

const seconds = Number(process.argv[2] ?? 120)
const browser = await chromium.launch()
const ctx = await browser.newContext({ storageState: '.auth/crew.json' })
const page = await ctx.newPage()
const t0 = Date.now()
const at = () => ((Date.now() - t0) / 1000).toFixed(1)
page.on('websocket', ws => {
  process.stdout.write(`${at()} ws open ${ws.url()}\n`)
  ws.on('framereceived', f => {
    const s = String(f.payload)
    if (/"id":"srq-|"method":"(approval|clarify|sudo|secret)"|approval\.(request|settled)|request\.cancel/.test(s)) process.stdout.write(`${at()} <= ${s.slice(0, 400)}\n`)
  })
  ws.on('framesent', f => {
    const s = String(f.payload)
    if (/srq-|approval|clarify|"error"|respond/.test(s)) process.stdout.write(`${at()} => ${s.slice(0, 400)}\n`)
  })
  ws.on('close', () => process.stdout.write(`${at()} ws closed\n`))
})
await page.goto('http://127.0.0.1:7070/bots/crew-test')
await page.waitForTimeout(seconds * 1000)
await browser.close()
