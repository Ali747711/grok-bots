import ReactMarkdown, { type Components } from 'react-markdown'

/** Marks a mention that group chats rewrite into a link; it renders as a highlight, never as a link. */
export const MENTION_SCHEME = 'crew-mention:'

/** Only absolute http(s) and mailto links survive; everything else (javascript:, data:, relative) becomes empty. */
export function safeUrl(url: string): string {
  return /^(https?:|mailto:)/i.test(url.trim()) ? url : ''
}

const keepUrl = (url: string): string => (url.startsWith(MENTION_SCHEME) ? url : safeUrl(url))

const LINK = 'rounded-sm font-medium text-foreground underline decoration-faint underline-offset-2 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring'
const HEADING = 'mt-4 mb-1.5 font-semibold tracking-tight first:mt-0'

const components: Components = {
  a: ({ node: _node, href, children, ...props }) =>
    href?.startsWith(MENTION_SCHEME) ? (
      <mark className="rounded-md bg-raised px-1 py-0.5 font-medium text-foreground">{children}</mark>
    ) : (
      <a {...props} href={href} target="_blank" rel="noopener noreferrer" className={LINK}>{children}</a>
    ),
  p: ({ node: _node, ...props }) => <p {...props} className="my-2 first:mt-0 last:mb-0" />,
  ul: ({ node: _node, ...props }) => <ul {...props} className="my-2 list-disc space-y-1 pl-5 marker:text-faint" />,
  ol: ({ node: _node, ...props }) => <ol {...props} className="my-2 list-decimal space-y-1 pl-5 marker:text-faint" />,
  pre: ({ node: _node, ...props }) => <pre {...props} className="my-2 scroll-thin overflow-x-auto rounded-2xl bg-raised p-3 font-mono text-xs leading-relaxed" />,
  code: ({ node: _node, ...props }) => <code {...props} className="rounded-md bg-raised px-1 py-0.5 font-mono text-[12.5px] [pre_&]:bg-transparent [pre_&]:p-0 [pre_&]:text-xs" />,
  blockquote: ({ node: _node, ...props }) => <blockquote {...props} className="my-2 border-l-2 border-control pl-3 text-muted-foreground" />,
  hr: ({ node: _node, ...props }) => <hr {...props} className="my-4 border-border" />,
  h1: ({ node: _node, ...props }) => <h3 {...props} className={`${HEADING} text-[15px]`} />,
  h2: ({ node: _node, ...props }) => <h3 {...props} className={`${HEADING} text-[15px]`} />,
  h3: ({ node: _node, ...props }) => <h4 {...props} className={`${HEADING} text-sm`} />
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
