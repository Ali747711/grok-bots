type Level = 'info' | 'warn' | 'error'
type Fields = Record<string, unknown>
type Sink = (line: string) => void

let sink: Sink = line => process.stderr.write(line + '\n')

/** Replace the output sink (tests capture log lines through this). Returns a restore function. */
export function setLogSink(next: Sink): () => void {
  const previous = sink
  sink = next
  return () => {
    sink = previous
  }
}

function write(level: Level, msg: string, fields?: Fields): void {
  sink(JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields }))
}

/** JSON-lines logger on stderr. Never pass secrets (tokens, cookies, keys) in fields. */
export const log = {
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, fields?: Fields) => write('error', msg, fields)
}
