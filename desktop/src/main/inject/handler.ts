import { BrowserWindow, type WebContents } from 'electron'
import { translateFromPayload } from '../services/translate'
import {
  clearSyncedChatLangPref,
  getTabSettingsByLabel,
  isActiveSynced,
  isManualPanelExpanded,
  isTabActive,
  resolveChatLang,
  upsertSyncedChatLangPref
} from '../services/syncState'
import { notifyDesktopNewMessage } from '../services/desktopNotify'
import * as browserViews from '../services/browserViews'
import { syncSocialMessage } from '../services/socialSync'

export interface InjectResponse {
  ok: boolean
  webview_label: string
  data: Record<string, unknown>
}

function emitMessageBlink(
  webviewLabel: string,
  active: boolean,
  title: string,
  count: number,
  source: string
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('message:blink', {
      webviewLabel,
      active,
      title,
      count,
      source
    })
  }
}

/**
 * 通知渲染进程：某标签的对话语言覆盖已变更（需持久化到 AppState）。
 * @param webviewLabel 标签 webview 标识
 * @param chatLangPrefs 完整对话语言映射
 * @param chatId 本次变更的对话 id
 * @param contactName 联系人名称
 */
function emitChatLangPrefs(
  webviewLabel: string,
  chatLangPrefs: Record<string, { sendTargetLang?: string; receiveTargetLang?: string; contactName?: string }>,
  chatId: string,
  contactName: string
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('chat:langPrefs', {
      webviewLabel,
      chatLangPrefs,
      chatId,
      contactName
    })
  }
}

/**
 * 通知渲染进程：某标签页当前打开的对话已变化（用于按客户设置语言）。
 * @param webviewLabel 标签 webview 标识
 * @param chatId 对话 id（guessChatId）
 * @param contactName 联系人显示名
 */
function emitChatContext(
  webviewLabel: string,
  chatId: string,
  contactName: string
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('chat:context', {
      webviewLabel,
      chatId,
      contactName
    })
  }
}

function handleNewMessage(
  webviewLabel: string,
  payload: Record<string, unknown> | null
): Record<string, unknown> {
  const active = typeof payload?.active === 'boolean' ? payload.active : true
  const title = typeof payload?.title === 'string' ? payload.title : ''
  const source = typeof payload?.source === 'string' ? payload.source : 'poll'
  let count = typeof payload?.count === 'number' ? Math.max(0, Math.floor(payload.count)) : 0
  if (active && count <= 0) {
    const m = title.match(/[(\[【]\s*(\d+)\s*[)\]】]/)
    count = m ? Math.max(1, parseInt(m[1]!, 10) || 1) : 1
  }
  if (!active) count = 0
  emitMessageBlink(webviewLabel, active, title, count, source)
  notifyDesktopNewMessage(webviewLabel, active, count, title, source)
  return { notified: true, count, source }
}

export async function handleInjectInvoke(
  webContents: WebContents,
  action: string,
  payload: unknown
): Promise<InjectResponse> {
  const label = browserViews.getLabelByWebContents(webContents)
  if (!label) {
    // 扩展后台页 / 热更新残留 webContents 也会打到这里，勿抛错刷屏
    return {
      ok: false,
      webview_label: '',
      data: { error: 'unknown_sender', action }
    }
  }

  const payloadObj =
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null

  switch (action) {
    case 'ping':
      return {
        ok: true,
        webview_label: label,
        data: { message: 'pong', payload }
      }

    case 'get_meta':
      return {
        ok: true,
        webview_label: label,
        data: { webviewLabel: label }
      }

    case 'get_manual_panel': {
      const tab = getTabSettingsByLabel(label)
      return {
        ok: true,
        webview_label: label,
        data: {
          expanded: isManualPanelExpanded(),
          skipAutoTranslate: Boolean(tab?.manualPanelDisablesAutoTranslate)
        }
      }
    }

    case 'log': {
      const level = typeof payloadObj?.level === 'string' ? payloadObj.level : 'info'
      const message = typeof payloadObj?.message === 'string' ? payloadObj.message : ''
      const href = typeof payloadObj?.href === 'string' ? payloadObj.href : ''
      const extra = payloadObj?.extra
      if (extra != null) {
        console.log(`[tab:${label}] [${level}] ${message} | ${href} | extra=`, extra)
      } else {
        console.log(`[tab:${label}] [${level}] ${message} | ${href}`)
      }
      return { ok: true, webview_label: label, data: { logged: true } }
    }

    case 'reload': {
      browserViews.reloadView(label)
      return { ok: true, webview_label: label, data: { reloading: true } }
    }

    case 'context_menu':
      // 阶段 5：系统右键菜单可后续补齐；先 no-op
      return { ok: true, webview_label: label, data: { shown: false } }

    case 'wa_ready': {
      const started = browserViews.requestInjectByWebContents(webContents)
      console.log(`[acecrm] wa_ready via IPC (${label}) started=${started}`)
      return {
        ok: true,
        webview_label: label,
        data: { injecting: started }
      }
    }

    case 'tg_ready': {
      const started = browserViews.requestInjectByWebContents(webContents)
      console.log(`[acecrm] tg_ready via IPC (${label}) started=${started}`)
      return {
        ok: true,
        webview_label: label,
        data: { injecting: started }
      }
    }

    case 'translate': {
      const outcome = await translateFromPayload(label, payload)
      return {
        ok: outcome.ok,
        webview_label: label,
        data: outcome.data as unknown as Record<string, unknown>
      }
    }

    case 'new_message':
      return {
        ok: true,
        webview_label: label,
        data: handleNewMessage(label, payloadObj)
      }

    case 'report_message': {
      // 只上报聊天记录、不翻译（用于「自己发出」的气泡，避免被当成收到）
      const text = String(payloadObj?.text ?? payloadObj?.content ?? '').trim()
      const messageType = String(
        payloadObj?.message_type ?? payloadObj?.messageType ?? 'receive'
      )
        .trim()
        .toLowerCase()
      const direction =
        messageType === 'send' ||
        messageType === 'out' ||
        messageType === 'sent' ||
        messageType === 'outgoing' ||
        messageType === '发送'
          ? 'out'
          : 'in'
      const meta = browserViews.getViewMetaByLabel(label)
      const tab = getTabSettingsByLabel(label)
      const platform =
        String(payloadObj?.platform || '').trim() || meta?.groupId || 'unknown'
      const contactName = String(
        payloadObj?.contact_name ?? payloadObj?.contactName ?? ''
      ).trim()
      const chatId = String(payloadObj?.chat_id ?? payloadObj?.chatId ?? '').trim()
      const accountId =
        String(payloadObj?.account_id ?? payloadObj?.accountId ?? '').trim() ||
        tab?.tabId ||
        meta?.tabId ||
        ''
      const accountName =
        String(payloadObj?.account_name ?? payloadObj?.accountName ?? '').trim() ||
        String(tab?.remark || '').trim() ||
        String(tab?.title || '').trim() ||
        accountId
      if (text) {
        void syncSocialMessage({
          platform,
          content: text,
          translatedText: String(
            payloadObj?.translated_text ?? payloadObj?.translatedText ?? ''
          ).trim(),
          direction,
          chatId,
          contactName,
          accountId,
          accountName
        })
      }
      return {
        ok: true,
        webview_label: label,
        data: { reported: !!text, direction }
      }
    }

    case 'chat_context': {
      const chatId = String(payloadObj?.chat_id ?? payloadObj?.chatId ?? '').trim().slice(0, 200)
      const contactName = String(
        payloadObj?.contact_name ?? payloadObj?.contactName ?? ''
      )
        .trim()
        .slice(0, 200)
      if (chatId) emitChatContext(label, chatId, contactName)
      return {
        ok: true,
        webview_label: label,
        data: { chatId, contactName }
      }
    }

    case 'get_chat_lang': {
      const chatId = String(payloadObj?.chat_id ?? payloadObj?.chatId ?? '').trim()
      const resolved = resolveChatLang(label, chatId)
      return {
        ok: true,
        webview_label: label,
        data: { chatId, ...resolved }
      }
    }

    case 'set_chat_lang': {
      const chatId = String(payloadObj?.chat_id ?? payloadObj?.chatId ?? '').trim().slice(0, 200)
      const contactName = String(
        payloadObj?.contact_name ?? payloadObj?.contactName ?? ''
      )
        .trim()
        .slice(0, 200)
      const sendTargetLang =
        typeof payloadObj?.send_target_lang === 'string'
          ? payloadObj.send_target_lang
          : typeof payloadObj?.sendTargetLang === 'string'
            ? payloadObj.sendTargetLang
            : undefined
      const receiveTargetLang =
        typeof payloadObj?.receive_target_lang === 'string'
          ? payloadObj.receive_target_lang
          : typeof payloadObj?.receiveTargetLang === 'string'
            ? payloadObj.receiveTargetLang
            : undefined
      const prefs = upsertSyncedChatLangPref(label, chatId, {
        sendTargetLang,
        receiveTargetLang,
        contactName
      })
      if (!prefs) {
        return {
          ok: false,
          webview_label: label,
          data: { error: 'tab_not_synced' }
        }
      }
      emitChatLangPrefs(label, prefs, chatId, contactName)
      const resolved = resolveChatLang(label, chatId)
      return {
        ok: true,
        webview_label: label,
        data: { chatId, ...resolved, chatLangPrefs: prefs }
      }
    }

    case 'clear_chat_lang': {
      const chatId = String(payloadObj?.chat_id ?? payloadObj?.chatId ?? '').trim()
      const contactName = String(
        payloadObj?.contact_name ?? payloadObj?.contactName ?? ''
      )
        .trim()
        .slice(0, 200)
      const prefs = clearSyncedChatLangPref(label, chatId)
      if (!prefs) {
        return {
          ok: false,
          webview_label: label,
          data: { error: 'tab_not_synced' }
        }
      }
      emitChatLangPrefs(label, prefs, chatId, contactName)
      const resolved = resolveChatLang(label, chatId)
      return {
        ok: true,
        webview_label: label,
        data: { chatId, ...resolved, chatLangPrefs: prefs }
      }
    }

    case 'is_tab_active':
      return {
        ok: true,
        webview_label: label,
        data: { active: isTabActive(label), synced: isActiveSynced() }
      }

    case 'line_contacts':
    case 'whatsapp_contacts':
      return {
        ok: true,
        webview_label: label,
        data: { skipped: true, reason: 'clue_upload_disabled' }
      }

    default:
      throw new Error(`unknown action: ${action}`)
  }
}

export async function pushToView(label: string, message: unknown): Promise<void> {
  const payload = JSON.stringify(message)
  const js = `(function(){var fn=window.__OMNITRANSLATE_ON_MESSAGE__;if(typeof fn==='function')fn(${payload});})();`
  await browserViews.executeJavaScript(label, js)
}
