/** Minimal page that redeems the `#ticket=` from a `crew login` link. The ticket never reaches server logs. */
export const LOGIN_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crew · Sign in</title>
<style>
  /* Crew UI 2 tokens, copied as literals from docs/ui2/tokens.md: this page loads no stylesheet, font or script file. */
  :root { color-scheme: light dark; --canvas: oklch(0.955 0 0); --card: oklch(0.995 0 0); --text: oklch(0.145 0 0);
          --muted: oklch(0.515 0 0); --chip: oklch(0.965 0 0);
          --panel-shadow: 0 1px 2px oklch(0 0 0 / 5%), 0 8px 24px -8px oklch(0 0 0 / 10%); }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; display: grid; place-items: center;
         min-height: 100vh; margin: 0; padding: 16px; color: var(--text); background: var(--canvas); }
  main { width: 100%; max-width: 380px; padding: 32px 28px; text-align: center; background: var(--card); border-radius: 24px;
         box-shadow: var(--panel-shadow); }
  h1 { margin: 0 0 8px; font-size: 24px; font-weight: 600; letter-spacing: -.02em; }
  p { margin: 0; color: var(--muted); font-weight: 500; }
  .kicker { margin-bottom: 6px; font-size: 12px; }
  code { padding: 2px 6px; border-radius: 6px; background: var(--chip); color: var(--text);
         font: 12px/1.5 ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; }
  @media (prefers-color-scheme: dark) {
    :root { --canvas: oklch(0.145 0 0); --card: oklch(0.205 0 0); --text: oklch(0.985 0 0);
            --muted: oklch(0.74 0 0); --chip: oklch(0.269 0 0); }
    main { box-shadow: none; }
  }
</style>
</head>
<body>
<main>
  <p class="kicker">Sign in</p>
  <h1>Crew</h1>
  <p id="msg">Signing you in…</p>
</main>
<script>
  (async () => {
    const msg = document.getElementById('msg')
    const ticket = new URLSearchParams(location.hash.slice(1)).get('ticket')
    history.replaceState(null, '', location.pathname)
    if (!ticket) {
      msg.innerHTML = 'Open the link printed by <code>crew login</code> in the VM.'
      return
    }
    const res = await fetch('/crew/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket })
    })
    if (res.status === 204) {
      location.replace('/')
    } else {
      msg.innerHTML = 'This link expired or was already used. Run <code>crew login</code> in the VM for a new one.'
    }
  })()
</script>
</body>
</html>`
