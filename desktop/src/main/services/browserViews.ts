import { getWorkbenchView } from './workbenchView'
import { getShellMode } from './appMode'
import { app, BrowserView, BrowserWindow, Menu, shell } from 'electron'
import { createHash } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { deleteFingerprint } from './fingerprint'
import type { Session, WebContents } from 'electron'
import {
  ensureLineExtensionDir,
  getLineEntryUrl,
  isLinePlatform,
  setRuntimeLineExtensionId
} from './lineExtension'
import {
  buildChatLangFabInject,
  buildInjectBootstrap,
  buildLineContactsInject,
  buildWhatsAppContactsInject
} from '../inject/script'
import { loadSettings } from './settings'
import { getAuthScopeKey } from './auth'
import { whatsappChromeUa, whatsappUaSpoofScript } from './whatsappChrome'

export interface ViewBounds {
  x: number
  y: number
  width: number
  height: number
}

/** 测试模式：打开标签时弹出 DevTools（独立窗口） */
function openViewDevToolsIfTestMode(view: BrowserView): void {
  try {
    if (!loadSettings().testModeEnabled) return
    const wc = view.webContents
    if (wc.isDestroyed()) return
    if (!wc.isDevToolsOpened()) {
      wc.openDevTools({ mode: 'detach' })
    }
  } catch (e) {
    console.warn('[omnitranslate] openDevTools failed:', e)
  }
}

export interface CreateViewOptions {
  label: string
  tabId: string
  groupId: string
  url: string
  bounds: ViewBounds
  proxyUrl?: string | null
}

export interface DestroyViewOptions {
  /** 删除标签时清除指纹；重建会话时不要传 */
  purgeFingerprint?: boolean
  tabId?: string
}

interface ViewEntry {
  view: BrowserView
  tabId: string
  label: string
  groupId: string
  url: string
  injectAttached: boolean
}

const views = new Map<string, ViewEntry>()
const loadedLinePartitions = new Set<string>()
/** webContents.id → 注入 runner；WhatsApp 通过 IPC 通知就绪，不依赖 console.log */
const injectRunners = new Map<number, () => void>()
let mainWindow: BrowserWindow | null = null
let activeLabel: string | null = null
let lastBounds: ViewBounds | null = null

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
  if (!win) return

  const reapply = (): void => {
    if (!activeLabel || !lastBounds) return
    const entry = views.get(activeLabel)
    if (!entry) return
    try {
      entry.view.setBounds(normalizeBounds(lastBounds))
    } catch {
      /* ignore */
    }
  }

  win.on('resize', reapply)
  win.on('maximize', reapply)
  win.on('unmaximize', reapply)
}

function normalizeBounds(bounds: ViewBounds): ViewBounds {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height))
  }
}

/**
 * 社媒标签的会话分区。同一账号、同一标签得到同一个短目录。
 * 目录名过长时，Windows 上 CacheStorage 会打不开，WhatsApp 就报数据库错误。
 * @param tabId 标签 id
 * @returns Electron persist partition 名
 */
function partitionFor(tabId: string): string {
  const scope = getAuthScopeKey()
  const id = createHash('sha256')
    .update(`${scope}\n${tabId || 'unknown'}`)
    .digest('hex')
    .slice(0, 16)
  return `persist:t-${id}`
}

function viewPreloadPath(): string {
  return join(__dirname, '../preload/view.js')
}

function lineViewPreloadPath(): string {
  return join(__dirname, '../preload/line-view.js')
}

function lineErrorPage(message: string): string {
  const safe = message.replace(/[<>&]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'
  )
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/><title>LINE</title>
<style>
  body{margin:0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
  min-height:100vh;background:#f7f8fa;color:#333}
  .box{max-width:480px;padding:24px;border:1px solid #e5e7eb;background:#fff}
  h1{font-size:16px;margin:0 0 8px}p{font-size:13px;line-height:1.5;margin:0;color:#666;white-space:pre-wrap}
</style></head><body><div class="box">
  <h1>LINE 扩展加载失败</h1>
  <p>${safe}</p>
</div></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function isUnusablePageUrl(href: string): boolean {
  return (
    !href ||
    href === 'about:blank' ||
    href.startsWith('chrome-error://') ||
    href.startsWith('chrome://') ||
    href.startsWith('data:')
  )
}

function socialFailPage(target: string, detail: string): string {
  const safeUrl = target.replace(/[<>&]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'
  )
  const safeDetail = detail.replace(/[<>&]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'
  )
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/><title>无法打开</title>
<style>
  body{margin:0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
  min-height:100vh;background:#f7f8fa;color:#333}
  .box{max-width:520px;padding:24px;border:1px solid #e5e7eb;background:#fff}
  h1{font-size:16px;margin:0 0 8px}p{font-size:13px;line-height:1.5;margin:0 0 8px;color:#666;word-break:break-all}
  code{font-size:12px;background:#f1f5f9;padding:1px 4px}
</style></head><body><div class="box">
  <h1>无法打开该社媒页面</h1>
  <p>目标地址：<code>${safeUrl || '—'}</code></p>
  <p>${safeDetail}</p>
  <p>可在标签上右键「刷新网页」重试。若本机开了系统代理/VPN，可先关掉后再试。</p>
</div></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

/**
 * 标签配了代理才走该代理；未配置则跟随 Windows 系统代理（v2rayN 等）。
 * 标签级代理优先；无标签代理时固定 mode:system。
 */
async function applyProxy(
  ses: Session,
  proxyUrl: string | null | undefined,
  wc?: WebContents
): Promise<void> {
  if (!proxyUrl?.trim()) {
    await ses.setProxy({ mode: 'system' })
    return
  }
  try {
    const u = new URL(proxyUrl.includes('://') ? proxyUrl : `http://${proxyUrl}`)
    // 海王：proxyRules 仅 host:port，鉴权走 login 事件
    const rules = `${u.protocol}//${u.host}`
    await ses.setProxy({ proxyRules: rules, proxyBypassRules: '<local>' })
    const user = decodeURIComponent(u.username || '')
    const pass = decodeURIComponent(u.password || '')
    if (wc && user) {
      wc.removeAllListeners('login')
      wc.on('login', (event, _request, authInfo, callback) => {
        event.preventDefault()
        if (authInfo.isProxy) {
          callback(user, pass)
        } else {
          callback()
        }
      })
    }
  } catch {
    await ses.setProxy({ proxyRules: proxyUrl, proxyBypassRules: '<local>' })
  }
}

async function applyWhatsAppChromeMask(ses: Session, wc: WebContents): Promise<void> {
  try {
    ses.setUserAgent(whatsappChromeUa())
  } catch {
    /* ignore */
  }
  try {
    wc.setUserAgent(whatsappChromeUa())
  } catch {
    /* ignore */
  }
  wc.on('dom-ready', () => {
    void wc.executeJavaScript(whatsappUaSpoofScript(), true).catch(() => undefined)
  })
}

/** 内置 Chrome 升级后，旧 IndexedDB 会让 WhatsApp 报数据库错误，本进程内每个标签清一次。 */
let whatsAppEngineMigrated = false

/**
 * 判断这次启动是否刚换过内置 Chrome。
 * @returns 需要清掉旧的 WhatsApp 本地库时为 true
 */
function whatsAppEngineChanged(): boolean {
  if (whatsAppEngineMigrated) return true
  const chrome = process.versions.chrome || ''
  const marker = join(app.getPath('userData'), 'whatsapp-storage-v3.txt')
  let previous = ''
  try {
    previous = readFileSync(marker, 'utf8').trim()
  } catch {
    previous = ''
  }
  if (previous === chrome) return false
  whatsAppEngineMigrated = true
  try {
    writeFileSync(marker, chrome)
  } catch {
    /* ignore */
  }
  return true
}

/**
 * 只在内置浏览器版本变化时，把 Service Worker 和本地库一起清掉。
 * 只清 Worker、留下数据库，会让 WhatsApp 一直报数据库错误。
 * @param ses 当前标签的会话
 * @returns 清理完成
 */
async function clearWhatsAppServiceWorkers(ses: Session): Promise<void> {
  if (!whatsAppEngineChanged()) return
  try {
    await ses.clearStorageData({
      storages: ['serviceworkers', 'cachestorage', 'indexdb', 'localstorage']
    })
  } catch {
    /* ignore */
  }
}

async function ensureLineLoaded(ses: Electron.Session, partition: string): Promise<string> {
  const findLoadedId = (): string | null => {
    try {
      const found = ses.getAllExtensions().find((e) => {
        const p = e.path.replace(/\\/g, '/')
        return (
          p.includes('/line-extensions/') ||
          p.includes('/extensions/ophjlpahpchlmihnnnihgmmeilfjmjjc/')
        )
      })
      return found?.id?.trim() || null
    } catch {
      return null
    }
  }

  let extId = findLoadedId()
  if (!extId || !loadedLinePartitions.has(partition)) {
    const extDir = await ensureLineExtensionDir()
    // 清掉本会话里旧的 LINE 扩展，避免 ID/路径错乱
    try {
      for (const e of ses.getAllExtensions()) {
        if (e.path.replace(/\\/g, '/').includes('/line-extensions/')) {
          ses.removeExtension(e.id)
        }
      }
    } catch {
      /* ignore */
    }
    // 对齐海王：loadExtension(path) 即可，勿 allowFileAccess / 强启 SW
    const ext = await ses.loadExtension(extDir)
    extId = ext.id
    setRuntimeLineExtensionId(ext.id)
    loadedLinePartitions.add(partition)
    console.log(`[omnitranslate] LINE loadExtension id=${ext.id}`)
  } else {
    setRuntimeLineExtensionId(extId)
    loadedLinePartitions.add(partition)
  }

  if (!extId) {
    throw new Error('LINE 扩展 loadExtension 未返回 ID')
  }
  // 对齐海王：chrome-extension://{id}/index.html（无 #popout）
  const url = getLineEntryUrl(extId)
  console.log(`[omnitranslate] LINE navigate → ${url}`)
  return url
}

function attachInject(entry: ViewEntry): void {
  if (entry.injectAttached) return
  entry.injectAttached = true
  const wc = entry.view.webContents
  let injecting = false
  let injectDone = false

  wc.on('console-message', (_e, level, message, line, sourceId) => {
    const gid = entry.groupId.trim()
    if (gid === 'whatsapp') {
      // 页面内观察者通知主界面就绪后再注入（避免登录页主进程轮询 executeJavaScript）
      if (typeof message === 'string' && message.includes('__OMNI_WA_READY__')) {
        if (!injectDone) {
          console.log(`[omnitranslate] WhatsApp ready, injecting (${entry.label})`)
          run()
        }
        return
      }
      if (level >= 2) console.warn(`[wa-page] ${message} (${sourceId}:${line})`)
      return
    }
    if (gid === 'telegram' || gid === 'telegram_w') {
      if (typeof message === 'string' && message.includes('__OMNI_TG_READY__')) {
        if (!injectDone) {
          console.log(`[omnitranslate] Telegram ready, injecting (${entry.label})`)
          run()
        }
        return
      }
      return
    }
    if (gid === 'zalo') {
      if (typeof message === 'string' && message.includes('__OMNI_ZALO_READY__')) {
        if (!injectDone) {
          console.log(`[omnitranslate] Zalo ready, injecting (${entry.label})`)
          run()
        }
        return
      }
      return
    }
    if (gid !== 'line') return
    // 0=debug 1=info 2=warning 3=error；ltsm 诊断也放行
    if (level < 2 && !/omnitranslate|ltsm/i.test(message)) return
    console.warn(`[line-page] ${message} (${sourceId}:${line})`)
  })

  const run = (): void => {
    if (wc.isDestroyed() || injecting || injectDone) return
    const href = wc.getURL()
    if (isUnusablePageUrl(href)) return
    // about:blank 会在 loadExtension 前触发 did-finish-load，此时还没有运行时 ID
    if (entry.groupId.trim() === 'line' && !href.startsWith('chrome-extension://')) {
      return
    }
    injecting = true
    try {
      let lineHomeUrl: string | undefined
      try {
        lineHomeUrl = getLineEntryUrl()
      } catch {
        // LINE 扩展 ID 只给 LINE 用。参考客户端以 LINE 为主会先 loadExtension；
        // 本产品默认 WhatsApp，若此处直接 return，tab.js 永远不会注入，自动翻译全灭。
        if (entry.groupId.trim() === 'line') {
          injecting = false
          console.warn(`[omnitranslate] inject skipped (${entry.label}): LINE 扩展尚未就绪`)
          return
        }
        console.warn(
          `[omnitranslate] LINE home URL unavailable, injecting tab.js anyway (${entry.label})`
        )
      }
      const code = buildInjectBootstrap(entry.groupId, { lineHomeUrl })
      console.log(`[omnitranslate] injecting tab.js (${entry.label}) group=${entry.groupId}`)
      void wc
        .executeJavaScript(code, true)
        .then(() => {
          injectDone = true
          console.log(`[omnitranslate] inject ok (${entry.label})`)
          if (entry.groupId.trim() === 'whatsapp') {
            void wc
              .executeJavaScript(
                `window.__OMNI_WA_INJECTED__=true;true`,
                true
              )
              .catch(() => undefined)
          }
          void installChatLangFab(entry.label)
        })
        .catch((e) => {
          // 页面跳转/销毁时常见；tab.js 已用 __OMNITRANSLATE_TAB__ 防重复
          const msg = e instanceof Error ? e.message : String(e)
          if (!/Script failed to execute|render frame was disposed|WebFrameMain/i.test(msg)) {
            console.warn(`[omnitranslate] inject failed (${entry.label}):`, e)
          }
        })
        .finally(() => {
          injecting = false
        })
      const groupId = entry.groupId.trim()
      if (groupId === 'line') {
        try {
          const lineCode = buildLineContactsInject()
          void wc.executeJavaScript(lineCode, true).catch((e) => {
            const msg = e instanceof Error ? e.message : String(e)
            if (!/Script failed to execute|render frame was disposed|WebFrameMain/i.test(msg)) {
              console.warn(`[omnitranslate] line-contacts inject failed (${entry.label}):`, e)
            }
          })
        } catch (e) {
          console.warn('[omnitranslate] line-contacts bootstrap error:', e)
        }
      } else if (groupId === 'whatsapp') {
        try {
          const waCode = buildWhatsAppContactsInject()
          void wc.executeJavaScript(waCode, true).catch((e) => {
            const msg = e instanceof Error ? e.message : String(e)
            if (!/Script failed to execute|render frame was disposed|WebFrameMain/i.test(msg)) {
              console.warn(`[omnitranslate] whatsapp-contacts inject failed (${entry.label}):`, e)
            }
          })
        } catch (e) {
          console.warn('[omnitranslate] whatsapp-contacts bootstrap error:', e)
        }
      }
    } catch (e) {
      injecting = false
      console.warn('[omnitranslate] inject bootstrap error:', e)
    }
  }

  injectRunners.set(wc.id, run)
  wc.once('destroyed', () => {
    injectRunners.delete(wc.id)
  })

  const diagnoseLine = async (): Promise<void> => {
    if (wc.isDestroyed() || entry.groupId.trim() !== 'line') return
    try {
      const info = (await wc.executeJavaScript(
        `(() => {
          const iframe = document.querySelector('iframe');
          let iframeInfo = null;
          if (iframe) {
            try {
              const doc = iframe.contentDocument;
              const win = iframe.contentWindow;
              iframeInfo = {
                src: iframe.src,
                readyState: doc ? doc.readyState : null,
                title: doc ? doc.title : null,
                rootChildren: doc ? (doc.querySelector('#root')?.childElementCount ?? -1) : -1,
                hasPolyfillLog: !!(win && win.__OMNI_LTSM_LOG__),
                childLog: win && win.__OMNI_LTSM_LOG__ ? win.__OMNI_LTSM_LOG__.slice(-5) : []
              };
            } catch (e) {
              iframeInfo = { src: iframe.src, error: String(e) };
            }
          }
          return {
            href: location.href,
            title: document.title,
            rootChildren: document.querySelector('#root')?.childElementCount ?? -1,
            rootHTML: (document.querySelector('#root')?.innerHTML || '').slice(0, 200),
            stillLoading: !!document.querySelector('.is_loading'),
            hasLineUtils: !!window.lineUtils,
            lineUtilsKeys: window.lineUtils ? Object.keys(window.lineUtils).slice(0, 12) : [],
            iframes: Array.from(document.querySelectorAll('iframe')).map((f) => f.src).slice(0, 5),
            parentLog: window.__OMNI_LTSM_LOG__ ? window.__OMNI_LTSM_LOG__.slice(-8) : [],
            iframeInfo
          };
        })()`,
        true
      )) as Record<string, unknown>
      console.log('[omnitranslate] LINE page diagnose', info)
    } catch (e) {
      console.warn('[omnitranslate] LINE diagnose failed:', e)
    }
  }

  // Electron 22 类型定义未包含 did-frame-finish-load；仅诊断 LTSM 子帧
  ;(wc as Electron.WebContents & {
    on(
      event: 'did-frame-finish-load',
      listener: (
        event: Electron.Event,
        isMainFrame: boolean,
        frameProcessId: number,
        frameRoutingId: number,
        url?: string
      ) => void
    ): Electron.WebContents
  }).on('did-frame-finish-load', (_e, isMainFrame, _pid, _rid, url) => {
    if (entry.groupId.trim() !== 'line') return
    if (!isMainFrame && /ltsmSandbox\.html/i.test(String(url || ''))) {
      console.log('[omnitranslate] LINE LTSM frame loaded', url)
    }
  })

  // LINE：等离开 is_loading（LTSM 就绪）再注入
  // WhatsApp / Telegram：登录页先不注入，进主界面后再注入，避免干扰二维码绘制
  // Zalo：等进入 chat.zalo.me 会话界面再注入
  // 主框架「整页」导航后才重新注入；勿在 did-navigate 无条件清（WA 会频繁触发导致反复注入）
  wc.on('did-start-navigation', (_e, _url, isInPlace, isMainFrame) => {
    if (isMainFrame === false) return
    if (isInPlace) return
    injectDone = false
  })

  wc.on('did-finish-load', () => {
    const groupId = entry.groupId.trim()
    if (groupId === 'line') {
      void (async () => {
        // 导航完成后确保 chrome 桥已挂上（preload 可能早于 chrome-extension URL）
        try {
          await wc.executeJavaScript(
            `typeof window.__omniInjectChromeApis==='function'&&window.__omniInjectChromeApis()`,
            true
          )
        } catch {
          /* ignore */
        }
        await diagnoseLine()
        const deadline = Date.now() + 45_000
        while (!wc.isDestroyed() && Date.now() < deadline) {
          try {
            // 登录页本身也会带 is_loading（LOG_IN_PROGRESSING）；出现 loginPage / 主界面即可注入
            const ready = await wc.executeJavaScript(
              `(() => {
                const root = document.querySelector('#root');
                if (!root || root.childElementCount < 1) return false;
                if (document.querySelector('[class*="loginPage"]')) return true;
                if (document.querySelector('[class*="gnb-module"]')) return true;
                // 纯启动空白转圈（只有 pageLayout + is_loading，无 login）
                const blank = document.querySelector('.is_loading.pageLayout-module__wrap__h-oSt');
                if (blank && !String(blank.className).includes('loginPage')) return false;
                return !document.querySelector('.is_loading.pageLayout-module__wrap__h-oSt');
              })()`,
              true
            )
            if (ready) break
          } catch {
            /* ignore */
          }
          await new Promise((r) => setTimeout(r, 500))
        }
        await diagnoseLine()
        run()
      })()
      return
    }
    if (groupId === 'whatsapp') {
      // 登录页不注入；进主界面后持续 ping，导航重置 injectDone 后可再次注入
      if (injectDone) return
      void wc
        .executeJavaScript(
          `(() => {
            const isQr = () =>
              !!(
                document.querySelector('[data-testid="qrcode"]') ||
                document.querySelector('canvas[aria-label*="QR"]') ||
                document.querySelector('div[data-ref] canvas')
              );
            const ready = () => {
              if (isQr()) return false;
              return !!(
                document.querySelector('#pane-side') ||
                document.querySelector('#side') ||
                document.querySelector('#app .two') ||
                document.querySelector('#app .three') ||
                document.querySelector('[data-icon="new-chat-outline"]') ||
                document.querySelector('[data-testid="chat-list"]') ||
                document.querySelector('[data-testid="chatlist"]') ||
                document.querySelector('[aria-label="Chat list"]') ||
                document.querySelector('[aria-label="聊天列表"]') ||
                document.querySelector('#main') ||
                document.querySelector('div[data-tab] [role="grid"]')
              );
            };
            const ping = () => {
              // 已注入成功则停止打扰（避免每 2s IPC 刷屏）
              if (window.__OMNI_WA_INJECTED__) return;
              try {
                if (window.__OMNI_BRIDGE__ && typeof window.__OMNI_BRIDGE__.invoke === 'function') {
                  window.__OMNI_BRIDGE__.invoke('wa_ready');
                }
              } catch (_) {}
              console.log('__OMNI_WA_READY__');
            };
            if (!window.__OMNI_WA_READY_WATCH__) {
              window.__OMNI_WA_READY_WATCH__ = true;
              setInterval(() => {
                if (ready()) ping();
              }, 2000);
            }
            if (ready()) ping();
          })()`,
          true
        )
        .catch(() => {
          /* ignore */
        })
      return
    }
    if (groupId === 'telegram' || groupId === 'telegram_w') {
      // Telegram Web 登录二维码画在 canvas 上；登录页过早注入会干扰绘制
      if (injectDone) return
      void wc
        .executeJavaScript(
          `(() => {
            const isAuth = () =>
              !!(
                document.querySelector('.auth-form') ||
                document.querySelector('.qr-canvas') ||
                document.querySelector('canvas.qr-canvas') ||
                document.querySelector('#auth-qr-form') ||
                document.querySelector('.login-page')
              );
            const ready = () => {
              if (isAuth()) return false;
              return !!(
                document.querySelector('.chat-list') ||
                document.querySelector('#column-left .chats-container') ||
                document.querySelector('.tabs-tab.chats-container') ||
                document.querySelector('.im-page-wrap') ||
                document.querySelector('#page-chats') ||
                document.querySelector('#LeftColumn') ||
                document.querySelector('.messages-layout') ||
                (document.querySelector('#Main') && document.querySelector('.chat-list, .chats-container, #column-left'))
              );
            };
            const ping = () => {
              try {
                if (window.__OMNI_BRIDGE__ && typeof window.__OMNI_BRIDGE__.invoke === 'function') {
                  window.__OMNI_BRIDGE__.invoke('tg_ready');
                }
              } catch (_) {}
              console.log('__OMNI_TG_READY__');
            };
            if (!window.__OMNI_TG_READY_WATCH__) {
              window.__OMNI_TG_READY_WATCH__ = true;
              setInterval(() => {
                if (ready()) ping();
              }, 2000);
            }
            if (ready()) ping();
          })()`,
          true
        )
        .catch(() => {
          /* ignore */
        })
      // 主进程轮询兜底（对齐 Zalo / WA IPC）：console READY 丢失时仍能注入
      void (async () => {
        const deadline = Date.now() + 120_000
        while (!wc.isDestroyed() && !injectDone && Date.now() < deadline) {
          try {
            const ready = await wc.executeJavaScript(
              `(() => {
                const isAuth = () =>
                  !!(
                    document.querySelector('.auth-form') ||
                    document.querySelector('.qr-canvas') ||
                    document.querySelector('canvas.qr-canvas') ||
                    document.querySelector('#auth-qr-form')
                  );
                if (isAuth()) return false;
                return !!(
                  document.querySelector('.chat-list') ||
                  document.querySelector('#column-left .chats-container') ||
                  document.querySelector('#LeftColumn') ||
                  document.querySelector('.messages-layout') ||
                  document.querySelector('.tabs-tab.chats-container')
                );
              })()`,
              true
            )
            if (ready) {
              console.log(`[omnitranslate] Telegram UI ready → inject (${entry.label})`)
              run()
              return
            }
          } catch {
            /* ignore */
          }
          await new Promise((r) => setTimeout(r, 1500))
        }
      })()
      return
    }
    if (groupId === 'zalo') {
      if (injectDone) return
      void wc
        .executeJavaScript(
          `(() => {
            if (window.__OMNI_ZALO_READY_WATCH__) return;
            window.__OMNI_ZALO_READY_WATCH__ = true;
            const ready = () => {
              const href = String(location.href || '');
              if (!/chat\\.zalo\\.me/i.test(href)) return false;
              return !!(
                document.querySelector('#app-page') ||
                document.querySelector('#conversationListId') ||
                document.querySelector('#container > main') ||
                document.querySelector('#richInput') ||
                document.querySelector('.msg-item') ||
                document.querySelector('.chat-message')
              );
            };
            if (ready()) {
              console.log('__OMNI_ZALO_READY__');
              return;
            }
            const t = setInterval(() => {
              if (!ready()) return;
              clearInterval(t);
              console.log('__OMNI_ZALO_READY__');
            }, 1200);
          })()`,
          true
        )
        .catch(() => {
          /* ignore */
        })
      // 主进程轮询兜底：console READY 丢失时仍能注入
      void (async () => {
        const deadline = Date.now() + 120_000
        while (!wc.isDestroyed() && !injectDone && Date.now() < deadline) {
          try {
            const href = wc.getURL()
            if (!/chat\.zalo\.me/i.test(href)) {
              await new Promise((r) => setTimeout(r, 1500))
              continue
            }
            const ready = await wc.executeJavaScript(
              `(() => !!(
                document.querySelector('#app-page') ||
                document.querySelector('#conversationListId') ||
                document.querySelector('#container > main') ||
                document.querySelector('#richInput') ||
                document.querySelector('.msg-item')
              ))()`,
              true
            )
            if (ready) {
              console.log(`[omnitranslate] Zalo UI ready → inject (${entry.label})`)
              run()
              return
            }
          } catch {
            /* ignore */
          }
          await new Promise((r) => setTimeout(r, 1500))
        }
      })()
      return
    }
    run()
  })
}

function attachContextMenu(view: BrowserView): void {
  view.webContents.on('context-menu', () => {
    if (view.webContents.isDestroyed()) return
    const menu = Menu.buildFromTemplate([
      {
        label: '刷新网页',
        accelerator: 'CmdOrCtrl+R',
        click: () => {
          if (view.webContents.isDestroyed()) return
          const entry = [...views.values()].find((e) => e.view === view)
          const target = entry?.url?.trim()
          if (target && !target.startsWith('data:')) {
            void view.webContents.loadURL(target).catch(() => undefined)
            return
          }
          view.webContents.reload()
        }
      }
    ])
    menu.popup({ window: mainWindow ?? undefined })
  })
}

function attachNavigationHandlers(view: BrowserView, groupId?: string): void {
  const isWhatsApp = (groupId || '').trim() === 'whatsapp'
  // LINE / Google 登录依赖 window.open；WhatsApp 对齐海王：外链外开并 deny，避免弹出窗口风暴
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isWhatsApp) {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        void shell.openExternal(url)
      }
      return { action: 'deny' }
    }
    if (
      url.startsWith('http://') ||
      url.startsWith('https://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('about:')
    ) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: {
            session: view.webContents.session,
            sandbox: false,
            // Electron 22：扩展页关闭 contextIsolation 会触发 renderer.bundle.js 崩溃
            // lineUtils 由扩展内 omni-chrome-polyfill.js 注入（对齐海王 preload 效果）
            contextIsolation: true,
            nodeIntegration: false,
            preload: viewPreloadPath()
          }
        }
      }
    }
    return { action: 'deny' }
  })

  view.webContents.on('will-navigate', (event, url) => {
    if (
      url.startsWith('http://') ||
      url.startsWith('https://') ||
      url.startsWith('data:') ||
      url.startsWith('about:') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('chrome-error://') ||
      url.startsWith('chrome://')
    ) {
      return
    }
    event.preventDefault()
    void shell.openExternal(url).catch(() => undefined)
  })

  view.webContents.on('did-fail-load', (_e, code, desc, validatedURL, isMainFrame) => {
    if (!isMainFrame || code === -3) return // -3 = aborted
    console.warn(
      `[omnitranslate] did-fail-load code=${code} desc=${desc} url=${validatedURL}`
    )
    if (view.webContents.isDestroyed()) return
    const current = view.webContents.getURL()
    if (current.startsWith('data:')) return
    const intended =
      [...views.values()].find((e) => e.view === view)?.url || validatedURL || ''
    void view.webContents
      .loadURL(socialFailPage(intended || validatedURL, `${desc} (${code})`))
      .catch(() => undefined)
  })

  attachContextMenu(view)
}

export async function createView(opts: CreateViewOptions): Promise<{ ok: boolean; error?: string }> {
  const { label, tabId, groupId, url, bounds, proxyUrl } = opts
  lastBounds = bounds

  const existing = views.get(label)
  if (existing) {
    existing.view.setBounds(normalizeBounds(bounds))
    return { ok: true }
  }

  try {
    // 对齐海王 createBrowserView：partition + additionalArguments 建窗，再 setProxy / UA / loadURL
    const partition = partitionFor(tabId)
    const isLine = isLinePlatform(groupId)
    const isWhatsApp = groupId.trim() === 'whatsapp'
    // WhatsApp 的本地库在关闭 webSecurity 时打不开。LINE / Twitter 仍保持原设置。
    const webSecurity = isWhatsApp || isLine || groupId === 'twitter'

    const view = new BrowserView({
      webPreferences: {
        partition,
        preload: isLine ? lineViewPreloadPath() : viewPreloadPath(),
        backgroundThrottling: false,
        sandbox: false,
        contextIsolation: false,
        webSecurity
      }
    })
    try {
      view.setBackgroundColor('#ffffff')
    } catch {
      /* ignore */
    }

    const ses = view.webContents.session
    await applyProxy(ses, proxyUrl, view.webContents)
    if (isWhatsApp) {
      await applyWhatsAppChromeMask(ses, view.webContents)
      await clearWhatsAppServiceWorkers(ses)
    }

    const entry: ViewEntry = {
      view,
      tabId,
      label,
      groupId,
      url,
      injectAttached: false
    }
    attachNavigationHandlers(view, groupId)
    attachInject(entry)
    views.set(label, entry)

    // 创建时只设 bounds，不挂到窗口、不等 load 完成——否则加载慢的页会堵住渠道切换。
    // 挂载由 showView 负责；后台加载用 void，切换时可立刻 show 其它已就绪标签。
    const b = normalizeBounds(bounds)
    view.setBounds(b)

    let loadUrl = url
    if (isLine) {
      try {
        loadUrl = await ensureLineLoaded(ses, partition)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        loadUrl = lineErrorPage(msg)
      }
    }
    entry.url = loadUrl
    console.log(`[omnitranslate] load ${groupId} (${label}) → ${loadUrl}`)

    void view.webContents.loadURL(loadUrl).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e)
      if (!/ERR_ABORTED|-3/i.test(msg)) {
        console.warn(`[omnitranslate] loadURL failed (${label}):`, msg)
      }
    })
    openViewDevToolsIfTestMode(view)
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}

export async function recreateView(
  opts: CreateViewOptions & { visible?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  await destroyView(opts.label)
  const result = await createView(opts)
  if (result.ok && opts.visible !== false) {
    showView(opts.label, opts.bounds)
  }
  return result
}

export function showView(label: string, bounds?: ViewBounds): { ok: boolean; error?: string } {
  const entry = views.get(label)
  if (!entry) return { ok: false, error: `view not found: ${label}` }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'main window unavailable' }
  }

  if (bounds) lastBounds = bounds
  // 地图/工作台模式下迟到的 show 不能再把社媒页盖回去
  if (getShellMode() !== 'social') {
    return { ok: true }
  }
  const b = normalizeBounds(bounds ?? lastBounds ?? { x: 0, y: 0, width: 800, height: 600 })

  if (activeLabel && activeLabel !== label) {
    const prev = views.get(activeLabel)
    if (prev) {
      try {
        mainWindow.removeBrowserView(prev.view)
      } catch {
        /* ignore */
      }
    }
  }

  try {
    const attached = mainWindow.getBrowserViews()
    const keepId = entry.view.webContents.isDestroyed() ? -1 : entry.view.webContents.id
    // 只摘掉「别的」视图；已是唯一挂载则不动，避免反复 remove/add 触发页面重载
    for (const bv of [...attached]) {
      try {
        if (!bv.webContents.isDestroyed() && bv.webContents.id === keepId) continue
        mainWindow.removeBrowserView(bv)
      } catch {
        /* ignore */
      }
    }
    if (!mainWindow.getBrowserViews().some((bv) => !bv.webContents.isDestroyed() && bv.webContents.id === keepId)) {
      mainWindow.addBrowserView(entry.view)
    }
    entry.view.setBounds(b)
    activeLabel = label
    openViewDevToolsIfTestMode(entry.view)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function isWorkbenchBrowserView(bv: BrowserView): boolean {
  const wb = getWorkbenchView()
  return Boolean(wb && bv === wb)
}

/** 从主窗口摘掉所有 BrowserView；可选保留某一个（当前激活页） */
function stripAttachedBrowserViews(keep?: Electron.BrowserView): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  for (const bv of [...mainWindow.getBrowserViews()]) {
    if (keep && bv === keep) continue
    if (isWorkbenchBrowserView(bv)) continue
    try {
      mainWindow.removeBrowserView(bv)
    } catch {
      /* ignore */
    }
  }
}

export function hideView(label: string): { ok: boolean } {
  const entry = views.get(label)
  if (!entry || !mainWindow || mainWindow.isDestroyed()) return { ok: true }
  try {
    mainWindow.removeBrowserView(entry.view)
  } catch {
    /* ignore */
  }
  if (activeLabel === label) activeLabel = null
  return { ok: true }
}

export function hideAllViews(): void {
  // 必须清窗口上全部 BrowserView，不能只清 Map——否则会有「无标签仍占着右侧」的游离页
  stripAttachedBrowserViews()
  activeLabel = null
}

/**
 * 只保留 keepLabels 里的视图；销毁 Map 中多余项。
 * 窗口上未知 BrowserView 只摘掉、不 crash（用 webContents.id 识别，避免误杀当前页导致重建死循环）。
 */
export async function reconcileViews(
  keepLabels: string[]
): Promise<{ ok: boolean; destroyed: number }> {
  const keep = new Set(keepLabels.filter(Boolean))
  let destroyed = 0
  for (const label of [...views.keys()]) {
    if (keep.has(label)) continue
    await destroyView(label)
    destroyed += 1
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    const knownIds = new Set(
      [...views.values()]
        .filter((e) => !e.view.webContents.isDestroyed())
        .map((e) => e.view.webContents.id)
    )
    for (const bv of [...mainWindow.getBrowserViews()]) {
      try {
        if (bv.webContents.isDestroyed()) {
          try {
            mainWindow.removeBrowserView(bv)
          } catch {
            /* ignore */
          }
          continue
        }
        if (knownIds.has(bv.webContents.id)) continue
        if (isWorkbenchBrowserView(bv)) continue
        // 游离层：只移出窗口，避免误 destroy 正在用的页
        try {
          mainWindow.removeBrowserView(bv)
        } catch {
          /* ignore */
        }
        destroyed += 1
      } catch {
        /* ignore */
      }
    }
  }
  if (!keep.size) activeLabel = null
  return { ok: true, destroyed }
}

export function setViewBounds(label: string, bounds: ViewBounds): { ok: boolean } {
  lastBounds = bounds
  const entry = views.get(label)
  if (!entry) return { ok: false }
  if (activeLabel === label) {
    entry.view.setBounds(normalizeBounds(bounds))
  }
  return { ok: true }
}

export async function destroyView(
  label: string,
  opts?: DestroyViewOptions
): Promise<{ ok: boolean }> {
  const entry = views.get(label)
  const tabId = opts?.tabId ?? entry?.tabId

  if (entry) {
    hideView(label)
    views.delete(label)
    // 对齐海王：Electron 22 没有 webContents.close()，用 forcefullyCrashRenderer + destroy 彻底销毁，
    // 否则 BrowserView 只是被移出窗口、webContents 仍存活，切换/重建时会残留在右侧区域。
    const wc = entry.view.webContents as Electron.WebContents & {
      forcefullyCrashRenderer?: () => void
      destroy?: () => void
    }
    try {
      if (!wc.isDestroyed()) {
        try {
          wc.forcefullyCrashRenderer?.()
        } catch {
          /* ignore */
        }
        wc.destroy?.()
      }
    } catch {
      /* ignore */
    }
  }

  if (opts?.purgeFingerprint && tabId) {
    deleteFingerprint(tabId)
  }

  return { ok: true }
}

export function reloadView(label: string): { ok: boolean; error?: string } {
  const entry = views.get(label)
  if (!entry) return { ok: false, error: 'view not found' }
  const wc = entry.view.webContents
  if (wc.isDestroyed()) return { ok: false, error: 'view destroyed' }
  const target = entry.url?.trim()
  if (target && !target.startsWith('data:') && isUnusablePageUrl(wc.getURL())) {
    void wc.loadURL(target).catch((e) => {
      console.warn(`[omnitranslate] reload loadURL failed (${label}):`, e)
    })
    return { ok: true }
  }
  wc.reload()
  return { ok: true }
}

export function getViewUrl(label: string): string | null {
  const entry = views.get(label)
  if (!entry || entry.view.webContents.isDestroyed()) return null
  return entry.view.webContents.getURL()
}

export function getLabelByWebContents(wc: Electron.WebContents): string | null {
  for (const entry of views.values()) {
    if (entry.view.webContents === wc || entry.view.webContents.id === wc.id) {
      return entry.label
    }
  }
  return null
}

/** WhatsApp 页面通过 __OMNI_BRIDGE__ 通知主界面就绪，触发 tab.js 注入 */
export function requestInjectByWebContents(wc: Electron.WebContents): boolean {
  const fn = injectRunners.get(wc.id)
  if (!fn) return false
  fn()
  return true
}

export function getViewMetaByWebContents(
  wc: Electron.WebContents
): { label: string; tabId: string; groupId: string } | null {
  for (const entry of views.values()) {
    if (entry.view.webContents === wc || entry.view.webContents.id === wc.id) {
      return { label: entry.label, tabId: entry.tabId, groupId: entry.groupId }
    }
  }
  return null
}

export function getViewMetaByLabel(
  label: string
): { label: string; tabId: string; groupId: string } | null {
  const entry = views.get(label)
  if (!entry) return null
  return { label: entry.label, tabId: entry.tabId, groupId: entry.groupId }
}

export function listViewLabels(): string[] {
  return [...views.keys()]
}

export async function executeJavaScript(label: string, code: string): Promise<unknown> {
  const entry = views.get(label)
  if (!entry || entry.view.webContents.isDestroyed()) {
    throw new Error(`view not found: ${label}`)
  }
  return entry.view.webContents.executeJavaScript(code, true)
}

/**
 * 向指定 BrowserView 注入「发送语言」悬浮按钮（可重复调用）。
 * @param label webview 标签
 */
export async function installChatLangFab(label: string): Promise<void> {
  const entry = views.get(label)
  if (!entry || entry.view.webContents.isDestroyed()) return
  const gid = entry.groupId.trim()
  if (gid === 'whoer' || gid === 'ip-test') return
  try {
    await entry.view.webContents.executeJavaScript(buildChatLangFabInject(), true)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/Script failed to execute|render frame was disposed|WebFrameMain/i.test(msg)) {
      console.warn(`[omnitranslate] chat-lang-fab inject failed (${label}):`, e)
    }
  }
}

/**
 * 给所有已打开的聊天标签挂上语言按钮。
 */
export async function installChatLangFabAll(): Promise<void> {
  await Promise.all(listViewLabels().map((label) => installChatLangFab(label)))
}

export function destroyAllViews(): void {
  const labels = [...views.keys()]
  for (const label of labels) {
    void destroyView(label)
  }
}
