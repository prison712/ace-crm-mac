import { BrowserView, BrowserWindow, session } from 'electron'
import { join } from 'path'
import { getShellMode, isUserSettingsOverlay } from '../appMode'
import { ensureMapsProxy, resolveMapsProxy } from './proxy'
import { getSettings } from './db'

const MAPS_PARTITION = 'persist:maps-scrape'
const MAPS_LABEL = 'maps'
/** 地图页面按这个尺寸排版，关闭按钮才出得来。窗口小的话右边和下边可以露在外面。 */
const MAPS_LAYOUT_WIDTH = 1440
const MAPS_LAYOUT_HEIGHT = 900

let mapsView: BrowserView | null = null
/** 商家官网窗口。每个 label 一个可见窗口，停止采集时全部关掉。 */
const emailWindows = new Map<string, BrowserWindow>()
let mapsVisible = false
/** 每次隐藏加一。进行中的打开若对不上，就不再把地图挂回窗口。 */
let mapsShowEpoch = 0
let lastMapsBounds: { x: number; y: number; width: number; height: number } | null = null
/** 最近一次真正打开的地图地址。切页后子视图被销毁时用它把画面找回来。 */
let lastMapsUrl = 'https://www.google.com/maps'
let mapsProxyFingerprint: string | null = null

/**
 * 功能：解析 maps-host preload 路径。
 * @returns 绝对路径
 */
function mapsHostPreloadPath(): string {
  // electron-vite 将 main 打进 out/main/index.js，与 workbench 一致
  return join(__dirname, '../preload/maps-host.js')
}

/**
 * 功能：取主窗口。
 * @returns BrowserWindow 或 null
 */
function mainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

/**
 * 功能：规范化 bounds。
 * @param x 左
 * @param y 上
 * @param width 宽
 * @param height 高
 * @returns 整数矩形
 */
/**
 * 功能：把嵌入地图的内部尺寸放大到能排出关闭按钮。位置仍跟搜索页占位对齐。
 * @param bounds 占位区域
 * @returns 实际套在子视图上的矩形
 */
function layoutBounds(bounds: {
  x: number
  y: number
  width: number
  height: number
}): { x: number; y: number; width: number; height: number } {
  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(bounds.width, MAPS_LAYOUT_WIDTH),
    height: Math.max(bounds.height, MAPS_LAYOUT_HEIGHT)
  }
}

function normalizeBounds(
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height))
  }
}

/**
 * 功能：设置指纹，判断代理配置是否变化。
 * @param settings 设置摘要字段
 * @returns 指纹
 */
function proxyFp(settings: ReturnType<typeof getSettings>): string {
  if (!settings.mapsProxyEnabled) return 'off'
  const p = resolveMapsProxy(settings)
  return [p.scheme, p.host, p.port, p.username, p.password].join('|')
}

/**
 * 功能：对 session 应用地图代理。
 * @param ses Session
 * @returns void
 */
async function applyMapsSessionProxy(ses: Electron.Session): Promise<void> {
  const settings = getSettings()
  const rules = await ensureMapsProxy(settings)
  if (!rules) {
    await ses.setProxy({ mode: 'direct' })
    return
  }
  await ses.setProxy({ proxyRules: rules, proxyBypassRules: '<local>' })
}

/**
 * 功能：若页面缺少 __MAPS_HOST__，用 executeJavaScript 兜底注入（preload 优先）。
 * @param wc WebContents
 * @returns void
 */
async function ensureMapsHostBridge(wc: Electron.WebContents): Promise<void> {
  if (wc.isDestroyed()) return
  try {
    await wc.executeJavaScript(
      `(() => {
        if (window.__MAPS_HOST__ && typeof window.__MAPS_HOST__.emit === 'function') return true;
        // preload 未注入时无法从页面直接 ipc；仅占位避免脚本报错
        window.__MAPS_HOST__ = window.__MAPS_HOST__ || {
          emit: function (e, p) {
            console.warn('[maps] __MAPS_HOST__ fallback noop', e, p);
          }
        };
        return false;
      })()`,
      true
    )
  } catch {
    /* ignore */
  }
}

/**
 * 功能：创建带 maps-host preload 的 BrowserView。
 * @param partition Session 分区
 * @returns BrowserView
 */
function createMapsBrowserView(partition: string): BrowserView {
  const view = new BrowserView({
    webPreferences: {
      partition,
      preload: mapsHostPreloadPath(),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  view.webContents.on('did-finish-load', () => {
    void ensureMapsHostBridge(view.webContents)
  })
  try {
    view.setBackgroundColor('#ffffff')
  } catch {
    /* ignore */
  }
  return view
}

/**
 * 功能：把视图挂到主窗口并置顶。
 * @param view BrowserView
 * @returns void
 */
function attachView(view: BrowserView): void {
  if (view.webContents.isDestroyed()) return
  const win = mainWindow()
  if (!win || win.isDestroyed()) return
  if (getShellMode() !== 'maps' || isUserSettingsOverlay()) {
    detachView(view)
    return
  }
  const keep = new Set<BrowserView>([view])
  if (mapsView) keep.add(mapsView)
  for (const bv of [...win.getBrowserViews()]) {
    if (keep.has(bv)) continue
    try {
      win.removeBrowserView(bv)
    } catch {
      /* ignore */
    }
  }
  const attached = win.getBrowserViews()
  if (!attached.includes(view)) {
    win.addBrowserView(view)
  }
  try {
    win.setTopBrowserView(view)
  } catch {
    /* ignore */
  }
}

/**
 * 功能：从主窗口移除视图。
 * @param view BrowserView
 * @returns void
 */
function detachView(view: BrowserView): void {
  const win = mainWindow()
  if (!win || win.isDestroyed()) return
  try {
    if (!view.webContents.isDestroyed()) {
      win.removeBrowserView(view)
    }
  } catch {
    /* ignore */
  }
}

/**
 * 功能：销毁并关闭 BrowserView。
 * @param view BrowserView
 * @returns void
 */
function destroyView(view: BrowserView): void {
  detachView(view)
  try {
    view.webContents.close()
  } catch {
    /* ignore */
  }
}

/**
 * 功能：切回搜索页时不要用地图首页覆盖正在采集的搜索。
 * 只有空白页，或目标不是首页且和当前地址不同时才跳转。
 * @param current 当前地址
 * @param next 要打开的地址
 * @returns 是否需要 loadURL
 */
/**
 * 功能：丢掉已经销毁的地图子视图，避免再挂回主窗口。
 * @returns 还活着的视图，没有则 null
 */
function liveMapsView(): BrowserView | null {
  if (!mapsView) return null
  if (mapsView.webContents.isDestroyed()) {
    mapsView = null
    return null
  }
  return mapsView
}

/**
 * 功能：是不是不带搜索词的地图首页。
 * @param url 地址
 * @returns 是否首页
 */
function isMapsHome(url: string): boolean {
  const target = (url || '').split('#')[0]
  return target === 'https://www.google.com/maps' || target === 'https://www.google.com/maps/'
}

function shouldNavigateMaps(current: string, next: string): boolean {
  const cur = (current || '').split('#')[0]
  const target = (next || '').split('#')[0]
  if (!cur || cur === 'about:blank') return true
  const home = target === 'https://www.google.com/maps' || target === 'https://www.google.com/maps/'
  const onMaps = /https:\/\/www\.google\.[^/]+\/maps/i.test(cur)
  if (home && onMaps) return false
  return cur !== target
}

/**
 * 功能：确保地图子 WebView 存在并导航到 url、设置 bounds。
 * @param url 目标地址
 * @param x 左
 * @param y 上
 * @param width 宽
 * @param height 高
 * @returns void
 */
export async function ensureMapsChild(
  url: string,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<void> {
  const epoch = mapsShowEpoch
  const bounds = normalizeBounds(x, y, width, height)
  if (bounds.width >= 40 && bounds.height >= 40) lastMapsBounds = bounds
  const settings = getSettings()
  const fp = proxyFp(settings)
  const requested = isMapsHome(url) && lastMapsUrl && !isMapsHome(lastMapsUrl) ? lastMapsUrl : url

  if (mapsView && (mapsView.webContents.isDestroyed() || mapsProxyFingerprint !== fp)) {
    if (!mapsView.webContents.isDestroyed()) destroyView(mapsView)
    mapsView = null
    mapsProxyFingerprint = null
  }

  if (!mapsView) {
    mapsView = createMapsBrowserView(MAPS_PARTITION)
    mapsProxyFingerprint = fp
    const ses = session.fromPartition(MAPS_PARTITION)
    await applyMapsSessionProxy(ses)
  }

  const view = liveMapsView()
  if (!view || !mapsVisible || epoch !== mapsShowEpoch) {
    if (view) detachView(view)
    return
  }
  attachView(view)
  if (bounds.width >= 40 && bounds.height >= 40) view.setBounds(layoutBounds(bounds))

  const current = view.webContents.getURL()
  if (shouldNavigateMaps(current, requested)) {
    await view.webContents.loadURL(requested)
  }
  if (!mapsVisible || epoch !== mapsShowEpoch || isUserSettingsOverlay()) {
    if (!view.webContents.isDestroyed()) detachView(view)
    return
  }
  const shown = view.webContents.isDestroyed() ? '' : view.webContents.getURL()
  if (shown && shown !== 'about:blank') lastMapsUrl = shown.split('#')[0]

  if (settings.mapsDebugMode) {
    try {
      if (mapsView && !mapsView.webContents.isDestroyed() && !mapsView.webContents.isDevToolsOpened()) {
        mapsView.webContents.openDevTools({ mode: 'detach' })
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * 功能：显示或隐藏地图子视图。
 * @param visible 是否可见
 * @returns void
 */
export async function setMapsVisible(visible: boolean): Promise<void> {
  if (visible && isUserSettingsOverlay()) visible = false
  mapsVisible = visible
  if (!visible) mapsShowEpoch += 1
  const epoch = mapsShowEpoch
  const view = liveMapsView()
  if (!view) {
    if (!visible) return
    const bounds = lastMapsBounds || { x: 0, y: 0, width: 1100, height: 800 }
    await ensureMapsChild(lastMapsUrl, bounds.x, bounds.y, bounds.width, bounds.height)
    return
  }
  if (!mapsVisible || epoch !== mapsShowEpoch) {
    detachView(view)
    return
  }
  attachView(view)
  if (lastMapsBounds && lastMapsBounds.width >= 40 && lastMapsBounds.height >= 40) {
    view.setBounds(layoutBounds(lastMapsBounds))
  }
}

/**
 * 功能：仅更新地图几何。
 * @param x 左
 * @param y 上
 * @param width 宽
 * @param height 高
 * @returns void
 */
export async function setMapsBounds(
  x: number,
  y: number,
  width: number,
  height: number
): Promise<void> {
  const bounds = normalizeBounds(x, y, width, height)
  if (bounds.width < 40 || bounds.height < 40) return
  lastMapsBounds = bounds
  const view = liveMapsView()
  if (view && mapsVisible) view.setBounds(layoutBounds(bounds))
}

/**
 * 功能：在已有的地图子视图里打开下一条搜索，不新开窗口。
 * 采集脚本只注入这个子视图；若每次搜索另开窗口，结果页上看得到店，脚本却点不到。
 * @param url 搜索地址
 * @returns void
 */
export async function openMapsWindow(url: string): Promise<void> {
  const bounds = lastMapsBounds || { x: 0, y: 0, width: 1100, height: 800 }
  await ensureMapsChild(url, bounds.x, bounds.y, bounds.width, bounds.height)
}

/**
 * 功能：在地图 WebView 中执行 JS。
 * @param script 脚本
 * @returns 执行结果
 */
export async function evalMapsJs(script: string): Promise<unknown> {
  if (!mapsView || mapsView.webContents.isDestroyed()) {
    throw new Error('地图 WebView 未打开')
  }
  return mapsView.webContents.executeJavaScript(script, true)
}

/**
 * 功能：取还活着的商家网站窗口。
 * @param label 窗口标签
 * @returns 窗口或 null
 */
function emailWindow(label: string): BrowserWindow | null {
  const key = String(label || '').trim() || 'email'
  const win = emailWindows.get(key)
  if (!win || win.isDestroyed()) {
    emailWindows.delete(key)
    return null
  }
  return win
}

/**
 * 功能：打开可见的商家网站窗口采集邮箱。同一 label 再次调用会在原窗口里换地址。
 * @param label 窗口标签
 * @param url 网站地址
 * @returns void
 */
export async function openEmailWindow(label: string, url: string): Promise<void> {
  const key = String(label || '').trim() || 'email'
  const target = String(url || '').trim()
  if (!target) throw new Error('网站地址为空')

  let win = emailWindow(key)
  if (!win) {
    const partition = `persist:maps-email-${key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48)}`
    win = new BrowserWindow({
      width: 900,
      height: 700,
      title: `邮箱采集 - ${key}`,
      autoHideMenuBar: true,
      show: true,
      webPreferences: {
        partition,
        preload: mapsHostPreloadPath(),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    emailWindows.set(key, win)
    win.on('closed', () => {
      if (emailWindows.get(key) === win) emailWindows.delete(key)
    })
    // 商家官网走本机直连。地图代理只给谷歌地图，套到官网经常打不开。
    const ses = session.fromPartition(partition)
    await ses.setProxy({ mode: 'direct' })
  }

  if (win.isDestroyed() || win.webContents.isDestroyed()) {
    emailWindows.delete(key)
    throw new Error(`邮箱窗口已关闭: ${key}`)
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.moveTop()
  const current = win.webContents.getURL().split('#')[0]
  if (current === target.split('#')[0]) return
  try {
    await win.loadURL(target)
  } catch (error) {
    const loaded = !win.isDestroyed() && win.webContents.getURL() && win.webContents.getURL() !== 'about:blank'
    if (!loaded) throw error
  }
}

/**
 * 功能：在指定商家网站窗口执行 JS。
 * @param label 标签
 * @param script 脚本
 * @returns 脚本返回值
 */
export async function evalEmailJs(label: string, script: string): Promise<unknown> {
  const win = emailWindow(label)
  if (!win) throw new Error(`邮箱窗口不存在: ${label}`)
  return win.webContents.executeJavaScript(script, true)
}

/**
 * 功能：关掉全部商家网站窗口。
 * @returns 关闭的窗口数
 */
export function closeAllEmailWindows(): number {
  const windows = [...emailWindows.values()]
  emailWindows.clear()
  let closed = 0
  for (const win of windows) {
    if (win.isDestroyed()) continue
    closed += 1
    win.close()
  }
  return closed
}

/**
 * 功能：关闭指定 WebView（maps 或邮箱 label）。
 * @param label 标签
 * @returns void
 */
export async function closeWebview(label: string): Promise<void> {
  const key = String(label || '').trim()
  if (key === MAPS_LABEL || key === 'maps') {
    if (mapsView) {
      destroyView(mapsView)
      mapsView = null
      mapsProxyFingerprint = null
    }
    return
  }
  const win = emailWindows.get(key)
  if (win && !win.isDestroyed()) win.close()
  emailWindows.delete(key)
}

/**
 * 功能：清理地图分区缓存。
 * @returns void
 */
export async function clearMapsWebviewCache(): Promise<void> {
  const ses = session.fromPartition(MAPS_PARTITION)
  await ses.clearCache()
  try {
    await ses.clearStorageData()
  } catch {
    /* ignore */
  }
}

/**
 * 功能：打开地图子 WebView 开发者工具。
 * @returns void
 */
export async function openMapsDevtools(): Promise<void> {
  if (!mapsView || mapsView.webContents.isDestroyed()) {
    throw new Error('地图 WebView 未打开')
  }
  mapsView.webContents.openDevTools({ mode: 'detach' })
}

/**
 * 功能：隐藏地图与邮箱视图（切模式时）。
 * @returns void
 */
export function hideMapsViews(): void {
  mapsVisible = false
  if (mapsView) detachView(mapsView)
}

/**
 * 功能：销毁全部地图相关视图。
 * @returns void
 */
export function destroyMapsViews(): void {
  hideMapsViews()
  if (mapsView) {
    destroyView(mapsView)
    mapsView = null
  }
  closeAllEmailWindows()
  mapsProxyFingerprint = null
  lastMapsBounds = null
}

/**
 * 功能：将宿主事件转发到主窗口渲染进程。
 * @param channel 事件名
 * @param payload 载荷
 * @returns void
 */
export function forwardMapsHostEvent(channel: string, payload: unknown): void {
  const win = mainWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send('maps:event', { channel, payload })
}
