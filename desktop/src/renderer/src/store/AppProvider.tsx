import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { v4 as uuidv4 } from 'uuid'
import {
  DEFAULT_RECEIVE_TARGET_LANG,
  DEFAULT_SEND_TARGET_LANG,
  DEFAULT_MANUAL_SOURCE_LANG,
  DEFAULT_MANUAL_TARGET_LANG
} from '@/lib/languages'
import {
  defaultTabTitle,
  getVisibleGroups,
  isPlatformEnabled
} from '@/lib/platforms'
import { buildProxyUrl } from '@/lib/proxy'
import { EMPTY_PROXY } from '@/lib/proxy'
import { applyTheme, loadState, saveState, tabChatUrl } from '@/lib/storage'
import { syncActiveTabToMain, syncAppSettingsToMain, syncTabSettingsToMain } from '@/lib/syncApi'
import type {
  AppState,
  BrowserTab,
  PlatformId,
  SettingsView,
  TabGroup,
  Theme,
  UserSettings,
  WebviewBounds
} from '@/lib/types'
import { useAppMode } from '@/context/ModeContext'
import {
  closeContentWebview,
  createContentWebview,
  hideAllContentWebviews,
  hideContentWebview,
  recreateContentWebview,
  reconcileContentWebviews,
  resizeContentWebview,
  showContentWebview
} from '@/lib/webview'

type Action =
  | { type: 'HYDRATE'; state: AppState }
  | { type: 'SET_THEME'; theme: Theme }
  | { type: 'SELECT_GROUP'; groupId: PlatformId }
  | { type: 'SET_ACTIVE_TAB'; tabId: string | null }
  | { type: 'ADD_TAB'; tab: BrowserTab }
  | { type: 'UPDATE_TAB'; tab: BrowserTab }
  | { type: 'REMOVE_TAB'; tabId: string }
  | { type: 'UPDATE_USER'; user: UserSettings }

/** 切到某分组时优先恢复上次选中的标签，失效则退回该组第一个，都没有则空 */
function pickTabForGroup(state: AppState, groupId: PlatformId): string | null {
  const remembered = state.lastActiveByGroup[groupId]
  if (remembered && state.tabs.some((t) => t.id === remembered && t.groupId === groupId)) {
    return remembered
  }
  return state.tabs.find((t) => t.groupId === groupId)?.id ?? null
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'HYDRATE':
      return action.state
    case 'SET_THEME':
      return { ...state, theme: action.theme }
    case 'SELECT_GROUP': {
      const activeTabId = pickTabForGroup(state, action.groupId)
      const lastActiveByGroup = activeTabId
        ? { ...state.lastActiveByGroup, [action.groupId]: activeTabId }
        : state.lastActiveByGroup
      return { ...state, selectedGroupId: action.groupId, activeTabId, lastActiveByGroup }
    }
    case 'SET_ACTIVE_TAB': {
      const tab = action.tabId ? state.tabs.find((t) => t.id === action.tabId) : null
      const lastActiveByGroup = tab
        ? { ...state.lastActiveByGroup, [tab.groupId]: tab.id }
        : state.lastActiveByGroup
      return { ...state, activeTabId: action.tabId, lastActiveByGroup }
    }
    case 'ADD_TAB':
      return {
        ...state,
        tabs: [...state.tabs, action.tab],
        selectedGroupId: action.tab.groupId,
        activeTabId: action.tab.id,
        lastActiveByGroup: { ...state.lastActiveByGroup, [action.tab.groupId]: action.tab.id }
      }
    case 'UPDATE_TAB':
      return {
        ...state,
        tabs: state.tabs.map((t) => (t.id === action.tab.id ? action.tab : t))
      }
    case 'REMOVE_TAB': {
      const tabs = state.tabs.filter((t) => t.id !== action.tabId)
      // 清掉指向被删标签的分组记忆
      const lastActiveByGroup = { ...state.lastActiveByGroup }
      for (const key of Object.keys(lastActiveByGroup) as PlatformId[]) {
        if (lastActiveByGroup[key] === action.tabId) delete lastActiveByGroup[key]
      }
      let activeTabId = state.activeTabId
      if (state.activeTabId === action.tabId) {
        const gid = state.selectedGroupId
        const remembered = gid ? lastActiveByGroup[gid] : undefined
        activeTabId =
          remembered && tabs.some((t) => t.id === remembered)
            ? remembered
            : gid
              ? (tabs.find((t) => t.groupId === gid)?.id ?? null)
              : null
      }
      return { ...state, tabs, activeTabId, lastActiveByGroup }
    }
    case 'UPDATE_USER':
      return { ...state, user: action.user }
    default:
      return state
  }
}

export interface MessageBlinkState {
  tabCounts: Map<string, number>
}

interface AppContextValue {
  state: AppState
  groups: TabGroup[]
  settingsView: SettingsView | null
  openSettings: (view: SettingsView) => Promise<void>
  closeSettings: () => Promise<void>
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  selectGroup: (groupId: PlatformId) => void
  setActiveTab: (tabId: string) => void
  addTab: (groupId: PlatformId) => void
  updateTab: (tab: BrowserTab) => void
  removeTab: (tabId: string) => Promise<void>
  applyProxyToTab: (tab: BrowserTab) => Promise<void>
  contentBounds: WebviewBounds | null
  setContentBounds: (bounds: WebviewBounds | null) => void
  groupTabs: BrowserTab[]
  activeTab: BrowserTab | null
  updateUser: (user: UserSettings) => void
  messageBlink: MessageBlinkState
  isGroupBlinking: (groupId: PlatformId) => boolean
  isTabBlinking: (tabId: string) => boolean
  getTabUnreadCount: (tabId: string) => number
  getGroupUnreadCount: (groupId: PlatformId) => number
  openTabRemark: () => Promise<void>
  closeTabRemark: () => Promise<void>
  /** 设置中的测试模式（线索伪造 / Whoer） */
  testModeEnabled: boolean
}

const AppContext = createContext<AppContextValue | null>(null)

function createTab(groupId: PlatformId, index: number): BrowserTab {
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

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, undefined, loadState)
  const [testModeEnabled, setTestModeEnabled] = useState(false)

  useEffect(() => {
    void window.api.settingsGet().then((s) => {
      setTestModeEnabled(Boolean(s.testModeEnabled))
    })
    return window.api.onSettingsChanged((s) => {
      setTestModeEnabled(Boolean(s.testModeEnabled))
    })
  }, [])

  const groups = useMemo(
    () =>
      getVisibleGroups(state.user.enabledPlatforms, {
        testModeEnabled,
        platformOrder: state.user.platformOrder
      }),
    [state.user.enabledPlatforms, state.user.platformOrder, testModeEnabled]
  )
  const [contentBounds, setContentBoundsState] = useState<WebviewBounds | null>(null)
  const [settingsView, setSettingsView] = useState<SettingsView | null>(null)
  const createdRef = useRef<Set<string>>(new Set())
  const lastKeepLabelsRef = useRef<string>('')
  /** 每次同步递增；旧任务结束后若 gen 过期则不再 show，保证切换不被慢加载堵住 */
  const syncGenRef = useRef(0)
  const mountedRef = useRef(true)
  const settingsOpenRef = useRef(false)
  const remarkOpenRef = useRef(false)
  const applyingProxyRef = useRef(false)
  const contentBoundsRef = useRef<WebviewBounds | null>(null)
  const tabsRef = useRef(state.tabs)
  tabsRef.current = state.tabs
  const activeTabIdRef = useRef(state.activeTabId)
  activeTabIdRef.current = state.activeTabId

  const [messageBlink, setMessageBlink] = useState<MessageBlinkState>({
    tabCounts: new Map()
  })

  const getTabUnreadCount = useCallback(
    (tabId: string) => messageBlink.tabCounts.get(tabId) ?? 0,
    [messageBlink.tabCounts]
  )

  const getGroupUnreadCount = useCallback(
    (groupId: PlatformId) => {
      let sum = 0
      for (const t of tabsRef.current) {
        if (t.groupId !== groupId) continue
        sum += messageBlink.tabCounts.get(t.id) ?? 0
      }
      return sum
    },
    [messageBlink.tabCounts]
  )

  const isGroupBlinking = useCallback(
    (groupId: PlatformId) => getGroupUnreadCount(groupId) > 0,
    [getGroupUnreadCount]
  )

  const isTabBlinking = useCallback(
    (tabId: string) => getTabUnreadCount(tabId) > 0,
    [getTabUnreadCount]
  )

  const totalUnreadCount = useMemo(() => {
    let sum = 0
    for (const n of messageBlink.tabCounts.values()) sum += n
    return sum
  }, [messageBlink.tabCounts])

  useEffect(() => {
    void window.api.setUnreadTotal({ total: totalUnreadCount }).catch(() => {
      /* ignore */
    })
  }, [totalUnreadCount])

  const setContentBounds = useCallback((bounds: WebviewBounds | null) => {
    contentBoundsRef.current = bounds
    setContentBoundsState(bounds)
  }, [])

  useEffect(() => {
    applyTheme(state.theme)
    saveState(state)
  }, [state])

  useEffect(() => {
    if (groups.length === 0) return
    const selected = state.selectedGroupId
    if (selected && isPlatformEnabled(state.user.enabledPlatforms, selected)) {
      return
    }
    dispatch({ type: 'SELECT_GROUP', groupId: groups[0].id })
  }, [groups, state.selectedGroupId, state.user.enabledPlatforms])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void syncAppSettingsToMain(state.user).catch(console.error)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [state.user])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void syncTabSettingsToMain(state.tabs).catch(console.error)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [state.tabs])

  const updateUser = useCallback((user: UserSettings) => {
    dispatch({ type: 'UPDATE_USER', user })
  }, [])

  const groupTabs = useMemo(() => {
    if (!state.selectedGroupId) return []
    const tabs = state.tabs.filter((t) => t.groupId === state.selectedGroupId)
    return [...tabs].sort((a, b) => {
      const ca = messageBlink.tabCounts.get(a.id) ?? 0
      const cb = messageBlink.tabCounts.get(b.id) ?? 0
      const aUnread = ca > 0
      const bUnread = cb > 0
      if (aUnread !== bUnread) return aUnread ? -1 : 1
      if (aUnread && bUnread && ca !== cb) return cb - ca
      return 0
    })
  }, [state.tabs, state.selectedGroupId, messageBlink.tabCounts])

  const activeTab = useMemo(
    () => state.tabs.find((t) => t.id === state.activeTabId) ?? null,
    [state.tabs, state.activeTabId]
  )

  const { appMode } = useAppMode()
  const appModeRef = useRef(appMode)
  appModeRef.current = appMode

  useEffect(() => {
    // 工作台模式下不把社媒标签当作「正在查看」，否则后台消息被吞、不闪烁不弹窗
    const label = appMode === 'social' ? activeTab?.webviewLabel ?? null : null
    void syncActiveTabToMain(label).catch(console.error)
  }, [activeTab?.webviewLabel, appMode])

  useEffect(() => {
    return window.api.onMessageBlink((payload) => {
      const webviewLabel = payload?.webviewLabel
      const active = payload?.active ?? true
      const source = payload?.source || 'poll'
      if (!webviewLabel) return
      const tab = tabsRef.current.find((t) => t.webviewLabel === webviewLabel)
      if (!tab) return
      const viewing = tabsRef.current.find((t) => t.id === activeTabIdRef.current)
      // 对齐 Omni：仅社媒模式 + 当前标签视为「正在查看」；
      // 窗口失焦时 document.hasFocus() 为 false，未读仍计入合计以触发 setUnreadAttention 闪烁
      const isViewing =
        appModeRef.current === 'social' &&
        viewing?.webviewLabel === webviewLabel &&
        (typeof document === 'undefined' || document.hasFocus())

      // 页面角标轮询：数量以页面上还在的角标为准，0 就清掉标签和 logo
      if (
        source === 'poll' ||
        source === 'line_unread' ||
        source === 'telegram_unread' ||
        source === 'whatsapp_unread' ||
        source === 'messenger_unread' ||
        source === 'became_hidden'
      ) {
        const raw =
          typeof payload.count === 'number' ? Math.max(0, Math.floor(payload.count)) : 0
        const nextCount = active ? raw : 0
        setMessageBlink((prev) => {
          const cur = prev.tabCounts.get(tab.id) ?? 0
          if (nextCount <= 0) {
            if (cur <= 0) return prev
            const next = new Map(prev.tabCounts)
            next.delete(tab.id)
            return { tabCounts: next }
          }
          if (cur === nextCount) return prev
          const next = new Map(prev.tabCounts)
          next.set(tab.id, nextCount)
          return { tabCounts: next }
        })
        return
      }

      if (
        source === 'hidden_translate' ||
        source === 'line_notification'
      ) {
        if (!active) return
        setMessageBlink((prev) => {
          const next = new Map(prev.tabCounts)
          const prevCount = next.get(tab.id) ?? 0
          next.set(tab.id, prevCount + 1)
          return { tabCounts: next }
        })
        return
      }

      if (isViewing && !active) {
        setMessageBlink((prev) => {
          if (!prev.tabCounts.has(tab.id)) return prev
          const next = new Map(prev.tabCounts)
          next.delete(tab.id)
          return { tabCounts: next }
        })
      }
    })
  }, [])

  useEffect(() => {
    if (typeof window.api.onChatContext !== 'function') return
    return window.api.onChatContext((payload) => {
      const webviewLabel = payload?.webviewLabel
      const chatId = String(payload?.chatId || '').trim()
      if (!webviewLabel || !chatId) return
      const tab = tabsRef.current.find((t) => t.webviewLabel === webviewLabel)
      if (!tab) return
      const contactName = String(payload?.contactName || '').trim()
      if (tab.activeChatId === chatId && tab.activeContactName === contactName) return
      dispatch({
        type: 'UPDATE_TAB',
        tab: {
          ...tab,
          activeChatId: chatId,
          activeContactName: contactName
        }
      })
    })
  }, [])

  useEffect(() => {
    if (typeof window.api.onChatLangPrefs !== 'function') return
    return window.api.onChatLangPrefs((payload) => {
      const webviewLabel = payload?.webviewLabel
      if (!webviewLabel || !payload?.chatLangPrefs) return
      const tab = tabsRef.current.find((t) => t.webviewLabel === webviewLabel)
      if (!tab) return
      const chatId = String(payload.chatId || '').trim()
      const contactName = String(payload.contactName || '').trim()
      dispatch({
        type: 'UPDATE_TAB',
        tab: {
          ...tab,
          chatLangPrefs: payload.chatLangPrefs,
          ...(chatId
            ? {
                activeChatId: chatId,
                activeContactName: contactName || tab.activeContactName
              }
            : {})
        }
      })
    })
  }, [])

  useEffect(() => {
    return window.api.onMessageOpenTab((payload) => {
      const byId = payload?.tabId
        ? tabsRef.current.find((t) => t.id === payload.tabId)
        : undefined
      const byLabel = payload?.webviewLabel
        ? tabsRef.current.find((t) => t.webviewLabel === payload.webviewLabel)
        : undefined
      const tab = byId ?? byLabel
      if (!tab) return
      dispatch({ type: 'SELECT_GROUP', groupId: tab.groupId })
      dispatch({ type: 'SET_ACTIVE_TAB', tabId: tab.id })
    })
  }, [])

  const proxyForTab = (tab: BrowserTab): string | null => {
    if (!tab.proxyEnabled) return null
    return buildProxyUrl(tab.proxy)
  }

  const suspendAllContentWebviews = useCallback(async () => {
    try {
      await hideAllContentWebviews()
    } catch {
      /* ignore */
    }
  }, [])

  const ensureWebview = useCallback(
    async (tab: BrowserTab, bounds: WebviewBounds) => {
      const url = tabChatUrl(tab, state.user.platformUrls)
      if (!createdRef.current.has(tab.webviewLabel)) {
        await createContentWebview(
          tab.webviewLabel,
          tab.id,
          tab.groupId,
          url,
          bounds,
          proxyForTab(tab)
        )
        createdRef.current.add(tab.webviewLabel)
      } else {
        await resizeContentWebview(tab.webviewLabel, bounds)
      }
    },
    [state.user.platformUrls]
  )

  const syncWebviews = useCallback(async () => {
    // 地图和工作台都不该再挂社媒网页，否则会和地图层叠在一起花屏
    if (appModeRef.current !== 'social') {
      await suspendAllContentWebviews()
      return
    }
    if (
      !contentBounds ||
      !mountedRef.current ||
      settingsOpenRef.current ||
      remarkOpenRef.current ||
      applyingProxyRef.current
    ) {
      return
    }

    const gen = ++syncGenRef.current
    const stale = (): boolean => gen !== syncGenRef.current || !mountedRef.current

    // 仅当标签集合变化时 reconcile，避免每次 resize 都销毁/重建
    const keepLabels = state.tabs.map((t) => t.webviewLabel)
    const keepKey = keepLabels.slice().sort().join('|')
    if (keepKey !== lastKeepLabelsRef.current) {
      lastKeepLabelsRef.current = keepKey
      try {
        await reconcileContentWebviews(keepLabels)
        if (stale()) return
        createdRef.current = new Set(keepLabels.filter((l) => createdRef.current.has(l)))
      } catch (error) {
        console.error('webview reconcile failed', error)
      }
    }

    if (stale()) return

    const activeTabObj = state.activeTabId
      ? state.tabs.find((t) => t.id === state.activeTabId)
      : undefined
    if (!activeTabObj) {
      await suspendAllContentWebviews()
      return
    }

    // 已创建：立刻 show，不等其它标签加载完
    if (createdRef.current.has(activeTabObj.webviewLabel)) {
      for (const label of [...createdRef.current]) {
        if (label === activeTabObj.webviewLabel) continue
        try {
          await hideContentWebview(label)
        } catch {
          /* ignore */
        }
        if (stale()) return
      }
      if (stale()) return
      try {
        await showContentWebview(activeTabObj.webviewLabel, contentBounds)
      } catch (error) {
        console.error('webview show failed', activeTabObj.webviewLabel, error)
        createdRef.current.delete(activeTabObj.webviewLabel)
      }
      return
    }

    // 未创建：create 不再阻塞 loadURL，创建后立刻 show；若期间用户已切走则放弃 show
    try {
      await ensureWebview(activeTabObj, contentBounds)
      if (stale()) return
      for (const label of [...createdRef.current]) {
        if (label === activeTabObj.webviewLabel) continue
        try {
          await hideContentWebview(label)
        } catch {
          /* ignore */
        }
        if (stale()) return
      }
      if (stale()) return
      await showContentWebview(activeTabObj.webviewLabel, contentBounds)
    } catch (error) {
      console.error('webview sync failed', activeTabObj.webviewLabel, error)
      createdRef.current.delete(activeTabObj.webviewLabel)
    }
  }, [contentBounds, state.tabs, state.activeTabId, ensureWebview, suspendAllContentWebviews])

  const openSettings = useCallback(
    async (view: SettingsView) => {
      if (view.type === 'tab') {
        dispatch({ type: 'SET_ACTIVE_TAB', tabId: view.tabId })
      }
      settingsOpenRef.current = true
      await suspendAllContentWebviews()
      if (view.type === 'user') {
        await window.api.setUserSettingsOverlay(true).catch(() => undefined)
      }
      setSettingsView(view)
    },
    [suspendAllContentWebviews]
  )

  const closeSettings = useCallback(async () => {
    await window.api.setUserSettingsOverlay(false).catch(() => undefined)
    settingsOpenRef.current = false
    setSettingsView(null)
    const bounds = contentBoundsRef.current || undefined
    await window.api
      .setAppMode({ mode: appModeRef.current, bounds })
      .catch(() => undefined)
    await syncWebviews()
  }, [syncWebviews])

  const openTabRemark = useCallback(async () => {
    remarkOpenRef.current = true
    await suspendAllContentWebviews()
  }, [suspendAllContentWebviews])

  const closeTabRemark = useCallback(async () => {
    remarkOpenRef.current = false
    await syncWebviews()
  }, [syncWebviews])

  useEffect(() => {
    mountedRef.current = true
    void syncWebviews()
    return () => {
      mountedRef.current = false
    }
  }, [syncWebviews, appMode])

  useEffect(() => {
    if (
      !contentBounds ||
      settingsOpenRef.current ||
      remarkOpenRef.current ||
      applyingProxyRef.current
    ) {
      return
    }
    const timer = window.setTimeout(() => {
      void syncWebviews()
    }, 50)
    return () => window.clearTimeout(timer)
  }, [contentBounds, syncWebviews])

  const setTheme = useCallback((theme: Theme) => {
    dispatch({ type: 'SET_THEME', theme })
  }, [])

  const toggleTheme = useCallback(() => {
    dispatch({ type: 'SET_THEME', theme: state.theme === 'light' ? 'dark' : 'light' })
  }, [state.theme])

  const selectGroup = useCallback((groupId: PlatformId) => {
    dispatch({ type: 'SELECT_GROUP', groupId })
  }, [])

  const setActiveTab = useCallback((tabId: string) => {
    dispatch({ type: 'SET_ACTIVE_TAB', tabId })
  }, [])

  const addTab = useCallback(
    (groupId: PlatformId) => {
      const index = state.tabs.filter((t) => t.groupId === groupId).length + 1
      const tab = createTab(groupId, index)
      dispatch({ type: 'ADD_TAB', tab })
    },
    [state.tabs]
  )

  const updateTab = useCallback((tab: BrowserTab) => {
    dispatch({ type: 'UPDATE_TAB', tab })
  }, [])

  const removeTab = useCallback(
    async (tabId: string) => {
      const tab = state.tabs.find((t) => t.id === tabId)
      dispatch({ type: 'REMOVE_TAB', tabId })
      if (tab) {
        createdRef.current.delete(tab.webviewLabel)
        try {
          await closeContentWebview(tab.webviewLabel, {
            tabId: tab.id,
            purgeFingerprint: true
          })
        } catch {
          /* ignore */
        }
      }
    },
    [state.tabs]
  )

  const applyProxyToTab = useCallback(
    async (tab: BrowserTab) => {
      applyingProxyRef.current = true
      try {
        dispatch({ type: 'UPDATE_TAB', tab })
        const bounds = contentBoundsRef.current
        if (bounds && createdRef.current.has(tab.webviewLabel)) {
          await recreateContentWebview(
            tab.webviewLabel,
            tab.id,
            tab.groupId,
            tabChatUrl(tab, state.user.platformUrls),
            bounds,
            proxyForTab(tab),
            true
          )
        }
      } finally {
        applyingProxyRef.current = false
        await syncWebviews()
        await closeSettings()
      }
    },
    [closeSettings, state.user.platformUrls, syncWebviews]
  )

  const value: AppContextValue = {
    state,
    groups,
    settingsView,
    openSettings,
    closeSettings,
    setTheme,
    toggleTheme,
    selectGroup,
    setActiveTab,
    addTab,
    updateTab,
    removeTab,
    applyProxyToTab,
    contentBounds,
    setContentBounds,
    groupTabs,
    activeTab,
    updateUser,
    messageBlink,
    isGroupBlinking,
    isTabBlinking,
    getTabUnreadCount,
    getGroupUnreadCount,
    openTabRemark,
    closeTabRemark,
    testModeEnabled
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
