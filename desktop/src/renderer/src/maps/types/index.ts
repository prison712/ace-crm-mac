/** 去重作用域 */
export type DedupMode = 'global' | 'task'

/** 采集任务状态 */
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'waiting_human'
  | 'completed'
  | 'failed'

/** 应用设置 */
export interface AppSettings {
  resultTimeoutSec: number
  emailTimeoutSec: number
  dedupMode: DedupMode
  emailConcurrency: number
  mapsCacheClearMinutes: number
  /** 关闭=不强制代理；开启=使用下方代理 */
  mapsProxyEnabled: boolean
  mapsProxyType: 'http' | 'socks5'
  mapsProxyHost: string
  mapsProxyPort: number
  mapsProxyUsername: string
  mapsProxyPassword: string
  mapsDebugMode: boolean
}

/** 地点选择项（用于 URL 中的 location） */
export interface SelectedLocation {
  country: string
  state?: string
  city?: string
  label: string
}

/** 采集到的商家 */
export interface BusinessRow {
  id: number
  taskId: number
  keyword: string
  location: string
  category: string | null
  name: string
  phone: string | null
  email: string | null
  website: string | null
  mapsUrl: string | null
  createdAt: string
}

/** 日志行 */
export interface LogRow {
  id: number
  level: 'info' | 'warn' | 'error'
  message: string
  createdAt: string
}

/** 任务摘要 */
export interface TaskRow {
  id: number
  keywords: string
  locations: string
  status: TaskStatus
  phoneCount: number
  emailCount: number
  websiteCount: number
  createdAt: string
  updatedAt: string
}

/** 前端注入脚本回报的商家草稿 */
export interface ScrapedBusiness {
  name: string
  category?: string
  phone?: string
  website?: string
  mapsUrl?: string
  placeKey?: string
  matched?: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  resultTimeoutSec: 30,
  emailTimeoutSec: 15,
  dedupMode: 'global',
  emailConcurrency: 10,
  mapsCacheClearMinutes: 30,
  mapsProxyEnabled: false,
  mapsProxyType: 'socks5',
  mapsProxyHost: '',
  mapsProxyPort: 0,
  mapsProxyUsername: '',
  mapsProxyPassword: '',
  mapsDebugMode: false
}
