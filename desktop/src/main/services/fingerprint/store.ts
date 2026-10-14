import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getAuthScopeKey } from '../auth'
import { generateRandomFingerprint, generateUserAgent, runtimeChromeMajor } from './generate'
import type { FingerprintConfig } from './types'

/**
 * 指纹目录按软件登录账号分桶，防止跨账号共用浏览器指纹配置。
 * @returns 目录绝对路径
 */
function fingerprintsDir(): string {
  const scope = getAuthScopeKey()
  const dir = join(app.getPath('userData'), 'fingerprints', scope)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function fingerprintPath(tabId: string): string {
  const safe = tabId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(fingerprintsDir(), `${safe}.json`)
}

export function loadFingerprint(tabId: string): FingerprintConfig | null {
  try {
    const path = fingerprintPath(tabId)
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf-8')) as FingerprintConfig
  } catch {
    return null
  }
}

export function saveFingerprint(tabId: string, config: FingerprintConfig): void {
  writeFileSync(fingerprintPath(tabId), JSON.stringify(config, null, 2), 'utf-8')
}

export function deleteFingerprint(tabId: string): void {
  try {
    const path = fingerprintPath(tabId)
    if (existsSync(path)) unlinkSync(path)
  } catch {
    /* ignore */
  }
}

export type EnsureFingerprintResult = {
  fingerprint: FingerprintConfig
  /** UA 主版本刚被改写：应对应分区清 Service Worker（海王注释：chrome 版本不对） */
  chromeMajorChanged: boolean
}

/**
 * 对齐海王 Spe()：UA 主版本必须跟当前运行时 Chromium 一致，
 * 否则 WhatsApp 会因「chrome 版本不对」卡在二维码/验证码（海王注释同因）。
 */
function syncChromeMajor(
  tabId: string,
  fp: FingerprintConfig
): EnsureFingerprintResult {
  const runtimeMajor = runtimeChromeMajor()
  const uaMajor = fp.userAgent?.match(/Chrome\/(\d+)/)?.[1]
  if (uaMajor === runtimeMajor && fp.version === runtimeMajor) {
    return { fingerprint: fp, chromeMajorChanged: false }
  }
  const next: FingerprintConfig = {
    ...fp,
    version: runtimeMajor,
    userAgent: generateUserAgent(runtimeMajor)
  }
  saveFingerprint(tabId, next)
  return { fingerprint: next, chromeMajorChanged: true }
}

/** 已有文件则校验 UA 主版本后返回，否则生成并持久化 */
export function ensureFingerprint(tabId: string): EnsureFingerprintResult {
  const existing = loadFingerprint(tabId)
  if (existing?.userAgent && existing.webGl) {
    return syncChromeMajor(tabId, existing)
  }
  const created = generateRandomFingerprint()
  saveFingerprint(tabId, created)
  return { fingerprint: created, chromeMajorChanged: false }
}
