import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('chatgptGuide', {
  getConfig: (): Promise<{
    backendUrl: string
    loggedIn: boolean
    localBackend: boolean
    writeAllowed: boolean
    bridgePath: string | null
    mcpJson: string
  }> => ipcRenderer.invoke('chatgptGuide:getConfig'),
  checkBridge: (): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('chatgptGuide:checkBridge'),
  openChatgpt: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('chatgptGuide:open')
})
