import { ipcMain } from 'electron'
import * as browserViews from '../services/browserViews'
import type { ViewBounds } from '../services/browserViews'

export function registerViewIpc(): void {
  ipcMain.handle(
    'view:create',
    async (
      _event,
      payload: {
        label: string
        tabId: string
        groupId: string
        url: string
        bounds: ViewBounds
        proxyUrl?: string | null
      }
    ) => {
      return browserViews.createView(payload)
    }
  )

  ipcMain.handle(
    'view:recreate',
    async (
      _event,
      payload: {
        label: string
        tabId: string
        groupId: string
        url: string
        bounds: ViewBounds
        proxyUrl?: string | null
        visible?: boolean
      }
    ) => {
      return browserViews.recreateView(payload)
    }
  )

  ipcMain.handle('view:show', (_event, payload: { label: string; bounds?: ViewBounds }) => {
    return browserViews.showView(payload.label, payload.bounds)
  })

  ipcMain.handle('view:hide', (_event, payload: { label: string }) => {
    return browserViews.hideView(payload.label)
  })

  ipcMain.handle('view:hideAll', () => {
    browserViews.hideAllViews()
    return { ok: true }
  })

  ipcMain.handle('view:reconcile', async (_event, payload: { keepLabels?: string[] }) => {
    return browserViews.reconcileViews(payload?.keepLabels ?? [])
  })

  ipcMain.handle('view:setBounds', (_event, payload: { label: string; bounds: ViewBounds }) => {
    return browserViews.setViewBounds(payload.label, payload.bounds)
  })

  ipcMain.handle(
    'view:destroy',
    async (
      _event,
      payload: { label: string; tabId?: string; purgeFingerprint?: boolean }
    ) => {
      return browserViews.destroyView(payload.label, {
        tabId: payload.tabId,
        purgeFingerprint: payload.purgeFingerprint
      })
    }
  )

  ipcMain.handle('view:reload', (_event, payload: { label: string }) => {
    return browserViews.reloadView(payload.label)
  })

  ipcMain.handle('view:getUrl', (_event, payload: { label: string }) => {
    return browserViews.getViewUrl(payload.label)
  })
}
