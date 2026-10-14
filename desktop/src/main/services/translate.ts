import { getCachedTranslation, putCachedTranslation } from './translateCache'
import { getSyncedAppSettings, getTabSettingsByLabel } from './syncState'
import { loadAuthState } from './auth'
import { loadSettings } from './settings'
import { emitAuthExpired } from './authEvents'
import { abortSignalTimeout, appFetch } from './http'
import { syncSocialMessage } from './socialSync'
import { getViewMetaByLabel } from './browserViews'

export interface TranslateSuccess {
  translated_text: string
  provider: string
  from_cache: boolean
}

export interface TranslateFailure {
  error: string
}

export type TranslateOutcome =
  | { ok: true; data: TranslateSuccess }
  | { ok: false; data: TranslateFailure }

type MessageDirection = 'send' | 'receive'

interface ResolvedRequest {
  text: string
  sourceLang: string
  targetLang: string
  direction: MessageDirection
  translatePrompt?: string
}

function parseMessageType(raw: string): MessageDirection {
  const s = raw.trim().toLowerCase()
  if (['send', 'sent', 'outgoing', 'out', '发送'].includes(s)) return 'send'
  if (['receive', 'received', 'incoming', 'in', '接收'].includes(s)) return 'receive'
  throw new Error(`未知消息类型 \`${raw}\`，请使用 send（发送）或 receive（接收）`)
}

function resolveRequest(
  webviewLabel: string,
  payload: {
    text?: string
    message_type?: string
    messageType?: string
    chat_id?: string
    chatId?: string
    target_side?: string
    targetSide?: string
  }
): ResolvedRequest {
  const messageType = payload.message_type ?? payload.messageType ?? ''
  const direction = parseMessageType(String(messageType))
  const tab = getTabSettingsByLabel(webviewLabel)
  const chatId = String(payload.chat_id ?? payload.chatId ?? '').trim()
  const chatPref = chatId && tab?.chatLangPrefs ? tab.chatLangPrefs[chatId] : undefined
  // 发出气泡要在页面上显示双语：上报方向仍是 send，译文语言用接收侧（默认中文）
  const sideRaw = String(payload.target_side ?? payload.targetSide ?? '').trim().toLowerCase()
  const langSide = sideRaw === 'receive' || sideRaw === 'in' || sideRaw === '接收' ? 'receive' : direction
  // 优先级：对话/客户覆盖 > 窗口默认；渲染进程约 400ms 后才 sync，未同步时用默认值
  const targetLang =
    langSide === 'send'
      ? (chatPref?.sendTargetLang?.trim() || tab?.sendTargetLang?.trim() || 'en')
      : (chatPref?.receiveTargetLang?.trim() || tab?.receiveTargetLang?.trim() || 'zh')

  return {
    text: String(payload.text ?? ''),
    sourceLang: 'auto',
    targetLang: targetLang.trim(),
    direction
  }
}

function normalizeProvider(raw: string): 'chatgpt' | 'deepseek' {
  return raw.trim().toLowerCase() === 'deepseek' ? 'deepseek' : 'chatgpt'
}

/** 经后端翻译（API Key 在服务端） */
async function runTranslation(req: ResolvedRequest, platform: string): Promise<TranslateSuccess> {
  const app = getSyncedAppSettings()
  const provider = normalizeProvider(app.translationProvider)
  const { backendUrl } = loadSettings()
  const auth = loadAuthState()
  if (!auth?.token) {
    throw new Error('未登录，无法使用翻译，请先登录')
  }

  const resp = await appFetch(`${backendUrl.replace(/\/$/, '')}/api/translate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`
    },
    body: JSON.stringify({
      text: req.text,
      source_lang: req.sourceLang,
      target_lang: req.targetLang,
      provider,
      platform,
      ...(req.translatePrompt ? { extra_prompt: req.translatePrompt } : {})
    }),
    signal: abortSignalTimeout(90_000)
  }).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e)
    if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(msg)) {
      throw new Error(
        `无法连接后端 ${backendUrl}（连接被拒绝）。请在用户设置里把后端地址改为 http://8.219.152.183:3088，并确认翻译服务可用。`
      )
    }
    throw e instanceof Error ? e : new Error(msg)
  })

  const data = (await resp.json().catch(() => ({}))) as {
    error?: string
    translated_text?: string
    provider?: string
    from_cache?: boolean
  }

  if (resp.status === 401) {
    emitAuthExpired()
    throw new Error('登录已过期，请重新登录')
  }

  if (!resp.ok || !data.translated_text) {
    const detail = (data.error || '').trim()
    if (detail) throw new Error(detail)
    throw new Error(
      resp.status === 502
        ? '翻译失败：上游 ChatGPT/DeepSeek 不可用（HTTP 502）。多为模型下架或配额用尽，请检查服务端 OPENAI_API_KEY / DEEPSEEK_API_KEY。'
        : `翻译失败 (HTTP ${resp.status})`
    )
  }

  return {
    translated_text: data.translated_text,
    provider: data.provider || provider,
    from_cache: Boolean(data.from_cache)
  }
}

export async function translateFromPayload(
  webviewLabel: string,
  payload: unknown
): Promise<TranslateOutcome> {
  try {
    if (!payload || typeof payload !== 'object') {
      return { ok: false, data: { error: '缺少翻译参数' } }
    }
    const req = resolveRequest(
      webviewLabel,
      payload as {
        text?: string
        message_type?: string
        messageType?: string
        chat_id?: string
        chatId?: string
        target_side?: string
        targetSide?: string
      }
    )
    if (!req.text.trim()) {
      return { ok: false, data: { error: '待翻译文本不能为空' } }
    }

    const extra = payload as {
      contact_name?: string
      contactName?: string
      chat_id?: string
      chatId?: string
      platform?: string
      account_id?: string
      accountId?: string
      account_name?: string
      accountName?: string
    }
    const settings = getSyncedAppSettings()
    console.log(
      `[omnitranslate] translate tab=${webviewLabel} provider=${settings.translationProvider} ${req.direction} auto -> ${req.targetLang} chars=${req.text.length}`
    )

    const meta = getViewMetaByLabel(webviewLabel)
    const tab = getTabSettingsByLabel(webviewLabel)
    const platform =
      String(extra.platform || '').trim() || meta?.groupId || 'unknown'
    const contactName = String(extra.contact_name || extra.contactName || '').trim()
    const chatId = String(extra.chat_id || extra.chatId || '').trim()
    const accountId =
      String(extra.account_id || extra.accountId || '').trim() ||
      tab?.tabId ||
      meta?.tabId ||
      ''
    const accountName =
      String(extra.account_name || extra.accountName || '').trim() ||
      String(tab?.remark || '').trim() ||
      String(tab?.title || '').trim() ||
      accountId

    let success: TranslateSuccess | null = null
    let translateError = ''
    try {
      const wantProvider = normalizeProvider(settings.translationProvider)
      const cached = getCachedTranslation(req.text, req.targetLang, wantProvider)
      success = cached
        ? {
            translated_text: cached.translatedText,
            provider: cached.provider || wantProvider,
            from_cache: true
          }
        : await runTranslation(req, platform)
      if (!cached && success) {
        putCachedTranslation(req.text, req.targetLang, success.translated_text, success.provider)
      }
    } catch (e) {
      translateError = e instanceof Error ? e.message : String(e)
      console.error('[omnitranslate] translate failed:', translateError)
    }

    // 原文始终上报后台；译文有就带上。翻译失败不能导致聊天记录丢失。
    void syncSocialMessage({
      platform,
      content: req.text,
      translatedText: success?.translated_text || '',
      direction: req.direction === 'send' ? 'out' : 'in',
      chatId,
      contactName,
      accountId,
      accountName
    })

    if (!success) {
      return { ok: false, data: { error: translateError || '翻译失败' } }
    }
    return { ok: true, data: success }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error('[omnitranslate] translate failed:', error)
    return { ok: false, data: { error } }
  }
}

/** 右侧手动翻译：显式源/目标语言；可选附加手动翻译提示词 */
export async function translateManual(payload: {
  webviewLabel?: string
  text: string
  sourceLang: string
  targetLang: string
}): Promise<TranslateOutcome> {
  try {
    const text = String(payload.text ?? '').trim()
    if (!text) return { ok: false, data: { error: '待翻译文本不能为空' } }
    const targetLang = String(payload.targetLang ?? '').trim()
    if (!targetLang) return { ok: false, data: { error: '请选择目标语言' } }
    const sourceLang = String(payload.sourceLang ?? 'auto').trim() || 'auto'

    let translatePrompt = ''
    const label = payload.webviewLabel?.trim()
    if (label) {
      const tab = getTabSettingsByLabel(label)
      if (tab?.manualTranslatePromptEnabled && tab.manualTranslatePrompt?.trim()) {
        translatePrompt = tab.manualTranslatePrompt.trim().slice(0, 2000)
      }
    }

    const req: ResolvedRequest = {
      text,
      sourceLang,
      targetLang,
      direction: 'send',
      translatePrompt
    }

    const settings = getSyncedAppSettings()
    console.log(
      `[acecrm] translate manual tab=${label || '-'} provider=${settings.translationProvider} ${req.sourceLang} -> ${req.targetLang} chars=${req.text.length}`
    )

    const meta = label ? getViewMetaByLabel(label) : null
    const platform = meta?.groupId || 'manual'
    const wantProvider = normalizeProvider(settings.translationProvider)
    const cacheKey = translatePrompt ? `${req.text}\0${translatePrompt}` : req.text
    const cached = getCachedTranslation(cacheKey, req.targetLang, wantProvider)
    if (cached) {
      return {
        ok: true,
        data: {
          translated_text: cached.translatedText,
          provider: cached.provider || wantProvider,
          from_cache: true
        }
      }
    }

    const success = await runTranslation(req, platform)
    putCachedTranslation(cacheKey, req.targetLang, success.translated_text, success.provider)
    return { ok: true, data: success }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error('[acecrm] translate manual failed:', error)
    return { ok: false, data: { error } }
  }
}
