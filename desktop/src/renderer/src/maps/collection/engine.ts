import { listen, type UnlistenFn } from '@/maps/services/events'
import { api, type BusinessInput } from '@/maps/services/api'
import { EMAIL_PAGE_PROBE, MAPS_SCRAPER_BOOTSTRAP } from '@/maps/inject/scripts'
import { businessNamesMatch, mapsPlaceKey } from '@/maps/lib/utils'
import type { AppSettings, ScrapedBusiness } from '@/maps/types'

export type CollectorStatus =
  | 'idle'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'waiting_human'
  | 'completed'

interface QueueItem {
  keyword: string
  location: string
  url: string
}

interface EmailJob {
  businessId: number
  website: string
}

/**
 * 采集编排器：关键词×地点队列、地图滚动、邮箱窗口（最多 N 个）排队。
 * 详情处理期间暂停列表滚动，避免切卡片过快导致串数据。
 */
export class CollectionEngine {
  private status: CollectorStatus = 'idle'
  private detailText = '待命'
  /** 用户点了停止。循环和邮箱窗口都要立刻收掉。 */
  private halt = false
  /** 每开始或停止一次就加一，旧循环发现对不上就退出。 */
  private runId = 0
  private pauseAfterCurrent = false
  private queue: QueueItem[] = []
  private index = 0
  private taskId = 0
  private settings: AppSettings | null = null
  private emailQueue: EmailJob[] = []
  private activeEmails = new Map<string, number>()
  /** 已处理地点键（placeId / url / name） */
  private seenPlaceKeys = new Set<string>()
  private unlisteners: UnlistenFn[] = []
  private waitHumanResolve: (() => void) | null = null
  private detailWaiter: ((detail: ScrapedBusiness | null) => void) | null = null
  private batchRunning = false
  private batchQueue: ScrapedBusiness[][] = []

  onStatus?: (status: CollectorStatus, detail: string) => void
  onStats?: () => void
  private statsListeners = new Set<() => void>()

  /**
   * 当前状态。
   * @returns 采集状态枚举
   */
  getStatus(): CollectorStatus {
    return this.status
  }

  /**
   * 当前状态说明。切回搜索页时用来恢复「任务还在跑」。
   * @returns 说明文字
   */
  getDetail(): string {
    return this.detailText
  }

  /**
   * 正在采集的任务。没有则返回 null。
   * @returns 任务 ID
   */
  getTaskId(): number | null {
    return this.taskId || null
  }

  /**
   * 开始一批采集。
   * @param taskId 任务 ID
   * @param queue 搜索队列
   * @param settings 运行参数
   */
  async start(taskId: number, queue: QueueItem[], settings: AppSettings): Promise<void> {
    if (this.status === 'running' || this.status === 'pausing') return
    this.taskId = taskId
    this.queue = queue
    this.index = 0
    this.settings = settings
    this.runId += 1
    const runId = this.runId
    this.halt = false
    this.pauseAfterCurrent = false
    this.seenPlaceKeys.clear()
    this.emailQueue = []
    this.batchQueue = []
    this.batchRunning = false
    await this.bindEvents()
    this.setStatus('running', `开始采集，共 ${queue.length} 条 URL`)
    await api.updateTaskStatus(taskId, 'running')
    void this.loop(runId)
  }

  /**
   * 立刻停止本轮采集，并关掉已经打开的商家网站窗口。
   * @returns 停止完成
   */
  async stop(): Promise<void> {
    this.runId += 1
    this.halt = true
    this.pauseAfterCurrent = false
    this.emailQueue = []
    if (this.waitHumanResolve) {
      this.waitHumanResolve()
      this.waitHumanResolve = null
    }
    const labels = [...this.activeEmails.keys()]
    this.activeEmails.clear()
    for (const label of labels) {
      await api.closeWebview(label).catch(() => undefined)
    }
    await api.closeAllEmailWindows().catch(() => undefined)
    this.status = 'idle'
    this.detailText = '已停止采集，网站窗口已关闭'
    this.onStatus?.('idle', this.detailText)
    await api.addLog('info', '已停止采集，网站窗口已关闭')
    if (this.taskId) await api.updateTaskStatus(this.taskId, 'paused').catch(() => undefined)
  }

  /**
   * 请求暂停：当前 URL 采完后再停。
   */
  requestPause(): void {
    if (this.status !== 'running') return
    this.pauseAfterCurrent = true
    this.setStatus('pausing', '将在当前 URL 采完后暂停')
  }

  /**
   * 从暂停或等人处理状态继续。
   */
  async resume(): Promise<void> {
    if (this.status === 'waiting_human' && this.waitHumanResolve) {
      this.waitHumanResolve()
      this.waitHumanResolve = null
      return
    }
    if (this.status !== 'paused') return
    this.runId += 1
    const runId = this.runId
    this.halt = false
    this.pauseAfterCurrent = false
    this.setStatus('running', '继续采集')
    await api.updateTaskStatus(this.taskId, 'running')
    void this.loop(runId)
  }

  /**
   * 人机验证等处理完成后调用。
   */
  continueAfterHuman(): void {
    if (this.status === 'waiting_human' && this.waitHumanResolve) {
      this.waitHumanResolve()
      this.waitHumanResolve = null
    }
  }

  /**
   * 订阅「每保存/更新一条商家」后的刷新通知。
   * @param listener 无参回调
   * @returns 取消订阅函数
   */
  subscribeStats(listener: () => void): () => void {
    this.statsListeners.add(listener)
    return () => {
      this.statsListeners.delete(listener)
    }
  }

  /**
   * 通知界面立刻刷新统计与结果列表。
   */
  private emitStats(): void {
    this.onStats?.()
    for (const listener of this.statsListeners) {
      try {
        listener()
      } catch {
        /* 单个监听失败不影响采集 */
      }
    }
  }

  private setStatus(status: CollectorStatus, detail: string): void {
    this.status = status
    this.detailText = detail
    this.onStatus?.(status, detail)
    void api.addLog(status === 'waiting_human' ? 'warn' : 'info', detail)
  }

  private async bindEvents(): Promise<void> {
    await this.unbindEvents()
    this.unlisteners.push(
      await listen<{ type: string }>('maps-blocker', async (event) => {
        await this.handleBlocker(event.payload.type)
      }),
      await listen<{ items: ScrapedBusiness[] }>('maps-batch', async (event) => {
        await this.handleBatch(event.payload.items || [])
      }),
      await listen<ScrapedBusiness>('maps-detail', (event) => {
        const waiter = this.detailWaiter
        this.detailWaiter = null
        waiter?.(event.payload)
      }),
      await listen<{ businessId: number; email: string }>('email-found', async (event) => {
        await this.handleEmailFound(event.payload.businessId, event.payload.email)
      }),
      await listen<{ businessId: number }>('email-timeout', async (event) => {
        await this.handleEmailDone(event.payload.businessId)
      })
    )
  }

  private async unbindEvents(): Promise<void> {
    for (const off of this.unlisteners) off()
    this.unlisteners = []
    if (this.detailWaiter) {
      this.detailWaiter(null)
      this.detailWaiter = null
    }
  }

  private async handleBlocker(type: string): Promise<void> {
    this.setStatus('waiting_human', `检测到拦截（${type}），请在地图窗口处理后点继续`)
    await api.updateTaskStatus(this.taskId, 'waiting_human')
    await new Promise<void>((resolve) => {
      this.waitHumanResolve = resolve
    })
    this.setStatus('running', '已继续，恢复采集')
    await api.updateTaskStatus(this.taskId, 'running')
  }

  /**
   * 生成会话内去重键。
   * @param item 卡片
   * @returns 去重键
   */
  private itemKey(item: ScrapedBusiness): string {
    return (
      item.placeKey || mapsPlaceKey(item.mapsUrl) || item.mapsUrl || item.name.trim().toLowerCase()
    )
  }

  private async handleBatch(items: ScrapedBusiness[]): Promise<void> {
    this.batchQueue.push(items)
    if (this.batchRunning) return
    this.batchRunning = true
    try {
      while (this.batchQueue.length > 0) {
        const next = this.batchQueue.shift() || []
        await this.processBatchItems(next)
      }
    } finally {
      this.batchRunning = false
    }
  }

  /**
   * 是否仍在处理详情/批次（列表滚动应等待）。
   * @returns 忙碌中
   */
  private isDetailBusy(): boolean {
    return this.batchRunning || this.batchQueue.length > 0 || !!this.detailWaiter
  }

  /**
   * 邮箱并发窗口是否已满。
   * @returns 已满
   */
  private isEmailWindowsFull(): boolean {
    const limit = this.settings?.emailConcurrency || 10
    return this.activeEmails.size >= limit
  }

  /**
   * 邮箱窗口已满时暂停地图搜索，直到全部邮箱窗口关闭且待处理队列清空。
   */
  private async waitIfEmailWindowsFull(): Promise<void> {
    if (!this.isEmailWindowsFull()) {
      this.pumpEmailQueue()
      return
    }

    const limit = this.settings?.emailConcurrency || 10
    this.onStatus?.(
      this.status,
      `邮箱窗口已满(${this.activeEmails.size}/${limit})，暂停搜索直至全部完成`
    )
    await api.addLog(
      'info',
      `邮箱窗口已满(${this.activeEmails.size}/${limit})，暂停搜索直至全部完成`
    )

    while (this.activeEmails.size > 0 || this.emailQueue.length > 0) {
      if (this.halt || this.getStatus() === 'paused') return
      while (this.getStatus() === 'waiting_human') {
        await sleep(500)
      }
      this.pumpEmailQueue()
      await sleep(500)
    }

    if (this.status === 'running' || this.status === 'pausing') {
      this.onStatus?.(this.status, '邮箱窗口已清空，继续搜索')
      await api.addLog('info', '邮箱窗口已清空，继续搜索')
    }
  }

  /**
   * 等待当前批次详情全部处理完。
   */
  private async waitUntilBatchIdle(): Promise<void> {
    while (this.isDetailBusy()) {
      await sleep(400)
    }
  }

  /**
   * 逐条打开详情并入库；详情未对齐时不采电话/网站，避免串店。
   * @param items 列表卡片
   */
  private async processBatchItems(items: ScrapedBusiness[]): Promise<void> {
    if (!this.settings) return
    for (const item of items) {
      if (!item.name) continue

      // 邮箱窗口满则停搜，等窗口全部结束后再开下一家
      await this.waitIfEmailWindowsFull()
      if (this.getStatus() === 'paused') return

      const key = this.itemKey(item)
      if (this.seenPlaceKeys.has(key)) continue
      this.seenPlaceKeys.add(key)

      let detail: ScrapedBusiness = item
      if (item.mapsUrl) {
        try {
          // 用脚本返回值取详情，不依赖 maps-detail 事件（事件通道断了也会继续）
          const extracted = (await api.evalMapsJs(
            `window.__gmapsOpenPlaceAndExtract(${JSON.stringify(item.mapsUrl)}, ${JSON.stringify(item.name)})`
          )) as ScrapedBusiness | null
          if (
            extracted &&
            extracted.matched !== false &&
            businessNamesMatch(extracted.name || item.name, item.name)
          ) {
            detail = {
              ...item,
              ...extracted,
              name: item.name,
              category: extracted.category || item.category,
              phone: extracted.phone || '',
              website: extracted.website || ''
            }
          } else if (extracted && extracted.matched === false) {
            await api.addLog('warn', `详情未切换到位，仅保存列表名: ${item.name}`)
          }
        } catch {
          /* 详情失败仍保存列表数据 */
        }
        await sleep(900)
      }

      const current = this.queue[this.index]
      const phone = detail.phone || null
      const website = detail.website || null
      const payload: BusinessInput = {
        taskId: this.taskId,
        keyword: current?.keyword || '',
        location: current?.location || '',
        category: detail.category || item.category || null,
        name: item.name,
        phone,
        email: null,
        website,
        mapsUrl: item.mapsUrl || detail.mapsUrl || null
      }

      const result = await api.saveBusiness(payload, this.settings.dedupMode)
      if (result.saved) {
        await api.addLog(
          'info',
          `已保存: ${payload.name}${phone ? ` · ${phone}` : ''}${website ? ` · ${website}` : ''}`
        )
        if (result.business?.website) {
          this.emailQueue.push({
            businessId: result.business.id,
            website: result.business.website
          })
          this.pumpEmailQueue()
        }
        this.emitStats()
      }
    }
  }

  private async handleEmailFound(businessId: number, email: string): Promise<void> {
    if (!this.settings) return
    await api.updateBusinessEmail(businessId, email, this.settings.dedupMode)
    await api.addLog('info', `邮箱命中 #${businessId}: ${email}`)
    await this.handleEmailDone(businessId)
    this.emitStats()
  }

  private async handleEmailDone(businessId: number): Promise<void> {
    for (const [label, id] of this.activeEmails) {
      if (id === businessId) {
        this.activeEmails.delete(label)
        await api.closeWebview(label)
        break
      }
    }
    this.pumpEmailQueue()
  }

  private pumpEmailQueue(): void {
    if (!this.settings) return
    const limit = this.settings.emailConcurrency || 10
    while (this.activeEmails.size < limit && this.emailQueue.length > 0) {
      const job = this.emailQueue.shift()!
      const label = `email-${job.businessId}`
      this.activeEmails.set(label, job.businessId)
      void this.openEmailJob(label, job)
    }
  }

  /**
   * 打开商家网站，在首页和联系页里找邮箱，然后关掉这个窗口。
   * @param label 窗口标签
   * @param job 待采集的网站
   * @returns void
   */
  private async openEmailJob(label: string, job: EmailJob): Promise<void> {
    try {
      if (this.halt) return
      await api.addLog('info', `打开网站采集邮箱: ${job.website}`)
      const email = await this.scrapeEmailFromSite(label, job)
      if (email && this.settings && !this.halt) {
        await api.updateBusinessEmail(job.businessId, email, this.settings.dedupMode)
        await api.addLog('info', `邮箱命中 #${job.businessId}: ${email}`)
        this.emitStats()
      } else if (!this.halt) {
        await api.addLog('info', `网站未找到邮箱: ${job.website}`)
      }
    } catch (error) {
      if (!this.halt) await api.addLog('error', `打开邮箱窗口失败: ${String(error)}`)
    } finally {
      await api.closeWebview(label).catch(() => undefined)
      this.activeEmails.delete(label)
      if (!this.halt) this.pumpEmailQueue()
    }
  }

  /**
   * 依次打开首页、/contact、/contact-us，读到邮箱就返回。
   * @param label 窗口标签
   * @param website 商家网站
   * @returns 邮箱或 null
   */
  private async scrapeEmailFromSite(label: string, job: EmailJob): Promise<string | null> {
    const timeoutMs = (this.settings?.emailTimeoutSec || 15) * 1000
    for (const url of emailPageUrls(job.website)) {
      if (this.halt) return null
      await api.openEmailWindow(label, url)
      await sleep(1200)
      const found = await this.pollEmail(label, timeoutMs)
      if (found) return found
    }
    return null
  }

  /**
   * 在当前网页上反复找邮箱，直到找到或超时。
   * @param label 窗口标签
   * @param timeoutMs 这一页最多等多久
   * @returns 邮箱或 null
   */
  private async pollEmail(label: string, timeoutMs: number): Promise<string | null> {
    const started = Date.now()
    while (!this.halt && Date.now() - started < timeoutMs) {
      await sleep(800)
      if (this.halt) return null
      try {
        const found = await api.evalEmailJs(label, EMAIL_PAGE_PROBE)
        const email = String(found || '').trim()
        if (email.includes('@')) return email
      } catch (error) {
        const message = String(error)
        if (/不存在|已关闭/.test(message)) return null
      }
    }
    return null
  }

  private async loop(runId: number): Promise<void> {
    while (this.index < this.queue.length) {
      if (this.runId !== runId || this.halt || this.status === 'paused') return

      const item = this.queue[this.index]
      this.setStatus(
        'running',
        `采集 (${this.index + 1}/${this.queue.length}) ${item.keyword} @ ${item.location}`
      )
      await api.openMapsWindow(item.url)
      await sleep(3500)
      await api.evalMapsJs(MAPS_SCRAPER_BOOTSTRAP)

      const timeoutMs = (this.settings?.resultTimeoutSec || 30) * 1000
      const started = Date.now()
      let idleRounds = 0
      let lastCount = this.seenPlaceKeys.size
      let ended = false
      let needScroll = false
      let lastTick: { count?: number; host?: boolean; placeLinks?: number; feed?: boolean } | null =
        null

      while (!ended) {
        while (this.getStatus() === 'waiting_human') {
          await sleep(500)
        }
        if (this.runId !== runId || this.halt || this.getStatus() === 'paused') return

        // 详情处理中绝不滚动/扫描，避免列表切太快
        await this.waitUntilBatchIdle()
        // 邮箱窗口满则停搜，等窗口全部没了再继续列表
        await this.waitIfEmailWindowsFull()
        if (this.runId !== runId || this.halt || this.getStatus() === 'paused') return

        try {
          const tick = (await api.evalMapsJs(
            `(async () => {
              if (typeof window.__gmapsScrapeTick !== 'function') return { missing: true };
              return await window.__gmapsScrapeTick(${JSON.stringify({ scroll: needScroll })});
            })()`
          )) as {
            missing?: boolean
            items?: ScrapedBusiness[]
            count?: number
            host?: boolean
            placeLinks?: number
            feed?: boolean
          } | null
          if (tick?.missing) {
            await api.evalMapsJs(MAPS_SCRAPER_BOOTSTRAP)
          } else if (tick) {
            lastTick = tick
            // 事件通道和返回值都会进批次；已见过的地点会被跳过
            if (tick.items?.length) await this.handleBatch(tick.items)
          }
        } catch (error) {
          await api.addLog('warn', `注入执行失败: ${String(error)}`)
        }

        // 给 maps-batch 事件一点到达时间，再等详情队列清空
        await sleep(600)
        await this.waitUntilBatchIdle()

        // 本轮可见卡片处理完后再滚动加载更多
        needScroll = true
        await sleep(1800)

        if (this.seenPlaceKeys.size === lastCount) idleRounds += 1
        else {
          idleRounds = 0
          lastCount = this.seenPlaceKeys.size
        }

        if (this.seenPlaceKeys.size === 0 && Date.now() - started > timeoutMs) {
          const why =
            lastTick?.placeLinks && lastTick.placeLinks > 0
              ? `页面有 ${lastTick.placeLinks} 个地点链接，但没有进入详情`
              : lastTick?.feed === false
                ? '结果列表还没出现'
                : '页面上没有可采集的地点'
          await api.addLog('warn', `超时无结果，跳过: ${item.url}（${why}）`)
          ended = true
        }
        if (idleRounds >= 5 && this.seenPlaceKeys.size > 0) {
          ended = true
        }
        if (Date.now() - started > timeoutMs * 30) {
          ended = true
        }
      }

      // 进入下一条搜索 URL 前，若邮箱窗口仍满则先等清完
      await this.waitIfEmailWindowsFull()
      if (this.getStatus() === 'paused') return

      this.index += 1
      if (this.pauseAfterCurrent) {
        this.pauseAfterCurrent = false
        this.setStatus('paused', '已暂停')
        await api.updateTaskStatus(this.taskId, 'paused')
        return
      }
    }

    while (this.emailQueue.length > 0 || this.activeEmails.size > 0) {
      this.pumpEmailQueue()
      await sleep(1000)
    }

    this.setStatus('completed', '本轮采集完成')
    await api.updateTaskStatus(this.taskId, 'completed')
    await this.unbindEvents()
  }
}

/**
 * @param ms 毫秒
 * @returns Promise
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 商家网站上要打开的页面：首页，以及常见联系页。
 * @param website 官网地址
 * @returns 地址列表
 */
function emailPageUrls(website: string): string[] {
  const pages = [website]
  try {
    const origin = new URL(website).origin
    pages.push(`${origin}/contact`, `${origin}/contact-us`)
  } catch {
    /* 地址不完整时只打开原链接 */
  }
  return pages
}

export const collectionEngine = new CollectionEngine()
