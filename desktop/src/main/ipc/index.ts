import { BrowserWindow, ipcMain } from 'electron'
import {
  loadAuthState,
  loginWithPassword,
  logout,
  sanitizeAuthScopeKey,
  type AuthPublicState
} from '../services/auth'
import { destroyAllViews, hideAllViews } from '../services/browserViews'
import { destroyWorkbenchView, hideWorkbenchView, setWorkbenchBounds, showWorkbenchView, reloadWorkbenchView } from '../services/workbenchView'
import { setShellMode, setUserSettingsOverlay } from '../services/appMode'
import { destroyMapsViews, hideMapsViews } from '../services/maps/views'
import { emitAuthExpired as emitAuthExpiredEvent } from '../services/authEvents'
import { broadcastSettings, loadSettings, saveSettings, type AppSettings } from '../services/settings'
import {
  getInstalledLineExtensionVersion,
  getLineExtensionInfo,
  publicLineExtensionVersion
} from '../services/lineExtension'
import { registerViewIpc } from './views'
import { registerPhase5Ipc } from './phase5'
import { registerClueIpc } from './clue'
import { registerMapsIpc } from './maps'

function getAuthPublicState(): AuthPublicState {
  const auth = loadAuthState()
  const settings = loadSettings()
  return {
    authenticated: Boolean(auth?.token),
    inviteCode: auth?.username ?? null,
    inviteCodeId: null,
    token: auth?.token ?? null,
    backendUrl: settings.backendUrl,
    userId: auth?.userId ?? null,
    username: auth?.username ?? null,
    displayName: auth?.displayName ?? null,
    scopeKey: auth ? sanitizeAuthScopeKey(auth.userId, auth.username) : null
  }
}

export function registerIpcHandlers(): void {
  registerViewIpc()
  registerPhase5Ipc()
  registerClueIpc()
  registerMapsIpc()

  ipcMain.handle('auth:getState', () => getAuthPublicState())

  ipcMain.handle(
    'auth:login',
    async (
      _event,
      payload: { username?: string; password?: string; inviteCode?: string; backendUrl?: string }
    ) => {
      const incomingUrl = payload?.backendUrl?.trim() ?? ''
      let settings = loadSettings()
      if (incomingUrl) {
        settings = saveSettings({ backendUrl: incomingUrl })
      }
      const backendUrl = settings.backendUrl
      if (!backendUrl) {
        return { ok: false, error: '请先填写后端地址' }
      }
      const username = payload?.username?.trim() || payload?.inviteCode?.trim() || ''
      const password = payload?.password || ''
      return loginWithPassword(backendUrl, username, password)
    }
  )

  ipcMain.handle('app:requestSocialMode', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('app:modeChanged', 'social')
    }
    return { ok: true }
  })

  /** 工作台菜单「地图获客」：通知外壳切到地图模式 */
  ipcMain.handle('app:requestMapsMode', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('app:modeChanged', 'maps')
    }
    return { ok: true }
  })

  /** 用户设置打开时摘掉原生页面，关闭后由 setMode 按当前版块挂回去。 */
  ipcMain.handle('app:setUserSettingsOverlay', (_event, open: boolean) => {
    const shown = Boolean(open)
    setUserSettingsOverlay(shown)
    if (shown) {
      hideAllViews()
      hideWorkbenchView()
      hideMapsViews()
    }
    return { ok: true }
  })

  ipcMain.handle(
    'app:setMode',
    (_event, payload: { mode?: string; bounds?: { x: number; y: number; width: number; height: number } }) => {
      const raw = payload?.mode
      const mode = raw === 'workbench' || raw === 'maps' ? raw : 'social'
      setShellMode(mode)
      if (mode === 'workbench') {
        hideAllViews()
        hideMapsViews()
        return showWorkbenchView(payload?.bounds)
      }
      if (mode === 'maps') {
        hideAllViews()
        hideWorkbenchView()
        // 地图子 WebView 由前端 ensureMapsChild / setMapsVisible 控制
        return { ok: true }
      }
      // social
      hideWorkbenchView()
      hideMapsViews()
      return { ok: true }
    }
  )

  ipcMain.handle(
    'app:setWorkbenchBounds',
    (_event, bounds: { x: number; y: number; width: number; height: number }) => {
      setWorkbenchBounds(bounds)
      return { ok: true }
    }
  )

  /** 工作台页面刷新（强制重载 BrowserView） */
  ipcMain.handle('app:reloadWorkbench', () => reloadWorkbenchView())

  ipcMain.handle('auth:logout', () => {
    // 先销毁社媒/工作台/地图视图，切断旧账号 Session；再清登录态
    destroyAllViews()
    destroyWorkbenchView()
    destroyMapsViews()
    logout()
    return { ok: true }
  })

  ipcMain.handle('settings:get', () => loadSettings())

  ipcMain.handle('settings:set', (_event, partial: Partial<AppSettings>) => {
    const next = saveSettings(partial ?? {})
    broadcastSettings(next)
    return next
  })

  /** 401 时由其他服务调用：清登录并发事件 */
  ipcMain.handle('auth:forceExpire', () => {
    emitAuthExpiredEvent()
    return { ok: true }
  })

  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    if (win.isMaximized()) {
      win.unmaximize()
      return false
    }
    win.maximize()
    return true
  })

  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('window:isMaximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  ipcMain.handle('lineExt:getVersion', () => {
    return { version: publicLineExtensionVersion(getInstalledLineExtensionVersion()) }
  })

  ipcMain.handle('lineExt:getInfo', () => getLineExtensionInfo())

  // 对齐海王 crx-msg：LINE 扩展页 chrome.cookies / tabs → session
  ipcMain.handle('omni-crx-msg', async (event, fn: string, ...args: unknown[]) => {
    const ses = event.sender.session
    try {
      switch (fn) {
        case 'cookies.get': {
          const details = (args[0] || {}) as Electron.CookiesGetFilter
          return await ses.cookies.get(details)
        }
        case 'cookies.getAll': {
          const details = (args[0] || {}) as Electron.CookiesGetFilter
          return await ses.cookies.get(details)
        }
        case 'cookies.set': {
          const details = args[0] as Electron.CookiesSetDetails
          if (!details?.url) return null
          await ses.cookies.set(details)
          const found = await ses.cookies.get({
            url: details.url,
            name: details.name
          })
          return found[0] ?? null
        }
        case 'cookies.remove': {
          const details = args[0] as { url?: string; name?: string }
          if (!details?.url || !details?.name) return null
          return await ses.cookies.remove(details.url, details.name)
        }
        case 'tabs.reload': {
          if (!event.sender.isDestroyed()) {
            // 海王：forcefullyCrashRenderer + reload；这里先普通 reload
            event.sender.reload()
          }
          return null
        }
        case 'tabs.getZoom':
          return 1
        default:
          console.warn('[omnitranslate] omni-crx-msg unhandled', fn)
          return null
      }
    } catch (e) {
      console.warn('[omnitranslate] omni-crx-msg failed', fn, e)
      return null
    }
  })
}

export function emitAuthExpired(): void {
  emitAuthExpiredEvent()
}
