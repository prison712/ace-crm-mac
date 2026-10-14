import { BrowserWindow } from 'electron'
import * as browserViews from './browserViews'
import { clearDesktopNotifyState, notifyDesktopNewMessage } from './desktopNotify'
import { isActiveSynced, isTabActive } from './syncState'

/**
 * Messenger / Facebook 主进程未读轮询（对齐 WhatsApp / LINE / Telegram）。
 * 页内 checkMessengerNewMessage 仍保留；此处保证失焦/最小化时任务栏闪烁可靠，
 * 且只在未读数上升时通知，避免 facebook.com 标题误判导致空闪。
 */
const COUNT_UNREAD_JS = `(() => {
  var total = 0;
  var seen = new Set();
  function addCount(n) {
    if (Number.isFinite(n) && n > 0) total += n;
  }
  function considerLabel(el, label) {
    if (!el || seen.has(el)) return;
    var text = String(label || '').trim();
    if (!text) return;
    if (!/unread|未读|未讀|新消息|new message|未読/i.test(text)) return;
    seen.add(el);
    var m = text.match(/(\\d{1,4})/);
    addCount(m ? parseInt(m[1], 10) || 1 : 1);
  }
  try {
    document.querySelectorAll('[aria-label]').forEach(function (el) {
      considerLabel(el, el.getAttribute('aria-label'));
    });
  } catch (e) {}
  try {
    document.querySelectorAll('[title]').forEach(function (el) {
      considerLabel(el, el.getAttribute('title'));
    });
  } catch (e) {}
  try {
    document.querySelectorAll('[data-testid]').forEach(function (el) {
      if (seen.has(el)) return;
      var tid = String(el.getAttribute('data-testid') || '');
      if (!/unread|badge|notif/i.test(tid)) return;
      var txt = String(el.textContent || '').trim();
      seen.add(el);
      if (/^\\d{1,4}\\+?$/.test(txt)) addCount(parseInt(txt.replace(/\\D/g, ''), 10) || 1);
      else addCount(1);
    });
  } catch (e) {}
  var title = document.title || '';
  var m = title.match(/[(\\[【]\\s*(\\d+)\\s*[)\\]】]/);
  var titleCount = m ? (parseInt(m[1], 10) || 0) : 0;
  return Math.max(total, titleCount);
})()`

const META_GROUPS = new Set(['messenger', 'facebook'])

const lastCountByLabel = new Map<string, number>()
let timer: ReturnType<typeof setInterval> | null = null

/**
 * 把当前角标数量同步到标签和社媒 logo。count 为 0 时清掉数字。
 * @param webviewLabel 标签 webview 标识
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
      source: 'messenger_unread',
    })
  }
}

/**
 * 轮询所有 Messenger / Facebook 视图的未读数，仅在上升时通知
 */
async function pollMessengerViews(): Promise<void> {
  for (const label of browserViews.listViewLabels()) {
    const meta = browserViews.getViewMetaByLabel(label)
    if (!meta || !META_GROUPS.has(meta.groupId.trim())) continue

    let count = 0
    try {
      const raw = await browserViews.executeJavaScript(label, COUNT_UNREAD_JS)
      count = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0
    } catch {
      continue
    }

    const prev = lastCountByLabel.get(label) ?? 0
    lastCountByLabel.set(label, count)
    const title = meta.groupId.trim() === 'facebook' ? 'Facebook' : 'Messenger'
    emitBlink(label, count, title)
    if (count <= 0) {
      clearDesktopNotifyState(label)
      continue
    }

    const viewing = isActiveSynced() && isTabActive(label)
    if (viewing || count <= prev) continue
    notifyDesktopNewMessage(label, true, count, title, 'messenger_unread')
  }
}

/** 启动 Messenger/Facebook 未读轮询 */
export function startMessengerUnreadWatcher(): void {
  if (timer) return
  timer = setInterval(() => {
    void pollMessengerViews()
  }, 2000)
  void pollMessengerViews()
}

/** 停止 Messenger/Facebook 未读轮询 */
export function stopMessengerUnreadWatcher(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
