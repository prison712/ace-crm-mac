import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'

/** 地图采集设置（camelCase，对齐 MapsApi） */
export interface MapsAppSettings {
  resultTimeoutSec: number
  emailTimeoutSec: number
  dedupMode: 'global' | 'task'
  emailConcurrency: number
  mapsCacheClearMinutes: number
  mapsProxyEnabled: boolean
  mapsProxyType: 'http' | 'socks5'
  mapsProxyHost: string
  mapsProxyPort: number
  mapsProxyUsername: string
  mapsProxyPassword: string
  mapsDebugMode: boolean
}

export interface MapsBusinessInput {
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

export interface MapsBusinessRow {
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

export interface MapsLogRow {
  id: number
  level: 'info' | 'warn' | 'error'
  message: string
  createdAt: string
}

export interface MapsTaskRow {
  id: number
  keywords: string
  locations: string
  status: 'pending' | 'running' | 'paused' | 'waiting_human' | 'completed' | 'failed'
  phoneCount: number
  emailCount: number
  websiteCount: number
  createdAt: string
  updatedAt: string
}

export interface MapsSaveBusinessResult {
  saved: boolean
  skippedReason?: string | null
  business?: MapsBusinessRow | null
}

/** 与 renderer maps/types DEFAULT_SETTINGS 一致 */
export const DEFAULT_SETTINGS: MapsAppSettings = {
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

let db: Database.Database | null = null

/**
 * 功能：解析地图采集 SQLite 路径。
 * @returns 绝对路径
 */
function dbPath(): string {
  return join(app.getPath('userData'), 'maps-scrape', 'data.sqlite')
}

/**
 * 功能：打开并初始化数据库（幂等）。
 * @returns better-sqlite3 连接
 */
function getDb(): Database.Database {
  if (db) return db
  const path = dbPath()
  const dir = join(app.getPath('userData'), 'maps-scrape')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keywords TEXT NOT NULL,
      locations TEXT NOT NULL,
      status TEXT NOT NULL,
      phone_count INTEGER NOT NULL DEFAULT 0,
      email_count INTEGER NOT NULL DEFAULT 0,
      website_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS businesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      keyword TEXT NOT NULL,
      location TEXT NOT NULL,
      category TEXT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      website TEXT,
      maps_url TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dedup_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      task_id INTEGER,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(scope, task_id, kind, value)
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)
  // 确保默认设置写入
  const existing = db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as
    | { value: string }
    | undefined
  if (!existing) {
    db.prepare(
      "INSERT INTO settings(key, value) VALUES('app', ?)"
    ).run(JSON.stringify(DEFAULT_SETTINGS))
  }
  return db
}

/**
 * 功能：归一化可选字符串（trim + lower）。
 * @param value 原始值
 * @returns 非空字符串或 null
 */
function normalizeOpt(value?: string | null): string | null {
  if (value == null) return null
  const v = String(value).trim().toLowerCase()
  return v || null
}

/**
 * 功能：当前 UTC RFC3339 时间。
 * @returns ISO 字符串
 */
function nowIso(): string {
  return new Date().toISOString()
}

/**
 * 功能：将任务行映射为 camelCase。
 * @param row 原始行
 * @returns MapsTaskRow
 */
function mapTask(row: Record<string, unknown>): MapsTaskRow {
  return {
    id: Number(row.id),
    keywords: String(row.keywords),
    locations: String(row.locations),
    status: row.status as MapsTaskRow['status'],
    phoneCount: Number(row.phone_count),
    emailCount: Number(row.email_count),
    websiteCount: Number(row.website_count),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

/**
 * 功能：将商家行映射为 camelCase。
 * @param row 原始行
 * @returns MapsBusinessRow
 */
function mapBusiness(row: Record<string, unknown>): MapsBusinessRow {
  return {
    id: Number(row.id),
    taskId: Number(row.task_id),
    keyword: String(row.keyword),
    location: String(row.location),
    category: (row.category as string | null) ?? null,
    name: String(row.name),
    phone: (row.phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    mapsUrl: (row.maps_url as string | null) ?? null,
    createdAt: String(row.created_at)
  }
}

/**
 * 功能：查询去重缓存是否命中。
 * @param scope global|task
 * @param taskId task 作用域下的任务 id
 * @param kind phone|email|website
 * @param value 归一化后的值
 * @returns 是否已存在
 */
function isDeduped(
  scope: string,
  taskId: number | null,
  kind: string,
  value: string
): boolean {
  const conn = getDb()
  if (taskId != null) {
    const row = conn
      .prepare(
        'SELECT id FROM dedup_cache WHERE scope = ? AND task_id = ? AND kind = ? AND value = ?'
      )
      .get(scope, taskId, kind, value)
    return Boolean(row)
  }
  const row = conn
    .prepare(
      'SELECT id FROM dedup_cache WHERE scope = ? AND task_id IS NULL AND kind = ? AND value = ?'
    )
    .get(scope, kind, value)
  return Boolean(row)
}

/**
 * 功能：写入去重缓存（忽略冲突）。
 * @param scope 作用域
 * @param taskId 任务 id 或 null
 * @param kind 类型
 * @param value 值
 * @param createdAt 时间
 */
function insertDedup(
  scope: string,
  taskId: number | null,
  kind: string,
  value: string,
  createdAt: string
): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO dedup_cache(scope, task_id, kind, value, created_at)
       VALUES(?, ?, ?, ?, ?)`
    )
    .run(scope, taskId, kind, value, createdAt)
}

/**
 * 功能：读取应用设置。
 * @returns 设置对象
 */
export function getSettings(): MapsAppSettings {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'app'").get() as
    | { value: string }
    | undefined
  if (!row?.value) return { ...DEFAULT_SETTINGS }
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * 功能：保存应用设置。
 * @param settings 完整设置
 * @returns void
 */
export function saveSettings(settings: MapsAppSettings): void {
  getDb()
    .prepare(
      `INSERT INTO settings(key, value) VALUES('app', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(JSON.stringify(settings))
}

/**
 * 功能：新建采集任务。
 * @param keywords 关键词列表
 * @param locations 地点列表
 * @returns 任务行
 */
export function createTask(keywords: string[], locations: string[]): MapsTaskRow {
  const now = nowIso()
  const conn = getDb()
  const info = conn
    .prepare(
      `INSERT INTO tasks(keywords, locations, status, created_at, updated_at)
       VALUES(?, ?, 'pending', ?, ?)`
    )
    .run(JSON.stringify(keywords), JSON.stringify(locations), now, now)
  const task = getTask(Number(info.lastInsertRowid))
  if (!task) throw new Error('任务创建失败')
  return task
}

/**
 * 功能：按 id 取任务。
 * @param id 任务 id
 * @returns 任务或 null
 */
export function getTask(id: number): MapsTaskRow | null {
  const row = getDb()
    .prepare(
      `SELECT id, keywords, locations, status, phone_count, email_count, website_count, created_at, updated_at
       FROM tasks WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | undefined
  return row ? mapTask(row) : null
}

/**
 * 功能：列出全部任务（新到旧）。
 * @returns 任务数组
 */
export function listTasks(): MapsTaskRow[] {
  const rows = getDb()
    .prepare(
      `SELECT id, keywords, locations, status, phone_count, email_count, website_count, created_at, updated_at
       FROM tasks ORDER BY id DESC`
    )
    .all() as Record<string, unknown>[]
  return rows.map(mapTask)
}

/**
 * 功能：更新任务状态。
 * @param id 任务 id
 * @param status 状态字符串
 * @returns void
 */
export function updateTaskStatus(id: number, status: string): void {
  getDb()
    .prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, nowIso(), id)
}

/**
 * 功能：按 id 取商家。
 * @param id 商家 id
 * @returns 商家或 null
 */
function getBusiness(id: number): MapsBusinessRow | null {
  const row = getDb()
    .prepare(
      `SELECT id, task_id, keyword, location, category, name, phone, email, website, maps_url, created_at
       FROM businesses WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | undefined
  return row ? mapBusiness(row) : null
}

/**
 * 功能：写入商家；命中去重则跳过。
 * @param input 商家草稿
 * @param dedupMode global|task
 * @returns 保存结果
 */
export function saveBusiness(
  input: MapsBusinessInput,
  dedupMode: string
): MapsSaveBusinessResult {
  const scope = dedupMode === 'task' ? 'task' : 'global'
  const taskIdForCache = scope === 'task' ? input.taskId : null

  const phone = normalizeOpt(input.phone)
  if (phone && isDeduped(scope, taskIdForCache, 'phone', phone)) {
    return { saved: false, skippedReason: 'phone', business: null }
  }
  const email = normalizeOpt(input.email)
  if (email && isDeduped(scope, taskIdForCache, 'email', email)) {
    return { saved: false, skippedReason: 'email', business: null }
  }
  const website = normalizeOpt(input.website)
  if (website && isDeduped(scope, taskIdForCache, 'website', website)) {
    return { saved: false, skippedReason: 'website', business: null }
  }

  const now = nowIso()
  const conn = getDb()
  const info = conn
    .prepare(
      `INSERT INTO businesses(task_id, keyword, location, category, name, phone, email, website, maps_url, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      input.taskId,
      input.keyword,
      input.location,
      input.category ?? null,
      input.name,
      input.phone ?? null,
      input.email ?? null,
      input.website ?? null,
      input.mapsUrl ?? null,
      now
    )
  const id = Number(info.lastInsertRowid)

  if (phone) {
    insertDedup(scope, taskIdForCache, 'phone', phone, now)
    conn
      .prepare('UPDATE tasks SET phone_count = phone_count + 1, updated_at = ? WHERE id = ?')
      .run(now, input.taskId)
  }
  if (email) {
    insertDedup(scope, taskIdForCache, 'email', email, now)
    conn
      .prepare('UPDATE tasks SET email_count = email_count + 1, updated_at = ? WHERE id = ?')
      .run(now, input.taskId)
  }
  if (website) {
    insertDedup(scope, taskIdForCache, 'website', website, now)
    conn
      .prepare('UPDATE tasks SET website_count = website_count + 1, updated_at = ? WHERE id = ?')
      .run(now, input.taskId)
  }

  return { saved: true, skippedReason: null, business: getBusiness(id) }
}

/**
 * 功能：更新商家邮箱并写入去重。
 * @param businessId 商家 id
 * @param email 邮箱
 * @param dedupMode global|task
 * @returns void
 */
export function updateBusinessEmail(
  businessId: number,
  email: string,
  dedupMode: string
): void {
  const now = nowIso()
  const conn = getDb()
  const row = conn
    .prepare('SELECT task_id, email FROM businesses WHERE id = ?')
    .get(businessId) as { task_id: number; email: string | null } | undefined
  if (!row) throw new Error('商家不存在')
  conn.prepare('UPDATE businesses SET email = ? WHERE id = ?').run(email, businessId)
  const scope = dedupMode === 'task' ? 'task' : 'global'
  const taskIdForCache = scope === 'task' ? row.task_id : null
  const normalized = normalizeOpt(email)
  if (normalized) {
    insertDedup(scope, taskIdForCache, 'email', normalized, now)
  }
  if (!(row.email || '').trim()) {
    conn
      .prepare('UPDATE tasks SET email_count = email_count + 1, updated_at = ? WHERE id = ?')
      .run(now, row.task_id)
  }
}

/**
 * 功能：分页列出商家。
 * @param taskId 任务过滤；null 表示全部
 * @param page 页码（从 1）
 * @param pageSize 每页条数
 * @returns [行, 总数]
 */
export function listBusinesses(
  taskId: number | null,
  page: number,
  pageSize: number
): [MapsBusinessRow[], number] {
  const conn = getDb()
  const size = Math.max(1, pageSize)
  const offset = (Math.max(1, page) - 1) * size
  if (taskId != null) {
    const total = (
      conn.prepare('SELECT COUNT(*) AS c FROM businesses WHERE task_id = ?').get(taskId) as {
        c: number
      }
    ).c
    const rows = conn
      .prepare(
        `SELECT id, task_id, keyword, location, category, name, phone, email, website, maps_url, created_at
         FROM businesses WHERE task_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`
      )
      .all(taskId, size, offset) as Record<string, unknown>[]
    return [rows.map(mapBusiness), total]
  }
  const total = (conn.prepare('SELECT COUNT(*) AS c FROM businesses').get() as { c: number }).c
  const rows = conn
    .prepare(
      `SELECT id, task_id, keyword, location, category, name, phone, email, website, maps_url, created_at
       FROM businesses ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(size, offset) as Record<string, unknown>[]
  return [rows.map(mapBusiness), total]
}

/**
 * 功能：导出商家（全量，按 id 升序）。
 * @param taskId 任务过滤；null 表示全部
 * @returns 商家数组
 */
export function exportBusinesses(taskId: number | null): MapsBusinessRow[] {
  const conn = getDb()
  if (taskId != null) {
    const rows = conn
      .prepare(
        `SELECT id, task_id, keyword, location, category, name, phone, email, website, maps_url, created_at
         FROM businesses WHERE task_id = ? ORDER BY id ASC`
      )
      .all(taskId) as Record<string, unknown>[]
    return rows.map(mapBusiness)
  }
  const rows = conn
    .prepare(
      `SELECT id, task_id, keyword, location, category, name, phone, email, website, maps_url, created_at
       FROM businesses ORDER BY id ASC`
    )
    .all() as Record<string, unknown>[]
  return rows.map(mapBusiness)
}

/**
 * 功能：批量导入商家（任务内去重）。
 * @param taskId 目标任务
 * @param rows 商家草稿
 * @returns 成功写入条数
 */
export function importBusinesses(taskId: number, rows: MapsBusinessInput[]): number {
  let saved = 0
  for (const row of rows) {
    const result = saveBusiness({ ...row, taskId }, 'task')
    if (result.saved) saved += 1
  }
  return saved
}

/**
 * 功能：清空去重缓存。
 * @param scope 可选 global|task
 * @param taskId task 作用域下的任务 id
 * @returns 删除行数
 */
export function clearDedupCache(scope?: string | null, taskId?: number | null): number {
  const conn = getDb()
  if (scope === 'task' && taskId != null) {
    return conn
      .prepare("DELETE FROM dedup_cache WHERE scope = 'task' AND task_id = ?")
      .run(taskId).changes
  }
  if (scope === 'global') {
    return conn.prepare("DELETE FROM dedup_cache WHERE scope = 'global'").run().changes
  }
  return conn.prepare('DELETE FROM dedup_cache').run().changes
}

/**
 * 功能：追加日志。
 * @param level 级别
 * @param message 内容
 * @returns 日志行
 */
export function addLog(level: string, message: string): MapsLogRow {
  const now = nowIso()
  const info = getDb()
    .prepare('INSERT INTO logs(level, message, created_at) VALUES(?, ?, ?)')
    .run(level, message, now)
  const normalized =
    level === 'warn' || level === 'error' ? level : ('info' as MapsLogRow['level'])
  return {
    id: Number(info.lastInsertRowid),
    level: normalized,
    message,
    createdAt: now
  }
}

/**
 * 功能：列出最近日志。
 * @param limit 条数上限
 * @returns 日志数组
 */
export function listLogs(limit = 300): MapsLogRow[] {
  const rows = getDb()
    .prepare('SELECT id, level, message, created_at FROM logs ORDER BY id DESC LIMIT ?')
    .all(Math.max(1, limit)) as Array<{
    id: number
    level: string
    message: string
    created_at: string
  }>
  return rows.map((r) => ({
    id: r.id,
    level: (r.level === 'warn' || r.level === 'error' ? r.level : 'info') as MapsLogRow['level'],
    message: r.message,
    createdAt: r.created_at
  }))
}

/**
 * 功能：清空全部日志。
 * @returns void
 */
export function clearLogs(): void {
  getDb().prepare('DELETE FROM logs').run()
}
