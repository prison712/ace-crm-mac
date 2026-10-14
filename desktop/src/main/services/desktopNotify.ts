import {
  BrowserWindow,
  Notification,
  Tray,
  app,
  nativeImage,
  shell
} from 'electron'
import { spawn } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { getViewMetaByLabel } from './browserViews'
import {
  isActiveSynced,
  isTabActive,
  pauseActiveTabForNotify,
  resumeActiveTabAfterFocus
} from './syncState'

/** 必须与 electron-builder.yml appId、安装包快捷方式一致，否则 Win10 Toast 不显示 */
export const APP_USER_MODEL_ID = 'com.zhending.acecrm'

const PLATFORM_NAMES: Record<string, string> = {
  whatsapp: 'WhatsApp',
  zalo: 'Zalo',
  line: 'LINE',
  line_business: 'LINE Business',
  telegram: 'Telegram',
  telegram_w: 'Telegram-W',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  meta_business: 'Meta Business',
  twitter: 'X (Twitter)',
  messenger: 'Messenger',
  google_voice: 'Google Voice',
  botim: 'Botim',
  snapchat: 'Snapchat',
  discord: 'Discord',
  skype: 'Skype',
  line_works: 'LINE Works',
  linkedin: 'LinkedIn',
  google_chat: 'Google Chat',
  tinder: 'Tinder'
}

const lastNotifiedCount = new Map<string, number>()
const lastTranslateNotifyAt = new Map<string, number>()
const TRANSLATE_NOTIFY_GAP_MS = 2500

export function clearDesktopNotifyState(webviewLabel: string): void {
  if (!webviewLabel) return
  lastNotifiedCount.delete(webviewLabel)
  lastTranslateNotifyAt.delete(webviewLabel)
}

function platformName(groupId: string): string {
  return PLATFORM_NAMES[groupId] || groupId || 'ACE CRM'
}

function notificationIcon(): Electron.NativeImage | undefined {
  try {
    const candidates = [
      join(process.resourcesPath || '', 'icon.png'),
      join(app.getAppPath(), 'resources', 'icon.png'),
      join(__dirname, '../../resources/icon.png'),
      join(__dirname, '../../build/icon.ico'),
      join(process.resourcesPath || '', 'icon.ico')
    ]
    for (const p of candidates) {
      if (!p || !existsSync(p)) continue
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img
    }
  } catch {
    /* ignore */
  }
  return undefined
}

/**
 * Win10 Toast 依赖「开始菜单快捷方式 + 相同 AppUserModelId」。
 * 安装包通常已有；便携/覆盖运行时补写一份，避免客户机无弹窗。
 */
export function initWindowsNotifySupport(): void {
  try {
    app.setAppUserModelId(APP_USER_MODEL_ID)
  } catch {
    /* ignore */
  }
  // 尽早挂上 blur/focus：失焦放开当前标签抑制（消息数增加才能闪任务栏）
  ensureFocusHooks()
  if (process.platform !== 'win32') return
  try {
    const programs = join(
      app.getPath('appData'),
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs'
    )
    mkdirSync(programs, { recursive: true })
    const lnkPath = join(programs, 'ACE CRM.lnk')
    const target = process.execPath
    const operation = existsSync(lnkPath) ? 'update' : 'create'
    shell.writeShortcutLink(lnkPath, operation, {
      target,
      cwd: dirname(target),
      description: 'ACE CRM',
      appUserModelId: APP_USER_MODEL_ID
    })
  } catch (e) {
    console.warn('[acecrm] ensure Win10 toast shortcut failed:', e)
  }
}

let unreadTotal = 0
let mainWindowFocused = true
let focusHooksInstalled = false
/** 已触发「待处理未读提醒」：持续闪到用户点击/聚焦或未读清零 */
let attentionPending = false
let flashKeepAliveTimer: ReturnType<typeof setInterval> | null = null

function stopFlashMainWindow(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.flashFrame(false)
    } catch {
      /* ignore */
    }
    break
  }
}

function flashMainWindow(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      // 先关再开，提高 Win11 再次触发成功率（Omni 仅 flashFrame(true)；此为兼容补强）
      win.flashFrame(false)
      win.flashFrame(true)
    } catch {
      /* ignore */
    }
    break
  }
}

function stopContinuousFlash(): void {
  attentionPending = false
  if (flashKeepAliveTimer) {
    clearInterval(flashKeepAliveTimer)
    flashKeepAliveTimer = null
  }
  stopFlashMainWindow()
}

/**
 * Windows 上 flashFrame(true) 默认只闪几下就停，需周期性重新 flash 才能持续到用户点击。
 * （对齐 OmniTranslate desktopNotify）
 */
function startContinuousFlash(): void {
  if (mainWindowFocused) return
  attentionPending = true
  flashMainWindow()
  if (flashKeepAliveTimer) return
  flashKeepAliveTimer = setInterval(() => {
    if (!attentionPending || mainWindowFocused) {
      stopContinuousFlash()
      return
    }
    flashMainWindow()
  }, 1200)
}

function syncFocusFromWindow(win: BrowserWindow | undefined): void {
  if (!win || win.isDestroyed()) return
  mainWindowFocused = win.isFocused() && !win.isMinimized()
}

function ensureFocusHooks(): void {
  if (focusHooksInstalled) return
  focusHooksInstalled = true
  const attach = (win: BrowserWindow): void => {
    // 点击任务栏图标会 focus：立刻停闪，等未读数再次由少变多才闪
    win.on('focus', () => {
      mainWindowFocused = true
      stopContinuousFlash()
      // 恢复「当前查看标签」，与 Omni isTabActive 抑制语义对齐
      resumeActiveTabAfterFocus()
    })
    win.on('blur', () => {
      mainWindowFocused = false
      // 失焦后放开当前标签抑制：否则停在 TG/WA 标签上时未读上升永远不弹不闪
      // （对齐 Omni「非当前查看才提醒」——失焦即视为未在查看）
      pauseActiveTabForNotify()
    })
    win.on('minimize', () => {
      mainWindowFocused = false
      pauseActiveTabForNotify()
    })
    win.on('restore', () => {
      if (win.isFocused()) {
        mainWindowFocused = true
        stopContinuousFlash()
        resumeActiveTabAfterFocus()
      }
    })
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) attach(win)
  }
  app.on('browser-window-created', (_e, win) => attach(win))
}

/**
 * 任务栏闪烁策略（对齐 OmniTranslate）：
 * - 未读数由少→多 且窗口未聚焦：开始持续闪烁（直到点击/聚焦）
 * - 未读数由多→少：不新触发；若已在闪则继续闪（不因计数抖动停闪）
 * - 未读清零或点击任务栏：停止闪烁
 */
export function setUnreadAttention(total: number): void {
  ensureFocusHooks()
  const next = Math.max(0, Number(total) || 0)
  const prev = unreadTotal
  unreadTotal = next

  const wins = BrowserWindow.getAllWindows()
  syncFocusFromWindow(wins[0])

  if (next <= 0) {
    stopContinuousFlash()
    return
  }

  // 仅「由少到多」新开闪烁；由多到少不打断已在进行的闪烁
  if (next > prev && !mainWindowFocused) {
    startContinuousFlash()
  }
}

function focusAndOpenTab(
  webviewLabel: string,
  tabId: string,
  groupId: string
): void {
  const wins = BrowserWindow.getAllWindows()
  const win = wins[0]
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    stopContinuousFlash()
    mainWindowFocused = true
    resumeActiveTabAfterFocus()
    if (tabId || webviewLabel) {
      win.webContents.send('message:open-tab', {
        tabId,
        groupId,
        webviewLabel
      })
    }
  }
}

/** Win10 托盘气泡兜底（不依赖 Toast 注册，多数机器可用） */
function showTrayBalloon(title: string, body: string): void {
  if (process.platform !== 'win32') return
  try {
    const icon = notificationIcon()
    if (!icon || icon.isEmpty()) return
    const tray = new Tray(icon)
    tray.setToolTip('ACE CRM')
    tray.displayBalloon({
      title,
      content: body.slice(0, 255),
      iconType: 'info'
    })
    const dispose = (): void => {
      try {
        tray.destroy()
      } catch {
        /* ignore */
      }
    }
    tray.on('balloon-click', () => {
      focusAndOpenTab('', '', '')
      dispose()
    })
    setTimeout(dispose, 12000)
  } catch (e) {
    console.warn('[acecrm] tray balloon failed:', e)
  }
}

/** WinRT Toast（需 AppUserModelId + 开始菜单快捷方式） */
function showWinRtToast(title: string, body: string): void {
  if (process.platform !== 'win32') return
  const safeTitle = title.replace(/[&<>"']/g, '')
  const safeBody = body.replace(/[&<>"']/g, '').slice(0, 180)
  const script = `
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$template = @"
<toast><visual><binding template="ToastGeneric"><text>${safeTitle}</text><text>${safeBody}</text></binding></visual></toast>
"@
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($template)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${APP_USER_MODEL_ID}')
$notifier.Show($toast)
`
  try {
    spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, stdio: 'ignore' }
    )
  } catch (e) {
    console.warn('[acecrm] WinRT toast spawn failed:', e)
  }
}

function showNotification(
  webviewLabel: string,
  count: number,
  pageTitle: string
): void {
  const meta = getViewMetaByLabel(webviewLabel)
  const groupId = meta?.groupId || ''
  const tabId = meta?.tabId || ''
  const name = platformName(groupId)
  const title = `ACE CRM · ${name}`
  const body =
    count > 1
      ? `${count} 条新消息${pageTitle ? ` · ${pageTitle}` : ''}`
      : pageTitle
        ? `新消息 · ${pageTitle}`
        : '你有一条新消息'
  const bodyShort = body.length > 120 ? `${body.slice(0, 117)}...` : body

  // 系统通知伴随持续任务栏闪烁（未聚焦时），直到用户点击 — 对齐 Omni
  ensureFocusHooks()
  syncFocusFromWindow(BrowserWindow.getAllWindows()[0])
  if (!mainWindowFocused) startContinuousFlash()

  // 只走一条通知通道，避免关一个又弹出另一个
  try {
    if (Notification.isSupported()) {
      const icon = notificationIcon()
      const n = new Notification({
        title,
        body: bodyShort,
        silent: false,
        ...(icon ? { icon } : {})
      })
      n.on('click', () => focusAndOpenTab(webviewLabel, tabId, groupId))
      n.on('failed', () => {
        if (process.platform === 'win32') {
          showWinRtToast(title, bodyShort)
          setTimeout(() => showTrayBalloon(title, bodyShort), 400)
        }
      })
      n.show()
      return
    }
  } catch (e) {
    console.warn('[acecrm] Electron Notification failed:', e)
  }

  if (process.platform === 'win32') {
    showWinRtToast(title, bodyShort)
  } else {
    showTrayBalloon(title, bodyShort)
  }
}

/**
 * 有新未读时弹出系统桌面通知（Windows 右下角等）。
 * 逻辑对齐 OmniTranslate；whatsapp / telegram / line 主进程未读同等处理。
 */
export function notifyDesktopNewMessage(
  webviewLabel: string,
  active: boolean,
  count: number,
  pageTitle: string,
  source = 'poll'
): void {
  ensureFocusHooks()
  if (!active || count <= 0) {
    lastNotifiedCount.delete(webviewLabel)
    return
  }
  // 对齐 Omni：正在查看的标签不弹窗（失焦时已 pause active，不会误吞）
  if (isActiveSynced() && isTabActive(webviewLabel)) return

  const now = Date.now()
  const prev = lastNotifiedCount.get(webviewLabel) ?? 0
  const n = Math.max(1, Math.floor(count))

  // WA / LINE / Telegram / Messenger 主进程未读轮询：仅未读数上升时弹一次（toast 内触发持续闪任务栏）
  if (
    source === 'line_unread' ||
    source === 'telegram_unread' ||
    source === 'whatsapp_unread' ||
    source === 'messenger_unread'
  ) {
    const lastAt = lastTranslateNotifyAt.get(webviewLabel) ?? 0
    if (now - lastAt < 1200) return
    if (n <= prev) return
    lastTranslateNotifyAt.set(webviewLabel, now)
    lastNotifiedCount.set(webviewLabel, n)
    const fallbackTitle =
      source === 'telegram_unread'
        ? 'Telegram'
        : source === 'whatsapp_unread'
          ? 'WhatsApp'
          : source === 'messenger_unread'
            ? 'Messenger'
            : 'LINE'
    showNotification(webviewLabel, n, pageTitle || fallbackTitle)
    return
  }

  // 后台翻译 / 扩展通知：事件型，按节流弹窗
  if (
    source === 'hidden_translate' ||
    source === 'became_hidden' ||
    source === 'line_notification'
  ) {
    const lastAt = lastTranslateNotifyAt.get(webviewLabel) ?? 0
    const gap = source === 'became_hidden' ? 800 : TRANSLATE_NOTIFY_GAP_MS
    if (now - lastAt < gap) return
    lastTranslateNotifyAt.set(webviewLabel, now)
    lastNotifiedCount.set(webviewLabel, Math.max(prev, n))
    showNotification(webviewLabel, n, pageTitle || 'LINE')
    return
  }

  // 标题/轮询类：只有计数上升才弹
  if (n <= prev) return
  lastNotifiedCount.set(webviewLabel, n)
  showNotification(webviewLabel, n, pageTitle)
}
