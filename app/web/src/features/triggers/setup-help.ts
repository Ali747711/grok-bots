export const GITHUB_EVENTS = ['issues', 'issue_comment', 'pull_request', 'push', 'release', 'workflow_run'] as const

export function githubSteps(events: readonly string[]): string[] {
  return [
    "In GitHub, open the repository's Settings → Webhooks → Add webhook.",
    'Payload URL: the URL above.',
    'Content type: application/json.',
    'Secret: the secret above.',
    `Events: ${events.length ? events.join(', ') : 'Send me everything'}.`
  ]
}

export const GENERIC_HELP =
  'Sign <timestamp>.<body> with HMAC-SHA256 and the secret. Send it as X-Crew-Signature: sha256=<hex>, with X-Crew-Timestamp: <unix seconds> (within 5 minutes). X-Crew-Event and X-Crew-Delivery are optional.'

export function curlExample(url: string, secret: string, eventType: string): string {
  return [
    `URL='${url}'`,
    `SECRET='${secret}'`,
    `BODY='{"message":"hello from curl"}'`,
    'TS=$(date +%s)',
    `SIG=$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')`,
    'curl -sS -X POST "$URL" \\',
    "  -H 'Content-Type: application/json' \\",
    '  -H "X-Crew-Timestamp: $TS" \\',
    '  -H "X-Crew-Signature: sha256=$SIG" \\',
    `  -H 'X-Crew-Event: ${eventType}' \\`,
    '  --data "$BODY"'
  ].join('\n')
}
