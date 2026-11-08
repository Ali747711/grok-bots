/** Parse a raw Cookie header into name → value (first occurrence wins). */
export function parseCookieHeader(header: string | undefined): Readonly<Record<string, string>> {
  if (!header) return {}
  const entries = header.split(';').flatMap(part => {
    const index = part.indexOf('=')
    if (index <= 0) return []
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    return name ? [[name, value] as const] : []
  })
  return entries.reduce<Record<string, string>>(
    (acc, [name, value]) => (name in acc ? acc : { ...acc, [name]: value }),
    {}
  )
}
