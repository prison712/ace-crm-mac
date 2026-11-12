import { contextBridge, ipcRenderer } from 'electron'

const bridge = {
  openSocialChat: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:requestSocialMode'),
  openMaps: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:requestMapsMode'),
  /**
   * 退出整个桌面端登录。外壳标题栏和工作台回到同一个登录页。
   * @returns 主进程是否已清掉登录
   */
  logout: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('auth:logout')
}

try {
  contextBridge.exposeInMainWorld('desktopBridge', bridge)
} catch (e) {
  console.error('[workbench preload] expose failed:', e)
  ;(globalThis as unknown as { desktopBridge: typeof bridge }).desktopBridge = bridge
}
