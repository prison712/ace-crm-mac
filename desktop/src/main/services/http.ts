import { net, type Session } from 'electron'
import type { IncomingMessage } from 'electron'

type NetWithFetch = typeof net & {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
}

const electronNet = net as NetWithFetch

/** Node 16 / Electron 22 无 AbortSignal.timeout */
export function abortSignalTimeout(ms: number): AbortSignal {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
  return controller.signal
}

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {}
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    const out: Record<string, string> = {}
    headers.forEach((value, key) => {
      out[key] = value
    })
    return out
  }
  if (Array.isArray(headers)) {
    const out: Record<string, string> = {}
    for (const [key, value] of headers) out[key] = value
    return out
  }
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers as Record<string, string>)) {
    if (value !== undefined) out[key] = String(value)
  }
  return out
}

function bodyToBuffer(body: BodyInit | null | undefined): Buffer | null {
  if (body == null) return null
  if (typeof body === 'string') return Buffer.from(body)
  if (Buffer.isBuffer(body)) return body
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  }
  throw new Error('appFetch: 不支持的 body 类型（Electron 22 回退路径）')
}

/** Electron 22 无 net.fetch：用 net.request 拼出 Response 兼容对象 */
function netRequestFetch(input: string, init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const method = (init?.method || 'GET').toUpperCase()
    const headers = headersToRecord(init?.headers)
    const body = bodyToBuffer(init?.body ?? null)
    const signal = init?.signal

    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }

    const req = electronNet.request({ url: input, method })
    for (const [key, value] of Object.entries(headers)) {
      req.setHeader(key, value)
    }

    const onAbort = (): void => {
      try {
        req.abort()
      } catch {
        /* ignore */
      }
      reject(new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const chunks: Buffer[] = []
    req.on('response', (res: IncomingMessage) => {
      res.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      res.on('end', () => {
        signal?.removeEventListener('abort', onAbort)
        const buf = Buffer.concat(chunks)
        const status = res.statusCode ?? 0
        // Electron 22 主进程未必有 Headers；调用方只用 ok/status/text/json/arrayBuffer
        const response = {
          ok: status >= 200 && status < 300,
          status,
          statusText: res.statusMessage || '',
          headers: res.headers as unknown as Headers,
          url: input,
          async arrayBuffer(): Promise<ArrayBuffer> {
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
          },
          async text(): Promise<string> {
            return buf.toString('utf8')
          },
          async json(): Promise<unknown> {
            return JSON.parse(buf.toString('utf8')) as unknown
          }
        } as Response

        resolve(response)
      })
      res.on('error', (err) => {
        signal?.removeEventListener('abort', onAbort)
        reject(err)
      })
    })
    req.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      reject(err)
    })

    if (body) req.write(body)
    req.end()
  })
}

/**
 * 主进程 HTTP。
 * Electron 25+：net.fetch；更早（含 22）：net.request 回退。
 */
export async function appFetch(input: string, init?: RequestInit): Promise<Response> {
  if (typeof electronNet.fetch === 'function') {
    return electronNet.fetch(input, init)
  }
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch(input, init)
  }
  return netRequestFetch(input, init)
}

type SessionFetchResult = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}

/**
 * 经指定 session（含代理）发请求。
 * Electron 28+ 有 session.fetch；Electron 22 用 net.request + session。
 */
export async function sessionFetch(
  ses: Session,
  url: string,
  init?: { signal?: AbortSignal }
): Promise<SessionFetchResult> {
  const sesWithFetch = ses as Session & {
    fetch?: (input: string, init?: RequestInit) => Promise<Response>
  }
  if (typeof sesWithFetch.fetch === 'function') {
    const resp = await sesWithFetch.fetch(url, { signal: init?.signal })
    return {
      ok: resp.ok,
      status: resp.status,
      json: () => resp.json() as Promise<unknown>,
      text: () => resp.text()
    }
  }

  return new Promise((resolve, reject) => {
    const signal = init?.signal
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }

    const req = electronNet.request({ url, session: ses })
    const onAbort = (): void => {
      try {
        req.abort()
      } catch {
        /* ignore */
      }
      reject(new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const chunks: Buffer[] = []
    req.on('response', (res) => {
      res.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      res.on('end', () => {
        signal?.removeEventListener('abort', onAbort)
        const buf = Buffer.concat(chunks)
        const status = res.statusCode ?? 0
        resolve({
          ok: status >= 200 && status < 300,
          status,
          json: async () => JSON.parse(buf.toString('utf8')) as unknown,
          text: async () => buf.toString('utf8')
        })
      })
      res.on('error', (err) => {
        signal?.removeEventListener('abort', onAbort)
        reject(err)
      })
    })
    req.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    req.end()
  })
}
