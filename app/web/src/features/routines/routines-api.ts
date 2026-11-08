import { crewJson } from '@/lib/crew-json'

import type { RoutineInput, RoutineView, RunView, ScheduleSpec } from './types'

export { CrewApiError } from '@/lib/crew-json'

const base = (bot: string, id?: string, action?: string) =>
  `/crew/routines${id ? `/${encodeURIComponent(id)}` : ''}${action ? `/${action}` : ''}?bot=${encodeURIComponent(bot)}`

export const listRoutines = (bot: string) => crewJson<RoutineView[]>(base(bot), 'GET')
export const createRoutine = (bot: string, input: RoutineInput) => crewJson<RoutineView>(base(bot), 'POST', input)
export const updateRoutine = (bot: string, id: string, input: RoutineInput) => crewJson<RoutineView>(base(bot, id), 'PUT', input)
export const pauseRoutine = (bot: string, id: string) => crewJson<RoutineView>(base(bot, id, 'pause'), 'POST')
export const resumeRoutine = (bot: string, id: string) => crewJson<RoutineView>(base(bot, id, 'resume'), 'POST')
export const deleteRoutine = (bot: string, id: string) => crewJson<void>(base(bot, id), 'DELETE')
export const listRuns = (bot: string, id: string, limit = 20) => crewJson<RunView[]>(`${base(bot, id, 'runs')}&limit=${limit}`, 'GET')

/** 202 started, or 409 `already_running` (a normal answer, not an error). */
export async function runRoutine(bot: string, id: string): Promise<'started' | 'already_running'> {
  const out = await crewJson<{ status: 'started' | 'already_running' }>(base(bot, id, 'run'), 'POST', undefined, [409])
  return out.status
}

/** Next run times (ms) for a schedule; throws `CrewApiError` with `{error, message}` on a bad schedule. */
export async function previewRoutine(schedule: ScheduleSpec, timezone: string): Promise<number[]> {
  const out = await crewJson<{ next: number[] }>('/crew/routines/preview', 'POST', { schedule, timezone })
  return out.next
}
