import type { UserSettings, BrowserTab, ChatLangPref } from './types'

export async function syncAppSettingsToMain(user: UserSettings): Promise<void> {
  await window.api.syncAppSettings({
    translationProvider: user.translationProvider
  })
}

/**
 * 将标签页翻译相关设置同步到主进程（含对话级语言覆盖）。
 * @param tabs 当前全部标签
 */
export async function syncTabSettingsToMain(tabs: BrowserTab[]): Promise<void> {
  await window.api.syncTabSettings({
    tabs: tabs.map((t) => ({
      webviewLabel: t.webviewLabel,
      sendTargetLang: t.sendTargetLang,
      receiveTargetLang: t.receiveTargetLang,
      chatLangPrefs: t.chatLangPrefs ?? {},
      tabId: t.id,
      title: t.title,
      remark: t.remark,
      manualTranslatePrompt: t.manualTranslatePrompt || '',
      manualTranslatePromptEnabled: Boolean(t.manualTranslatePromptEnabled),
      manualPanelDisablesAutoTranslate: Boolean(t.manualPanelDisablesAutoTranslate)
    }))
  })
}

export async function syncActiveTabToMain(webviewLabel: string | null): Promise<void> {
  await window.api.syncActiveTab({ webviewLabel })
}

/** 供类型检查与调用方复用 */
export type { ChatLangPref }
