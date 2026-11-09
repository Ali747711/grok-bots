// Bidi controls, zero-width and invisible characters can make shown text differ from what runs.
const HIDDEN_CLASS = '[\\u202A-\\u202E\\u2066-\\u2069\\u200E\\u200F\\u061C\\u200B-\\u200D\\u2060\\uFEFF\\u00AD]'
const HIDDEN_ONE = new RegExp(HIDDEN_CLASS)
const HIDDEN_SPLIT = new RegExp(`(${HIDDEN_CLASS})`)

export const hasHidden = (text: string | undefined): boolean => text !== undefined && HIDDEN_ONE.test(text)

const token = (ch: string) => `⟨U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟩`

/** Text with every hidden character replaced by a visible, distinctly styled marker (display only). */
export function RevealHidden({ text }: { text: string }) {
  return (
    <>
      {text.split(HIDDEN_SPLIT).map((part, i) =>
        HIDDEN_ONE.test(part) ? (
          <span key={i} className="rounded bg-red-100 px-0.5 font-mono text-red-700 dark:bg-red-950 dark:text-red-300">{token(part)}</span>
        ) : (
          part
        )
      )}
    </>
  )
}
