import { app, BrowserWindow } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/** 本地开发后端 */
export const DEV_BACKEND_URL = 'http://localhost:3001'
/** 正式环境官网 / API / 更新源（无尾斜杠） */
export const PRODUCTION_BACKEND_URL = 'http://8.219.152.183:3088'
/** 旧生产地址：读设置时自动迁到新地址 */
const LEGACY_BACKEND_HOSTS = ['http://47.243.12.28:3088', 'http://47.243.12.28']

export function getDefaultBackendUrl(): string {
  try {
    return app.isPackaged ? PRODUCTION_BACKEND_URL : DEV_BACKEND_URL
  } catch {
    return DEV_BACKEND_URL
  }
}

/** @deprecated 使用 getDefaultBackendUrl()，打包后指向正式环境 */
export const DEFAULT_BACKEND_URL = DEV_BACKEND_URL

export interface AppSettings {
  backendUrl: string
  fingerprintEnabled: false
  testModeEnabled: boolean
}

function defaultSettings(): AppSettings {
  return {
    backendUrl: getDefaultBackendUrl(),
    fingerprintEnabled: false,
    testModeEnabled: false
  }
}

function settingsFilePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): AppSettings {
  try {
    const path = settingsFilePath()
    if (!existsSync(path)) return defaultSettings()
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<AppSettings>
    const rawUrl = typeof raw.backendUrl === 'string' ? raw.backendUrl.trim().replace(/\/$/, '') : ''
    const migrated =
      rawUrl && LEGACY_BACKEND_HOSTS.some((h) => rawUrl === h || rawUrl.startsWith(h + '/'))
        ? PRODUCTION_BACKEND_URL
        : rawUrl
    return {
      backendUrl: migrated || getDefaultBackendUrl(),
      fingerprintEnabled: false,
      testModeEnabled: Boolean(raw.testModeEnabled)
    }
  } catch {
    return defaultSettings()
  }
}

export function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const next: AppSettings = {
    ...loadSettings(),
    ...partial,
    fingerprintEnabled: false
  }
  if (typeof next.backendUrl === 'string') {
    next.backendUrl = next.backendUrl.trim().replace(/\/$/, '') || getDefaultBackendUrl()
  }
  next.testModeEnabled = Boolean(next.testModeEnabled)
  writeFileSync(settingsFilePath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export function broadcastSettings(settings: AppSettings): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('settings:changed', settings)
  }
}
