const CSRF_COOKIE = 'crew_csrf'
const CSRF_HEADER = 'X-Crew-CSRF'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function readCookie(name: string): string | null {
  for (const part of document.cookie.split('; ')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1))
  }
  return null
}

/**
 * Same-origin fetch to the Crew server. Adds the CSRF header on mutating
 * requests and sends the user to /login when the session is gone.
 */
export async function crewFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const method = (init.method ?? 'GET').toUpperCase()
  if (!SAFE_METHODS.has(method)) {
    const token = readCookie(CSRF_COOKIE)
    if (token) headers.set(CSRF_HEADER, token)
  }
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  if (res.status === 401) location.href = '/login'
  return res
}
