import { session } from 'electron'
import { sessionFetch } from './http'

export interface ProxyTestInput {
  host: string
  port: number
  username?: string
  password?: string
}

export interface ProxyTestResult {
  success: boolean
  message: string
  ip?: string
  country?: string
  region?: string
  city?: string
}

function buildProxyRules(host: string, port: number, username: string, password: string): string {
  const h = host.trim()
  if (!h) throw new Error('请填写代理 IP')
  if (!port) throw new Error('请填写代理端口')

  const user = username.trim()
  if (!user) return `http://${h}:${port}`
  return `http://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${h}:${port}`
}

interface IpApiResponse {
  status: string
  message?: string
  country?: string
  regionName?: string
  city?: string
  query?: string
}

export async function testProxy(input: ProxyTestInput): Promise<ProxyTestResult> {
  let proxyRules: string
  try {
    proxyRules = buildProxyRules(
      input.host,
      Number(input.port) || 0,
      input.username ?? '',
      input.password ?? ''
    )
  } catch (e) {
    return {
      success: false,
      message: e instanceof Error ? e.message : String(e)
    }
  }

  const partition = `proxy-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const ses = session.fromPartition(partition, { cache: false })

  try {
    await ses.setProxy({ proxyRules, proxyBypassRules: '<local>' })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    let resp: Awaited<ReturnType<typeof sessionFetch>>
    try {
      resp = await sessionFetch(
        ses,
        'http://ip-api.com/json/?fields=status,message,country,regionName,city,query',
        { signal: controller.signal }
      )
    } finally {
      clearTimeout(timer)
    }

    if (!resp.ok) {
      return {
        success: false,
        message: `检测服务返回 HTTP ${resp.status}`
      }
    }

    const body = (await resp.json()) as IpApiResponse
    if (body.status !== 'success') {
      return {
        success: false,
        message: body.message || '代理检测失败',
        ip: body.query,
        country: body.country,
        region: body.regionName,
        city: body.city
      }
    }

    const location = [body.country, body.regionName, body.city].filter(Boolean).join(' · ')
    return {
      success: true,
      message: location ? `代理可用 · 归属地: ${location}` : '代理可用',
      ip: body.query,
      country: body.country,
      region: body.regionName,
      city: body.city
    }
  } catch (e) {
    return {
      success: false,
      message: `代理连接失败: ${e instanceof Error ? e.message : String(e)}`
    }
  } finally {
    try {
      await ses.clearStorageData()
    } catch {
      /* ignore */
    }
  }
}
