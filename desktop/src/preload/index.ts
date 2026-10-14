import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export interface AppSettings {
  backendUrl: string
  fingerprintEnabled: false
  testModeEnabled?: boolean
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

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  getLineExtensionVersion: (): Promise<{ version: string | null }> =>
    ipcRenderer.invoke('lineExt:getVersion'),
  getLineExtensionInfo: (): Promise<{
    version: string | null
    extensionId: string | null
    entryUrl: string | null
  }> => ipcRenderer.invoke('lineExt:getInfo'),
  getUpdateInfo: (): Promise<{
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
  }> => ipcRenderer.invoke('app:getUpdateInfo'),
  checkForUpdates: (): Promise<{
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
  }> => ipcRenderer.invoke('app:checkForUpdates'),
  onUpdateProgress: (
    callback: (info: {
      packageVersion: string
      lastStatus?: string
      lastRemoteVersion?: string | null
      lastPercent?: number | null
      lastCheck: { action: string; remoteVersion?: string } | null
    }) => void
  ): (() => void) => {
    const listener = (_event: IpcRendererEvent, info: Parameters<typeof callback>[0]): void => {
      callback(info)
    }
    ipcRenderer.on('app:updateProgress', listener)
    return () => ipcRenderer.removeListener('app:updateProgress', listener)
  },

  authGetState: (): Promise<AuthPublicState> => ipcRenderer.invoke('auth:getState'),
  authLogin: (payload: {
    username?: string
    password?: string
    inviteCode?: string
    backendUrl?: string
  }): Promise<LoginResult> => ipcRenderer.invoke('auth:login', payload),
  setAppMode: (payload: {
    mode: 'workbench' | 'social' | 'maps'
    bounds?: { x: number; y: number; width: number; height: number }
  }): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:setMode', payload),
  setUserSettingsOverlay: (open: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('app:setUserSettingsOverlay', open),
  setWorkbenchBounds: (bounds: {
    x: number
    y: number
    width: number
    height: number
  }): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:setWorkbenchBounds', bounds),
  reloadWorkbench: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:reloadWorkbench'),
  authLogout: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('auth:logout'),

  settingsGet: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  settingsSet: (partial: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:set', partial),

  onAuthExpired: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('auth:expired', listener)
    return () => ipcRenderer.removeListener('auth:expired', listener)
  },

  onAppModeChanged: (callback: (mode: 'workbench' | 'social' | 'maps') => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, mode: 'workbench' | 'social' | 'maps'): void => {
      if (mode === 'workbench' || mode === 'social' || mode === 'maps') callback(mode)
    }
    ipcRenderer.on('app:modeChanged', listener)
    return () => ipcRenderer.removeListener('app:modeChanged', listener)
  },

  onSettingsChanged: (callback: (settings: AppSettings) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, settings: AppSettings): void => {
      callback(settings)
    }
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  },

  windowMinimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  windowMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:maximize'),
  windowClose: (): Promise<void> => ipcRenderer.invoke('window:close'),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),

  viewCreate: (payload: {
    label: string
    tabId: string
    groupId: string
    url: string
    bounds: { x: number; y: number; width: number; height: number }
    proxyUrl?: string | null
  }): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('view:create', payload),

  viewRecreate: (payload: {
    label: string
    tabId: string
    groupId: string
    url: string
    bounds: { x: number; y: number; width: number; height: number }
    proxyUrl?: string | null
    visible?: boolean
  }): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('view:recreate', payload),

  viewShow: (payload: {
    label: string
    bounds?: { x: number; y: number; width: number; height: number }
  }): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('view:show', payload),

  viewHide: (payload: { label: string }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('view:hide', payload),

  viewHideAll: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('view:hideAll'),

  viewReconcile: (payload: { keepLabels: string[] }): Promise<{ ok: boolean; destroyed: number }> =>
    ipcRenderer.invoke('view:reconcile', payload),

  viewSetBounds: (payload: {
    label: string
    bounds: { x: number; y: number; width: number; height: number }
  }): Promise<{ ok: boolean }> => ipcRenderer.invoke('view:setBounds', payload),

  viewDestroy: (payload: {
    label: string
    tabId?: string
    purgeFingerprint?: boolean
  }): Promise<{ ok: boolean }> => ipcRenderer.invoke('view:destroy', payload),

  viewReload: (payload: { label: string }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('view:reload', payload),

  viewGetUrl: (payload: { label: string }): Promise<string | null> =>
    ipcRenderer.invoke('view:getUrl', payload),

  syncAppSettings: (payload: {
    translationProvider: string
    apiKeys?: { chatgpt?: string; deepseek?: string }
  }): Promise<unknown> => ipcRenderer.invoke('sync:appSettings', payload),

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
  }): Promise<{ ok: boolean }> => ipcRenderer.invoke('sync:tabSettings', payload),

  syncActiveTab: (payload: { webviewLabel: string | null }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('sync:activeTab', payload),

  syncManualPanel: (payload: {
    expanded: boolean
  }): Promise<{ ok: boolean; expanded: boolean }> =>
    ipcRenderer.invoke('sync:manualPanel', payload),

  setUnreadTotal: (payload: { total: number }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('desktop:unreadTotal', payload),

  translateManual: (payload: {
    webviewLabel?: string
    text: string
    sourceLang: string
    targetLang: string
  }): Promise<
    | { ok: true; data: { translated_text: string; provider: string; from_cache: boolean } }
    | { ok: false; data: { error: string } }
  > => ipcRenderer.invoke('translate:manual', payload),

  injectPush: (payload: {
    label: string
    message: unknown
  }): Promise<{ ok: boolean }> => ipcRenderer.invoke('inject:push', payload),

  proxyTest: (payload: {
    host: string
    port: number
    username?: string
    password?: string
  }): Promise<{
    success: boolean
    message: string
    ip?: string
    country?: string
    region?: string
    city?: string
  }> => ipcRenderer.invoke('proxy:test', payload),

  onMessageBlink: (
    callback: (payload: {
      webviewLabel: string
      active: boolean
      title?: string
      count?: number
      source?: string
    }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      payload: {
        webviewLabel: string
        active: boolean
        title?: string
        count?: number
        source?: string
      }
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('message:blink', listener)
    return () => ipcRenderer.removeListener('message:blink', listener)
  },

  onChatContext: (
    callback: (payload: {
      webviewLabel: string
      chatId: string
      contactName: string
    }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      payload: {
        webviewLabel: string
        chatId: string
        contactName: string
      }
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('chat:context', listener)
    return () => ipcRenderer.removeListener('chat:context', listener)
  },

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
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      payload: {
        webviewLabel: string
        chatId: string
        contactName: string
        chatLangPrefs: Record<
          string,
          { sendTargetLang?: string; receiveTargetLang?: string; contactName?: string }
        >
      }
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('chat:langPrefs', listener)
    return () => ipcRenderer.removeListener('chat:langPrefs', listener)
  },

  onMessageOpenTab: (
    callback: (payload: {
      tabId?: string
      groupId?: string
      webviewLabel?: string
    }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      payload: { tabId?: string; groupId?: string; webviewLabel?: string }
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('message:open-tab', listener)
    return () => ipcRenderer.removeListener('message:open-tab', listener)
  },

  clueDevFake: (payload: {
    mode: 'add_friend' | 'friend_message'
    platform: 'line' | 'whatsapp'
    tabId: string
    webviewLabel?: string
    accountUid?: string
    accountName?: string
    friendText?: string
  }): Promise<{
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
  }> => ipcRenderer.invoke('clue:devFake', payload),

  maps: {
    getSettings: (): Promise<unknown> => ipcRenderer.invoke('maps:getSettings'),
    saveSettings: (settings: unknown): Promise<void> =>
      ipcRenderer.invoke('maps:saveSettings', settings),
    createTask: (keywords: string[], locations: string[]): Promise<unknown> =>
      ipcRenderer.invoke('maps:createTask', keywords, locations),
    listTasks: (): Promise<unknown> => ipcRenderer.invoke('maps:listTasks'),
    getTask: (id: number): Promise<unknown> => ipcRenderer.invoke('maps:getTask', id),
    updateTaskStatus: (id: number, status: string): Promise<void> =>
      ipcRenderer.invoke('maps:updateTaskStatus', id, status),
    saveBusiness: (business: unknown, dedupMode: string): Promise<unknown> =>
      ipcRenderer.invoke('maps:saveBusiness', business, dedupMode),
    updateBusinessEmail: (businessId: number, email: string, dedupMode: string): Promise<void> =>
      ipcRenderer.invoke('maps:updateBusinessEmail', businessId, email, dedupMode),
    listBusinesses: (
      taskId: number | null,
      page: number,
      pageSize: number
    ): Promise<unknown> => ipcRenderer.invoke('maps:listBusinesses', taskId, page, pageSize),
    exportBusinesses: (taskId: number | null): Promise<unknown> =>
      ipcRenderer.invoke('maps:exportBusinesses', taskId),
    importBusinesses: (taskId: number, rows: unknown[]): Promise<number> =>
      ipcRenderer.invoke('maps:importBusinesses', taskId, rows),
    clearDedupCache: (scope?: string | null, taskId?: number | null): Promise<number> =>
      ipcRenderer.invoke('maps:clearDedupCache', scope ?? null, taskId ?? null),
    addLog: (level: string, message: string): Promise<unknown> =>
      ipcRenderer.invoke('maps:addLog', level, message),
    listLogs: (limit?: number): Promise<unknown> =>
      ipcRenderer.invoke('maps:listLogs', limit),
    clearLogs: (): Promise<void> => ipcRenderer.invoke('maps:clearLogs'),
    openMapsWindow: (url: string): Promise<void> =>
      ipcRenderer.invoke('maps:openMapsWindow', url),
    ensureMapsChild: (
      url: string,
      x: number,
      y: number,
      width: number,
      height: number
    ): Promise<void> => ipcRenderer.invoke('maps:ensureMapsChild', url, x, y, width, height),
    setMapsVisible: (visible: boolean): Promise<void> =>
      ipcRenderer.invoke('maps:setMapsVisible', visible),
    setMapsBounds: (x: number, y: number, width: number, height: number): Promise<void> =>
      ipcRenderer.invoke('maps:setMapsBounds', x, y, width, height),
    evalMapsJs: (script: string): Promise<unknown> =>
      ipcRenderer.invoke('maps:evalMapsJs', script),
    openEmailWindow: (label: string, url: string): Promise<void> =>
      ipcRenderer.invoke('maps:openEmailWindow', label, url),
    evalEmailJs: (label: string, script: string): Promise<unknown> =>
      ipcRenderer.invoke('maps:evalEmailJs', label, script),
    closeWebview: (label: string): Promise<void> =>
      ipcRenderer.invoke('maps:closeWebview', label),
    closeAllEmailWindows: (): Promise<number> =>
      ipcRenderer.invoke('maps:closeAllEmailWindows'),
    createCustomer: (input: {
      name?: string
      company?: string
      contactPerson?: string
      email?: string
      phone?: string
      website?: string
      country?: string
      notes?: string
    }): Promise<{ id: string }> => ipcRenderer.invoke('maps:createCustomer', input),
    clearMapsWebviewCache: (): Promise<void> =>
      ipcRenderer.invoke('maps:clearMapsWebviewCache'),
    pickExportPath: (defaultName: string): Promise<string | null> =>
      ipcRenderer.invoke('maps:pickExportPath', defaultName),
    writeExportFile: (path: string, bytes: number[]): Promise<void> =>
      ipcRenderer.invoke('maps:writeExportFile', path, bytes),
    openMapsDevtools: (): Promise<void> => ipcRenderer.invoke('maps:openMapsDevtools'),
    testMapsProxy: (settings: unknown): Promise<unknown> =>
      ipcRenderer.invoke('maps:testMapsProxy', settings),
    onEvent: <T = unknown>(channel: string, callback: (payload: T) => void): (() => void) => {
      const listener = (
        _event: IpcRendererEvent,
        data: { channel?: string; payload?: T }
      ): void => {
        if (data?.channel === channel) callback(data.payload as T)
      }
      ipcRenderer.on('maps:event', listener)
      return () => ipcRenderer.removeListener('maps:event', listener)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error fallback when contextIsolation is disabled
  window.electron = electronAPI
  // @ts-expect-error fallback when contextIsolation is disabled
  window.api = api
}
