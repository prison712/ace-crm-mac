import { ipcMain } from 'electron'
import { handleInjectInvoke, pushToView } from '../inject/handler'
import { testProxy } from '../services/proxy'
import { translateManual } from '../services/translate'
import * as browserViews from '../services/browserViews'
import {
  getTabSettingsByLabel,
  isManualPanelExpanded,
  setActiveWebviewLabel,
  setManualPanelExpanded,
  setSyncedAppSettings,
  setSyncedTabSettings,
  type SyncedTabSettings
} from '../services/syncState'
import { clearDesktopNotifyState, setUnreadAttention } from '../services/desktopNotify'

async function broadcastManualPanelExpanded(expanded: boolean): Promise<void> {
  setManualPanelExpanded(expanded)
  await Promise.all(
    browserViews.listViewLabels().map((label) => {
      const tab = getTabSettingsByLabel(label)
      return pushToView(label, {
        type: 'manual_panel',
        expanded,
        skipAutoTranslate: Boolean(tab?.manualPanelDisablesAutoTranslate)
      }).catch((e) => {
        console.warn(`[acecrm] push manual_panel to ${label} failed:`, e)
      })
    })
  )
}

export function registerPhase5Ipc(): void {
  ipcMain.handle(
    'sync:appSettings',
    (
      _event,
      payload: {
        translationProvider?: string
        apiKeys?: { chatgpt?: string; deepseek?: string }
      }
    ) => {
      return setSyncedAppSettings(payload ?? {})
    }
  )

  ipcMain.handle(
    'sync:tabSettings',
    async (_event, payload: { tabs?: SyncedTabSettings[] }) => {
      const tabs = payload?.tabs ?? []
      setSyncedTabSettings(tabs)
      const panelExpanded = isManualPanelExpanded()
      await Promise.all(
        tabs.map((t) =>
          pushToView(t.webviewLabel, {
            type: 'tab_flags',
            expanded: panelExpanded,
            skipAutoOnManualPanel: Boolean(t.manualPanelDisablesAutoTranslate)
          }).catch(() => {
            /* view may not exist yet */
          })
        )
      )
      // 已打开的标签补挂「发送语言」按钮（修复热更新后看不到入口）
      void browserViews.installChatLangFabAll()
      return { ok: true }
    }
  )

  ipcMain.handle('sync:activeTab', (_event, payload: { webviewLabel?: string | null }) => {
    const label = payload?.webviewLabel ?? null
    setActiveWebviewLabel(label)
    if (label) {
      clearDesktopNotifyState(label)
      void browserViews.installChatLangFab(label)
    }
    return { ok: true }
  })

  ipcMain.handle(
    'sync:manualPanel',
    async (_event, payload: { expanded?: boolean }) => {
      const expanded = Boolean(payload?.expanded)
      await broadcastManualPanelExpanded(expanded)
      return { ok: true, expanded: isManualPanelExpanded() }
    }
  )

  ipcMain.handle(
    'desktop:unreadTotal',
    (_event, payload: { total?: number }) => {
      setUnreadAttention(Number(payload?.total) || 0)
      return { ok: true }
    }
  )

  ipcMain.handle(
    'proxy:test',
    async (
      _event,
      payload: { host: string; port: number; username?: string; password?: string }
    ) => {
      return testProxy({
        host: payload?.host ?? '',
        port: Number(payload?.port) || 0,
        username: payload?.username ?? '',
        password: payload?.password ?? ''
      })
    }
  )

  ipcMain.handle(
    'inject:invoke',
    async (event, payload: { action?: string; payload?: unknown }) => {
      const action = payload?.action ?? ''
      return handleInjectInvoke(event.sender, action, payload?.payload ?? null)
    }
  )

  ipcMain.handle(
    'inject:push',
    async (_event, payload: { label: string; message: unknown }) => {
      await pushToView(payload.label, payload.message)
      return { ok: true }
    }
  )

  ipcMain.handle(
    'translate:manual',
    async (
      _event,
      payload: {
        webviewLabel?: string
        text?: string
        sourceLang?: string
        targetLang?: string
      }
    ) => {
      return translateManual({
        webviewLabel: payload?.webviewLabel,
        text: payload?.text ?? '',
        sourceLang: payload?.sourceLang ?? 'auto',
        targetLang: payload?.targetLang ?? ''
      })
    }
  )
}
