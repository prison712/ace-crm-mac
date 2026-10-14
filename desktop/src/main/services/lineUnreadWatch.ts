import { BrowserWindow } from 'electron'
import * as browserViews from './browserViews'
import { clearDesktopNotifyState, notifyDesktopNewMessage } from './desktopNotify'
import { isActiveSynced, isTabActive } from './syncState'

/**
 * 对齐 OmniTranslate lineUnreadWatch：主进程轮询 LINE 未读。
 * 未读上升 → blink（推高 totalUnread → setUnreadAttention 闪任务栏）+ 系统通知（toast 内再闪）。
 */
const COUNT_UNREAD_JS = `(() => {
  var total = 0;
  var seen = new Set();
  function consider(el) {
    if (!el || seen.has(el)) return;
    seen.add(el);
    try {
      if (el.offsetParent === null && el.getClientRects().length === 0) return;
    } catch (e) {}
    var cls = String(el.className || '');
    if (/badge_voom|voom|profileImage|icon_badge|editButton|settingPopup|chatroomHeader/i.test(cls)) return;
    var t = String(el.textContent || '').trim();
    if (!t) { total += 1; return; }
    if (!/^\\d{1,4}\\+?$/.test(t)) return;
    var n = parseInt(t.replace(/\\D/g, ''), 10);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  [
    '[class*="friendlistItem-module__badge"]',
    '[class*="gnb-module__badge__"]',
    '[class*="badge-module__badge"]'
  ].forEach(function (sel) {
    try { document.querySelectorAll(sel).forEach(consider); } catch (e) {}
  });
  var title = document.title || '';
  var m = title.match(/[(\\[【]\\s*(\\d+)\\s*[)\\]】]/);
  var titleCount = m ? (parseInt(m[1], 10) || 0) : 0;
  return Math.max(total, titleCount);
})()`

const lastCountByLabel = new Map<string, number>()
let timer: ReturnType<typeof setInterval> | null = null

/**
 * 把当前角标数量同步到标签和社媒 logo。count 为 0 时清掉数字。
 * @param webviewLabel 标签标识
 * @param count 页面上还在的未读角标合计
 * @param title 页面标题
 * @returns {void}
 */
function emitBlink(webviewLabel: string, count: number, title: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send('message:blink', {
      webviewLabel,
      active: count > 0,
      title,
      count,
      source: 'line_unread'
    })
  }
}

async function pollLineViews(): Promise<void> {
  for (const label of browserViews.listViewLabels()) {
    const meta = browserViews.getViewMetaByLabel(label)
    if (!meta || meta.groupId.trim() !== 'line') continue

    let count = 0
    try {
      const raw = await browserViews.executeJavaScript(label, COUNT_UNREAD_JS)
      count = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0
    } catch {
      continue
    }

    const prev = lastCountByLabel.get(label) ?? 0
    lastCountByLabel.set(label, count)
    const title = 'LINE'
    emitBlink(label, count, title)
    if (count <= 0) {
      clearDesktopNotifyState(label)
      continue
    }

    const viewing = isActiveSynced() && isTabActive(label)
    if (viewing || count <= prev) continue
    notifyDesktopNewMessage(label, true, count, title, 'line_unread')
  }
}

export function startLineUnreadWatcher(): void {
  if (timer) return
  timer = setInterval(() => {
    void pollLineViews()
  }, 2000)
  void pollLineViews()
}

export function stopLineUnreadWatcher(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
