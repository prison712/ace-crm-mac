import { ElectronAPI } from '@electron-toolkit/preload'

export interface AppSettings {
  backendUrl: string
  fingerprintEnabled: false
  testModeEnabled: boolean
}

export interface AuthPublicState {
  authenticated: boolean
  inviteCode: string | null
  inviteCodeId: number | null
  token: string | null
  backendUrl: string
  userId?: string | null
  username?: string | null
  displayName?: string | null
  /** 软件账号隔离键（社媒缓存 / 本地状态） */
  scopeKey?: string | null
}

export interface LoginResult {
  ok: boolean
  error?: string
  data?: {
    token: string
    userId?: string
    username?: string
    displayName?: string
    accountType: string
    scopeKey?: string
  }
}

export interface OmniApi {
  ping: () => Promise<string>
  getAppVersion: () => Promise<string>
  getLineExtensionVersion: () => Promise<{ version: string | null }>
  getLineExtensionInfo: () => Promise<{
    version: string | null
    extensionId: string | null
    entryUrl: string | null
  }>
  getUpdateInfo: () => Promise<{
    packaged: boolean
    packageVersion: string
    feedUrl?: string
    lastStatus?: string
    lastRemoteVersion?: string | null
    lastDetail?: string
    lastPercent?: number | null
    hotSyncedVersion: string | null
    hotSyncedSha256: string | null
    localAsarSha256: string | null
    pendingHot: boolean
    lastCheck: {
      at: string
      action: string
      remoteVersion?: string
      remoteSha256?: string
      detail?: string
    } | null
  }>
  checkForUpdates: () => Promise<{
    packaged: boolean
    packageVersion: string
    feedUrl?: string
    lastStatus?: string
    lastDetail?: string
    lastCheck: {
      at: string
      action: string
      remoteVersion?: string
      detail?: string
    } | null
  }>
  /** 下载进度变化时立刻通知，用来刷新「正在更新 xx%」 */
  onUpdateProgress: (
    callback: (info: {
      packageVersion: string
      lastStatus?: string
      lastRemoteVersion?: string | null
      lastPercent?: number | null
      lastCheck: { action: string; remoteVersion?: string } | null
    }) => void
  ) => () => void
  authGetState: () => Promise<AuthPublicState>
  authLogin: (payload: {
    username?: string
    password?: string
    inviteCode?: string
    backendUrl?: string
  }) => Promise<LoginResult>
  setAppMode: (payload: {
    mode: 'workbench' | 'social' | 'maps'
    bounds?: { x: number; y: number; width: number; height: number }
  }) => Promise<{ ok: boolean }>
  /** 用户设置打开时拿开工作台和地图，避免原生页面盖住设置 */
  setUserSettingsOverlay: (open: boolean) => Promise<{ ok: boolean }>
  /** 在耳机按钮旁弹出客服二维码，坐标相对于窗口内容区 */
  showSupportCard: (anchor: {
    x: number
    y: number
    width: number
    height: number
  }) => Promise<{ ok: boolean }>
  /** 打开 ChatGPT MCP 对接引导窗 */
  showChatgptGuide: () => Promise<{ ok: boolean }>
  setWorkbenchBounds: (bounds: {
    x: number
    y: number
    width: number
    height: number
  }) => Promise<{ ok: boolean }>
  reloadWorkbench: () => Promise<{ ok: boolean }>
  authLogout: () => Promise<{ ok: boolean }>
  settingsGet: () => Promise<AppSettings>
  settingsSet: (partial: Partial<AppSettings>) => Promise<AppSettings>
  onAuthExpired: (callback: () => void) => () => void
  onAppModeChanged: (callback: (mode: 'workbench' | 'social' | 'maps') => void) => () => void
  onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<boolean>
  windowClose: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>
  viewCreate: (payload: {
    label: string
    tabId: string
    groupId: string
    url: string
    bounds: { x: number; y: number; width: number; height: number }
    proxyUrl?: string | null
  }) => Promise<{ ok: boolean; error?: string }>
  viewRecreate: (payload: {
    label: string
    tabId: string
    groupId: string
    url: string
    bounds: { x: number; y: number; width: number; height: number }
    proxyUrl?: string | null
    visible?: boolean
  }) => Promise<{ ok: boolean; error?: string }>
  viewShow: (payload: {
    label: string
    bounds?: { x: number; y: number; width: number; height: number }
  }) => Promise<{ ok: boolean; error?: string }>
  viewHide: (payload: { label: string }) => Promise<{ ok: boolean }>
  viewHideAll: () => Promise<{ ok: boolean }>
  viewReconcile: (payload: { keepLabels: string[] }) => Promise<{ ok: boolean; destroyed: number }>
  viewSetBounds: (payload: {
    label: string
    bounds: { x: number; y: number; width: number; height: number }
  }) => Promise<{ ok: boolean }>
  viewDestroy: (payload: {
    label: string
    tabId?: string
    purgeFingerprint?: boolean
  }) => Promise<{ ok: boolean }>
  viewReload: (payload: { label: string }) => Promise<{ ok: boolean; error?: string }>
  viewGetUrl: (payload: { label: string }) => Promise<string | null>
  syncAppSettings: (payload: {
    translationProvider: string
    apiKeys?: { chatgpt?: string; deepseek?: string }
  }) => Promise<unknown>
  syncTabSettings: (payload: {
    tabs: Array<{
      webviewLabel: string
      sendTargetLang: string
      receiveTargetLang: string
      chatLangPrefs?: Record<
        string,
        { sendTargetLang?: string; receiveTargetLang?: string; contactName?: string }
      >
      tabId?: string
      title?: string
      remark?: string
      manualTranslatePrompt?: string
      manualTranslatePromptEnabled?: boolean
      manualPanelDisablesAutoTranslate?: boolean
    }>
  }) => Promise<{ ok: boolean }>
  syncActiveTab: (payload: { webviewLabel: string | null }) => Promise<{ ok: boolean }>
  syncManualPanel: (payload: {
    expanded: boolean
  }) => Promise<{ ok: boolean; expanded: boolean }>
  setUnreadTotal: (payload: { total: number }) => Promise<{ ok: boolean }>
  translateManual: (payload: {
    webviewLabel?: string
    text: string
    sourceLang: string
    targetLang: string
  }) => Promise<
    | { ok: true; data: { translated_text: string; provider: string; from_cache: boolean } }
    | { ok: false; data: { error: string } }
  >
  injectPush: (payload: { label: string; message: unknown }) => Promise<{ ok: boolean }>
  proxyTest: (payload: {
    host: string
    port: number
    username?: string
    password?: string
  }) => Promise<{
    success: boolean
    message: string
    ip?: string
    country?: string
    region?: string
    city?: string
  }>
  onMessageBlink: (
    callback: (payload: {
      webviewLabel: string
      active: boolean
      title?: string
      count?: number
      source?: string
    }) => void
  ) => () => void
  onChatContext: (
    callback: (payload: {
      webviewLabel: string
      chatId: string
      contactName: string
    }) => void
  ) => () => void
  onChatLangPrefs: (
    callback: (payload: {
      webviewLabel: string
      chatId: string
      contactName: string
      chatLangPrefs: Record<
        string,
        { sendTargetLang?: string; receiveTargetLang?: string; contactName?: string }
      >
    }) => void
  ) => () => void
  onMessageOpenTab: (
    callback: (payload: {
      tabId?: string
      groupId?: string
      webviewLabel?: string
    }) => void
  ) => () => void
  clueDevFake: (payload: {
    mode: 'add_friend' | 'friend_message'
    platform: 'line' | 'whatsapp'
    tabId: string
    webviewLabel?: string
    accountUid?: string
    accountName?: string
    friendText?: string
  }) => Promise<{
    ok: boolean
    skipped?: boolean
    reason?: string
    error?: string
    new_unique?: number
    new_duplicate?: number
    new_messaged?: number
    total?: number
    friend?: { uid: string; name: string }
    account?: { uid: string; name: string }
  }>
  /** 谷歌地图商家采集（主进程实现后可用） */
  maps: MapsApi
}

/** 地图采集设置（与 renderer maps/types 对齐） */
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

/** window.api.maps 方法面（不含授权） */
export interface MapsApi {
  getSettings: () => Promise<MapsAppSettings>
  saveSettings: (settings: MapsAppSettings) => Promise<void>
  createTask: (keywords: string[], locations: string[]) => Promise<MapsTaskRow>
  listTasks: () => Promise<MapsTaskRow[]>
  getTask: (id: number) => Promise<MapsTaskRow | null>
  updateTaskStatus: (id: number, status: string) => Promise<void>
  saveBusiness: (
    business: MapsBusinessInput,
    dedupMode: string
  ) => Promise<MapsSaveBusinessResult>
  updateBusinessEmail: (
    businessId: number,
    email: string,
    dedupMode: string
  ) => Promise<void>
  listBusinesses: (
    taskId: number | null,
    page: number,
    pageSize: number
  ) => Promise<[MapsBusinessRow[], number]>
  exportBusinesses: (taskId: number | null) => Promise<MapsBusinessRow[]>
  importBusinesses: (taskId: number, rows: MapsBusinessInput[]) => Promise<number>
  clearDedupCache: (scope?: string | null, taskId?: number | null) => Promise<number>
  addLog: (level: string, message: string) => Promise<MapsLogRow>
  listLogs: (limit?: number) => Promise<MapsLogRow[]>
  clearLogs: () => Promise<void>
  openMapsWindow: (url: string) => Promise<void>
  ensureMapsChild: (
    url: string,
    x: number,
    y: number,
    width: number,
    height: number
  ) => Promise<void>
  setMapsVisible: (visible: boolean) => Promise<void>
  setMapsBounds: (x: number, y: number, width: number, height: number) => Promise<void>
  evalMapsJs: (script: string) => Promise<unknown>
  openEmailWindow: (label: string, url: string) => Promise<void>
  evalEmailJs: (label: string, script: string) => Promise<unknown>
  closeWebview: (label: string) => Promise<void>
  closeAllEmailWindows: () => Promise<number>
  createCustomer: (input: {
    name?: string
    company?: string
    contactPerson?: string
    email?: string
    phone?: string
    website?: string
    country?: string
    notes?: string
  }) => Promise<{ id: string }>
  clearMapsWebviewCache: () => Promise<void>
  pickExportPath: (defaultName: string) => Promise<string | null>
  writeExportFile: (path: string, bytes: number[]) => Promise<void>
  openMapsDevtools: () => Promise<void>
  testMapsProxy: (settings: MapsAppSettings) => Promise<{
    ok: boolean
    message: string
    latencyMs: number
    exitIp: string | null
    country: string | null
    region: string | null
    city: string | null
    timezone: string | null
  }>
  /**
   * 订阅地图采集事件；返回取消订阅函数。
   * @param channel 事件名
   * @param callback 载荷回调
   */
  onEvent: <T = unknown>(channel: string, callback: (payload: T) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: OmniApi
  }
}

export {}
