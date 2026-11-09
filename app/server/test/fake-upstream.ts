import { createHash } from 'node:crypto'
import { type IncomingHttpHeaders, type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface RecordedRequest {
  method: string
  url: string
  headers: IncomingHttpHeaders
  bodySha256: string
  bodyBytes: number
}

/** A tiny HTTP server standing in for Hermes. Responds 200 JSON unless a status is queued. */
export class FakeUpstream {
  readonly requests: RecordedRequest[] = []
  private queued: number[] = []
  private always: number | null = null
  private server: Server | null = null
  respondStatus = 200

  get last(): RecordedRequest {
    const last = this.requests.at(-1)
    if (!last) throw new Error('no upstream request recorded')
    return last
  }

  get calls(): number {
    return this.requests.length
  }

  respondOnce(status: number): void {
    this.queued = [...this.queued, status]
  }

  respondAlways(status: number): void {
    this.always = status
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      const hash = createHash('sha256')
      let bytes = 0
      req.on('data', (chunk: Buffer) => {
        hash.update(chunk)
        bytes += chunk.length
      })
      req.on('end', () => {
        this.requests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          bodySha256: hash.digest('hex'),
          bodyBytes: bytes
        })
        const [next, ...rest] = this.queued
        this.queued = rest
        const status = this.always ?? next ?? this.respondStatus
        res.writeHead(status, { 'content-type': 'application/json', 'set-cookie': 'upstream=1', 'x-internal': 'secret' })
        res.end(JSON.stringify({ status, path: req.url }))
      })
    })
    await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', resolve))
    const { port } = this.server.address() as AddressInfo
    return `http://127.0.0.1:${port}`
  }

  async stop(): Promise<void> {
    await new Promise<void>(resolve => (this.server ? this.server.close(() => resolve()) : resolve()))
  }
}
