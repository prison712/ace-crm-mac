import { BrowserWindow } from 'electron'
import { clearAuthState } from './auth'
import { destroyAllViews } from './browserViews'
import { destroyMapsViews } from './maps/views'
import { destroyWorkbenchView } from './workbenchView'

/**
 * 清掉桌面端登录，并通知外壳回到登录页。
 * 工作台里的退出也走这里，避免标题栏还留着上一个账号。
 */
export function emitAuthExpired(): void {
  clearAuthState()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('auth:expired')
  }
  destroyAllViews()
  destroyWorkbenchView()
  destroyMapsViews()
}
