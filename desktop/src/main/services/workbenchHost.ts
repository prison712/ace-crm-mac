import http from 'http'
import https from 'https'
import type { Duplex } from 'stream'
import { createReadStream, existsSync, statSync } from 'fs'
import { extname, isAbsolute, join, relative, resolve } from 'path'
import { app } from 'electron'
import { loadSettings } from './settings'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8'
}

let originPromise: Promise<string> | null = null
let server: http.Server | null = null

/**
 * 打包进客户端的工作台静态目录。
 * @returns dist 目录绝对路径
 */
export function workbenchDistDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'workbench')
  return resolve(__dirname, '../../../workbench/dist')
}

function backendBase(): URL {
  const raw = (loadSettings().backendUrl || 'http://127.0.0.1:3001').trim().replace(/\/$/, '')
  return new URL(raw)
}

function isProxiedPath(pathname: string): boolean {
  return (
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/uploads' ||
    pathname.startsWith('/uploads/') ||
    pathname === '/ws' ||
    pathname.startsWith('/ws/')
  )
}

function safeStatic(root: string, urlPath: string): string | null {
  let pathname = urlPath.split('?')[0] || '/'
  try {
    pathname = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const full = resolve(root, pathname.replace(/^\/+/, ''))
  const diff = relative(resolve(root), full)
  if (diff.startsWith('..') || isAbsolute(diff)) return null
  return full
}

function sendFile(res: http.ServerResponse, file: string): void {
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream'
  const headers: Record<string, string> = { 'Content-Type': type }
  if (file.endsWith('index.html')) headers['Cache-Control'] = 'no-store'
  res.writeHead(200, headers)
  createReadStream(file).pipe(res)
}

function proxyHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
  let backend: URL
  try {
    backend = backendBase()
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('后端地址无效')
    return
  }
  const lib = backend.protocol === 'https:' ? https : http
  const preq = lib.request(
    {
      protocol: backend.protocol,
      hostname: backend.hostname,
      port: backend.port || undefined,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: backend.host }
    },
    (pres) => {
      res.writeHead(pres.statusCode || 502, pres.headers)
      pres.pipe(res)
    }
  )
  preq.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('无法连接业务服务器')
  })
  req.pipe(preq)
}

function proxyUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
  let backend: URL
  try {
    backend = backendBase()
  } catch {
    socket.destroy()
    return
  }
  const lib = backend.protocol === 'https:' ? https : http
  const preq = lib.request({
    protocol: backend.protocol,
    hostname: backend.hostname,
    port: backend.port || undefined,
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: backend.host }
  })
  preq.on('upgrade', (pres, psocket, phead) => {
    const lines = [`HTTP/1.1 ${pres.statusCode || 101} ${pres.statusMessage || 'Switching Protocols'}`]
    for (const [key, value] of Object.entries(pres.headers)) {
      if (value == null) continue
      const list = Array.isArray(value) ? value : [value]
      for (const item of list) lines.push(`${key}: ${item}`)
    }
    socket.write(`${lines.join('\r\n')}\r\n\r\n`)
    if (phead.length) socket.write(phead)
    if (head.length) psocket.write(head)
    psocket.pipe(socket)
    socket.pipe(psocket)
  })
  preq.on('error', () => socket.destroy())
  preq.end()
}

/**
 * 在本机启动工作台静态服务。页面从本地读，/api 与 /ws 转发到当前后端。
 * @returns 形如 http://127.0.0.1:port
 */
export function ensureWorkbenchOrigin(): Promise<string> {
  if (originPromise) return originPromise
  originPromise = new Promise((resolveOrigin, reject) => {
    const root = workbenchDistDir()
    if (!existsSync(join(root, 'index.html'))) {
      originPromise = null
      reject(new Error(`本地工作台文件缺失：${root}`))
      return
    }
    const srv = http.createServer((req, res) => {
      const pathname = (req.url || '/').split('?')[0] || '/'
      if (isProxiedPath(pathname)) {
        proxyHttp(req, res)
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      const file = safeStatic(root, pathname)
      if (file && existsSync(file) && statSync(file).isFile()) {
        if (req.method === 'HEAD') {
          res.writeHead(200)
          res.end()
          return
        }
        sendFile(res, file)
        return
      }
      if (extname(pathname)) {
        res.writeHead(404)
        res.end()
        return
      }
      const index = join(root, 'index.html')
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end()
        return
      }
      sendFile(res, index)
    })
    srv.on('upgrade', (req, socket, head) => {
      const pathname = (req.url || '').split('?')[0] || ''
      if (pathname === '/ws' || pathname.startsWith('/ws/')) proxyUpgrade(req, socket, head)
      else socket.destroy()
    })
    srv.on('error', (err) => {
      originPromise = null
      server = null
      reject(err)
    })
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      server = srv
      resolveOrigin(`http://127.0.0.1:${port}`)
    })
  })
  return originPromise
}

export function stopWorkbenchHost(): void {
  if (server) {
    try {
      server.close()
    } catch {
      /* ignore */
    }
    server = null
  }
  originPromise = null
}
