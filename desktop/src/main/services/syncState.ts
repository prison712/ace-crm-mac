/** 渲染进程同步到主进程的翻译相关状态（无 license） */

export interface SyncedApiKeys {
  chatgpt: string
  deepseek: string
}

export interface SyncedAppSettings {
  translationProvider: string
  apiKeys: SyncedApiKeys
}

/** 主进程侧：按对话覆盖的收发目标语言 */
export interface SyncedChatLangPref {
  sendTargetLang?: string
  receiveTargetLang?: string
  contactName?: string
}

export interface SyncedTabSettings {
  webviewLabel: string
  sendTargetLang: string
  receiveTargetLang: string
  /** 对话级语言覆盖；优先级高于窗口默认 */
  chatLangPrefs: Record<string, SyncedChatLangPref>
  tabId?: string
  title?: string
  remark?: string
  manualTranslatePrompt: string
  manualTranslatePromptEnabled: boolean
  /** 展开右侧翻译面板时是否取消回车自动翻译 */
  manualPanelDisablesAutoTranslate: boolean
}

let appSettings: SyncedAppSettings = {
  translationProvider: 'deepseek',
  apiKeys: { chatgpt: '', deepseek: '' }
}

const tabByLabel = new Map<string, SyncedTabSettings>()

let activeWebviewLabel: string | null = null
let activeSynced = false
/** 窗口失焦时暂停「当前查看」抑制，聚焦后恢复 */
let blurPaused = false
let pausedActiveLabel: string | null = null

/** 右侧手动翻译面板是否展开：展开时聊天框回车直发不自动翻译 */
let manualPanelExpanded = false

export function setManualPanelExpanded(expanded: boolean): boolean {
  manualPanelExpanded = Boolean(expanded)
  return manualPanelExpanded
}

export function isManualPanelExpanded(): boolean {
  return manualPanelExpanded
}

export function setSyncedAppSettings(partial: {
  translationProvider?: string
  apiKeys?: Partial<SyncedApiKeys>
}): SyncedAppSettings {
  appSettings = {
    translationProvider: partial.translationProvider ?? appSettings.translationProvider,
    apiKeys: {
      chatgpt: partial.apiKeys?.chatgpt ?? appSettings.apiKeys.chatgpt,
      deepseek: partial.apiKeys?.deepseek ?? appSettings.apiKeys.deepseek
    }
  }
  return appSettings
}

export function getSyncedAppSettings(): SyncedAppSettings {
  return appSettings
}

/**
 * 规范化对话级语言映射，丢掉空键与空覆盖。
 * @param raw 渲染进程传入的 prefs
 * @returns 仅含有效覆盖的映射
 */
function normalizeChatLangPrefs(
  raw: unknown
): Record<string, SyncedChatLangPref> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, SyncedChatLangPref> = {}
  for (const [chatId, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(chatId || '').trim().slice(0, 200)
    if (!id || !value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    const send =
      typeof v.sendTargetLang === 'string' ? v.sendTargetLang.trim() : ''
    const receive =
      typeof v.receiveTargetLang === 'string' ? v.receiveTargetLang.trim() : ''
    if (!send && !receive) continue
    const pref: SyncedChatLangPref = {}
    if (send) pref.sendTargetLang = send
    if (receive) pref.receiveTargetLang = receive
    if (typeof v.contactName === 'string' && v.contactName.trim()) {
      pref.contactName = v.contactName.trim().slice(0, 200)
    }
    out[id] = pref
  }
  return out
}

export function setSyncedTabSettings(tabs: SyncedTabSettings[]): void {
  tabByLabel.clear()
  for (const t of tabs) {
    if (!t.webviewLabel) continue
    tabByLabel.set(t.webviewLabel, {
      webviewLabel: t.webviewLabel,
      sendTargetLang: t.sendTargetLang || '',
      receiveTargetLang: t.receiveTargetLang || '',
      chatLangPrefs: normalizeChatLangPrefs(t.chatLangPrefs),
      tabId: t.tabId || '',
      title: t.title || '',
      remark: t.remark || '',
      manualTranslatePrompt:
        typeof t.manualTranslatePrompt === 'string' ? t.manualTranslatePrompt : '',
      manualTranslatePromptEnabled: Boolean(t.manualTranslatePromptEnabled),
      manualPanelDisablesAutoTranslate: Boolean(t.manualPanelDisablesAutoTranslate)
    })
  }
}

export function getTabSettingsByLabel(label: string): SyncedTabSettings | undefined {
  return tabByLabel.get(label)
}

/**
 * 读取某对话的有效收发目标语言（对话覆盖优先于窗口默认）。
 * @param label webview 标签
 * @param chatId 对话 id
 * @returns 有效语言与是否已覆盖
 */
export function resolveChatLang(
  label: string,
  chatId: string
): {
  sendTargetLang: string
  receiveTargetLang: string
  tabSendTargetLang: string
  tabReceiveTargetLang: string
  overridden: boolean
  contactName: string
} {
  const tab = tabByLabel.get(label)
  const tabSend = tab?.sendTargetLang?.trim() || 'en'
  const tabReceive = tab?.receiveTargetLang?.trim() || 'zh'
  const id = String(chatId || '').trim()
  const pref = id && tab?.chatLangPrefs ? tab.chatLangPrefs[id] : undefined
  const send = pref?.sendTargetLang?.trim() || tabSend
  const receive = pref?.receiveTargetLang?.trim() || tabReceive
  return {
    sendTargetLang: send,
    receiveTargetLang: receive,
    tabSendTargetLang: tabSend,
    tabReceiveTargetLang: tabReceive,
    overridden: Boolean(pref?.sendTargetLang || pref?.receiveTargetLang),
    contactName: pref?.contactName || ''
  }
}

/**
 * 写入或更新某对话的语言覆盖（主进程即时生效，供注入层设置）。
 * 标签尚未 sync 时会创建最小占位，避免保存失败。
 * @param label webview 标签
 * @param chatId 对话 id
 * @param patch 覆盖字段
 * @returns 更新后的完整 prefs；chatId 非法时返回 null
 */
export function upsertSyncedChatLangPref(
  label: string,
  chatId: string,
  patch: {
    sendTargetLang?: string
    receiveTargetLang?: string
    contactName?: string
  }
): Record<string, SyncedChatLangPref> | null {
  const id = String(chatId || '').trim().slice(0, 200)
  if (!label || !id) return null
  let tab = tabByLabel.get(label)
  if (!tab) {
    tab = {
      webviewLabel: label,
      sendTargetLang: 'en',
      receiveTargetLang: 'zh',
      chatLangPrefs: {},
      tabId: '',
      title: '',
      remark: '',
      manualTranslatePrompt: '',
      manualTranslatePromptEnabled: false,
      manualPanelDisablesAutoTranslate: true
    }
    tabByLabel.set(label, tab)
  }
  const prev = tab.chatLangPrefs[id] || {}
  const send =
    typeof patch.sendTargetLang === 'string' && patch.sendTargetLang.trim()
      ? patch.sendTargetLang.trim()
      : prev.sendTargetLang || tab.sendTargetLang || 'en'
  const receive =
    typeof patch.receiveTargetLang === 'string' && patch.receiveTargetLang.trim()
      ? patch.receiveTargetLang.trim()
      : prev.receiveTargetLang || tab.receiveTargetLang || 'zh'
  const contactName =
    (typeof patch.contactName === 'string' && patch.contactName.trim()
      ? patch.contactName.trim()
      : prev.contactName || ''
    ).slice(0, 200)
  const nextPrefs = {
    ...tab.chatLangPrefs,
    [id]: {
      sendTargetLang: send,
      receiveTargetLang: receive,
      ...(contactName ? { contactName } : {})
    }
  }
  tabByLabel.set(label, { ...tab, chatLangPrefs: nextPrefs })
  return nextPrefs
}

/**
 * 清除某对话的语言覆盖。
 * @param label webview 标签
 * @param chatId 对话 id
 * @returns 更新后的 prefs；失败返回 null
 */
export function clearSyncedChatLangPref(
  label: string,
  chatId: string
): Record<string, SyncedChatLangPref> | null {
  const tab = tabByLabel.get(label)
  const id = String(chatId || '').trim()
  if (!tab || !id) return null
  if (!tab.chatLangPrefs[id]) return { ...tab.chatLangPrefs }
  const nextPrefs = { ...tab.chatLangPrefs }
  delete nextPrefs[id]
  tabByLabel.set(label, { ...tab, chatLangPrefs: nextPrefs })
  return nextPrefs
}

export function setActiveWebviewLabel(label: string | null): void {
  if (blurPaused) {
    // 失焦期间渲染进程仍可能同步 active：只记下来，聚焦后再应用
    pausedActiveLabel = label
    return
  }
  activeWebviewLabel = label
  activeSynced = true
}

/** 失焦：清空当前查看标签，使未读上升可走 Omni 通知/闪烁路径 */
export function pauseActiveTabForNotify(): void {
  if (blurPaused) return
  blurPaused = true
  pausedActiveLabel = activeWebviewLabel
  activeWebviewLabel = null
}

/** 聚焦：恢复失焦前的当前查看标签 */
export function resumeActiveTabAfterFocus(): void {
  if (!blurPaused) return
  blurPaused = false
  activeWebviewLabel = pausedActiveLabel
  pausedActiveLabel = null
  activeSynced = true
}

export function getActiveWebviewLabel(): string | null {
  return activeWebviewLabel
}

export function isTabActive(label: string): boolean {
  // 未同步前视为 active，避免启动时误闪
  if (!activeSynced) return true
  return activeWebviewLabel === label
}

export function isActiveSynced(): boolean {
  return activeSynced
}
