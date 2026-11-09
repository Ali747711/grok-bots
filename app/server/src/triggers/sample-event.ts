import { signGeneric, signGithub } from './verify.js'
import type { Trigger } from './types.js'

/** A signed sample request for Send test event, built exactly like a real sender would (R11). */
export function sampleEvent(trigger: Trigger, nowMs: number, deliveryId: string): { raw: Buffer; headers: Headers } {
  if (trigger.source === 'github') {
    const raw = Buffer.from(JSON.stringify({
      action: trigger.actions[0] ?? 'opened',
      issue: {
        number: 1,
        title: 'Test event from Crew',
        body: "This is a sample event sent by Crew's Send test event button.",
        html_url: 'https://github.com/example/repo/issues/1'
      },
      repository: { full_name: 'example/repo' },
      sender: { login: 'crew' },
      // Makes every sample a different request: replays of one signature are refused.
      crew_test_id: deliveryId
    }))
    return {
      raw,
      headers: new Headers({
        'content-type': 'application/json',
        'x-github-event': trigger.events[0] ?? 'issues',
        'x-github-delivery': deliveryId,
        'x-hub-signature-256': signGithub(raw, trigger.secret)
      })
    }
  }
  const raw = Buffer.from(JSON.stringify({ message: 'Test event from Crew', id: deliveryId }))
  const timestamp = String(Math.floor(nowMs / 1000))
  return {
    raw,
    headers: new Headers({
      'content-type': 'application/json',
      'x-crew-event': trigger.events[0] ?? 'test',
      'x-crew-delivery': deliveryId,
      'x-crew-timestamp': timestamp,
      'x-crew-signature': signGeneric(raw, trigger.secret, timestamp)
    })
  }
}
