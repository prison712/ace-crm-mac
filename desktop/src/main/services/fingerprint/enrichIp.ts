import { session } from 'electron'
import { sessionFetch } from '../http'
import { LanguageType, TimeZoneType, type FingerprintConfig } from './types'

/** 对齐海王 Ile：国家码 → Accept-Language 首选 */
const COUNTRY_LANG: Record<string, string> = {
  CN: 'zh-CN',
  HK: 'zh-HK',
  TW: 'zh-TW',
  MO: 'zh-MO',
  SG: 'en-SG',
  JP: 'ja-JP',
  KR: 'ko-KR',
  US: 'en-US',
  GB: 'en-GB',
  AU: 'en-AU',
  DE: 'de-DE',
  FR: 'fr-FR',
  TH: 'th-TH',
  VN: 'vi-VN',
  ID: 'id-ID',
  MY: 'ms-MY',
  PH: 'en-PH',
  IN: 'en-IN',
  BR: 'pt-BR',
  RU: 'ru-RU'
}

type IpGeo = {
  countryCode?: string
  timezone?: string
  query?: string
}

/**
 * 对齐海王 lpe()：有代理时走代理出口查 IP，再填 languageIpValue / timeZoneIp / webRTCIp。
 * 指纹其它伪装项（canvas 等）不动。
 */
export async function enrichFingerprintFromIp(
  fp: FingerprintConfig,
  proxyUrl?: string | null
): Promise<FingerprintConfig> {
  const needLang = fp.languageType === LanguageType.IP && !fp.languageIpValue?.length
  const needTz = fp.timeZoneType === TimeZoneType.IP && !fp.timeZoneIp
  if (!needLang && !needTz && fp.webRTCIp) return fp

  const geo = await fetchIpGeo(proxyUrl)
  const next: FingerprintConfig = { ...fp }

  if (needLang) {
    const cc = geo?.countryCode?.toUpperCase()
    const lang = (cc && COUNTRY_LANG[cc]) || 'zh-CN'
    next.languageIpValue = [lang]
  }
  if (needTz) {
    next.timeZoneIp = geo?.timezone || 'Asia/Shanghai'
  }
  if (!next.webRTCIp && geo?.query) {
    next.webRTCIp = geo.query
  }
  if (needLang && !next.languageIpValue?.length) {
    next.languageIpValue = ['zh-CN']
  }
  if (needTz && !next.timeZoneIp) {
    next.timeZoneIp = 'Asia/Shanghai'
  }
  return next
}

async function fetchIpGeo(proxyUrl?: string | null): Promise<IpGeo | null> {
  const url =
    'http://ip-api.com/json/?fields=status,countryCode,timezone,lat,lon,query'
  try {
    if (proxyUrl?.trim()) {
      return await fetchIpGeoViaProxy(proxyUrl.trim(), url)
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8_000)
    try {
      const resp = await fetch(url, { signal: ctrl.signal })
      if (!resp.ok) return null
      const data = (await resp.json()) as IpGeo & { status?: string }
      if (data.status !== 'success') return null
      return data
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}

/** 对齐海王 CHECK_REQUEST_PROXY：临时 session + setProxy 查出口 IP */
async function fetchIpGeoViaProxy(proxyUrl: string, url: string): Promise<IpGeo | null> {
  const partition = `fp-ip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const ses = session.fromPartition(partition, { cache: false })
  try {
    try {
      const u = new URL(proxyUrl.includes('://') ? proxyUrl : `http://${proxyUrl}`)
      // 临时检测会话：账号密码直接进 rules（与 proxy.test 一致）；正式 View 仍用 login 回调
      const user = decodeURIComponent(u.username || '')
      const pass = decodeURIComponent(u.password || '')
      const rules = user
        ? `${u.protocol}//${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${u.host}`
        : `${u.protocol}//${u.host}`
      await ses.setProxy({ proxyRules: rules, proxyBypassRules: '<local>' })
    } catch {
      await ses.setProxy({ proxyRules: proxyUrl, proxyBypassRules: '<local>' })
    }

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 12_000)
    try {
      const resp = await sessionFetch(ses, url, { signal: ctrl.signal })
      if (!resp.ok) return null
      const data = (await resp.json()) as IpGeo & { status?: string }
      if (data.status !== 'success') return null
      return data
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  } finally {
    try {
      await ses.clearStorageData()
    } catch {
      /* ignore */
    }
  }
}
