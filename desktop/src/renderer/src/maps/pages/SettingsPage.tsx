import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { showToast } from '@/maps/components/ui/toast'
import { api } from '@/maps/services/api'
import type { AppSettings, DedupMode } from '@/maps/types'
import type { ReactNode } from 'react'
import { useState } from 'react'

/**
 * 设置页：超时、去重、地图代理、缓存清理。
 * 「启用代理」勾选后立即持久化，启动时地图按已保存配置走代理。
 */
export function SettingsPage({
  settings,
  onChange
}: {
  settings: AppSettings
  onChange: (next: AppSettings) => void
}): React.ReactElement {
  const [busy, setBusy] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    message: string
    exitIp?: string | null
    country?: string | null
    region?: string | null
    city?: string | null
    timezone?: string | null
  } | null>(null)

  /**
   * 合并部分设置字段（仅改内存，需保存才落库）。
   * @param next 局部更新
   */
  function patch(next: Partial<AppSettings>): void {
    onChange({ ...settings, ...next })
  }

  /**
   * 将设置写入数据库（代理指纹变化会关闭旧地图窗口，下次打开搜索页重建）。
   * @param next 完整设置
   */
  async function persist(next: AppSettings): Promise<void> {
    if (next.mapsProxyEnabled && !next.mapsProxyHost.trim()) {
      throw new Error('已启用代理，请填写主机地址')
    }
    await api.saveSettings(next)
    onChange(next)
  }

  /**
   * 保存当前设置到数据库。
   */
  async function save(): Promise<void> {
    setBusy('save')
    try {
      await persist(settings)
      await api.addLog('info', '设置已保存')
      showToast(
        settings.mapsProxyEnabled
          ? '设置已保存；请回到搜索页，地图将按代理重建'
          : '设置已保存',
        'success'
      )
    } catch (error) {
      showToast(`保存失败：${String(error)}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  /**
   * 切换「启用代理」并立即持久化，保证下次启动生效。
   * @param enabled 是否启用
   */
  async function toggleProxyEnabled(enabled: boolean): Promise<void> {
    const next = { ...settings, mapsProxyEnabled: enabled }
    onChange(next)
    setBusy('proxy-toggle')
    try {
      await persist(next)
      await api.addLog('info', enabled ? '已启用地图代理并保存' : '已关闭地图代理并保存')
      showToast(
        enabled ? '已启用代理并保存，搜索页地图将走此代理' : '已关闭代理并保存',
        'success'
      )
    } catch (error) {
      onChange(settings)
      showToast(`保存失败：${String(error)}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  /**
   * 清空全局去重缓存。
   */
  async function clearGlobalDedup(): Promise<void> {
    setBusy('dedup')
    try {
      const n = await api.clearDedupCache('global')
      await api.addLog('info', `已清空全局去重 ${n} 条`)
      showToast(`已清空全局去重 ${n} 条`, 'success')
    } catch (error) {
      showToast(`清除去重失败：${String(error)}`, 'error')
      await api.addLog('error', `清除去重失败: ${String(error)}`)
    } finally {
      setBusy(null)
    }
  }

  /**
   * 代理检测：经代理查出口 IP、归属地、时区（与指纹浏览器一致）。
   */
  async function testProxy(): Promise<void> {
    setBusy('proxy')
    setTestResult(null)
    try {
      if (!settings.mapsProxyHost.trim()) {
        showToast('请填写代理主机', 'error')
        return
      }
      const result = await api.testMapsProxy({ ...settings })
      setTestResult({
        ok: result.ok,
        message: result.message,
        exitIp: result.exitIp,
        country: result.country,
        region: result.region,
        city: result.city,
        timezone: result.timezone
      })
      if (result.ok) {
        showToast(result.message, 'success')
        await api.addLog('info', `代理检测成功: ${result.message}`)
      } else {
        showToast(result.message, 'error')
        await api.addLog('warn', `代理检测失败: ${result.message}`)
      }
    } catch (error) {
      showToast(`代理检测失败：${String(error)}`, 'error')
      await api.addLog('error', `代理检测异常: ${String(error)}`)
    } finally {
      setBusy(null)
    }
  }

  /**
   * 清理地图子 WebView 浏览缓存。
   */
  async function clearMapsCache(): Promise<void> {
    setBusy('cache')
    try {
      await api.clearMapsWebviewCache()
      await api.addLog('info', '已请求清理地图网页缓存')
      showToast('已清理地图网页缓存', 'success')
    } catch (error) {
      showToast(`清理缓存失败：${String(error)}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const proxyOn = !!settings.mapsProxyEnabled

  return (
    <div className="h-full space-y-3 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 shadow-sm">
      <h2 className="text-sm font-semibold">设置</h2>

      <Field label="搜索无结果超时（秒）">
        <Input
          type="number"
          value={settings.resultTimeoutSec}
          onChange={(e) => patch({ resultTimeoutSec: Number(e.target.value) || 30 })}
        />
      </Field>

      <Field label="官网邮箱检测超时（秒）">
        <Input
          type="number"
          value={settings.emailTimeoutSec}
          onChange={(e) => patch({ emailTimeoutSec: Number(e.target.value) || 15 })}
        />
      </Field>

      <Field label="邮箱窗口并发上限">
        <Input
          type="number"
          value={settings.emailConcurrency}
          onChange={(e) => patch({ emailConcurrency: Number(e.target.value) || 10 })}
        />
      </Field>

      <Field label="地图网页缓存清理间隔（分钟）">
        <Input
          type="number"
          value={settings.mapsCacheClearMinutes}
          onChange={(e) => patch({ mapsCacheClearMinutes: Number(e.target.value) || 30 })}
        />
      </Field>

      <Field label="去重模式">
        <select
          className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
          value={settings.dedupMode}
          onChange={(e) => patch({ dedupMode: e.target.value as DedupMode })}
        >
          <option value="global">全局去重</option>
          <option value="task">按任务去重</option>
        </select>
      </Field>

      <section className="space-y-2 rounded-md border border-[var(--border)] bg-[#f8fafb] p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold">地图调试</h3>
            <p className="text-[10px] text-[var(--muted-foreground)]">
              打开地图子 WebView 的开发者工具
            </p>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <input
              type="checkbox"
              checked={!!settings.mapsDebugMode}
              onChange={(e) => patch({ mapsDebugMode: e.target.checked })}
            />
            地图调试模式
          </label>
        </div>
        <Button
          className="h-8 text-xs"
          variant="secondary"
          disabled={!!busy || !settings.mapsDebugMode}
          onClick={() =>
            void api
              .openMapsDevtools()
              .then(() => showToast('已打开地图调试窗口 / DevTools', 'success'))
              .catch((error) => showToast(String(error), 'error'))
          }
        >
          打开地图调试工具
        </Button>
      </section>

      <section className="space-y-2 rounded-md border border-[var(--border)] bg-[#f8fafb] p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold">地图代理</h3>
            <p className="text-[10px] text-[var(--muted-foreground)]">
              地图与官网邮箱采集都经此代理出网。勾选启用会立即保存。
            </p>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <input
              type="checkbox"
              checked={proxyOn}
              disabled={!!busy}
              onChange={(e) => void toggleProxyEnabled(e.target.checked)}
            />
            启用代理
          </label>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="代理类型">
            <select
              className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
              value={settings.mapsProxyType}
              onChange={(e) =>
                patch({ mapsProxyType: e.target.value === 'http' ? 'http' : 'socks5' })
              }
            >
              <option value="socks5">SOCKS5</option>
              <option value="http">HTTP</option>
            </select>
          </Field>
          <Field label="主机">
            <Input
              value={settings.mapsProxyHost}
              placeholder="IP 或域名，也可粘贴 主机:端口:账号:密码"
              onChange={(e) => patch({ mapsProxyHost: e.target.value })}
            />
          </Field>
          <Field label="端口">
            <Input
              type="number"
              value={settings.mapsProxyPort || ''}
              placeholder="主机栏含端口时可留空"
              onChange={(e) => patch({ mapsProxyPort: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label="账号">
            <Input
              value={settings.mapsProxyUsername}
              autoComplete="off"
              onChange={(e) => patch({ mapsProxyUsername: e.target.value })}
            />
          </Field>
          <Field label="密码">
            <Input
              type="password"
              value={settings.mapsProxyPassword}
              autoComplete="off"
              onChange={(e) => patch({ mapsProxyPassword: e.target.value })}
            />
          </Field>
        </div>

        <p className="text-[10px] text-[var(--muted-foreground)]">
          先填代理信息并点「代理检测」，通过后再勾选启用。改完账密后请点「保存设置」。
        </p>

        <Button
          className="h-8 text-xs"
          variant="secondary"
          disabled={!!busy || !settings.mapsProxyHost.trim()}
          onClick={() => void testProxy()}
        >
          {busy === 'proxy' ? '检测中…' : '代理检测'}
        </Button>

        {testResult ? (
          <div
            className={`rounded border p-2 text-[11px] leading-relaxed ${
              testResult.ok
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-red-200 bg-red-50 text-red-800'
            }`}
          >
            <p className="whitespace-pre-wrap">{testResult.message}</p>
            {testResult.ok ? (
              <div className="mt-1 space-y-0.5 opacity-90">
                {testResult.exitIp ? <p>IP地址: {testResult.exitIp}</p> : null}
                {(testResult.country || testResult.region || testResult.city) && (
                  <p>
                    归属地:{' '}
                    {[testResult.country, testResult.region, testResult.city]
                      .filter(Boolean)
                      .join(' ')}
                  </p>
                )}
                {testResult.timezone ? <p>时区: {testResult.timezone}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap gap-2">
        <Button className="h-8 text-xs" disabled={!!busy} onClick={() => void save()}>
          {busy === 'save' ? '保存中…' : '保存设置'}
        </Button>
        <Button
          className="h-8 text-xs"
          variant="secondary"
          disabled={!!busy}
          onClick={() => void clearGlobalDedup()}
        >
          {busy === 'dedup' ? '清理中…' : '清空全局去重'}
        </Button>
        <Button
          className="h-8 text-xs"
          variant="secondary"
          disabled={!!busy}
          onClick={() => void clearMapsCache()}
        >
          {busy === 'cache' ? '清理中…' : '清理地图缓存'}
        </Button>
      </div>
    </div>
  )
}

/**
 * 带标签的表单行。
 * @param label 标签
 * @param children 控件
 */
function Field({ label, children }: { label: string; children: ReactNode }): React.ReactElement {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-[var(--muted-foreground)]">{label}</span>
      {children}
    </label>
  )
}
