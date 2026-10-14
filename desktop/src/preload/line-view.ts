import { ipcRenderer } from 'electron'

/**
 * LINE BrowserView preload（对齐海王 line-preload 精简版）：
 * - contextIsolation: false，可写页面 window / chrome.*
 * - 注入 chrome.cookies / tabs 等经 IPC 走 session（Electron 原生不全）
 * - window.lineUtils + __OMNI_BRIDGE__
 */

type ChromeLike = Record<string, unknown>

type LineWindow = Window & {
  lineUtils?: {
    setUserInfo: (info: unknown) => void
    fetchAllContactFinish?: (data: unknown) => void
    addContact?: (data: unknown) => void
    ReceiveEvent?: (data: unknown) => void
    [key: string]: unknown
  }
  __OMNI_BRIDGE__?: {
    invoke: (action: string, payload?: unknown) => Promise<unknown>
  }
  chrome?: ChromeLike
}

const w = window as LineWindow & {
  __OMNI_CRX_BRIDGED__?: boolean
  __omniInjectChromeApis?: () => void
  __omniCrxInvoke?: (fn: string, ...args: unknown[]) => Promise<unknown>
}

/**
 * 海王 main.js（gary 补丁）会在 Redux fulfilled 里直接调用这些方法。
 * 若不存在会抛错 → Immer 丢弃 draft → 好友/聊天列表一直转圈。
 * 其余 API（handle / e2ee / getRecentMessagesV2…）由扩展运行时挂到 lineUtils 上。
 */
function ensureLineUtils(): void {
  const u = (w.lineUtils || {}) as NonNullable<LineWindow['lineUtils']>
  if (typeof u.setUserInfo !== 'function') {
    u.setUserInfo = (info: unknown) => {
      try {
        w.localStorage.setItem('userInfo', JSON.stringify(info))
      } catch {
        /* ignore */
      }
    }
  }
  if (typeof u.fetchAllContactFinish !== 'function') {
    u.fetchAllContactFinish = () => undefined
  }
  if (typeof u.addContact !== 'function') {
    u.addContact = () => undefined
  }
  if (typeof u.ReceiveEvent !== 'function') {
    u.ReceiveEvent = () => undefined
  }
  w.lineUtils = u
}

ensureLineUtils()

w.__OMNI_BRIDGE__ = {
  invoke: (action: string, payload?: unknown): Promise<unknown> =>
    ipcRenderer.invoke('inject:invoke', { action, payload: payload ?? null })
}

w.__omniCrxInvoke = (fn: string, ...args: unknown[]): Promise<unknown> =>
  ipcRenderer.invoke('omni-crx-msg', fn, ...args)


function finish(result: unknown, callback?: (...args: unknown[]) => void): unknown {
  if (typeof callback === 'function') {
    try {
      callback(result)
    } catch {
      /* ignore */
    }
    return undefined
  }
  return Promise.resolve(result)
}

function forceFn(obj: Record<string, unknown>, key: string, fn: (...args: unknown[]) => unknown): void {
  try {
    delete obj[key]
  } catch {
    /* ignore */
  }
  try {
    Object.defineProperty(obj, key, {
      value: fn,
      writable: true,
      configurable: true,
      enumerable: true
    })
  } catch {
    try {
      obj[key] = fn
    } catch {
      /* ignore */
    }
  }
}

/** 对齐海王 injectExtensionAPIs：扩展页 chrome.* → 主进程 session */
function injectChromeApis(): void {
  if (!location.href.startsWith('chrome-extension://')) return
  if (w.__OMNI_CRX_BRIDGED__) return
  w.__OMNI_CRX_BRIDGED__ = true

  const chromeObj = (w.chrome || {}) as ChromeLike
  w.chrome = chromeObj

  const invoke = (fn: string, ...args: unknown[]): Promise<unknown> =>
    w.__omniCrxInvoke ? w.__omniCrxInvoke(fn, ...args) : ipcRenderer.invoke('omni-crx-msg', fn, ...args)

  // --- tabs ---
  const tabs = (chromeObj.tabs || {}) as Record<string, unknown>
  chromeObj.tabs = tabs
  forceFn(tabs, 'getZoom', (tabIdOrCb?: unknown, maybeCb?: unknown) => {
    const cb = typeof tabIdOrCb === 'function' ? tabIdOrCb : maybeCb
    return finish(1, cb as ((...a: unknown[]) => void) | undefined)
  })
  forceFn(tabs, 'setZoom', (...args: unknown[]) => {
    const last = args[args.length - 1]
    const cb = typeof last === 'function' ? last : undefined
    return finish(undefined, cb as ((...a: unknown[]) => void) | undefined)
  })
  forceFn(tabs, 'getZoomSettings', (tabIdOrCb?: unknown, maybeCb?: unknown) => {
    const cb = typeof tabIdOrCb === 'function' ? tabIdOrCb : maybeCb
    return finish(
      { mode: 'automatic', scope: 'per-origin', defaultZoomFactor: 1 },
      cb as ((...a: unknown[]) => void) | undefined
    )
  })
  forceFn(tabs, 'reload', (tabIdOrCb?: unknown, maybeCb?: unknown) => {
    const cb = typeof tabIdOrCb === 'function' ? tabIdOrCb : maybeCb
    const p = invoke('tabs.reload')
    if (typeof cb === 'function') {
      void p.then(() => (cb as () => void)()).catch(() => (cb as () => void)())
      return undefined
    }
    return p
  })

  // --- cookies（海王 crx-msg cookies.get → session.cookies）---
  const cookies = (chromeObj.cookies || {}) as Record<string, unknown>
  chromeObj.cookies = cookies

  forceFn(cookies, 'get', (details?: unknown, maybeCb?: unknown) => {
    const cb = typeof details === 'function' ? details : maybeCb
    const detailObj = typeof details === 'function' ? undefined : details
    // 海王返回数组，LINE 侧用 [0]
    const p = invoke('cookies.get', detailObj).then((res) => {
      if (Array.isArray(res)) return res
      return res == null ? [] : [res]
    })
    if (typeof cb === 'function') {
      void p.then((r) => (cb as (v: unknown) => void)(r)).catch(() => (cb as (v: unknown) => void)([]))
      return undefined
    }
    return p
  })

  forceFn(cookies, 'getAll', (details?: unknown, maybeCb?: unknown) => {
    const cb = typeof details === 'function' ? details : maybeCb
    const detailObj = typeof details === 'function' ? {} : details || {}
    const p = invoke('cookies.getAll', detailObj)
    if (typeof cb === 'function') {
      void p.then((r) => (cb as (v: unknown) => void)(r)).catch(() => (cb as (v: unknown) => void)([]))
      return undefined
    }
    return p
  })

  forceFn(cookies, 'set', (details?: unknown, maybeCb?: unknown) => {
    const cb = typeof details === 'function' ? details : maybeCb
    const detailObj = typeof details === 'function' ? undefined : details
    const p = invoke('cookies.set', detailObj)
    if (typeof cb === 'function') {
      void p.then((r) => (cb as (v: unknown) => void)(r)).catch(() => (cb as (v: unknown) => void)(null))
      return undefined
    }
    return p
  })

  forceFn(cookies, 'remove', (details?: unknown, maybeCb?: unknown) => {
    const cb = typeof details === 'function' ? details : maybeCb
    const detailObj = typeof details === 'function' ? undefined : details
    const p = invoke('cookies.remove', detailObj)
    if (typeof cb === 'function') {
      void p.then((r) => (cb as (v: unknown) => void)(r)).catch(() => (cb as (v: unknown) => void)(null))
      return undefined
    }
    return p
  })

  // --- action 空壳 ---
  const action = (chromeObj.action || {}) as Record<string, unknown>
  chromeObj.action = action
  const noopEvent = {
    addListener: (): void => undefined,
    removeListener: (): void => undefined,
    hasListener: (): boolean => false,
    hasListeners: (): boolean => false
  }
  if (action.onClicked == null) action.onClicked = noopEvent
  chromeObj.browserAction = chromeObj.browserAction || action

  console.warn('[omnitranslate] line-view chrome.* bridge ready')
}

try {
  w.__omniInjectChromeApis = injectChromeApis
  const run = (): void => {
    try {
      injectChromeApis()
    } catch (e) {
      console.error('[omnitranslate] line-view chrome bridge failed', e)
    }
  }
  if (location.href.startsWith('chrome-extension://')) {
    run()
  } else {
    window.addEventListener('DOMContentLoaded', run, { once: true })
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(process as any).once?.('loaded', run)
    } catch {
      /* ignore */
    }
  }
} catch (e) {
  console.error('[omnitranslate] line-view init failed', e)
}
