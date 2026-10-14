import { dialog, ipcMain, BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import { loadAuthState } from '../services/auth'
import { appFetch } from '../services/http'
import { loadSettings } from '../services/settings'
import * as mapsDb from '../services/maps/db'
import { testMapsProxy } from '../services/maps/proxy'
import * as mapsViews from '../services/maps/views'

/**
 * 功能：校验已登录；未登录抛错。
 * @returns void
 */
function requireAuth(): void {
  if (!loadAuthState()?.token) {
    throw new Error('请先登录后再使用地图采集')
  }
}

/**
 * 功能：包装需登录的 IPC handler。
 * @param fn 业务函数
 * @returns 包装后的 handler
 */
function authed<T extends unknown[], R>(
  fn: (...args: T) => R | Promise<R>
): (_event: Electron.IpcMainInvokeEvent, ...args: T) => Promise<R> {
  return async (_event, ...args) => {
    requireAuth()
    return fn(...args)
  }
}

/**
 * 功能：注册地图采集全部 IPC。
 * @returns void
 */
/**
 * 功能：把地图采集的商家写入客户管理。客户名称必填，其余字段可空。
 * @param input 表单字段
 * @returns 新建客户 id
 */
async function createCustomer(input: {
  name?: string
  company?: string
  contactPerson?: string
  email?: string
  phone?: string
  website?: string
  country?: string
  notes?: string
}): Promise<{ id: string }> {
  const name = String(input.name || '').trim()
  if (!name) throw new Error('请填写客户名称')
  const auth = loadAuthState()
  const { backendUrl } = loadSettings()
  if (!auth?.token || !backendUrl) throw new Error('请先登录')
  const resp = await appFetch(`${backendUrl.replace(/\/$/, '')}/api/customers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`
    },
    body: JSON.stringify({
      name,
      company: input.company || '',
      contactPerson: input.contactPerson || '',
      email: input.email || '',
      phone: input.phone || '',
      website: input.website || '',
      country: input.country || '',
      notes: input.notes || '',
      source: '地图采集',
      sourceDetail: '谷歌地图采集',
      stage: 'S0',
      customer_type: 'strategic'
    })
  })
  const data = (await resp.json().catch(() => ({}))) as { id?: string; error?: string }
  if (!resp.ok || !data.id) throw new Error(data.error || `加入客户失败 (HTTP ${resp.status})`)
  return { id: data.id }
}

export function registerMapsIpc(): void {
  ipcMain.handle('maps:getSettings', authed(() => mapsDb.getSettings()))
  ipcMain.handle(
    'maps:saveSettings',
    authed((settings: mapsDb.MapsAppSettings) => {
      mapsDb.saveSettings(settings)
    })
  )
  ipcMain.handle(
    'maps:createTask',
    authed((keywords: string[], locations: string[]) => mapsDb.createTask(keywords, locations))
  )
  ipcMain.handle('maps:listTasks', authed(() => mapsDb.listTasks()))
  ipcMain.handle(
    'maps:getTask',
    authed((id: number) => mapsDb.getTask(id))
  )
  ipcMain.handle(
    'maps:updateTaskStatus',
    authed((id: number, status: string) => {
      mapsDb.updateTaskStatus(id, status)
    })
  )
  ipcMain.handle(
    'maps:saveBusiness',
    authed((business: mapsDb.MapsBusinessInput, dedupMode: string) =>
      mapsDb.saveBusiness(business, dedupMode)
    )
  )
  ipcMain.handle(
    'maps:updateBusinessEmail',
    authed((businessId: number, email: string, dedupMode: string) => {
      mapsDb.updateBusinessEmail(businessId, email, dedupMode)
    })
  )
  ipcMain.handle(
    'maps:listBusinesses',
    authed((taskId: number | null, page: number, pageSize: number) =>
      mapsDb.listBusinesses(taskId, page, pageSize)
    )
  )
  ipcMain.handle(
    'maps:exportBusinesses',
    authed((taskId: number | null) => mapsDb.exportBusinesses(taskId))
  )
  ipcMain.handle(
    'maps:importBusinesses',
    authed((taskId: number, rows: mapsDb.MapsBusinessInput[]) =>
      mapsDb.importBusinesses(taskId, rows)
    )
  )
  ipcMain.handle(
    'maps:clearDedupCache',
    authed((scope?: string | null, taskId?: number | null) =>
      mapsDb.clearDedupCache(scope, taskId)
    )
  )
  ipcMain.handle(
    'maps:addLog',
    authed((level: string, message: string) => mapsDb.addLog(level, message))
  )
  ipcMain.handle(
    'maps:listLogs',
    authed((limit?: number) => mapsDb.listLogs(limit ?? 300))
  )
  ipcMain.handle(
    'maps:clearLogs',
    authed(() => {
      mapsDb.clearLogs()
    })
  )

  ipcMain.handle(
    'maps:openMapsWindow',
    authed((url: string) => mapsViews.openMapsWindow(url))
  )
  ipcMain.handle(
    'maps:ensureMapsChild',
    authed((url: string, x: number, y: number, width: number, height: number) =>
      mapsViews.ensureMapsChild(url, x, y, width, height)
    )
  )
  ipcMain.handle(
    'maps:setMapsVisible',
    authed((visible: boolean) => mapsViews.setMapsVisible(visible))
  )
  ipcMain.handle(
    'maps:setMapsBounds',
    authed((x: number, y: number, width: number, height: number) =>
      mapsViews.setMapsBounds(x, y, width, height)
    )
  )
  ipcMain.handle(
    'maps:evalMapsJs',
    authed((script: string) => mapsViews.evalMapsJs(script))
  )
  ipcMain.handle(
    'maps:openEmailWindow',
    authed((label: string, url: string) => mapsViews.openEmailWindow(label, url))
  )
  ipcMain.handle(
    'maps:evalEmailJs',
    authed((label: string, script: string) => mapsViews.evalEmailJs(label, script))
  )
  ipcMain.handle(
    'maps:closeWebview',
    authed((label: string) => mapsViews.closeWebview(label))
  )
  ipcMain.handle(
    'maps:closeAllEmailWindows',
    authed(() => mapsViews.closeAllEmailWindows())
  )
  ipcMain.handle(
    'maps:createCustomer',
    authed((input: Parameters<typeof createCustomer>[0]) => createCustomer(input))
  )
  ipcMain.handle(
    'maps:clearMapsWebviewCache',
    authed(() => mapsViews.clearMapsWebviewCache())
  )
  ipcMain.handle(
    'maps:openMapsDevtools',
    authed(() => mapsViews.openMapsDevtools())
  )
  ipcMain.handle(
    'maps:testMapsProxy',
    authed((settings: mapsDb.MapsAppSettings) => testMapsProxy(settings))
  )

  ipcMain.handle(
    'maps:pickExportPath',
    authed(async (defaultName: string) => {
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      const result = await dialog.showSaveDialog(win ?? undefined, {
        defaultPath: defaultName || 'maps-export.xlsx',
        filters: [
          { name: 'Excel', extensions: ['xlsx'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      if (result.canceled || !result.filePath) return null
      return result.filePath
    })
  )

  ipcMain.handle(
    'maps:writeExportFile',
    authed(async (path: string, bytes: number[]) => {
      await writeFile(path, Buffer.from(bytes))
    })
  )

  // 注入脚本 → 主进程 → 渲染进程
  ipcMain.on(
    'maps:host-event',
    (_event, data: { event?: string; payload?: unknown }) => {
      const channel = String(data?.event || '')
      if (!channel) return
      mapsViews.forwardMapsHostEvent(channel, data.payload ?? null)
    }
  )
}
