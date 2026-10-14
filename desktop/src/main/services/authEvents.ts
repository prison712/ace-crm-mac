import { BrowserWindow } from 'electron'
import { clearAuthState } from './auth'
import { destroyAllViews } from './browserViews'
import { destroyWorkbenchView } from './workbenchView'

/** 清登录并通知所有渲染窗口（避免 upload ↔ ipc 循环依赖） */
export function emitAuthExpired(): void {
  destroyAllViews()
  destroyWorkbenchView()
  clearAuthState()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('auth:expired')
  }
}
