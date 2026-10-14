import { loadAuthState } from '../auth'
import { loadSettings } from '../settings'
import { emitAuthExpired } from '../authEvents'
import { abortSignalTimeout, appFetch } from '../http'

export interface ClueContact {
  uid: string
  name: string
}

export interface ClueUploadPayload {
  line_uid: string
  line_name: string
  contacts: ClueContact[]
  messaged_uids?: string[]
  tabId?: string
  webviewLabel?: string
  /** 日志标签：line / whatsapp */
  platform?: string
}

export interface ClueUploadResult {
  ok: boolean
  skipped?: boolean
  reason?: string
  new_unique?: number
  new_duplicate?: number
  new_messaged?: number
  total?: number
  error?: string
}

interface RecentUpload {
  at: number
  line_uid: string
  line_name: string
  contactCount: number
  platform?: string
  tabId?: string
  result: ClueUploadResult
}

export interface ClueTabAccount {
  line_uid: string
  line_name: string
  platform: string
  at: number
}

let lastUpload: RecentUpload | null = null
/** 各标签最近一次成功/尝试上报的本机账号，供开发态伪造用 */
const lastAccountByTab = new Map<string, ClueTabAccount>()

export function getClueStatus(): RecentUpload | null {
  return lastUpload
}

export function getLastClueAccountForTab(
  tabId: string,
  platform?: string
): ClueTabAccount | null {
  const hit = lastAccountByTab.get(tabId)
  if (!hit) return null
  if (platform && hit.platform !== platform) return null
  return hit
}

function rememberTabAccount(payload: ClueUploadPayload): void {
  const line_uid = String(payload.line_uid || '').trim()
  if (!line_uid) return
  const account: ClueTabAccount = {
    line_uid,
    line_name: String(payload.line_name || '').trim() || line_uid,
    platform: payload.platform || 'line',
    at: Date.now()
  }
  const tabId = String(payload.tabId || '').trim()
  if (tabId) lastAccountByTab.set(tabId, account)
  const label = String(payload.webviewLabel || '').trim()
  if (label) lastAccountByTab.set(`label:${label}`, account)
}

/** 开发伪造：按 tab / webviewLabel / 最近一次同渠道上报 解析本机账号 */
export function resolveClueAccountForDev(opts: {
  tabId?: string
  webviewLabel?: string
  platform: string
}): ClueTabAccount | null {
  const tabId = String(opts.tabId || '').trim()
  if (tabId) {
    const hit = getLastClueAccountForTab(tabId, opts.platform)
    if (hit) return hit
  }
  const label = String(opts.webviewLabel || '').trim()
  if (label) {
    const hit = lastAccountByTab.get(`label:${label}`)
    if (hit && hit.platform === opts.platform) return hit
  }
  if (
    lastUpload &&
    (lastUpload.platform || 'line') === opts.platform &&
    lastUpload.line_uid
  ) {
    return {
      line_uid: lastUpload.line_uid,
      line_name: lastUpload.line_name || lastUpload.line_uid,
      platform: lastUpload.platform || 'line',
      at: lastUpload.at
    }
  }
  return null
}

/**
 * POST {backendUrl}/api/upload
 * 字段仍用 line_uid/line_name（后端契约）；WhatsApp 账号 id/昵称填入同一字段。
 * 无 token / 无 backendUrl 时只打日志，不抛崩
 */
export async function uploadClueContacts(payload: ClueUploadPayload): Promise<ClueUploadResult> {
  const settings = loadSettings()
  const backendUrl = settings.backendUrl?.trim().replace(/\/$/, '') || ''
  const auth = loadAuthState()
  const platform = payload.platform || 'line'
  const tag = payload.webviewLabel || payload.tabId || payload.line_uid || platform
  rememberTabAccount(payload)

  if (!backendUrl) {
    console.warn(`[clue:${tag}] skip upload: backendUrl empty`)
    const result: ClueUploadResult = { ok: false, skipped: true, reason: 'no_backend_url' }
    lastUpload = {
      at: Date.now(),
      line_uid: payload.line_uid,
      line_name: payload.line_name,
      contactCount: payload.contacts?.length ?? 0,
      platform,
      tabId: payload.tabId,
      result
    }
    return result
  }

  if (!auth?.token) {
    console.warn(`[clue:${tag}] skip upload: no auth token`)
    const result: ClueUploadResult = { ok: false, skipped: true, reason: 'no_token' }
    lastUpload = {
      at: Date.now(),
      line_uid: payload.line_uid,
      line_name: payload.line_name,
      contactCount: payload.contacts?.length ?? 0,
      platform,
      tabId: payload.tabId,
      result
    }
    return result
  }

  const body = {
    line_uid: String(payload.line_uid || '').trim(),
    line_name: String(payload.line_name || '').trim(),
    platform,
    contacts: (payload.contacts || [])
      .map((c) => ({
        uid: String(c.uid || '').trim(),
        name: String(c.name || '').trim()
      }))
      .filter((c) => c.uid),
    messaged_uids: (payload.messaged_uids || []).map((u) => String(u).trim()).filter(Boolean)
  }

  if (!body.line_uid) {
    console.warn(`[clue:${tag}] skip upload: empty line_uid`)
    return { ok: false, skipped: true, reason: 'empty_line_uid' }
  }

  console.log(
    `[clue:${tag}] POST /api/upload platform=${platform} account=${body.line_name || body.line_uid} contacts=${body.contacts.length} messaged=${body.messaged_uids.length}`
  )

  try {
    const resp = await appFetch(`${backendUrl}/api/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`
      },
      body: JSON.stringify(body),
      signal: abortSignalTimeout(30_000)
    })

    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>

    if (resp.status === 401) {
      console.warn(`[clue:${tag}] upload 401 — auth expired`)
      emitAuthExpired()
      const result: ClueUploadResult = { ok: false, error: 'unauthorized' }
      lastUpload = {
        at: Date.now(),
        line_uid: body.line_uid,
        line_name: body.line_name,
        contactCount: body.contacts.length,
        platform,
        result
      }
      return result
    }

    if (!resp.ok) {
      const err = typeof data.error === 'string' ? data.error : `HTTP ${resp.status}`
      console.warn(`[clue:${tag}] upload failed: ${err}`)
      const result: ClueUploadResult = { ok: false, error: err }
      lastUpload = {
        at: Date.now(),
        line_uid: body.line_uid,
        line_name: body.line_name,
        contactCount: body.contacts.length,
        platform,
        result
      }
      return result
    }

    const result: ClueUploadResult = {
      ok: true,
      new_unique: Number(data.new_unique) || 0,
      new_duplicate: Number(data.new_duplicate) || 0,
      new_messaged: Number(data.new_messaged) || 0,
      total: Number(data.total) || 0
    }
    console.log(
      `[clue:${tag}] upload ok — new_unique=${result.new_unique} new_duplicate=${result.new_duplicate} new_messaged=${result.new_messaged} total=${result.total}`
    )
    lastUpload = {
      at: Date.now(),
      line_uid: body.line_uid,
      line_name: body.line_name,
      contactCount: body.contacts.length,
      platform,
      result
    }
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`[clue:${tag}] upload network error: ${msg}`)
    const result: ClueUploadResult = { ok: false, error: msg }
    lastUpload = {
      at: Date.now(),
      line_uid: body.line_uid,
      line_name: body.line_name,
      contactCount: body.contacts.length,
      platform,
      result
    }
    return result
  }
}

/** @deprecated 使用 uploadClueContacts */
export const uploadLineContacts = uploadClueContacts
