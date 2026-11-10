import ReactMarkdown, { type Components } from 'react-markdown'

/** Marks a mention that group chats rewrite into a link; it renders as a highlight, never as a link. */
export const MENTION_SCHEME = 'crew-mention:'

/** Only absolute http(s) and mailto links survive; everything else (javascript:, data:, relative) becomes empty. */
export function safeUrl(url: string): string {
  return /^(https?:|mailto:)/i.test(url.trim()) ? url : ''
}

const keepUrl = (url: string): string => (url.startsWith(MENTION_SCHEME) ? url : safeUrl(url))

const components: Components = {
  a: ({ node: _node, href, children, ...props }) =>
    href?.startsWith(MENTION_SCHEME) ? (
      <span className="rounded bg-raised px-0.5 text-foreground">{children}</span>
    ) : (
      <a {...props} href={href} target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-2">{children}</a>
    ),
  p: ({ node: _node, ...props }) => <p {...props} className="my-2 first:mt-0 last:mb-0" />,
  ul: ({ node: _node, ...props }) => <ul {...props} className="my-2 list-disc pl-5" />,
  ol: ({ node: _node, ...props }) => <ol {...props} className="my-2 list-decimal pl-5" />,
  pre: ({ node: _node, ...props }) => <pre {...props} className="my-2 overflow-x-auto rounded-xl bg-muted p-3 font-mono text-xs" />,
  code: ({ node: _node, ...props }) => <code {...props} className="rounded bg-muted px-1 font-mono text-[0.9em] [pre_&]:bg-transparent [pre_&]:p-0" />,
  h1: ({ node: _node, ...props }) => <h3 {...props} className="mt-3 mb-1 text-base font-semibold" />,
  h2: ({ node: _node, ...props }) => <h3 {...props} className="mt-3 mb-1 text-base font-semibold" />,
  h3: ({ node: _node, ...props }) => <h4 {...props} className="mt-3 mb-1 text-sm font-semibold" />
}

/** Assistant text as markdown. Raw HTML is dropped, never rendered. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="min-w-0 leading-relaxed break-words">
      <ReactMarkdown skipHtml urlTransform={keepUrl} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
