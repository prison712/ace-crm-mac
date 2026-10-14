import { loadAuthState } from './auth'
import { loadSettings } from './settings'
import { appFetch } from './http'

export async function syncSocialMessage(payload: {
  platform?: string
  content?: string
  translatedText?: string
  direction?: string
  chatId?: string
  contactName?: string
  accountId?: string
  accountName?: string
  timestamp?: number | string
  mediaBase64?: string
  mediaName?: string
  mediaType?: string
}): Promise<void> {
  const auth = loadAuthState()
  const { backendUrl } = loadSettings()
  if (!auth?.token || !backendUrl) {
    console.warn(
      `[social-sync] skipped: ${!backendUrl ? 'no backendUrl' : 'not logged in'}`
    )
    return
  }
  const content = String(payload.content || '').trim()
  if (!content && !payload.mediaBase64) return

  try {
    const resp = await appFetch(`${backendUrl.replace(/\/$/, '')}/api/social-chats/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`
      },
      body: JSON.stringify({
        platform: payload.platform || 'unknown',
        content,
        translated_text: payload.translatedText || '',
        direction: payload.direction || 'in',
        chat_id: payload.chatId || '',
        contact_name: payload.contactName || '',
        account_id: payload.accountId || '',
        account_name: payload.accountName || '',
        timestamp: payload.timestamp || Date.now(),
        media_base64: payload.mediaBase64,
        media_name: payload.mediaName,
        media_type: payload.mediaType
      })
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      console.warn(
        `[social-sync] HTTP ${resp.status} ${body.slice(0, 300) || '(empty)'} platform=${payload.platform || ''}`
      )
      return
    }
      console.log(
      `[social-sync] ok platform=${payload.platform || ''} dir=${payload.direction || 'in'} chars=${content.length} translated=${
        payload.translatedText ? 'yes' : 'no'
      }`
    )
  } catch (err) {
    console.warn('[social-sync] failed', err instanceof Error ? err.message : err)
  }
}
