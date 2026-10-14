import http from 'http'
import https from 'https'
import { anonymizeProxy, closeAnonymizedProxy } from 'proxy-chain'
import type { MapsAppSettings } from './db'

/**
 * 地图采集代理。
 *
 * 用户填的代理只有一种走法：解析设置 → 本地起一个无鉴权 HTTP 桥 → Chromium 通过桥出网。
 * Chromium 不支持 SOCKS5 带账密，也不擅长 HTTP 代理鉴权，所以统一由 proxy-chain 在本机代为鉴权。
 */

export interface MapsProxyTestResult {
  ok: boolean
  message: string
  latencyMs: number
  exitIp: string | null
  country: string | null
  region: string | null
  city: string | null
  timezone: string | null
}

/** 解析后的代理要素。 */
export interface MapsProxyEndpoint {
  scheme: 'http' | 'socks5'
  host: string
  port: number
  username: string
  password: string
}

/** 当前正在运行的本地桥。 */
interface ActiveBridge {
  key: string
  localUrl: string
  proxyRules: string
}

let activeBridge: ActiveBridge | null = null

/**
 * 功能：解析「主机」栏。接受 host、host:port、user:pass@host:port、host:port:user:pass。
 * @param raw 主机栏原文
 * @returns 主机、端口、账号、密码；缺省项为空
 */
function parseHostField(raw: string): Omit<MapsProxyEndpoint, 'scheme'> {
  let text = (raw || '').trim()
  if (!text) return { host: '', port: 0, username: '', password: '' }

  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const slash = text.indexOf('/')
  if (slash >= 0) text = text.slice(0, slash)

  let username = ''
  let password = ''
  const at = text.lastIndexOf('@')
  if (at >= 0) {
    const cred = text.slice(0, at)
    const sep = cred.indexOf(':')
    username = sep >= 0 ? cred.slice(0, sep) : cred
    password = sep >= 0 ? cred.slice(sep + 1) : ''
    text = text.slice(at + 1)
  }

  if (text.startsWith('[')) {
    const end = text.indexOf(']')
    const host = end > 0 ? text.slice(1, end) : text
    const port = Number(text.slice(end + 2)) || 0
    return { host, port, username, password }
  }

  const parts = text.split(':')
  const host = parts[0] || ''
  const port = Number(parts[1]) || 0
  if (parts.length >= 4 && !username) {
    username = parts[2]
    password = parts.slice(3).join(':')
  }
  return { host, port, username, password }
}

/**
 * 功能：把设置合并成一份完整的代理要素。单独填写的端口、账号、密码优先于主机栏整串。
 * @param settings 地图设置
 * @returns 代理要素
 */
export function resolveMapsProxy(settings: MapsAppSettings): MapsProxyEndpoint {
  const parsed = parseHostField(settings.mapsProxyHost)
  return {
    scheme: settings.mapsProxyType === 'http' ? 'http' : 'socks5',
    host: parsed.host,
    port: Number(settings.mapsProxyPort) || parsed.port,
    username: (settings.mapsProxyUsername || '').trim() || parsed.username,
    password: settings.mapsProxyPassword || parsed.password
  }
}

/**
 * 功能：代理要素的唯一键，用来判断是否要重建本地桥。
 * @param endpoint 代理要素
 * @returns 键
 */
function endpointKey(endpoint: MapsProxyEndpoint): string {
  return [endpoint.scheme, endpoint.host, endpoint.port, endpoint.username, endpoint.password].join('|')
}

/**
 * 功能：拼出给 proxy-chain 的上游地址。
 * @param endpoint 代理要素
 * @returns 带账密的 URL
 */
function upstreamUrl(endpoint: MapsProxyEndpoint): string {
  const auth = endpoint.username
    ? `${encodeURIComponent(endpoint.username)}:${encodeURIComponent(endpoint.password)}@`
    : ''
  return `${endpoint.scheme}://${auth}${endpoint.host}:${endpoint.port}`
}

/**
 * 功能：关闭当前本地桥。
 * @returns 关闭完成
 */
export async function stopMapsProxy(): Promise<void> {
  const bridge = activeBridge
  activeBridge = null
  if (!bridge) return
  try {
    await closeAnonymizedProxy(bridge.localUrl, true)
  } catch {
    /* 桥已经不在了 */
  }
}

/**
 * 功能：按设置准备代理，返回 session.setProxy 用的 proxyRules。代理关闭时返回 null。
 * @param settings 地图设置
 * @returns proxyRules 或 null
 */
export async function ensureMapsProxy(settings: MapsAppSettings): Promise<string | null> {
  if (!settings.mapsProxyEnabled) {
    await stopMapsProxy()
    return null
  }

  const endpoint = resolveMapsProxy(settings)
  if (!endpoint.host) throw new Error('代理主机为空，请核对「主机」栏')
  if (!endpoint.port) throw new Error('代理端口为空，请核对「端口」栏')

  const key = endpointKey(endpoint)
  if (activeBridge && activeBridge.key === key) return activeBridge.proxyRules

  await stopMapsProxy()
  const localUrl = await anonymizeProxy(upstreamUrl(endpoint))
  const local = new URL(localUrl)
  activeBridge = { key, localUrl, proxyRules: `http://${local.host}` }
  return activeBridge.proxyRules
}

/** proxy-chain 把上游失败编成 59x，不是检测网站的 HTTP 状态。 */
const BRIDGE_STATUS_TEXT: Record<number, string> = {
  407: '代理要求账号密码，请填写账号和密码',
  504: '代理连接超时，请检查网络或代理是否在线',
  590: '上游代理没有成功返回',
  592: '上游代理返回了无法识别的状态',
  593: '代理主机无法解析，请核对主机地址',
  594: '代理拒绝连接，请核对主机和端口',
  595: '代理连接被重置，请核对协议（HTTP / SOCKS5）、账号和密码',
  596: '代理连接已断开',
  597: '代理账号或密码不正确',
  599: '代理上游出错'
}

/** Node 网络错误码对应的说明。 */
const SOCKET_ERROR_TEXT: Record<string, string> = {
  ECONNREFUSED: '代理拒绝连接，请核对主机和端口',
  ENOTFOUND: '代理主机无法解析，请核对主机地址',
  ETIMEDOUT: '代理连接超时，请检查网络或代理是否在线',
  ECONNRESET: '代理连接被重置，请核对协议（HTTP / SOCKS5）、账号和密码'
}

/**
 * 功能：把连接异常说成人话。
 * @param err 异常
 * @returns 给界面的说明
 */
function explainSocketError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: string })?.code || message.match(/\b(E[A-Z]+)\b/)?.[1] || ''
  const hint = SOCKET_ERROR_TEXT[code]
  return hint ? `${hint}（${message}）` : `代理连接失败: ${message}`
}

/**
 * 功能：把本地桥的状态码说成人话。
 * @param status HTTP 状态
 * @param body 响应正文
 * @returns 给界面的说明
 */
function explainBridgeStatus(status: number, body: string): string {
  const hint = BRIDGE_STATUS_TEXT[status]
  if (!hint) return `检测服务返回 HTTP ${status}`
  const detail = body.replace(/\s+/g, ' ').trim().slice(0, 160)
  const bare = !detail || /^(connection reset|upstream\d*)$/i.test(detail)
  return bare ? hint : `${hint}（${detail}）`
}

/**
 * 功能：经本地桥取回网页正文。HTTPS 走 CONNECT 隧道。
 * @param proxyRules 本地桥地址，如 http://127.0.0.1:1234
 * @param targetUrl 要访问的地址
 * @param timeoutMs 超时毫秒
 * @returns 状态码与正文
 */
function fetchThroughBridge(
  proxyRules: string,
  targetUrl: string,
  timeoutMs: number
): Promise<{ status: number; body: string }> {
  const proxy = new URL(proxyRules)
  const target = new URL(targetUrl)
  const proxyPort = Number(proxy.port) || 80
  const targetPort = Number(target.port) || (target.protocol === 'https:' ? 443 : 80)
  const headers = { Host: target.host, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('代理检测超时')), timeoutMs)
    const done = (status: number, body: string): void => {
      clearTimeout(timer)
      resolve({ status, body })
    }
    const fail = (err: Error): void => {
      clearTimeout(timer)
      reject(err)
    }
    const collect = (res: http.IncomingMessage): void => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => done(res.statusCode || 0, Buffer.concat(chunks).toString('utf8')))
      res.on('error', fail)
    }

    if (target.protocol !== 'https:') {
      const req = http.request(
        { host: proxy.hostname, port: proxyPort, method: 'GET', path: target.href, headers },
        collect
      )
      req.on('error', fail)
      req.end()
      return
    }

    const tunnel = http.request({
      host: proxy.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: `${target.hostname}:${targetPort}`,
      headers: { Host: `${target.hostname}:${targetPort}` }
    })
    tunnel.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        collect(res)
        return
      }
      const req = https.request(
        {
          host: target.hostname,
          servername: target.hostname,
          path: `${target.pathname}${target.search}`,
          method: 'GET',
          socket,
          agent: false,
          headers
        } as https.RequestOptions,
        collect
      )
      req.on('error', fail)
      req.end()
    })
    tunnel.on('error', fail)
    tunnel.end()
  })
}

/** 出口 IP 查询结果。 */
interface GeoProbe {
  ok: boolean
  message?: string
  ip?: string
  country?: string
  region?: string
  city?: string
  timezone?: string
}

/**
 * 功能：解析出口 IP 查询结果。兼容 ipwho.is 与 ip-api.com 两种字段。
 * @param body 响应正文
 * @returns 归属地；解析失败时 ok 为 false
 */
function parseGeoProbe(body: string): GeoProbe {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(body) as Record<string, unknown>
  } catch {
    return { ok: false, message: '检测结果不是有效数据' }
  }
  const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

  if (typeof data.success === 'boolean') {
    const zone = data.timezone as { id?: unknown } | undefined
    return {
      ok: data.success,
      message: text(data.message),
      ip: text(data.ip),
      country: text(data.country),
      region: text(data.region),
      city: text(data.city),
      timezone: zone && typeof zone === 'object' ? text(zone.id) : undefined
    }
  }
  return {
    ok: data.status === 'success',
    message: text(data.message),
    ip: text(data.query),
    country: text(data.country),
    region: text(data.regionName),
    city: text(data.city),
    timezone: text(data.timezone)
  }
}

const GEO_PROBES = [
  'https://ipwho.is/',
  'http://ip-api.com/json/?fields=status,message,country,regionName,city,query,timezone'
]

/**
 * 功能：经代理探测出口 IP、归属地、时区。
 * @param settings 当前表单设置
 * @returns 探测结果
 */
export async function testMapsProxy(settings: MapsAppSettings): Promise<MapsProxyTestResult> {
  const started = Date.now()
  const result = (patch: Partial<MapsProxyTestResult>): MapsProxyTestResult => ({
    ok: false,
    message: '',
    latencyMs: Date.now() - started,
    exitIp: null,
    country: null,
    region: null,
    city: null,
    timezone: null,
    ...patch
  })

  let proxyRules: string | null
  try {
    proxyRules = await ensureMapsProxy({ ...settings, mapsProxyEnabled: true })
  } catch (e) {
    return result({ message: e instanceof Error ? e.message : String(e) })
  }
  if (!proxyRules) return result({ message: '代理未启用' })

  let lastStatus = 0
  let lastBody = ''
  try {
    for (const url of GEO_PROBES) {
      const resp = await fetchThroughBridge(proxyRules, url, 20_000)
      lastStatus = resp.status
      lastBody = resp.body
      if (resp.status < 200 || resp.status >= 300) continue

      const geo = parseGeoProbe(resp.body)
      const place = [geo.country, geo.region, geo.city].filter(Boolean).join(' · ')
      return result({
        ok: geo.ok,
        message: geo.ok ? (place ? `代理可用 · 归属地: ${place}` : '代理可用') : geo.message || '代理检测失败',
        exitIp: geo.ip ?? null,
        country: geo.country ?? null,
        region: geo.region ?? null,
        city: geo.city ?? null,
        timezone: geo.timezone ?? null
      })
    }
    return result({ message: explainBridgeStatus(lastStatus, lastBody) })
  } catch (e) {
    return result({ message: explainSocketError(e) })
  }
}
