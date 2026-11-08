import { crewFetch } from './crew-api'

/** A non-2xx answer from Crew: the status and the parsed JSON body (or null). */
export class CrewApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown> | null
  ) {
    super(`Crew answered ${status}`)
    this.name = 'CrewApiError'
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** JSON request to Crew. Statuses in `accept` resolve with their body instead of throwing; 204 resolves undefined. */
export async function crewJson<T>(path: string, method: string, body?: unknown, accept: readonly number[] = []): Promise<T> {
  const res = await crewFetch(path, {
    method,
    ...(body === undefined ? {} : { headers: JSON_HEADERS, body: JSON.stringify(body) })
  })
  if (!res.ok && !accept.includes(res.status)) {
    const parsed: unknown = await res.json().catch(() => null)
    throw new CrewApiError(res.status, parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}
