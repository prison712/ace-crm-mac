import { BrowserWindow, screen, type IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

/** 客服卡片图 803×1024，窗口按这个比例显示 */
const CARD_WIDTH = 260
const CARD_HEIGHT = Math.round((CARD_WIDTH * 1024) / 803)

/** 耳机按钮在主窗口内容区里的位置，单位是 CSS 像素 */
export interface SupportAnchor {
  x: number
  y: number
  width: number
  height: number
}

interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

let card: BrowserWindow | null = null
let host: BrowserWindow | null = null
let anchor: SupportAnchor | null = null
let outsideSince = 0
let watchTimer: ReturnType<typeof setInterval> | null = null
let waitingForLoad = false

/**
 * 找到客服卡片页。打包后在 out/renderer，开发时直接读 public。
 * @returns html 文件绝对路径
 */
function cardHtmlPath(): string {
  const built = join(__dirname, '../renderer/support-card.html')
  if (existsSync(built)) return built
  return join(process.cwd(), 'src/renderer/public/support-card.html')
}

/**
 * 判断光标是否落在矩形内，pad 用来盖住按钮和卡片之间的缝。
 * @param px 光标横坐标
 * @param py 光标纵坐标
 * @param rect 屏幕矩形
 * @param pad 四周外扩像素
 * @returns 是否在范围内
 */
function hit(px: number, py: number, rect: ScreenRect, pad = 0): boolean {
  return (
    px >= rect.x - pad &&
    px <= rect.x + rect.width + pad &&
    py >= rect.y - pad &&
    py <= rect.y + rect.height + pad
  )
}

/**
 * 把卡片贴到耳机按钮右侧，底部与按钮对齐，并限制在当前屏幕工作区内。
 * @returns 按钮和卡片的屏幕矩形；窗口不在时返回 null
 */
function placeCard(): { button: ScreenRect; card: ScreenRect } | null {
  if (!card || card.isDestroyed() || !host || host.isDestroyed() || !anchor) return null
  const content = host.getContentBounds()
  const button: ScreenRect = {
    x: content.x + anchor.x,
    y: content.y + anchor.y,
    width: anchor.width,
    height: anchor.height
  }
  const area = screen.getDisplayNearestPoint({ x: button.x, y: button.y }).workArea
  let x = Math.round(button.x + button.width + 4)
  let y = Math.round(button.y + button.height - CARD_HEIGHT)
  if (y < area.y) y = area.y
  if (y + CARD_HEIGHT > area.y + area.height) y = area.y + area.height - CARD_HEIGHT
  if (x + CARD_WIDTH > area.x + area.width) x = Math.round(button.x - CARD_WIDTH - 4)
  const next = { x, y, width: CARD_WIDTH, height: CARD_HEIGHT }
  const current = card.getBounds()
  if (
    current.x !== next.x ||
    current.y !== next.y ||
    current.width !== next.width ||
    current.height !== next.height
  ) {
    card.setBounds(next)
  }
  return { button, card: next }
}

/**
 * 光标离开按钮和卡片后收起。卡片是独立窗口，才能盖住工作台那层原生页面。
 * @returns void
 */
function watchCursor(): void {
  if (!card || card.isDestroyed() || !host || host.isDestroyed() || host.isMinimized()) {
    hideSupportCard()
    return
  }
  const placed = placeCard()
  if (!placed) return
  const point = screen.getCursorScreenPoint()
  const over = hit(point.x, point.y, placed.button, 10) || hit(point.x, point.y, placed.card, 8)
  if (over) {
    outsideSince = 0
    return
  }
  if (!outsideSince) outsideSince = Date.now()
  if (Date.now() - outsideSince > 220) hideSupportCard()
}

/**
 * 在耳机按钮旁显示客服二维码。
 * @param event 来自主窗口的 IPC
 * @param next 按钮在内容区中的位置
 * @returns 是否已显示
 */
export function showSupportCard(
  event: IpcMainInvokeEvent,
  next: SupportAnchor
): { ok: boolean } {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return { ok: false }
  if (![next?.x, next?.y, next?.width, next?.height].every((n) => Number.isFinite(n))) {
    return { ok: false }
  }
  host = win
  anchor = {
    x: next.x,
    y: next.y,
    width: next.width,
    height: next.height
  }
  outsideSince = 0

  if (!card || card.isDestroyed()) {
    card = new BrowserWindow({
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      parent: win,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      show: false,
      backgroundColor: '#ffffff',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    card.setMenuBarVisibility(false)
    card.setAlwaysOnTop(true, 'pop-up-menu')
    card.on('closed', () => {
      card = null
    })
    win.once('closed', () => hideSupportCard())
    void card.loadFile(cardHtmlPath())
  }

  placeCard()
  const popup = card
  const reveal = (): void => {
    waitingForLoad = false
    if (!popup || popup.isDestroyed() || !anchor) return
    placeCard()
    popup.showInactive()
  }
  if (popup.webContents.isLoading()) {
    if (!waitingForLoad) {
      waitingForLoad = true
      popup.webContents.once('did-finish-load', reveal)
    }
  } else {
    reveal()
  }

  if (!watchTimer) watchTimer = setInterval(watchCursor, 80)
  return { ok: true }
}

/**
 * 关掉客服二维码窗口并停止跟踪光标。
 * @returns 是否已处理
 */
export function hideSupportCard(): { ok: boolean } {
  outsideSince = 0
  anchor = null
  if (watchTimer) {
    clearInterval(watchTimer)
    watchTimer = null
  }
  if (card && !card.isDestroyed()) {
    card.hide()
  }
  return { ok: true }
}
