import { BrowserWindow } from 'electron'
import * as browserViews from './browserViews'
import { clearDesktopNotifyState, notifyDesktopNewMessage } from './desktopNotify'
import { isActiveSynced, isTabActive } from './syncState'

/**
 * WhatsApp 主进程未读轮询（对齐 LINE / Telegram）。
 * 页面内 checkWhatsAppNewMessage 仍保留；此处保证失焦/最小化时任务栏闪烁可靠。
 */
const COUNT_UNREAD_JS = `(() => {
  var total = 0;
  var seen = new Set();
  function addFromText(text) {
    var n = parseInt(String(text || '').replace(/[^\\d]/g, ''), 10);
    if (Number.isFinite(n) && n > 0) total += n;
    else if (String(text || '').trim()) total += 1;
  }
  var sels = [
    '[data-testid="icon-unread-count"]',
    'span[data-testid="icon-unread-count"]',
    'div[data-testid="icon-unread-count"]',
    '[data-testid*="unread"]',
    '[data-icon="unread-count"]',
    '#pane-side span[aria-label]',
    '#side span[aria-label]'
  ];
  for (var i = 0; i < sels.length; i++) {
    try {
      document.querySelectorAll(sels[i]).forEach(function (el) {
        if (seen.has(el)) return;
        var tid = String(el.getAttribute('data-testid') || '');
        var txt = String(el.textContent || '').trim();
        if (sels[i].indexOf('unread') >= 0 && sels[i].indexOf('icon-unread-count') < 0) {
          if (!/^\\d{1,4}\\+?$/.test(txt) && !/unread/i.test(tid)) return;
        }
        if (sels[i].indexOf('aria-label') >= 0) {
          var al = String(el.getAttribute('aria-label') || '');
          if (!/unread|未读|não lida|no leído|non lu|ungelesen|непрочит/i.test(al)) return;
        }
        seen.add(el);
        addFromText(txt || el.getAttribute('aria-label'));
      });
    } catch (e) {}
  }
  try {
    document.querySelectorAll('[aria-label]').forEach(function (el) {
      var label = String(el.getAttribute('aria-label') || '');
      if (!/unread|未读|não lida|no leído|non lu|ungelesen|непрочит/i.test(label)) return;
      if (seen.has(el)) return;
      seen.add(el);
      var m = label.match(/(\\d+)/);
      if (m) total += parseInt(m[1], 10) || 1;
      else total += 1;
    });
  } catch (e) {}
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
      source: 'whatsapp_unread'
    })
  }
}

async function pollWhatsAppViews(): Promise<void> {
  for (const label of browserViews.listViewLabels()) {
    const meta = browserViews.getViewMetaByLabel(label)
    if (!meta || meta.groupId.trim() !== 'whatsapp') continue

    let count = 0
    try {
      const raw = await browserViews.executeJavaScript(label, COUNT_UNREAD_JS)
      count = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0
    } catch {
      continue
    }

    const prev = lastCountByLabel.get(label) ?? 0
    lastCountByLabel.set(label, count)
    const title = 'WhatsApp'
    emitBlink(label, count, title)
    if (count <= 0) {
      clearDesktopNotifyState(label)
      continue
    }

    const viewing = isActiveSynced() && isTabActive(label)
    if (viewing || count <= prev) continue
    notifyDesktopNewMessage(label, true, count, title, 'whatsapp_unread')
  }
}

export function startWhatsAppUnreadWatcher(): void {
  if (timer) return
  timer = setInterval(() => {
    void pollWhatsAppViews()
  }, 2000)
  void pollWhatsAppViews()
}

export function stopWhatsAppUnreadWatcher(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
