/** Minimal page that redeems the `#ticket=` from a `crew login` link. The ticket never reaches server logs. */
export const LOGIN_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crew · Sign in</title>
<style>
  * { box-sizing: border-box; }
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; display: grid; place-items: center;
         min-height: 100vh; margin: 0; padding: 16px; color: #0d0d0d;
         background: radial-gradient(180px 60px at 18% 94%, rgba(255,255,255,.85), transparent 70%),
                     radial-gradient(240px 75px at 55% 100%, rgba(255,255,255,.8), transparent 70%),
                     radial-gradient(200px 68px at 88% 92%, rgba(255,255,255,.75), transparent 70%),
                     linear-gradient(180deg, #2a8af0 0%, #4ea4f6 55%, #bcdcfb 100%); }
  @media (prefers-color-scheme: dark) { body { background: #050505; } }
  main { width: 100%; max-width: 380px; padding: 32px 28px; text-align: center; background: rgba(255,255,255,.95); border-radius: 24px;
         box-shadow: 0 12px 40px rgba(13,13,13,.18); }
  @media (prefers-color-scheme: dark) { main { background: #131416; color: #f3f4f6; } }
  h1 { margin: 0 0 8px; font-size: 26px; letter-spacing: -.01em; }
  p { margin: 0; color: #6b7280; }
  @media (prefers-color-scheme: dark) { p { color: #9ca3af; } }
  .pill { display: inline-block; margin-bottom: 16px; padding: 3px 12px; border-radius: 999px; background: #d6f55a; color: #0d0d0d;
          font: 600 10px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .12em; text-transform: uppercase; }
  code { background: #f2f4f6; color: #0d0d0d; padding: 2px 6px; border-radius: 6px; }
  @media (prefers-color-scheme: dark) { code { background: #1d1f22; color: #f3f4f6; } }
</style>
</head>
<body>
<main>
  <span class="pill">Sign in</span>
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
