import { contextBridge, ipcRenderer } from 'electron'

/**
 * BrowserView preload：向页面暴露 OmniTranslate IPC 桥。
 * tab.js 通过 window.__OMNI_BRIDGE__.invoke(action, payload) 调用主进程。
 * 对齐参考聊天客户端：contextIsolation:false 时直接挂 window。
 * WhatsApp UA 由主进程 session / Client Hints 处理，不要在 preload 里 executeJavaScript。
 */
const bridge = {
  invoke: (action: string, payload?: unknown): Promise<unknown> =>
    ipcRenderer.invoke('inject:invoke', { action, payload: payload ?? null })
}

function attachBridge(): void {
  ;(globalThis as unknown as { __OMNI_BRIDGE__: typeof bridge }).__OMNI_BRIDGE__ = bridge
  try {
    ;(window as unknown as { __OMNI_BRIDGE__: typeof bridge }).__OMNI_BRIDGE__ = bridge
  } catch {
    /* ignore */
  }
}

try {
  if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('__OMNI_BRIDGE__', bridge)
  } else {
    attachBridge()
  }
} catch (e) {
  console.error('[omni view preload] expose failed:', e)
  attachBridge()
}
