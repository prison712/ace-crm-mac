import { contextBridge, ipcRenderer } from 'electron'

const bridge = {
  openSocialChat: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:requestSocialMode'),
  openMaps: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:requestMapsMode')
}

try {
  contextBridge.exposeInMainWorld('desktopBridge', bridge)
} catch (e) {
  console.error('[workbench preload] expose failed:', e)
  ;(globalThis as unknown as { desktopBridge: typeof bridge }).desktopBridge = bridge
}
