import { contextBridge, ipcRenderer } from 'electron'

/**
 * 地图 / 邮箱 BrowserView preload：向页面暴露 __MAPS_HOST__.emit。
 * 注入脚本通过 emit 把采集事件回传到主进程。
 */
const host = {
  /**
   * 功能：向主进程发送地图宿主事件。
   * @param event 事件名
   * @param payload 载荷
   * @returns void
   */
  emit: (event: string, payload?: unknown): void => {
    ipcRenderer.send('maps:host-event', { event, payload: payload ?? null })
  }
}

function attachHost(): void {
  ;(globalThis as unknown as { __MAPS_HOST__: typeof host }).__MAPS_HOST__ = host
  try {
    ;(window as unknown as { __MAPS_HOST__: typeof host }).__MAPS_HOST__ = host
  } catch {
    /* ignore */
  }
}

try {
  if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('__MAPS_HOST__', host)
  } else {
    attachHost()
  }
} catch (e) {
  console.error('[maps-host preload] expose failed:', e)
  attachHost()
}
