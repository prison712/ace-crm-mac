import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { ContentArea } from '@/components/layout/ContentArea'
import { GroupSidebar } from '@/components/layout/GroupSidebar'
import { LangSwitch } from '@/components/layout/LangSwitch'
import { ManualTranslatePanel } from '@/components/layout/ManualTranslatePanel'
import { SettingsPanel } from '@/components/layout/SettingsPanel'
import { TabPanel } from '@/components/layout/TabPanel'
import { TitleBar } from '@/components/layout/TitleBar'
import { UserSettingsPanel } from '@/components/layout/UserSettingsPanel'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useI18n } from '@/context/I18nContext'
import { useAppMode } from '@/context/ModeContext'
import { MapsApp } from '@/maps/MapsApp'
import { useApp } from '@/store/AppProvider'

interface AppShellProps {
  inviteCode?: string | null
  onLogout: () => void
}

export function AppShell({ inviteCode, onLogout }: AppShellProps): React.JSX.Element {
  const { settingsView, state, contentBounds } = useApp()
  const { appMode, setAppMode } = useAppMode()
  const { t } = useI18n()
  const userSettingsOpen = settingsView?.type === 'user'
  const [lineTip, setLineTip] = useState<string | null>(null)
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lineTipShownRef = useRef(false)

  useEffect(() => {
    if (state.selectedGroupId !== 'line') {
      setLineTip(null)
      if (tipTimer.current) {
        clearTimeout(tipTimer.current)
        tipTimer.current = null
      }
      return
    }

    // 启动后仅第一次打开 LINE 分组时提示版本
    if (lineTipShownRef.current) return
    lineTipShownRef.current = true

    let cancelled = false
    void (async () => {
      try {
        const { version } = await window.api.getLineExtensionVersion()
        if (cancelled) return
        setLineTip(
          version
            ? t('line.versionTip', { version })
            : t('line.versionUnknown')
        )
        if (tipTimer.current) clearTimeout(tipTimer.current)
        tipTimer.current = setTimeout(() => {
          setLineTip(null)
          tipTimer.current = null
        }, 5000)
      } catch {
        if (cancelled) return
        setLineTip(t('line.versionUnknown'))
      }
    })()

    return () => {
      cancelled = true
      if (tipTimer.current) {
        clearTimeout(tipTimer.current)
        tipTimer.current = null
      }
    }
  }, [state.selectedGroupId, t])

  // 仅模式切换时 load 工作台；尺寸变化走 setWorkbenchBounds（内部会重挂，避免被社媒误摘后只改尺寸仍空白）
  useEffect(() => {
    void window.api.setAppMode({
      mode: appMode,
      bounds: contentBounds || undefined
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 故意不依赖 contentBounds，避免 resize 反复 loadURL
  }, [appMode])

  useEffect(() => {
    if (!contentBounds || appMode !== 'workbench') return
    void window.api.setWorkbenchBounds(contentBounds)
  }, [contentBounds, appMode])

  useEffect(() => {
    void window.api.setUserSettingsOverlay(userSettingsOpen).catch(() => undefined)
  }, [userSettingsOpen])

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <TitleBar
          inviteCode={inviteCode}
          langSwitch={<LangSwitch className="h-6 px-1.5 text-[10px]" />}
          onBackToWorkbench={
            appMode === 'social' || appMode === 'maps'
              ? () => setAppMode('workbench')
              : undefined
          }
          onRefreshWorkbench={
            appMode === 'workbench' ? () => window.api.reloadWorkbench() : undefined
          }
        />

        {lineTip ? (
          <div
            className="app-chrome relative z-30 flex shrink-0 items-center justify-center gap-2 border-b border-border bg-primary/10 px-3 py-1.5 text-[12px] text-foreground"
            role="status"
          >
            <span className="min-w-0 truncate">{lineTip}</span>
            <button
              type="button"
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Dismiss"
              onClick={() => setLineTip(null)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <GroupSidebar />

          {userSettingsOpen ? (
            <UserSettingsPanel inviteCode={inviteCode} onLogout={onLogout} />
          ) : appMode === 'workbench' ? (
            <div className="flex min-w-0 flex-1 flex-col bg-background">
              <main className="relative flex min-h-0 flex-1 flex-col bg-background">
                <ContentArea />
              </main>
            </div>
          ) : appMode === 'maps' ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
              <MapsApp />
            </div>
          ) : (
            <>
              <div className="app-chrome relative z-20 flex shrink-0">
                {settingsView?.type === 'tab' ? (
                  <SettingsPanel view={settingsView} />
                ) : (
                  <TabPanel />
                )}
              </div>

              <div className="flex min-w-0 flex-1 overflow-hidden bg-background">
                <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background p-1.5">
                  <ContentArea />
                </main>
                <ManualTranslatePanel />
              </div>
            </>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
