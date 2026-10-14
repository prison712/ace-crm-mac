import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc'
import { destroyAllViews, setMainWindow } from './services/browserViews'
import { destroyWorkbenchView } from './services/workbenchView'
import { stopWorkbenchHost } from './services/workbenchHost'
import { destroyMapsViews } from './services/maps/views'
import { stopMapsProxy } from './services/maps/proxy'
import { initTranslateCache } from './services/translateCache'
import { tryEnsureLineExtensionDir } from './services/lineExtension'
import { checkAppUpdatesOnStartup, checkForUpdatesNow, getUpdateInfo } from './services/appUpdate'
import { startHeartbeatLoop } from './services/heartbeat'
import { initWindowsNotifySupport } from './services/desktopNotify'
import { startLineUnreadWatcher } from './services/lineUnreadWatch'
import { startTelegramUnreadWatcher } from './services/telegramUnreadWatch'
import { startWhatsAppUnreadWatcher } from './services/whatsappUnreadWatch'
import { startMessengerUnreadWatcher } from './services/messengerUnreadWatch'

// 对齐海王
app.commandLine.appendSwitch('disable-renderer-accessibility')

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    title: 'ACE CRM系统',
    // Windows 打包后快捷方式走 exe 内嵌图标；此处覆盖开发态/任务栏窗口图标
    ...(process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  setMainWindow(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    destroyAllViews()
    destroyWorkbenchView()
    destroyMapsViews()
    void stopMapsProxy()
    setMainWindow(null)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.zhending.acecrm')
  initWindowsNotifySupport()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('ping', () => 'pong')
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:getUpdateInfo', () => getUpdateInfo())
  ipcMain.handle('app:checkForUpdates', () => checkForUpdatesNow())
  registerIpcHandlers()
  initTranslateCache()

  void tryEnsureLineExtensionDir()
  void checkAppUpdatesOnStartup()
  startHeartbeatLoop()
  startLineUnreadWatcher()
  startTelegramUnreadWatcher()
  startWhatsAppUnreadWatcher()
  startMessengerUnreadWatcher()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopWorkbenchHost()
})
