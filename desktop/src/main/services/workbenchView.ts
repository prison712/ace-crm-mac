import { BrowserView } from 'electron'
import { join } from 'path'
import { getAuthScopeKey, loadAuthState } from './auth'
import { loadSettings } from './settings'
import { getShellMode, isUserSettingsOverlay } from './appMode'
import { ensureWorkbenchOrigin } from './workbenchHost'
import { getMainWindow, type ViewBounds } from './browserViews'

const WORKBENCH_LABEL = '__workbench__'
/** Chromium: 导航被新请求取消，不算真正失败 */
const ERR_ABORTED = -3

let view: BrowserView | null = null
let failHandlerAttached = false
/** 正在导航的目标（去掉 hash），用于忽略重复 loadURL */
let pendingNavKey: string | null = null
let lastOkNavKey: string | null = null
/** 最近一次内容区坐标。视图尚未创建时先记下，避免盖住标题栏 */
let lastBounds: ViewBounds | null = null

function resolveWorkbenchBase(): string {
  const env = process.env.WORKBENCH_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  const backend = (loadSettings().backendUrl || '').trim().replace(/\/$/, '')
  return backend || 'http://localhost:3001'
}

/**
 * 工作台入口。页面文件在本机，只把 token 交给本地页，接口仍走后端。
 * @returns 完整加载地址
 */
async function workbenchUrl(): Promise<string> {
  const origin = await ensureWorkbenchOrigin()
  const auth = loadAuthState()
  const q = auth?.token ? `?token=${encodeURIComponent(auth.token)}` : ''
  return `${origin}/${q}#/dashboard`
}

/**
 * 比较导航目标（忽略 hash）
 * @param a URL
 * @param b URL
 */
function navKey(a: string): string {
  return String(a || '').split('#')[0]
}

/**
 * 失败页（真正加载失败时才展示，不是“正在加载”）
 * @param target 后端基址
 * @param detail 错误详情
 */
function failHtml(target: string, detail: string): string {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#f5f6f7;color:#373c43;
       display:flex;align-items:center;justify-content:center;height:100vh}
  .box{max-width:460px;padding:24px;background:#fff;border-radius:12px;border:1px solid #e6e8eb;
       box-shadow:0 8px 24px rgba(31,35,41,.08);line-height:1.6}
  h1{margin:0 0 8px;font-size:18px;color:#1f2329}
  code{background:#f2f3f5;padding:1px 6px;border-radius:4px;word-break:break-all}
  .err{margin-top:10px;font-size:12px;color:#ac2f28;background:#fef1f1;padding:8px 10px;border-radius:8px}
  .hint{margin-top:10px;font-size:12px;color:#646a73}
</style></head><body><div class="box">
  <h1>工作台打开失败</h1>
  <p>无法加载：<code>${target}</code></p>
  <div class="err">${detail || '未知错误'}</div>
  <p class="hint">页面从本机打开，只有业务数据走服务器。请确认后端地址可用，并用<strong>子账户</strong>登录。切换到「社媒」再切回「工作台」可重试。</p>
</div></body></html>`
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

/**
 * 记住内容区坐标，供稍后挂上视图时使用
 * @param bounds 内容区；缺省则沿用上次
 * @returns 可用坐标
 */
function rememberBounds(bounds?: ViewBounds): ViewBounds | null {
  if (bounds && bounds.width > 1 && bounds.height > 1) lastBounds = bounds
  return lastBounds
}

/**
 * 把工作台视图限制在内容区，避免默认铺满窗口盖住「刷新工作台」
 * @param bv 工作台视图
 * @param bounds 本次坐标，可空
 */
/**
 * 还没量到内容区时，先让出标题栏和左侧栏，避免视图铺满后点不到刷新
 * @returns 临时坐标
 */
function fallbackContentBounds(): ViewBounds | null {
  const win = getMainWindow()
  if (!win) return null
  const [width, height] = win.getContentSize()
  return {
    x: 44,
    y: 32,
    width: Math.max(1, width - 44),
    height: Math.max(1, height - 32)
  }
}

/**
 * 确保工作台视图挂在主窗口最上层；被社媒 show 误摘后只改 bounds 不够。
 * @param bv 工作台视图
 */
function attachWorkbench(bv: BrowserView): boolean {
  const win = getMainWindow()
  if (!win) return false
  const attached = win.getBrowserViews()
  if (!attached.includes(bv)) {
    win.addBrowserView(bv)
  }
  try {
    win.setTopBrowserView(bv)
  } catch {
    /* electron 旧版无此 API */
  }
  return true
}

function applyBounds(bv: BrowserView, bounds?: ViewBounds): void {
  const next = rememberBounds(bounds) || fallbackContentBounds()
  if (!next) return
  const guardTop = 36
  const rawY = Math.round(next.y)
  const y = Math.max(guardTop, rawY)
  bv.setBounds({
    x: Math.max(0, Math.round(next.x)),
    y,
    width: Math.max(1, Math.round(next.width)),
    height: Math.max(1, Math.round(next.height) - Math.max(0, y - rawY))
  })
}

function ensureView(): BrowserView {
  if (view) return view
  const scope = getAuthScopeKey()
  view = new BrowserView({
    webPreferences: {
      // 按软件账号隔离，避免换账号后工作台 cookie/缓存串用
      partition: `persist:workbench-${scope}`,
      preload: join(__dirname, '../preload/workbench.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  try {
    view.setBackgroundColor('#f5f6f7')
  } catch {
    /* ignore */
  }
  if (!failHandlerAttached) {
    failHandlerAttached = true
    view.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (!isMainFrame || !view) return
      if (url.startsWith('data:')) return
      // 尺寸变化/重复 setMode 会取消上一次导航，属正常，勿当成失败页
      if (code === ERR_ABORTED) {
        console.warn('[workbench] navigation aborted (ignored):', url)
        return
      }
      pendingNavKey = null
      console.warn('[workbench] did-fail-load', code, desc, url)
      view.webContents.loadURL(failHtml(resolveWorkbenchBase(), `${desc || 'load failed'} (${code})`))
    })
    view.webContents.on('did-finish-load', () => {
      if (!view) return
      const cur = view.webContents.getURL()
      if (cur.startsWith('data:')) return
      lastOkNavKey = navKey(cur)
      pendingNavKey = null
    })
  }
  return view
}

export function getWorkbenchView(): BrowserView | null {
  return view
}

/**
 * 显示工作台 BrowserView 并按需加载页面
 * @param bounds 内容区坐标
 */
export function showWorkbenchView(bounds?: ViewBounds): { ok: boolean } {
  if (getShellMode() !== 'workbench' || isUserSettingsOverlay()) return { ok: true }
  if (!getMainWindow()) return { ok: false }
  const bv = ensureView()
  if (!attachWorkbench(bv)) return { ok: false }
  applyBounds(bv, bounds)
  void loadWorkbench(bv)
  return { ok: true }
}

async function loadWorkbench(bv: BrowserView): Promise<void> {
  let url = ''
  try {
    url = await workbenchUrl()
  } catch (err) {
    pendingNavKey = null
    const detail = err instanceof Error ? err.message : '本地工作台打开失败'
    console.warn('[workbench] local host failed:', detail)
    if (!bv.webContents.isDestroyed()) {
      void bv.webContents.loadURL(failHtml(resolveWorkbenchBase(), detail))
    }
    return
  }
  if (getShellMode() !== 'workbench' || isUserSettingsOverlay()) return
  if (bv.webContents.isDestroyed()) return
  const key = navKey(url)
  const current = bv.webContents.getURL()
  const onFailPage = current.startsWith('data:text/html')
  const alreadyOk = !onFailPage && lastOkNavKey === key
  const alreadyPending = pendingNavKey === key
  const sameAsCurrent = !onFailPage && navKey(current) === key && current !== '' && current !== 'about:blank'
  if (alreadyOk || alreadyPending || sameAsCurrent) return

  pendingNavKey = key
  void bv.webContents.loadURL(url).catch((err) => {
    console.warn('[workbench] loadURL error:', err)
    pendingNavKey = null
  })
}

export function hideWorkbenchView(): void {
  const win = getMainWindow()
  if (win && view) {
    try {
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      win.removeBrowserView(view)
    } catch {
      /* ignore */
    }
  }
}

export function destroyWorkbenchView(): void {
  hideWorkbenchView()
  if (view) {
    try { view.webContents.close() } catch { /* ignore */ }
    view = null
    failHandlerAttached = false
    pendingNavKey = null
    lastOkNavKey = null
  }
}

export function setWorkbenchBounds(bounds: ViewBounds): void {
  rememberBounds(bounds)
  if (getShellMode() !== 'workbench' || isUserSettingsOverlay() || !view) return
  // 尺寸回调常在 setMode 之后；若视图已被摘掉，只 setBounds 会一直空白
  attachWorkbench(view)
  applyBounds(view, bounds)
}

/**
 * 给工作台地址加刷新参数。时间戳必须在 # 前面，否则会被当成路由路径，主区域空白。
 * @param url 工作台入口，含 hash
 * @returns 带 r 参数、hash 仍在末尾的地址
 */
function withReloadToken(url: string): string {
  const hashAt = url.indexOf('#')
  const hash = hashAt >= 0 ? url.slice(hashAt) : ''
  const before = hashAt >= 0 ? url.slice(0, hashAt) : url
  const joiner = before.includes('?') ? '&' : '?'
  return `${before}${joiner}r=${Date.now()}${hash}`
}

/**
 * 强制重新打开工作台。带时间戳，避免同一地址被当成已打开而什么都不做。
 * @returns 是否已发起加载
 */
export function reloadWorkbenchView(): { ok: boolean } {
  if (isUserSettingsOverlay()) return { ok: false }
  lastOkNavKey = null
  pendingNavKey = null
  if (!getMainWindow()) return { ok: false }
  const bv = view && !view.webContents.isDestroyed() ? view : ensureView()
  if (!attachWorkbench(bv)) return { ok: false }
  applyBounds(bv)
  void (async () => {
    try {
      const url = withReloadToken(await workbenchUrl())
      pendingNavKey = navKey(url)
      await bv.webContents.loadURL(url)
    } catch (err) {
      console.warn('[workbench] reload failed:', err)
      pendingNavKey = null
      if (!bv.webContents.isDestroyed()) {
        const detail = err instanceof Error ? err.message : '刷新失败'
        void bv.webContents.loadURL(failHtml(resolveWorkbenchBase(), detail))
      }
    }
  })()
  return { ok: true }
}

export { WORKBENCH_LABEL }
