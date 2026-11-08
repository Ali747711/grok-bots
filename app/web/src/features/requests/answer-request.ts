import { crewFetch } from '@/lib/crew-api'

export type AnswerBody = { choice: string } | { answer: string } | { value: string }

const MESSAGES: Record<number, string> = {
  400: 'That answer was not accepted',
  404: 'This request is no longer waiting',
  503: 'Hermes is offline — try again when it’s back'
}

/**
 * Send the user's answer through Crew (the browser never talks to Hermes for this).
 * Resolves null when the answer was handed over, otherwise a short plain-words message.
 * The body may hold a secret: it is only passed to fetch, never logged or stored.
 */
export async function submitAnswer(id: string, body: AnswerBody): Promise<string | null> {
  let res: Response
  try {
    res = await crewFetch(`/crew/requests/${encodeURIComponent(id)}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  } catch {
    return 'Could not reach Crew — try again'
  }
  if (res.status === 202) return null
  const reply = (await res.json().catch(() => null)) as { status?: string } | null
  if (res.status === 409) return reply?.status === 'answering' ? null : 'Already answered'
  if (res.status === 422) return 'Answer this in the app that asked'
  return MESSAGES[res.status] ?? `Something went wrong (${res.status})`
}
