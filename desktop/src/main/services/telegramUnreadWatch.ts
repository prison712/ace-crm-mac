import { BrowserWindow } from 'electron'
import * as browserViews from './browserViews'
import { clearDesktopNotifyState, notifyDesktopNewMessage } from './desktopNotify'
import { isActiveSynced, isTabActive } from './syncState'

/**
 * 对齐 OmniTranslate 的 LINE 主进程未读轮询模式，补齐 Telegram（Omni 本身缺 TG watcher）。
 * 未读由少→多 → blink（合计上升 → setUnreadAttention 闪任务栏）+ 系统通知。
 */
const COUNT_UNREAD_JS = `(() => {
  var total = 0;
  var seen = new Set();
  function consider(el) {
    if (!el || seen.has(el)) return;
    var cls = String(el.className || '');
    if (/reaction|pollvote|badge-fake|premium|verified|story/i.test(cls) && !/unread/i.test(cls)) return;
    if (/avatar|profile|emoji|mention-icon/i.test(cls) && !/badge|unread/i.test(cls)) return;
    if (/is-badge-empty/i.test(cls)) return;
    seen.add(el);
    var t = String(el.textContent || '').trim();
    if (!t) {
      if (/badge|unread/i.test(cls)) total += 1;
      return;
    }
    if (!/^\\d{1,4}\\+?$/.test(t)) return;
    var n = parseInt(t.replace(/\\D/g, ''), 10);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  var roots = [
    document.querySelector('#column-left'),
    document.querySelector('#chatlist-container'),
    document.querySelector('#folders-container'),
    document.querySelector('#LeftColumn'),
    document.querySelector('.chat-list'),
    document.querySelector('.chats-container'),
    document.body
  ].filter(Boolean);
  var sels = [
    '.dialog-subtitle-badge:not(.is-badge-empty)',
    '.badge.unread:not(.is-badge-empty)',
    '.badge.badge-primary:not(.is-badge-empty)',
    '.Badge:not(.is-badge-empty)',
    'span.badge:not(.is-badge-empty)',
    '.ChatBadge',
    '[class*="unread-badge"]',
    '[class*="UnreadBadge"]'
  ];
  roots.forEach(function (root) {
    for (var i = 0; i < sels.length; i++) {
      try { root.querySelectorAll(sels[i]).forEach(consider); } catch (e) {}
    }
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
      source: 'telegram_unread'
    })
  }
}

function isTelegramGroup(groupId: string): boolean {
  const g = groupId.trim()
  return g === 'telegram' || g === 'telegram_w'
}

async function pollTelegramViews(): Promise<void> {
  for (const label of browserViews.listViewLabels()) {
    const meta = browserViews.getViewMetaByLabel(label)
    if (!meta || !isTelegramGroup(meta.groupId)) continue

    let count = 0
    try {
      const raw = await browserViews.executeJavaScript(label, COUNT_UNREAD_JS)
      count = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0
    } catch {
      continue
    }

    const prev = lastCountByLabel.get(label) ?? 0
    lastCountByLabel.set(label, count)
    const title = 'Telegram'
    emitBlink(label, count, title)
    if (count <= 0) {
      clearDesktopNotifyState(label)
      continue
    }

    const viewing = isActiveSynced() && isTabActive(label)
    if (viewing || count <= prev) continue
    notifyDesktopNewMessage(label, true, count, title, 'telegram_unread')
  }
}

export function startTelegramUnreadWatcher(): void {
  if (timer) return
  timer = setInterval(() => {
    void pollTelegramViews()
  }, 2000)
  void pollTelegramViews()
}

export function stopTelegramUnreadWatcher(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
