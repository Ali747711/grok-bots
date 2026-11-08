import ReactMarkdown, { type Components } from 'react-markdown'

/** Only absolute http(s) and mailto links survive; everything else (javascript:, data:, relative) becomes empty. */
export function safeUrl(url: string): string {
  return /^(https?:|mailto:)/i.test(url.trim()) ? url : ''
}

const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2" />,
  p: ({ node: _node, ...props }) => <p {...props} className="my-2 first:mt-0 last:mb-0" />,
  ul: ({ node: _node, ...props }) => <ul {...props} className="my-2 list-disc pl-5" />,
  ol: ({ node: _node, ...props }) => <ol {...props} className="my-2 list-decimal pl-5" />,
  pre: ({ node: _node, ...props }) => <pre {...props} className="my-2 overflow-x-auto rounded-lg border border-border bg-card p-2.5 font-mono text-xs" />,
  code: ({ node: _node, ...props }) => <code {...props} className="font-mono text-[0.9em]" />,
  h1: ({ node: _node, ...props }) => <h3 {...props} className="mt-3 mb-1 text-base font-semibold" />,
  h2: ({ node: _node, ...props }) => <h3 {...props} className="mt-3 mb-1 text-base font-semibold" />,
  h3: ({ node: _node, ...props }) => <h4 {...props} className="mt-3 mb-1 text-sm font-semibold" />
}

/** Assistant text as markdown. Raw HTML is dropped, never rendered. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="min-w-0 break-words">
      <ReactMarkdown skipHtml urlTransform={safeUrl} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
