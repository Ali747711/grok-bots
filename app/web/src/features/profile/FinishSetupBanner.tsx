import { Wand2 } from 'lucide-react'

import { InlineAction } from '@/components/console/inline-action'
import { CrewApiError } from '@/features/bots/bots-api'
import { failureText } from '@/features/bots/use-profile-save'

interface FinishSetupBannerProps {
  /** Runs the unfinished steps. Resolves with the problem when a step still fails, else null. */
  onFinish: () => Promise<string | null>
}

const describe = (error: unknown): string => (error instanceof CrewApiError ? failureText(error) : error instanceof Error && error.message ? error.message : failureText(error))

/** A bot whose creation stopped half way: one action finishes it, and a step that fails again says why. */
export function FinishSetupBanner({ onFinish }: FinishSetupBannerProps) {
  const finish = async () => {
    const problem = await onFinish()
    if (problem) throw new Error(`Finish setup didn't complete: ${problem}`)
  }
  return <InlineAction label="Setup was not finished." icon={<Wand2 className="size-5" aria-hidden="true" />} actionText="Finish setup" onAction={finish} describeError={describe} />
}
