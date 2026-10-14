import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { appFetch } from './http'

export interface AuthState {
  token: string
  /** 软件账号稳定 id（JWT userId），用于隔离社媒缓存 */
  userId: string
  username: string
  displayName: string
  accountType: string
  expiresAt: number
}

function authFilePath(): string {
  return join(app.getPath('userData'), 'auth.json')
}

/**
 * 解析 JWT payload（不做验签，仅取本地已保存 token 的声明）。
 * @param token JWT
 * @returns payload 对象
 */
function parseJwtPayload(token: string): Record<string, unknown> {
  try {
    const part = String(token || '').split('.')[1]
    if (!part) return {}
    return JSON.parse(Buffer.from(part, 'base64').toString('utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function parseJwtExp(token: string): number {
  const payload = parseJwtPayload(token)
  const exp = Number(payload.exp || 0)
  return exp > 0 ? exp * 1000 : 0
}

/**
 * 从 token / 用户名得到可写进 partition 路径的安全片段。
 * @param userId 用户 id
 * @param username 用户名兜底
 * @returns 仅含安全字符的短 key
 */
export function sanitizeAuthScopeKey(userId?: string | null, username?: string | null): string {
  const raw = String(userId || username || 'anonymous').trim() || 'anonymous'
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 64)
  return safe || 'anonymous'
}

/**
 * 当前登录软件账号的缓存隔离键（用于 BrowserView partition / 指纹目录）。
 * @returns scope key；未登录为 anonymous
 */
export function getAuthScopeKey(): string {
  const auth = loadAuthState()
  return sanitizeAuthScopeKey(auth?.userId, auth?.username)
}

/**
 * 从 JWT 取出 userId（兼容 string / number）。
 * @param token JWT
 * @returns userId 字符串
 */
function userIdFromToken(token: string): string {
  const payload = parseJwtPayload(token)
  const id = payload.userId ?? payload.sub ?? payload.id
  return id != null && String(id).trim() ? String(id).trim() : ''
}

export function loadAuthState(): AuthState | null {
  try {
    const path = authFilePath()
    if (!existsSync(path)) return null
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<AuthState> & {
      inviteCode?: string
    }
    const token = raw.token
    if (!token || !raw.expiresAt) return null
    if (Date.now() > raw.expiresAt) {
      clearAuthState()
      return null
    }
    const userId =
      String(raw.userId || '').trim() || userIdFromToken(token) || String(raw.username || '').trim()
    return {
      token,
      userId,
      username: raw.username || raw.inviteCode || '',
      displayName: raw.displayName || raw.username || '',
      accountType: raw.accountType || 'sub_account',
      expiresAt: raw.expiresAt
    }
  } catch {
    return null
  }
}

export function saveAuthState(state: AuthState): void {
  writeFileSync(authFilePath(), JSON.stringify(state, null, 2), 'utf-8')
}

export function clearAuthState(): void {
  try {
    writeFileSync(authFilePath(), '{}', 'utf-8')
  } catch {
    // ignore
  }
}

export interface AuthPublicState {
  authenticated: boolean
  inviteCode: string | null
  inviteCodeId: number | null
  token: string | null
  backendUrl: string
  userId: string | null
  username: string | null
  displayName: string | null
  /** 社媒标签缓存隔离键，供渲染进程按账号分存 localStorage */
  scopeKey: string | null
}

export interface LoginResult {
  ok: boolean
  error?: string
  data?: {
    token: string
    userId: string
    username: string
    displayName: string
    accountType: string
    scopeKey: string
  }
}

export async function loginWithPassword(
  backendUrl: string,
  username: string,
  password: string
): Promise<LoginResult> {
  const url = backendUrl.trim().replace(/\/$/, '')
  if (!url) return { ok: false, error: '请先填写后端地址' }
  if (!username.trim() || !password) return { ok: false, error: '请输入用户名和密码' }

  try {
    const resp = await appFetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password, audience: 'desktop' })
    })

    let data: {
      error?: string
      token?: string
      user?: {
        id?: string | number
        username?: string
        displayName?: string
        accountType?: string
      }
    } = {}
    try {
      data = (await resp.json()) as typeof data
    } catch {
      // ignore
    }

    if (!resp.ok || !data.token) {
      return { ok: false, error: data.error || '用户名或密码错误' }
    }

    const expiresAt = parseJwtExp(data.token) || Date.now() + 7 * 24 * 60 * 60 * 1000
    const userId =
      (data.user?.id != null && String(data.user.id).trim()) ||
      userIdFromToken(data.token) ||
      username.trim()
    const state: AuthState = {
      token: data.token,
      userId,
      username: data.user?.username || username.trim(),
      displayName: data.user?.displayName || username.trim(),
      accountType: data.user?.accountType || 'sub_account',
      expiresAt
    }
    saveAuthState(state)
    const scopeKey = sanitizeAuthScopeKey(state.userId, state.username)
    return {
      ok: true,
      data: {
        token: state.token,
        userId: state.userId,
        username: state.username,
        displayName: state.displayName,
        accountType: state.accountType,
        scopeKey
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `连接后端失败: ${message}` }
  }
}

export function logout(): void {
  clearAuthState()
}
