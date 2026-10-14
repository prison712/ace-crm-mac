import { useEffect, useState, type ReactNode } from 'react'
import { Minus, RefreshCw, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/context/I18nContext'
import { cn } from '@/lib/utils'

export function TitleBar({
  langSwitch,
  inviteCode,
  onBackToWorkbench,
  onRefreshWorkbench
}: {
  langSwitch?: ReactNode
  inviteCode?: string | null
  onBackToWorkbench?: () => void
  onRefreshWorkbench?: () => void | Promise<unknown>
}): React.JSX.Element {
  const { t } = useI18n()
  const [version, setVersion] = useState('')
  const [versionTip, setVersionTip] = useState('')
  const [updateLabel, setUpdateLabel] = useState('正在检查更新')
  const [checking, setChecking] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.api.getAppVersion().then(setVersion).catch(() => setVersion(''))
    void window.api
      .getUpdateInfo()
      .then((info) => {
        const lines = [
          `包版本: ${info.packageVersion}`,
          `更新源: ${(info as { feedUrl?: string }).feedUrl || ''}`,
          `状态: ${(info as { lastStatus?: string }).lastStatus || info.lastCheck?.action || '—'}`,
          info.lastCheck?.remoteVersion ? `远端: ${info.lastCheck.remoteVersion}` : '',
          info.lastCheck?.detail ? `详情: ${info.lastCheck.detail}` : '',
          `打包运行: ${info.packaged ? '是' : '否（开发模式不更新）'}`
        ].filter(Boolean)
        setVersionTip(lines.join('\n'))
      })
      .catch(() => setVersionTip(''))
    void window.api.windowIsMaximized().then(setMaximized).catch(() => setMaximized(false))
    const applyUpdate = (info: {
      lastStatus?: string
      lastPercent?: number | null
      lastCheck?: { action: string } | null
    }): void => {
      setUpdateLabel(describeUpdateStatus(info))
    }
    void window.api.getUpdateInfo().then(applyUpdate).catch(() => setUpdateLabel('不需要更新'))
    const off = window.api.onUpdateProgress(applyUpdate)
    const timer = window.setInterval(() => {
      void window.api.getUpdateInfo().then(applyUpdate).catch(() => undefined)
    }, 1000)
    return () => {
      off()
      window.clearInterval(timer)
    }
  }, [])

  return (
    <header
      className={cn(
        'app-chrome app-drag flex h-8 shrink-0 items-center border-b border-border bg-background',
        'select-none'
      )}
    >
      <div className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2">
        <img
          src="./logo.png"
          alt="ACE CRM"
          className="h-4 w-4 shrink-0 object-contain"
          draggable={false}
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.display = 'none'
          }}
        />
        <span className="truncate text-xs font-medium text-foreground">ACE CRM系统</span>
        <span
          className={cn(
            'shrink-0 text-[10px]',
            updateLabel.startsWith('需要更新') ? 'text-primary' : 'text-muted-foreground'
          )}
        >
          · {updateLabel}
        </span>
        {version ? (
          <span
            className="shrink-0 text-[10px] text-muted-foreground"
            title={versionTip || t('titlebar.version', { version })}
          >
            v{version}
          </span>
        ) : null}
        {inviteCode ? (
          <span className="truncate text-[10px] text-muted-foreground">· {inviteCode}</span>
        ) : null}
        {langSwitch ? <div className="app-no-drag">{langSwitch}</div> : null}
        {onBackToWorkbench ? (
          <button
            type="button"
            className="app-no-drag ml-1 inline-flex h-6 shrink-0 items-center rounded px-2 text-[11px] text-foreground hover:bg-accent"
            onClick={onBackToWorkbench}
          >
            {t('titlebar.backWorkbench')}
          </button>
        ) : null}
        {onRefreshWorkbench ? (
          <div className="app-no-drag ml-1 flex h-full items-center">
            <button
              type="button"
              className="app-no-drag inline-flex h-6 shrink-0 items-center gap-1 rounded bg-accent/60 px-2 text-[11px] text-foreground hover:bg-accent"
              disabled={refreshing}
              title={t('titlebar.refreshWorkbench')}
              onClick={() => {
                if (refreshing) return
                setRefreshing(true)
                Promise.resolve(onRefreshWorkbench()).finally(() => {
                  window.setTimeout(() => setRefreshing(false), 600)
                })
              }}
            >
              <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} />
              {refreshing ? '正在刷新…' : t('titlebar.refreshWorkbench')}
            </button>
          </div>
        ) : null}
      </div>

      <div className="app-no-drag flex h-full shrink-0 items-stretch">
        <TitleBarButton
          label={checking ? t('titlebar.checking') : t('titlebar.checkUpdate')}
          className="w-auto gap-1 px-2.5 text-[11px]"
          onClick={() => {
            if (checking) return
            setChecking(true)
            void window.api
              .checkForUpdates()
              .then((info) => {
                if (!info.packaged) {
                  window.alert(info.lastDetail || t('updater.latest'))
                }
              })
              .catch((err) => {
                window.alert(t('updater.fail', { msg: err instanceof Error ? err.message : String(err) }))
              })
              .finally(() => setChecking(false))
          }}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', checking && 'animate-spin')} />
          <span>{checking ? t('titlebar.checking') : t('titlebar.checkUpdate')}</span>
        </TitleBarButton>
        <TitleBarButton
          label={t('titlebar.minimize')}
          onClick={() => void window.api.windowMinimize()}
        >
          <Minus className="h-3.5 w-3.5" />
        </TitleBarButton>
        <TitleBarButton
          label={t('titlebar.maximize')}
          onClick={() => {
            void window.api.windowMaximize().then(setMaximized)
          }}
        >
          {maximized ? (
            <span className="relative block h-3 w-3">
              <span className="absolute top-0.5 left-0.5 h-2 w-2 border border-current" />
              <span className="absolute top-0 left-0 h-2 w-2 border border-current bg-background" />
            </span>
          ) : (
            <Square className="h-3 w-3" />
          )}
        </TitleBarButton>
        <TitleBarButton
          label={t('titlebar.close')}
          className="hover:bg-destructive hover:text-white"
          onClick={() => void window.api.windowClose()}
        >
          <X className="h-3.5 w-3.5" />
        </TitleBarButton>
      </div>
    </header>
  )
}

/**
 * 标题栏用的更新状态：不需要更新，或需要更新并带上当前百分比。
 * @param info 主进程推来的更新快照
 * @returns 标题栏上显示的短句
 */
function describeUpdateStatus(info: {
  lastStatus?: string
  lastPercent?: number | null
  lastCheck?: { action: string } | null
}): string {
  const status = info.lastStatus || info.lastCheck?.action || 'idle'
  const percent =
    typeof info.lastPercent === 'number' && Number.isFinite(info.lastPercent)
      ? Math.max(0, Math.min(100, Math.round(info.lastPercent)))
      : null
  if (status === 'checking' || status === 'starting') return '正在检查更新'
  const updating =
    status === 'available' || status === 'downloading' || status === 'downloaded' || status === 'installing'
  if (!updating) return '不需要更新'
  return percent == null ? '需要更新' : `需要更新 ${percent}%`
}

function TitleBarButton({
  label,
  className,
  onClick,
  children
}: {
  label: string
  className?: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('h-8 w-10 rounded-none hover:bg-accent', className)}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
