export type Theme = 'light' | 'dark'

export type TranslationProvider = 'chatgpt' | 'deepseek'

/** 社媒渠道 id（对齐海王 AppType，小写 + 下划线） */
export type PlatformId =
  | 'whatsapp'
  | 'zalo'
  | 'messenger'
  | 'instagram'
  | 'facebook'
  | 'meta_business'
  | 'line'
  | 'line_business'
  | 'line_works'
  | 'discord'
  | 'telegram'
  | 'telegram_w'
  | 'linkedin'
  | 'tiktok'
  | 'twitter'
  | 'google_voice'
  | 'botim'
  | 'snapchat'
  | 'skype'
  | 'google_chat'
  | 'tinder'
  | 'whoer'

export interface TabGroup {
  id: PlatformId
  name: string
  logo: string
}

export interface ProxyConfig {
  host: string
  port: number
  username: string
  password: string
}

export type MessageDirection = 'send' | 'receive'

/**
 * 单个对话（客户）的翻译语言覆盖。
 * 未设置的方向回退到窗口级 sendTargetLang / receiveTargetLang。
 */
export interface ChatLangPref {
  sendTargetLang?: string
  receiveTargetLang?: string
  contactName?: string
  updatedAt?: number
}

export interface BrowserTab {
  id: string
  webviewLabel: string
  groupId: PlatformId
  title: string
  proxyEnabled: boolean
  proxy: ProxyConfig
  /** 窗口默认：发送消息目标语言（无对话覆盖时使用） */
  sendTargetLang: string
  /** 窗口默认：接收消息目标语言（无对话覆盖时使用） */
  receiveTargetLang: string
  /**
   * 按对话/客户独立语言；key 为注入层 guessChatId()。
   * 解析优先级：对话覆盖 > 窗口默认。
   */
  chatLangPrefs: Record<string, ChatLangPref>
  /** 注入层上报的当前打开对话 id（用于设置页展示） */
  activeChatId: string
  /** 注入层上报的当前对话联系人名称 */
  activeContactName: string
  remark: string
  /** 手动翻译面板源语言（含 auto） */
  manualSourceLang: string
  /** 手动翻译面板目标语言 */
  manualTargetLang: string
  manualTranslatePrompt: string
  manualTranslatePromptEnabled: boolean
  /** 展开右侧翻译面板时是否取消回车自动翻译（默认 true） */
  manualPanelDisablesAutoTranslate: boolean
}

export interface ProxyTestResult {
  success: boolean
  message: string
  ip?: string
  country?: string
  region?: string
  city?: string
}

export type SettingsView = { type: 'tab'; tabId: string } | { type: 'user' }

/** 可在用户设置中开关的渠道（含 Whoer 检测页） */
export type SocialPlatformId = PlatformId

export type EnabledPlatforms = Record<SocialPlatformId, boolean>

export interface UserSettings {
  translationProvider: TranslationProvider
  apiKeys: Record<TranslationProvider, string>
  enabledPlatforms: EnabledPlatforms
  /** 社媒渠道侧栏/设置列表顺序（不含 Whoer 等检测页） */
  platformOrder: SocialPlatformId[]
  /**
   * 测试模式下可覆盖各平台打开地址；空/未设置则用默认 chatUrl。
   * 新建会话时生效（已打开的标签需重建）。
   */
  platformUrls: Partial<Record<SocialPlatformId, string>>
}

export interface AppState {
  theme: Theme
  tabs: BrowserTab[]
  selectedGroupId: PlatformId | null
  activeTabId: string | null
  /** 每个分组最后一次选中的标签 id，用于切回分组时恢复位置 */
  lastActiveByGroup: Partial<Record<PlatformId, string>>
  user: UserSettings
}

export interface WebviewBounds {
  x: number
  y: number
  width: number
  height: number
}
