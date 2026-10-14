import { ipcMain } from 'electron'
import { loadSettings } from '../services/settings'
import {
  getClueStatus,
  resolveClueAccountForDev,
  uploadClueContacts,
  type ClueUploadResult
} from '../services/clue/upload'

export type DevClueMode = 'add_friend' | 'friend_message'

export interface DevClueFakePayload {
  mode: DevClueMode
  platform: 'line' | 'whatsapp'
  tabId: string
  webviewLabel?: string
  /** 当前登录用户 ID（LINE/WhatsApp 主号 uid） */
  accountUid?: string
  /** 当前登录用户名 */
  accountName?: string
  /** 好友信息：uid、uid|名称，或仅名称 */
  friendText?: string
}

function parseFriendText(
  raw: string,
  mode: DevClueMode = 'add_friend'
): { uid: string; name: string } {
  const prefix = mode === 'friend_message' ? 'dev_msg_' : 'dev_friend_'
  const text = String(raw || '').trim()
  if (!text) {
    const uid = `${prefix}${Date.now().toString(36)}`
    return { uid, name: `测试好友_${uid.slice(-6)}` }
  }
  const pipe = text.indexOf('|')
  if (pipe >= 0) {
    const uid = text.slice(0, pipe).trim() || `${prefix}${Date.now().toString(36)}`
    const name = text.slice(pipe + 1).trim() || uid
    return { uid, name }
  }
  // 纯数字/字母串当作 uid；否则生成 uid，原文当名称
  if (/^[a-zA-Z0-9._:@-]{3,80}$/.test(text) && !/\s/.test(text)) {
    return { uid: text, name: text }
  }
  const uid = `${prefix}${Date.now().toString(36)}`
  return { uid, name: text }
}

export function registerClueIpc(): void {
  ipcMain.handle('clue:status', () => {
    return getClueStatus()
  })

  ipcMain.handle(
    'clue:devFake',
    async (
      _event,
      payload: DevClueFakePayload | null
    ): Promise<
      ClueUploadResult & {
        friend?: { uid: string; name: string }
        account?: { uid: string; name: string }
      }
    > => {
      if (!loadSettings().testModeEnabled) {
        return { ok: false, error: '请先在设置中打开「测试模式」' }
      }
      const mode = payload?.mode
      const platform = payload?.platform === 'whatsapp' ? 'whatsapp' : 'line'
      const tabId = String(payload?.tabId || '').trim()
      if (!tabId || (mode !== 'add_friend' && mode !== 'friend_message')) {
        return { ok: false, error: '参数无效' }
      }

      const remembered = resolveClueAccountForDev({
        tabId,
        webviewLabel: payload?.webviewLabel,
        platform
      })
      const inputUid = String(payload?.accountUid || '').trim()
      const inputName = String(payload?.accountName || '').trim()
      const line_uid =
        inputUid ||
        remembered?.line_uid ||
        `dev-${platform}-${tabId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`
      const line_name =
        inputName ||
        remembered?.line_name ||
        `Dev${platform === 'whatsapp' ? 'WA' : 'LINE'}测试号`

      const friend = parseFriendText(payload?.friendText || '', mode)

      const result = await uploadClueContacts({
        line_uid,
        line_name,
        platform,
        tabId,
        webviewLabel: payload?.webviewLabel,
        contacts: [{ uid: friend.uid, name: friend.name }],
        messaged_uids: mode === 'friend_message' ? [friend.uid] : []
      })

      return {
        ...result,
        friend,
        account: { uid: line_uid, name: line_name }
      }
    }
  )
}
