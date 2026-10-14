import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/context/I18nContext'
import {
  getPlatform,
  movePlatformInOrder,
  orderedMessagingPlatforms,
  TOOL_PLATFORMS
} from '@/lib/platforms'
import type { SocialPlatformId, TranslationProvider, UserSettings } from '@/lib/types'
import { useApp } from '@/store/AppProvider'

const PROVIDERS: { id: TranslationProvider; label: string }[] = [
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'deepseek', label: 'DeepSeek' }
]

interface UserSettingsPanelProps {
  inviteCode?: string | null
  onLogout: () => void
}

interface UpdateSnapshot {
  packageVersion: string
  lastStatus?: string
  lastRemoteVersion?: string | null
  lastPercent?: number | null
  lastCheck: { action: string; remoteVersion?: string } | null
}

/**
 * 把更新检查结果收成两句话：正在更新或不必更新，版本是最新或写出本地和远程号。
 * @param info 主进程返回的更新快照
 * @returns 状态文案和版本文案
 */
function describeUpdate(info: UpdateSnapshot): { statusLabel: string; versionLabel: string } {
  const status = info.lastStatus || info.lastCheck?.action || 'idle'
  const local = info.packageVersion || ''
  const remote = info.lastRemoteVersion || info.lastCheck?.remoteVersion || ''
  const updating = ['checking', 'starting', 'available', 'downloading', 'downloaded', 'installing'].includes(
    status
  )
  const same = !remote || remote === local
  const percent =
    typeof info.lastPercent === 'number' && Number.isFinite(info.lastPercent)
      ? Math.max(0, Math.min(100, Math.round(info.lastPercent)))
      : null
  return {
    statusLabel: updating ? (percent == null ? '正在更新' : `正在更新 ${percent}%`) : '不需要更新',
    versionLabel: same ? '最新' : `本地 ${local}，远程 ${remote}`
  }
}

export function UserSettingsPanel({
  inviteCode,
  onLogout
}: UserSettingsPanelProps): React.JSX.Element {
  const { t } = useI18n()
  const { updateUser, closeSettings, state } = useApp()
  const user = state.user

  const [backendDraft, setBackendDraft] = useState('')
  const [testModeEnabled, setTestModeEnabled] = useState(false)
  const [savedHint, setSavedHint] = useState('')
  const [updateStatus, setUpdateStatus] = useState('不需要更新')
  const [updateVersion, setUpdateVersion] = useState('最新')

  /**
   * 读取当前更新快照并写成简短状态。
   * @returns void
   */
  const refreshUpdateText = (): void => {
    void window.api
      .getUpdateInfo()
      .then((info) => {
        const text = describeUpdate(info)
        setUpdateStatus(text.statusLabel)
        setUpdateVersion(text.versionLabel)
      })
      .catch(() => {
        setUpdateStatus('不需要更新')
        setUpdateVersion('最新')
      })
  }

  useEffect(() => {
    void window.api.settingsGet().then((s) => {
      setBackendDraft(s.backendUrl)
      setTestModeEnabled(Boolean(s.testModeEnabled))
    })
    refreshUpdateText()
    const timer = window.setInterval(refreshUpdateText, 2000)
    const stopProgress = window.api.onUpdateProgress((info) => {
      const text = describeUpdate(info)
      setUpdateStatus(text.statusLabel)
      setUpdateVersion(text.versionLabel)
    })
    const stopSettings = window.api.onSettingsChanged((s) => {
      setBackendDraft(s.backendUrl)
      setTestModeEnabled(Boolean(s.testModeEnabled))
    })
    return () => {
      window.clearInterval(timer)
      stopProgress()
      stopSettings()
    }
  }, [])

  const patchUser = (patch: Partial<UserSettings>): void => {
    const next: UserSettings = {
      ...user,
      ...patch,
      enabledPlatforms: patch.enabledPlatforms
        ? { ...user.enabledPlatforms, ...patch.enabledPlatforms }
        : user.enabledPlatforms,
      platformOrder: patch.platformOrder ?? user.platformOrder,
      platformUrls: patch.platformUrls
        ? { ...user.platformUrls, ...patch.platformUrls }
        : user.platformUrls
    }
    // 显式删除某平台覆盖时：传入的 key 值为 '' 表示清除
    if (patch.platformUrls) {
      const urls = { ...next.platformUrls }
      for (const [id, value] of Object.entries(patch.platformUrls)) {
        if (!value?.trim()) delete urls[id as SocialPlatformId]
      }
      next.platformUrls = urls
    }
    updateUser(next)
  }

  const messagingPlatforms = useMemo(
    () => orderedMessagingPlatforms(user.platformOrder),
    [user.platformOrder]
  )

  const enabledMessagingCount = messagingPlatforms.filter(
    (p) => user.enabledPlatforms[p.id]
  ).length

  const setPlatformEnabled = (id: SocialPlatformId, enabled: boolean): void => {
    if (!enabled && id !== 'whoer' && enabledMessagingCount <= 1) return
    patchUser({
      enabledPlatforms: { ...user.enabledPlatforms, [id]: enabled }
    })
  }

  const movePlatform = (id: SocialPlatformId, delta: -1 | 1): void => {
    patchUser({
      platformOrder: movePlatformInOrder(user.platformOrder, id, delta)
    })
  }

  const setPlatformUrl = (id: SocialPlatformId, value: string): void => {
    const trimmed = value.trim()
    const defaultUrl = getPlatform(id).chatUrl
    patchUser({
      platformUrls: {
        [id]: !trimmed || trimmed === defaultUrl ? '' : trimmed
      }
    })
  }

  const platformUrlValue = (id: SocialPlatformId): string => {
    return user.platformUrls[id] ?? getPlatform(id).chatUrl
  }

  const saveBackendUrl = async (): Promise<void> => {
    await window.api.settingsSet({ backendUrl: backendDraft.trim() })
    setSavedHint(t('userSettings.saved'))
    window.setTimeout(() => setSavedHint(''), 2000)
  }

  const toggleTestMode = async (checked: boolean): Promise<void> => {
    const next = await window.api.settingsSet({ testModeEnabled: checked })
    setTestModeEnabled(Boolean(next.testModeEnabled))
    if (!checked && user.enabledPlatforms.whoer) {
      // 关闭测试模式时顺带关掉 Whoer，避免侧栏残留
      patchUser({
        enabledPlatforms: { ...user.enabledPlatforms, whoer: false }
      })
    }
  }

  const handleLogout = async (): Promise<void> => {
    await window.api.authLogout()
    onLogout()
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => void closeSettings()}
          aria-label={t('settings.back')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-sm font-semibold">{t('userSettings.title')}</h1>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-lg p-6">
          <div className="grid gap-5 text-sm">
            <section className="grid gap-3">
              <Label className="text-muted-foreground">{t('userSettings.account')}</Label>
              <div className="flex items-center justify-between gap-3 border border-border px-3 py-2">
                <div>
                  <p className="text-[11px] text-muted-foreground">当前账户</p>
                  <p className="font-mono text-sm tracking-wider">{inviteCode ?? '—'}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void handleLogout()}>
                  {t('userSettings.logout')}
                </Button>
              </div>

              <div className="grid gap-1 border border-border px-3 py-2 text-[13px]">
                <p>当前状态：{updateStatus}</p>
                <p>版本号：{updateVersion}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1 w-fit"
                  onClick={() => {
                    void window.api.checkForUpdates().then((info) => {
                      if (!info.packaged) {
                        window.alert(info.lastDetail || t('updater.latest'))
                      }
                      refreshUpdateText()
                    })
                  }}
                >
                  {t('titlebar.checkUpdate')}
                </Button>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="backend-url">{t('userSettings.backendUrl')}</Label>
                <div className="flex gap-2">
                  <Input
                    id="backend-url"
                    value={backendDraft}
                    onChange={(e) => setBackendDraft(e.target.value)}
                    placeholder="http://8.219.152.183:3088"
                  />
                  <Button type="button" onClick={() => void saveBackendUrl()}>
                    {t('userSettings.save')}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {savedHint || t('userSettings.backendUrlHint')}
                </p>
              </div>

              <div className="flex items-start justify-between gap-4 border border-border p-3">
                <div className="space-y-1">
                  <div className="text-[13px] font-medium">{t('userSettings.testMode')}</div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {t('userSettings.testModeHint')}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {testModeEnabled ? t('userSettings.on') : t('userSettings.off')}
                  </p>
                </div>
                <Switch
                  checked={testModeEnabled}
                  onCheckedChange={(v) => void toggleTestMode(v)}
                />
              </div>
            </section>

            <Separator />

            <section className="grid gap-3">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-muted-foreground">{t('userSettings.provider')}</Label>
                <span className="text-[11px] text-muted-foreground">
                  {t('userSettings.providerHint')}
                </span>
              </div>
              <select
                className="h-9 w-full border border-input bg-background px-2 text-sm"
                value={user.translationProvider}
                onChange={(e) =>
                  patchUser({
                    translationProvider: e.target.value as TranslationProvider
                  })
                }
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {user.translationProvider === p.id ? t('userSettings.current') : ''}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">{t('userSettings.providerServerHint')}</p>
            </section>

            <Separator />

            <section className="grid gap-3">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-muted-foreground">{t('userSettings.platforms')}</Label>
                <span className="text-[11px] text-muted-foreground">
                  {t('userSettings.platformsHint')}
                </span>
              </div>
              <ul className="grid gap-2">
                {messagingPlatforms.map((p, index) => {
                  const on = user.enabledPlatforms[p.id]
                  const isLastOn = on && enabledMessagingCount <= 1
                  const isFirst = index === 0
                  const isLast = index === messagingPlatforms.length - 1
                  return (
                    <li
                      key={p.id}
                      className="grid gap-2 border border-border px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="flex shrink-0 flex-col gap-0.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              disabled={isFirst}
                              onClick={() => movePlatform(p.id, -1)}
                              aria-label={`${p.name} ${t('userSettings.platformMoveUp')}`}
                              title={t('userSettings.platformMoveUp')}
                            >
                              <ChevronUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              disabled={isLast}
                              onClick={() => movePlatform(p.id, 1)}
                              aria-label={`${p.name} ${t('userSettings.platformMoveDown')}`}
                              title={t('userSettings.platformMoveDown')}
                            >
                              <ChevronDown className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          <img
                            src={p.logo}
                            alt=""
                            className="h-5 w-5 shrink-0 object-contain"
                            draggable={false}
                          />
                          <span className="truncate text-sm">{p.name}</span>
                        </div>
                        <Switch
                          checked={on}
                          disabled={isLastOn}
                          onCheckedChange={(checked) => setPlatformEnabled(p.id, checked)}
                          aria-label={`${p.name} ${
                            on ? t('userSettings.platformOn') : t('userSettings.platformOff')
                          }`}
                        />
                      </div>
                      {testModeEnabled ? (
                        <div className="grid gap-1 pl-8">
                          <div className="flex items-center justify-between gap-2">
                            <Label
                              htmlFor={`platform-url-${p.id}`}
                              className="text-[11px] text-muted-foreground"
                            >
                              {t('userSettings.platformUrl')}
                            </Label>
                            {user.platformUrls[p.id] ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-[11px]"
                                onClick={() => setPlatformUrl(p.id, '')}
                              >
                                {t('userSettings.platformUrlReset')}
                              </Button>
                            ) : null}
                          </div>
                          <Input
                            id={`platform-url-${p.id}`}
                            className="h-8 font-mono text-[11px]"
                            value={platformUrlValue(p.id)}
                            onChange={(e) => setPlatformUrl(p.id, e.target.value)}
                            placeholder={getPlatform(p.id).chatUrl}
                          />
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
              <p className="text-xs text-muted-foreground">{t('userSettings.platformsMin')}</p>
              {testModeEnabled ? (
                <p className="text-[11px] text-muted-foreground">
                  {t('userSettings.platformUrlHint')}
                </p>
              ) : null}
            </section>

            {testModeEnabled ? (
              <>
                <Separator />
                <section className="grid gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-muted-foreground">{t('userSettings.tools')}</Label>
                    <span className="text-[11px] text-muted-foreground">
                      {t('userSettings.toolsHint')}
                    </span>
                  </div>
                  <ul className="grid gap-2">
                    {TOOL_PLATFORMS.map((p) => {
                      const on = user.enabledPlatforms[p.id]
                      return (
                        <li
                          key={p.id}
                          className="grid gap-2 border border-border px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <img
                                  src={p.logo}
                                  alt=""
                                  className="h-5 w-5 shrink-0 object-contain"
                                  draggable={false}
                                />
                                <span className="truncate text-sm">{p.name}</span>
                              </div>
                              <span className="pl-7 text-[11px] text-muted-foreground">
                                {t('userSettings.whoerDesc')}
                              </span>
                            </div>
                            <Switch
                              checked={on}
                              onCheckedChange={(checked) => setPlatformEnabled(p.id, checked)}
                              aria-label={`${p.name} ${
                                on ? t('userSettings.platformOn') : t('userSettings.platformOff')
                              }`}
                            />
                          </div>
                          <div className="grid gap-1 pl-7">
                            <div className="flex items-center justify-between gap-2">
                              <Label
                                htmlFor={`platform-url-${p.id}`}
                                className="text-[11px] text-muted-foreground"
                              >
                                {t('userSettings.platformUrl')}
                              </Label>
                              {user.platformUrls[p.id] ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-[11px]"
                                  onClick={() => setPlatformUrl(p.id, '')}
                                >
                                  {t('userSettings.platformUrlReset')}
                                </Button>
                              ) : null}
                            </div>
                            <Input
                              id={`platform-url-${p.id}`}
                              className="h-8 font-mono text-[11px]"
                              value={platformUrlValue(p.id)}
                              onChange={(e) => setPlatformUrl(p.id, e.target.value)}
                              placeholder={getPlatform(p.id).chatUrl}
                            />
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              </>
            ) : null}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
