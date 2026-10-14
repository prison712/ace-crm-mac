import { LogsPage } from '@/maps/pages/LogsPage'
import { ResultsPage } from '@/maps/pages/ResultsPage'
import { SearchPage } from '@/maps/pages/SearchPage'
import { SettingsPage } from '@/maps/pages/SettingsPage'
import { ToastHost } from '@/maps/components/ui/toast'
import { api } from '@/maps/services/api'
import { setMapsVisible } from '@/maps/services/maps-host'
import { DEFAULT_SETTINGS, type AppSettings, type TaskRow } from '@/maps/types'
import { useEffect, useState } from 'react'

type Tab = 'search' | 'results' | 'logs' | 'settings'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'search', label: '搜索' },
  { id: 'results', label: '结果' },
  { id: 'logs', label: '日志' },
  { id: 'settings', label: '设置' }
]

/**
 * 谷歌地图采集壳：业务标签页（无授权门禁）。
 */
export function MapsApp(): React.ReactElement {
  const [tab, setTab] = useState<Tab>('search')
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [settingsReady, setSettingsReady] = useState(false)
  const [currentTask, setCurrentTask] = useState<TaskRow | null>(null)

  useEffect(() => {
    void api
      .getSettings()
      .then((loaded) => {
        const merged = { ...DEFAULT_SETTINGS, ...loaded }
        let shouldPersist = false
        // 一次性纠正：地图调试默认关闭（开发期可能误存为开启）
        if (!localStorage.getItem('mapsDebugDefaultOff_v1')) {
          merged.mapsDebugMode = false
          shouldPersist = true
          localStorage.setItem('mapsDebugDefaultOff_v1', '1')
        }
        if (shouldPersist) {
          void api.saveSettings(merged).catch(() => undefined)
        }
        setSettings(merged)
        setSettingsReady(true)
      })
      .catch(() => {
        setSettings(DEFAULT_SETTINGS)
        setSettingsReady(true)
      })
  }, [])

  useEffect(() => {
    void setMapsVisible(tab === 'search').catch(() => undefined)
  }, [tab])

  /**
   * 切换标签：先藏地图再切页，避免原生层残留在其它标签上。
   * @param next 目标标签
   */
  function switchTab(next: Tab): void {
    if (next !== 'search') {
      void setMapsVisible(false).catch(() => undefined)
    }
    setTab(next)
  }

  useEffect(() => {
    if (!settingsReady) return
    const minutes = Math.max(5, settings.mapsCacheClearMinutes || 30)
    const timer = setInterval(
      () => {
        void api
          .clearMapsWebviewCache()
          .then(() => api.addLog('info', '定时清理谷歌地图网页缓存'))
      },
      minutes * 60 * 1000
    )
    return () => clearInterval(timer)
  }, [settings.mapsCacheClearMinutes, settingsReady])

  return (
    <div className="flex h-full flex-col bg-[var(--background)]">
      <header className="shrink-0 border-b border-[var(--border)] bg-[#dfe3e8]">
        <nav className="flex h-9 w-full items-stretch gap-px px-1 pt-1" role="tablist">
          {TABS.map((item) => {
            const active = tab === item.id
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`relative min-w-0 flex-1 truncate border px-3 text-[13px] transition-colors ${
                  active
                    ? 'rounded-t-md border-b-0 border-[var(--border)] bg-[var(--background)] font-medium text-[var(--foreground)] shadow-[0_-1px_0_var(--background)]'
                    : 'rounded-t-md border-[#c5ccd4] bg-[#e8ebef]/80 text-[var(--muted-foreground)] hover:border-[#aeb6c0] hover:bg-[#d8dee5]'
                }`}
                onClick={() => switchTab(item.id)}
              >
                {item.label}
              </button>
            )
          })}
        </nav>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden p-2">
        <div className={tab === 'search' ? 'h-full' : 'hidden'}>
          <SearchPage
            settings={settings}
            settingsReady={settingsReady}
            onTaskChange={setCurrentTask}
            active={tab === 'search'}
          />
        </div>
        <div className={tab === 'results' ? 'h-full' : 'hidden'}>
          <ResultsPage currentTask={currentTask} />
        </div>
        {tab === 'logs' && <LogsPage />}
        {tab === 'settings' && (
          <SettingsPage settings={settings} onChange={setSettings} />
        )}
      </main>
      <ToastHost />
    </div>
  )
}

export default MapsApp
