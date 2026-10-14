import type {
  AppSettings,
  BusinessRow,
  LogRow,
  ScrapedBusiness,
  TaskRow
} from '@/maps/types'

export interface BusinessInput {
  taskId: number
  keyword: string
  location: string
  category?: string | null
  name: string
  phone?: string | null
  email?: string | null
  website?: string | null
  mapsUrl?: string | null
}

export interface SaveBusinessResult {
  saved: boolean
  skippedReason?: string | null
  business?: BusinessRow | null
}

export interface MapsProxyTestResult {
  ok: boolean
  message: string
  latencyMs: number
  exitIp: string | null
  country: string | null
  region: string | null
  city: string | null
  timezone: string | null
}

/**
 * 前端调用 Electron maps API 的薄封装（对应原 Tauri invoke，不含授权）。
 */
export const api = {
  getSettings: (): Promise<AppSettings> => window.api.maps.getSettings(),
  saveSettings: (settings: AppSettings): Promise<void> =>
    window.api.maps.saveSettings(settings),
  createTask: (keywords: string[], locations: string[]): Promise<TaskRow> =>
    window.api.maps.createTask(keywords, locations),
  listTasks: (): Promise<TaskRow[]> => window.api.maps.listTasks(),
  getTask: (id: number): Promise<TaskRow | null> => window.api.maps.getTask(id),
  updateTaskStatus: (id: number, status: string): Promise<void> =>
    window.api.maps.updateTaskStatus(id, status),
  saveBusiness: (business: BusinessInput, dedupMode: string): Promise<SaveBusinessResult> =>
    window.api.maps.saveBusiness(business, dedupMode),
  updateBusinessEmail: (
    businessId: number,
    email: string,
    dedupMode: string
  ): Promise<void> => window.api.maps.updateBusinessEmail(businessId, email, dedupMode),
  listBusinesses: (
    taskId: number | null,
    page: number,
    pageSize: number
  ): Promise<[BusinessRow[], number]> =>
    window.api.maps.listBusinesses(taskId, page, pageSize),
  exportBusinesses: (taskId: number | null): Promise<BusinessRow[]> =>
    window.api.maps.exportBusinesses(taskId),
  importBusinesses: (taskId: number, rows: BusinessInput[]): Promise<number> =>
    window.api.maps.importBusinesses(taskId, rows),
  clearDedupCache: (scope?: string | null, taskId?: number | null): Promise<number> =>
    window.api.maps.clearDedupCache(scope ?? null, taskId ?? null),
  addLog: (level: string, message: string): Promise<LogRow> =>
    window.api.maps.addLog(level, message),
  listLogs: (limit = 300): Promise<LogRow[]> => window.api.maps.listLogs(limit),
  clearLogs: (): Promise<void> => window.api.maps.clearLogs(),
  openMapsWindow: (url: string): Promise<void> => window.api.maps.openMapsWindow(url),
  ensureMapsChild: (
    url: string,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<void> => window.api.maps.ensureMapsChild(url, x, y, width, height),
  setMapsVisible: (visible: boolean): Promise<void> => window.api.maps.setMapsVisible(visible),
  evalMapsJs: (script: string): Promise<unknown> => window.api.maps.evalMapsJs(script),
  openEmailWindow: (label: string, url: string): Promise<void> =>
    window.api.maps.openEmailWindow(label, url),
  evalEmailJs: (label: string, script: string): Promise<unknown> =>
    window.api.maps.evalEmailJs(label, script),
  closeWebview: (label: string): Promise<void> => window.api.maps.closeWebview(label),
  closeAllEmailWindows: (): Promise<number> => window.api.maps.closeAllEmailWindows(),
  createCustomer: (input: {
    name?: string
    company?: string
    contactPerson?: string
    email?: string
    phone?: string
    website?: string
    country?: string
    notes?: string
  }): Promise<{ id: string }> => window.api.maps.createCustomer(input),
  clearMapsWebviewCache: (): Promise<void> => window.api.maps.clearMapsWebviewCache(),
  /**
   * 弹出另存为对话框。
   * @param defaultName 默认文件名
   * @returns 路径或 null（取消）
   */
  pickExportPath: (defaultName: string): Promise<string | null> =>
    window.api.maps.pickExportPath(defaultName),
  /**
   * 写入导出文件字节。
   * @param path 目标路径
   * @param bytes 文件内容
   */
  writeExportFile: (path: string, bytes: number[]): Promise<void> =>
    window.api.maps.writeExportFile(path, bytes),
  /** 打开地图子 WebView 开发者工具 */
  openMapsDevtools: (): Promise<void> => window.api.maps.openMapsDevtools(),
  /**
   * 测试代理：经代理查询出口 IP / 归属地 / 时区。
   * @param settings 当前设置表单
   */
  testMapsProxy: (settings: AppSettings): Promise<MapsProxyTestResult> =>
    window.api.maps.testMapsProxy(settings)
}

export type { ScrapedBusiness }
