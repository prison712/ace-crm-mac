import { LocationPicker } from '@/maps/components/location/LocationPicker'
import { Textarea } from '@/maps/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { collectionEngine, type CollectorStatus } from '@/maps/collection/engine'
import { api } from '@/maps/services/api'
import {
  ensureMapsChild,
  measureHostBounds,
  setMapsVisible,
  syncMapsBounds
} from '@/maps/services/maps-host'
import type { AppSettings, SelectedLocation, TaskRow } from '@/maps/types'
import { buildSearchQueue, parseKeywordInput } from '@/maps/lib/utils'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 搜索页：紧凑控制区 + 主窗口内嵌地图子 WebView 宿主。
 */
export function SearchPage({
  settings,
  settingsReady = true,
  onTaskChange,
  active
}: {
  settings: AppSettings
  /** 设置已从数据库加载完成后再创建地图，保证启用代理时首屏就走代理 */
  settingsReady?: boolean
  onTaskChange: (task: TaskRow | null) => void
  active: boolean
}): React.ReactElement {
  const [keywordsText, setKeywordsText] = useState('restaurant')
  const [locations, setLocations] = useState<SelectedLocation[]>([])
  const [status, setStatus] = useState<CollectorStatus>('idle')
  const [detail, setDetail] = useState('待命')
  const [task, setTask] = useState<TaskRow | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const taskIdRef = useRef<number | null>(null)
  const activeRef = useRef(active)

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    taskIdRef.current = task?.id ?? null
  }, [task?.id])

  useEffect(() => {
    collectionEngine.onStatus = (next, message) => {
      setStatus(next)
      setDetail(message)
    }
    setStatus(collectionEngine.getStatus())
    setDetail(collectionEngine.getDetail())
    const runningTaskId = collectionEngine.getTaskId()
    if (runningTaskId) void refreshTask(runningTaskId)
  }, [])

  useEffect(() => {
    if (!active) return
    setStatus(collectionEngine.getStatus())
    setDetail(collectionEngine.getDetail())
    const runningTaskId = collectionEngine.getTaskId()
    if (runningTaskId) void refreshTask(runningTaskId)
  }, [active])

  /**
   * 按任务 ID 拉取最新统计（手机/邮箱/网站计数）。
   * @param id 任务 ID
   */
  async function refreshTask(id: number): Promise<void> {
    const latest = await api.getTask(id)
    setTask(latest)
    onTaskChange(latest)
  }

  useEffect(() => {
    return collectionEngine.subscribeStats(() => {
      const id = taskIdRef.current
      if (id) void refreshTask(id)
    })
  }, [onTaskChange])

  /**
   * 地点浮层打开时暂时隐藏地图子 WebView，避免原生层盖住下拉。
   * @param open 是否打开
   */
  const handleLocationOpenChange = useCallback((open: boolean) => {
    if (!activeRef.current) return
    void setMapsVisible(!open).catch(() => undefined)
  }, [])

  /**
   * 同步宿主区域到子 WebView；仅搜索标签激活且设置已加载时显示。
   * 代理相关设置变化时重建（后端按库内指纹关闭旧实例）。
   */
  useEffect(() => {
    if (!active || !settingsReady) {
      void setMapsVisible(false).catch(() => undefined)
      return
    }

    const host = hostRef.current
    if (!host) return

    let cancelled = false

    const sync = (): void => {
      if (cancelled || !activeRef.current) return
      const bounds = measureHostBounds(host)
      if (bounds.width < 40 || bounds.height < 40) return
      void syncMapsBounds(bounds).catch(() => undefined)
    }

    const boot = async (): Promise<void> => {
      await setMapsVisible(true).catch(() => undefined)
      if (cancelled || !activeRef.current) {
        await setMapsVisible(false).catch(() => undefined)
        return
      }
      const bounds = measureHostBounds(host)
      if (bounds.width < 40 || bounds.height < 40) return
      try {
        await ensureMapsChild(bounds, 'https://www.google.com/maps')
        if (cancelled || !activeRef.current) {
          await setMapsVisible(false).catch(() => undefined)
          return
        }
        await syncMapsBounds(bounds).catch(() => undefined)
      } catch (error) {
        const msg = String(error)
        if (msg.toLowerCase().includes('already exists')) {
          await syncMapsBounds(bounds).catch(() => undefined)
          return
        }
        await api.addLog('warn', `创建地图子 WebView 失败: ${msg}`)
      }
    }

    void boot()
    const ro = new ResizeObserver(sync)
    ro.observe(host)
    window.addEventListener('resize', sync)
    return () => {
      cancelled = true
      ro.disconnect()
      window.removeEventListener('resize', sync)
      void setMapsVisible(false).catch(() => undefined)
    }
  }, [
    active,
    settingsReady,
    settings.mapsProxyEnabled,
    settings.mapsProxyType,
    settings.mapsProxyHost,
    settings.mapsProxyPort,
    settings.mapsProxyUsername,
    settings.mapsProxyPassword
  ])

  async function handleStart(): Promise<void> {
    const keywords = parseKeywordInput(keywordsText)
    const locationLabels = locations.map((item) => item.label)
    if (keywords.length === 0) {
      await api.addLog('warn', '请至少填写一个关键词')
      return
    }
    if (locationLabels.length === 0) {
      await api.addLog('warn', '请至少选择一个地点')
      return
    }

    const host = hostRef.current
    if (host) {
      try {
        await ensureMapsChild(measureHostBounds(host), 'https://www.google.com/maps')
      } catch (error) {
        await api.addLog('error', `地图子 WebView 不可用: ${String(error)}`)
        return
      }
    }

    if (status === 'pausing' || status === 'paused' || status === 'waiting_human') {
      await collectionEngine.stop()
    }

    const queue = buildSearchQueue(keywords, locationLabels)
    const created = await api.createTask(keywords, locationLabels)
    setTask(created)
    onTaskChange(created)
    await collectionEngine.start(created.id, queue, settings)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <section className="relative z-30 shrink-0 overflow-visible rounded-lg border border-[var(--border)] bg-[var(--card)] p-2.5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">搜索</h2>
          <span className="rounded bg-[var(--accent)] px-1.5 py-0.5 text-[10px]">{status}</span>
          <span className="truncate text-[11px] text-[var(--muted-foreground)]">{detail}</span>
          <div className="ml-auto flex items-center gap-3 text-[11px]">
            <span>手机 {task?.phoneCount ?? 0}</span>
            <span>邮箱 {task?.emailCount ?? 0}</span>
            <span>网站 {task?.websiteCount ?? 0}</span>
          </div>
        </div>

        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]">
          <div>
            <label className="mb-0.5 block text-[11px] text-[var(--muted-foreground)]">
              关键词（多行/逗号）
            </label>
            <Textarea
              rows={3}
              className="min-h-[68px] text-xs"
              value={keywordsText}
              onChange={(e) => setKeywordsText(e.target.value)}
              placeholder={'restaurant\ncafe'}
            />
          </div>
          <div className="relative z-40 min-w-0">
            <label className="mb-0.5 block text-[11px] text-[var(--muted-foreground)]">
              地点（勾选国家/州可级联全选）
            </label>
            <LocationPicker
              value={locations}
              onChange={setLocations}
              onOpenChange={handleLocationOpenChange}
            />
          </div>
          <div className="flex flex-col justify-end gap-1.5">
            <Button
              className="h-8 text-xs"
              onClick={() => void handleStart()}
              disabled={status === 'running'}
            >
              开始
            </Button>
            <Button
              className="h-8 text-xs"
              variant="secondary"
              onClick={() => collectionEngine.requestPause()}
              disabled={status !== 'running'}
            >
              暂停
            </Button>
            <Button
              className="h-8 text-xs"
              variant="secondary"
              onClick={() => void collectionEngine.stop()}
              disabled={status === 'idle' || status === 'completed'}
            >
              停止
            </Button>
            <Button
              className="h-8 text-xs"
              variant="secondary"
              onClick={() => void collectionEngine.resume()}
              disabled={status !== 'paused' && status !== 'waiting_human'}
            >
              继续
            </Button>
            {status === 'waiting_human' && (
              <Button className="h-8 text-xs" onClick={() => collectionEngine.continueAfterHuman()}>
                已过人机验证
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-[var(--border)] bg-[#e8ecef]">
        <div className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-black/45 px-1.5 py-0.5 text-[10px] text-white">
          地图子 WebView
        </div>
        <div ref={hostRef} className="h-full w-full" />
      </section>
    </div>
  )
}
