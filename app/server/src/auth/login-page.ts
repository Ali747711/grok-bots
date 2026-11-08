/** Minimal page that redeems the `#ticket=` from a `crew login` link. The ticket never reaches server logs. */
export const LOGIN_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crew · Sign in</title>
<style>
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: grid; place-items: center;
         min-height: 100vh; margin: 0; background: #fafaf9; color: #1c1917; }
  @media (prefers-color-scheme: dark) { body { background: #0c0a09; color: #f5f5f4; } }
  main { max-width: 360px; padding: 24px; text-align: center; }
  code { background: rgba(127,127,127,.15); padding: 2px 6px; border-radius: 6px; }
</style>
</head>
<body>
<main>
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
