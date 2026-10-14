import { v4 as uuidv4 } from 'uuid'
import {
  defaultEnabledPlatforms,
  defaultPlatformOrder,
  defaultTabTitle,
  getPlatformChatUrl,
  normalizePlatformId,
  normalizePlatformOrder,
  PLATFORMS,
  SOCIAL_PLATFORMS
} from './platforms'
import { EMPTY_PROXY, normalizeProxyConfig, parseLegacyProxyUrl } from './proxy'
import {
  DEFAULT_RECEIVE_TARGET_LANG,
  DEFAULT_SEND_TARGET_LANG,
  DEFAULT_MANUAL_SOURCE_LANG,
  DEFAULT_MANUAL_TARGET_LANG,
  isTargetLanguageCode,
  normalizeManualSourceLanguage,
  normalizeTargetLanguage
} from './languages'
import type {
  AppState,
  BrowserTab,
  ChatLangPref,
  EnabledPlatforms,
  PlatformId,
  SocialPlatformId,
  Theme,
  TranslationProvider,
  UserSettings
} from './types'

const DEFAULT_USER: UserSettings = {
  translationProvider: 'deepseek',
  apiKeys: { chatgpt: '', deepseek: '' },
  enabledPlatforms: defaultEnabledPlatforms(),
  platformOrder: defaultPlatformOrder(),
  platformUrls: {}
}

function migratePlatformUrls(raw: unknown): Partial<Record<SocialPlatformId, string>> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Partial<Record<SocialPlatformId, string>> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = normalizePlatformId(key)
    if (!id || typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) out[id] = trimmed
  }
  return out
}

function migrateEnabledPlatforms(raw: unknown): EnabledPlatforms {
  const defaults = defaultEnabledPlatforms()
  if (!raw || typeof raw !== 'object') return defaults
  const o = raw as Partial<Record<SocialPlatformId, unknown>>
  const next = { ...defaults }
  for (const p of SOCIAL_PLATFORMS) {
    const v = o[p.id]
    if (typeof v === 'boolean') {
      next[p.id] = v
    }
  }
  return next
}

const STORAGE_KEY_BASE = 'omnitranslate-app-state-v2'
const LEGACY_STORAGE_KEY = 'omnitranslate-app-state-v2'

/** 当前软件登录账号隔离键（由 App 在登录后注入） */
let activeStorageScope = 'anonymous'

/**
 * 设置本地状态存储的账号隔离键（软件账号，非社媒账号）。
 * @param scopeKey 来自 auth.scopeKey
 */
export function setStorageScope(scopeKey: string | null | undefined): void {
  const raw = String(scopeKey || 'anonymous').trim() || 'anonymous'
  activeStorageScope = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'anonymous'
}

/**
 * @returns 当前隔离键
 */
export function getStorageScope(): string {
  return activeStorageScope
}

/**
 * 按软件账号分桶的 localStorage key，避免换账号读到别人的标签列表。
 * @returns storage key
 */
function storageKey(): string {
  return `${STORAGE_KEY_BASE}__${activeStorageScope}`
}

function defaultTab(groupId: PlatformId, index: number): BrowserTab {
  const id = uuidv4()
  return {
    id,
    webviewLabel: `tab-${id.replace(/-/g, '')}`,
    groupId,
    title: defaultTabTitle(groupId, index),
    proxyEnabled: false,
    proxy: { ...EMPTY_PROXY },
    sendTargetLang: DEFAULT_SEND_TARGET_LANG,
    receiveTargetLang: DEFAULT_RECEIVE_TARGET_LANG,
    chatLangPrefs: {},
    activeChatId: '',
    activeContactName: '',
    remark: '',
    manualSourceLang: DEFAULT_MANUAL_SOURCE_LANG,
    manualTargetLang: DEFAULT_MANUAL_TARGET_LANG,
    manualTranslatePrompt: '',
    manualTranslatePromptEnabled: false,
    manualPanelDisablesAutoTranslate: true
  }
}

/**
 * 从存档还原按对话语言覆盖。
 * @param raw 存档对象
 * @returns 合法的 chatId -> ChatLangPref 映射
 */
function migrateChatLangPrefs(raw: unknown): Record<string, ChatLangPref> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, ChatLangPref> = {}
  for (const [chatId, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(chatId || '').trim().slice(0, 200)
    if (!id || !value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    const pref: ChatLangPref = {}
    if (typeof v.sendTargetLang === 'string' && isTargetLanguageCode(v.sendTargetLang)) {
      pref.sendTargetLang = v.sendTargetLang
    }
    if (
      typeof v.receiveTargetLang === 'string' &&
      isTargetLanguageCode(v.receiveTargetLang)
    ) {
      pref.receiveTargetLang = v.receiveTargetLang
    }
    if (!pref.sendTargetLang && !pref.receiveTargetLang) continue
    if (typeof v.contactName === 'string' && v.contactName.trim()) {
      pref.contactName = v.contactName.trim().slice(0, 200)
    }
    if (typeof v.updatedAt === 'number' && Number.isFinite(v.updatedAt)) {
      pref.updatedAt = v.updatedAt
    }
    out[id] = pref
  }
  return out
}

export function createDefaultState(): AppState {
  const groupId: PlatformId = 'whatsapp'
  const tab = defaultTab(groupId, 1)
  return {
    theme: 'light',
    tabs: [tab],
    selectedGroupId: groupId,
    activeTabId: tab.id,
    lastActiveByGroup: { [groupId]: tab.id },
    user: defaultUserSettings()
  }
}

/** 从存档还原 lastActiveByGroup，仅保留仍存在的标签 */
function migrateLastActiveByGroup(
  raw: unknown,
  tabs: BrowserTab[]
): Partial<Record<PlatformId, string>> {
  const out: Partial<Record<PlatformId, string>> = {}
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const groupId = normalizePlatformId(key)
      if (!groupId || typeof value !== 'string') continue
      const tab = tabs.find((t) => t.id === value && t.groupId === groupId)
      if (tab) out[groupId] = value
    }
  }
  return out
}

function migrateUser(raw: unknown): UserSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_USER }
  const u = raw as Partial<UserSettings> & { licenseCode?: string }
  const rawProvider = typeof u.translationProvider === 'string' ? u.translationProvider : ''
  // 旧版 gemini 选项迁移为 chatgpt
  const provider: TranslationProvider = rawProvider === 'deepseek' ? 'deepseek' : 'chatgpt'
  const keys = u.apiKeys && typeof u.apiKeys === 'object' ? (u.apiKeys as Record<string, unknown>) : {}
  return {
    translationProvider: provider,
    apiKeys: {
      chatgpt: typeof keys.chatgpt === 'string' ? keys.chatgpt : '',
      deepseek: typeof keys.deepseek === 'string' ? keys.deepseek : ''
    },
    enabledPlatforms: migrateEnabledPlatforms(
      (u as { enabledPlatforms?: unknown }).enabledPlatforms
    ),
    platformOrder: normalizePlatformOrder(
      (u as { platformOrder?: unknown }).platformOrder
    ),
    platformUrls: migratePlatformUrls((u as { platformUrls?: unknown }).platformUrls)
  }
}

function migrateTab(raw: Record<string, unknown>): BrowserTab | null {
  const rawGroupId = raw.groupId
  if (typeof rawGroupId !== 'string') return null
  const groupId = normalizePlatformId(rawGroupId)
  if (!groupId) return null

  const id = typeof raw.id === 'string' ? raw.id : uuidv4()
  const proxyEnabled = Boolean(raw.proxyEnabled)
  const proxy =
    raw.proxy && typeof raw.proxy === 'object'
      ? normalizeProxyConfig(raw.proxy as Partial<BrowserTab['proxy']>)
      : typeof raw.proxyUrl === 'string'
        ? parseLegacyProxyUrl(raw.proxyUrl)
        : { ...EMPTY_PROXY }

  return {
    id,
    webviewLabel:
      typeof raw.webviewLabel === 'string' ? raw.webviewLabel : `tab-${id.replace(/-/g, '')}`,
    groupId,
    title:
      typeof raw.title === 'string' && raw.title.trim()
        ? raw.title
        : defaultTabTitle(groupId, 1),
    proxyEnabled,
    proxy,
    sendTargetLang: normalizeTargetLanguage(raw.sendTargetLang, DEFAULT_SEND_TARGET_LANG),
    receiveTargetLang: normalizeTargetLanguage(raw.receiveTargetLang, DEFAULT_RECEIVE_TARGET_LANG),
    chatLangPrefs: migrateChatLangPrefs(raw.chatLangPrefs),
    activeChatId: typeof raw.activeChatId === 'string' ? raw.activeChatId.slice(0, 200) : '',
    activeContactName:
      typeof raw.activeContactName === 'string' ? raw.activeContactName.slice(0, 200) : '',
    remark: typeof raw.remark === 'string' ? raw.remark : '',
    manualSourceLang: normalizeManualSourceLanguage(
      raw.manualSourceLang,
      DEFAULT_MANUAL_SOURCE_LANG
    ),
    manualTargetLang: normalizeTargetLanguage(
      raw.manualTargetLang ?? raw.sendTargetLang,
      DEFAULT_MANUAL_TARGET_LANG
    ),
    manualTranslatePrompt:
      typeof raw.manualTranslatePrompt === 'string'
        ? raw.manualTranslatePrompt.slice(0, 2000)
        : '',
    manualTranslatePromptEnabled:
      typeof raw.manualTranslatePromptEnabled === 'boolean'
        ? raw.manualTranslatePromptEnabled
        : typeof raw.manualTranslatePrompt === 'string' &&
          raw.manualTranslatePrompt.trim().length > 0,
    manualPanelDisablesAutoTranslate:
      typeof raw.manualPanelDisablesAutoTranslate === 'boolean'
        ? raw.manualPanelDisablesAutoTranslate
        : true
  }
}

export function loadState(): AppState {
  try {
    let raw = localStorage.getItem(storageKey())
    // 升级兼容：旧全局存档仅认领一次到「当前登录账号」桶，避免后续账号继续读到同一份标签
    if (!raw && activeStorageScope !== 'anonymous') {
      const legacyGlobal = localStorage.getItem(LEGACY_STORAGE_KEY)
      if (legacyGlobal) {
        localStorage.setItem(storageKey(), legacyGlobal)
        localStorage.removeItem(LEGACY_STORAGE_KEY)
        raw = legacyGlobal
      }
    }
    if (!raw && activeStorageScope === 'anonymous') {
      raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    }
    if (!raw) {
      const legacy = localStorage.getItem('omnitranslate-app-state')
      if (legacy) return migrateFromLegacy(legacy)
      return createDefaultState()
    }

    const parsed = JSON.parse(raw) as Partial<AppState> & { tabs?: unknown[] }
    const tabs = (parsed.tabs ?? [])
      .map((t) => migrateTab(t as unknown as Record<string, unknown>))
      .filter((t): t is BrowserTab => t !== null)

    // 有存档但用户已清空所有标签：保持为空，不再兜底重建默认 WhatsApp 标签。
    // （首次安装没有存档，走上面的 createDefaultState 分支。）
    if (!tabs.length) {
      const selectedGroupId =
        parsed.selectedGroupId && normalizePlatformId(parsed.selectedGroupId)
          ? normalizePlatformId(parsed.selectedGroupId)!
          : null
      return {
        theme: parsed.theme === 'dark' ? 'dark' : 'light',
        tabs: [],
        selectedGroupId,
        activeTabId: null,
        lastActiveByGroup: {},
        user: migrateUser((parsed as { user?: unknown }).user)
      }
    }

    const selectedGroupId =
      parsed.selectedGroupId && normalizePlatformId(parsed.selectedGroupId)
        ? normalizePlatformId(parsed.selectedGroupId)!
        : tabs[0].groupId

    const activeTabId =
      parsed.activeTabId && tabs.some((t) => t.id === parsed.activeTabId)
        ? parsed.activeTabId
        : (tabs.find((t) => t.groupId === selectedGroupId)?.id ?? tabs[0].id)

    const lastActiveByGroup = migrateLastActiveByGroup(
      (parsed as { lastActiveByGroup?: unknown }).lastActiveByGroup,
      tabs
    )
    if (activeTabId && !lastActiveByGroup[selectedGroupId]) {
      lastActiveByGroup[selectedGroupId] = activeTabId
    }

    return {
      theme: parsed.theme === 'dark' ? 'dark' : 'light',
      tabs,
      selectedGroupId,
      activeTabId,
      lastActiveByGroup,
      user: migrateUser((parsed as { user?: unknown }).user)
    }
  } catch {
    return createDefaultState()
  }
}

function migrateFromLegacy(raw: string): AppState {
  try {
    const parsed = JSON.parse(raw) as {
      theme?: Theme
      tabs?: Record<string, unknown>[]
      selectedGroupId?: string
      activeTabId?: string | null
    }
    const tabs = (parsed.tabs ?? []).map((t) => migrateTab(t)).filter((t): t is BrowserTab => t !== null)

    if (!tabs.length) return createDefaultState()

    const firstPlatform = PLATFORMS[0].id
    const selectedGroupId =
      parsed.selectedGroupId && normalizePlatformId(parsed.selectedGroupId)
        ? normalizePlatformId(parsed.selectedGroupId)!
        : (tabs[0]?.groupId ?? firstPlatform)

    const activeTabId =
      parsed.activeTabId && tabs.some((t) => t.id === parsed.activeTabId)
        ? parsed.activeTabId
        : (tabs.find((t) => t.groupId === selectedGroupId)?.id ?? tabs[0].id)

    return {
      theme: parsed.theme === 'dark' ? 'dark' : 'light',
      tabs,
      selectedGroupId,
      activeTabId,
      lastActiveByGroup: activeTabId ? { [selectedGroupId]: activeTabId } : {},
      user: migrateUser((parsed as { user?: unknown }).user)
    }
  } catch {
    return createDefaultState()
  }
}

export function defaultUserSettings(): UserSettings {
  return {
    ...DEFAULT_USER,
    apiKeys: { chatgpt: '', deepseek: '' },
    enabledPlatforms: defaultEnabledPlatforms(),
    platformOrder: defaultPlatformOrder(),
    platformUrls: {}
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(storageKey(), JSON.stringify(state))
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export function tabChatUrl(
  tab: BrowserTab,
  platformUrls?: Partial<Record<SocialPlatformId, string>>
): string {
  return getPlatformChatUrl(tab.groupId, platformUrls)
}
