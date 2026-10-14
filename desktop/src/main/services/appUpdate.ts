import { app, dialog, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import fs from 'fs'
import path from 'path'
import { loadSettings } from './settings'
import { destroyAllViews, setMainWindow } from './browserViews'

let started = false
let lastStatus = 'idle'
let lastRemoteVersion: string | null = null
let lastDetail = ''
/** 下载进度 0–100。没有进度时为 null。 */
let lastPercent: number | null = null
let manualCheck = false

/**
 * 把当前更新快照推给设置页，百分比变化时立刻刷新。
 * @returns void
 */
/**
 * 标题栏上的一句话：要不要更新，以及下载到了百分之几。
 * @returns {string}
 */
function updateTitleText(): string {
  const status = lastStatus
  const percent =
    typeof lastPercent === 'number' && Number.isFinite(lastPercent)
      ? Math.max(0, Math.min(100, Math.round(lastPercent)))
      : null
  if (status === 'checking' || status === 'starting') return 'ACE CRM系统 · 正在检查更新'
  const updating =
    status === 'available' || status === 'downloading' || status === 'downloaded' || status === 'installing'
  if (!updating) return 'ACE CRM系统 · 不需要更新'
  return percent == null ? 'ACE CRM系统 · 需要更新' : `ACE CRM系统 · 需要更新 ${percent}%`
}

function publishUpdate(): void {
  const payload = getUpdateInfo()
  const title = updateTitleText()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.setTitle(title)
    win.webContents.send('app:updateProgress', payload)
  }
}

function feedUrl(): string {
  const base = loadSettings().backendUrl.replace(/\/$/, '')
  return `${base}/api/app/updates`
}

/**
 * electron-updater 总会读 app-update.yml（即便已 setFeedURL）。
 * --dir/--prepackaged 打包时常漏掉该文件 → ENOENT。缺失时写到 userData 并改路径。
 */
function ensureUpdateConfigFile(url: string): void {
  const packagedPath = path.join(process.resourcesPath, 'app-update.yml')
  const body = [
    'provider: generic',
    `url: ${url}`,
    'updaterCacheDirName: ace-crm-updater',
    ''
  ].join('\n')

  try {
    if (fs.existsSync(packagedPath)) {
      autoUpdater.updateConfigPath = packagedPath
      return
    }
  } catch {
    /* ignore */
  }

  const fallback = path.join(app.getPath('userData'), 'app-update.yml')
  try {
    fs.writeFileSync(fallback, body, 'utf8')
    autoUpdater.updateConfigPath = fallback
    console.log('[updater] app-update.yml missing in resources; using', fallback)
  } catch (e) {
    console.warn('[updater] failed to write fallback app-update.yml:', e)
  }
}

/** 先清资源再拉起安装向导（非静默）；NSIS 侧会强制结束残留进程 */
function quitAndRunInstaller(): void {
  lastStatus = 'installing'
  lastPercent = 100
  lastDetail = '正在退出并打开安装向导'
  publishUpdate()

  try {
    destroyAllViews()
  } catch {
    /* ignore */
  }
  setMainWindow(null)

  app.removeAllListeners('window-all-closed')
  app.removeAllListeners('before-quit')
  app.removeAllListeners('will-quit')

  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.removeAllListeners('close')
      win.destroy()
    } catch {
      /* ignore */
    }
  }

  // isSilent=false → 显示 NSIS 安装画面；isForceRunAfter=true → 装完自动启动
  // installer.nsh 的 customCheckAppRunning 会 taskkill，避免「请手动关闭」卡住
  setTimeout(() => {
    try {
      autoUpdater.quitAndInstall(false, true)
    } catch (e) {
      console.warn('[updater] quitAndInstall failed:', e)
      app.exit(0)
    }
  }, 400)
}

export interface UpdateInfo {
  packaged: boolean
  packageVersion: string
  feedUrl: string
  lastStatus: string
  lastRemoteVersion: string | null
  lastDetail: string
  /** 下载百分比。未开始下载时为 null。 */
  lastPercent: number | null
  /** 兼容旧 UI 字段 */
  hotSyncedVersion: string | null
  hotSyncedSha256: string | null
  localAsarSha256: string | null
  pendingHot: boolean
  lastCheck: {
    at: string
    action: string
    remoteVersion?: string
    detail?: string
  } | null
}

export function getUpdateInfo(): UpdateInfo {
  return {
    packaged: app.isPackaged,
    packageVersion: app.getVersion(),
    feedUrl: feedUrl(),
    lastStatus,
    lastRemoteVersion,
    lastDetail,
    lastPercent,
    hotSyncedVersion: lastRemoteVersion,
    hotSyncedSha256: null,
    localAsarSha256: null,
    pendingHot: lastStatus === 'downloaded',
    lastCheck: {
      at: new Date().toISOString(),
      action: lastStatus,
      remoteVersion: lastRemoteVersion || undefined,
      detail: lastDetail || undefined
    }
  }
}

/**
 * 按 electron-vite 文档的 electron-builder generic 发布方式，
 * 使用 electron-updater 检查/下载/安装全量更新。
 * @see https://electron-vite.org/guide/distribution
 */
export function startElectronUpdater(): void {
  if (started) return
  started = true

  if (!app.isPackaged) {
    lastStatus = 'skipped_dev'
    lastDetail = 'unpackaged/dev mode — electron-updater 不运行'
    console.log('[ace-crm] skip electron-updater in unpackaged/dev mode')
    return
  }

  const url = feedUrl()
  lastStatus = 'starting'
  lastDetail = url

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = true

  ensureUpdateConfigFile(url)

  try {
    autoUpdater.setFeedURL({ provider: 'generic', url })
  } catch (e) {
    lastStatus = 'error'
    lastDetail = e instanceof Error ? e.message : String(e)
    console.warn('[ace-crm] setFeedURL failed:', e)
    return
  }

  autoUpdater.on('checking-for-update', () => {
    lastStatus = 'checking'
    lastPercent = null
    lastDetail = url
    console.log('[updater] checking', url)
    publishUpdate()
  })
  autoUpdater.on('update-available', (info) => {
    lastStatus = 'available'
    lastRemoteVersion = info.version
    lastPercent = 0
    lastDetail = `发现 ${info.version}，开始下载`
    console.log('[updater] available', info.version)
    publishUpdate()
  })
  autoUpdater.on('update-not-available', async (info) => {
    lastStatus = 'up_to_date'
    lastRemoteVersion = info.version
    lastPercent = null
    lastDetail = `当前 ${app.getVersion()}，远端 ${info.version}`
    console.log('[updater] not available, current=', app.getVersion(), 'remote=', info.version)
    publishUpdate()
    if (manualCheck) {
      manualCheck = false
      await dialog.showMessageBox({
        type: 'info',
        title: '检查更新',
        message: '当前已是最新版本。',
        detail: lastDetail
      })
    }
  })
  autoUpdater.on('error', async (err) => {
    lastStatus = 'error'
    lastPercent = null
    lastDetail = err.message
    console.warn('[updater] error:', err)
    publishUpdate()
    if (manualCheck) {
      manualCheck = false
      await dialog.showMessageBox({
        type: 'error',
        title: '检查更新失败',
        message: err.message || '无法检查更新'
      })
    }
  })
  autoUpdater.on('download-progress', (p) => {
    const next = Math.max(0, Math.min(100, Math.round(p.percent)))
    if (lastStatus === 'downloading' && lastPercent === next) return
    lastStatus = 'downloading'
    lastPercent = next
    lastDetail = `${next}%`
    console.log(`[updater] download ${next}%`)
    publishUpdate()
  })
  autoUpdater.on('update-downloaded', async (info) => {
    lastStatus = 'downloaded'
    lastRemoteVersion = info.version
    lastPercent = 100
    lastDetail = '已下载，等待安装'
    manualCheck = false
    console.log('[updater] downloaded', info.version)
    publishUpdate()
    await promptIfDownloaded()
  })

  void autoUpdater.checkForUpdates().catch((e) => {
    lastStatus = 'error'
    lastDetail = e instanceof Error ? e.message : String(e)
    console.warn('[updater] checkForUpdates failed:', e)
  })
}

async function promptIfDownloaded(): Promise<void> {
  if (lastStatus !== 'downloaded') return
  const win = BrowserWindow.getFocusedWindow()
  const opts = {
    type: 'info' as const,
    title: '更新已就绪',
    message: `新版本 v${lastRemoteVersion || ''} 已下载完成，是否立即重启安装？`,
    detail: '将关闭应用并打开安装向导，完成后会自动启动。',
    buttons: ['立即重启', '稍后'],
    defaultId: 0,
    cancelId: 1
  }
  const result = win
    ? await dialog.showMessageBox(win, opts)
    : await dialog.showMessageBox(opts)
  if (result.response === 0) quitAndRunInstaller()
}

/** 标题栏 / 设置页手动检查更新 */
export async function checkForUpdatesNow(): Promise<UpdateInfo> {
  manualCheck = true
  if (!app.isPackaged) {
    lastStatus = 'skipped_dev'
    lastDetail = '开发模式不会下载安装包更新，请使用官网打包客户端'
    return getUpdateInfo()
  }
  if (!started) {
    startElectronUpdater()
    return getUpdateInfo()
  }
  if (lastStatus === 'downloaded') {
    await promptIfDownloaded()
    return getUpdateInfo()
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    lastStatus = 'error'
    lastDetail = e instanceof Error ? e.message : String(e)
  }
  return getUpdateInfo()
}

/** @deprecated 兼容旧调用名 */
export async function checkAppUpdatesOnStartup(): Promise<void> {
  startElectronUpdater()
}

/** 手动 asar 热更新已废弃；保留空实现避免旧调用崩溃 */
export function tryApplyPendingHotUpdate(): boolean {
  return false
}
