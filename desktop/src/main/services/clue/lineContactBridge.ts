import type { ClueContact, ClueUploadResult } from './upload'
import { uploadClueContacts } from './upload'

export interface ClueContactsInvokePayload {
  line_uid?: string
  line_name?: string
  contacts?: ClueContact[]
  messaged_uids?: string[]
  platform?: string
}

/**
 * 注入脚本 action `line_contacts` / `whatsapp_contacts` → 主进程上报 /api/upload
 */
export async function handleClueContactsFromInject(
  webviewLabel: string,
  tabId: string | undefined,
  payload: ClueContactsInvokePayload | null,
  platform: 'line' | 'whatsapp' = 'line'
): Promise<ClueUploadResult> {
  return uploadClueContacts({
    line_uid: payload?.line_uid ?? '',
    line_name: payload?.line_name ?? '',
    contacts: payload?.contacts ?? [],
    messaged_uids: payload?.messaged_uids ?? [],
    webviewLabel,
    tabId,
    platform: payload?.platform || platform
  })
}

/** @deprecated 使用 handleClueContactsFromInject */
export async function handleLineContactsFromInject(
  webviewLabel: string,
  tabId: string | undefined,
  payload: ClueContactsInvokePayload | null
): Promise<ClueUploadResult> {
  return handleClueContactsFromInject(webviewLabel, tabId, payload, 'line')
}
