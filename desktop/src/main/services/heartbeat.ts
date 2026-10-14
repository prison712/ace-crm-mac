import { app } from 'electron'
import { loadAuthState } from './auth'
import { abortSignalTimeout, appFetch } from './http'
import { loadSettings } from './settings'

const HOUR_MS = 60 * 60 * 1000
const INITIAL_DELAY_MS = 5_000

let started = false

async function sendHeartbeat(): Promise<void> {
  try {
    const auth = loadAuthState()
    if (!auth || auth.accountType !== 'invite' || !auth.token) return

    const backendUrl = loadSettings().backendUrl.replace(/\/$/, '')
    if (!backendUrl) return

    const resp = await appFetch(`${backendUrl}/api/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`
      },
      body: JSON.stringify({ client_version: app.getVersion() }),
      signal: abortSignalTimeout(30_000)
    })

    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`
      try {
        const data = (await resp.json()) as { error?: string }
        if (data?.error) detail = data.error
      } catch {
        /* ignore */
      }
      console.warn(`[omnitranslate] heartbeat failed: ${detail}`)
    }
  } catch (e) {
    console.warn('[omnitranslate] heartbeat error:', e)
  }
}

/** 邀请码登录后每小时心跳；启动约 5s 后补发一次。无登录则跳过。失败仅 warn。 */
export function startHeartbeatLoop(): void {
  if (started) return
  started = true

  setTimeout(() => {
    void sendHeartbeat()
  }, INITIAL_DELAY_MS)

  setInterval(() => {
    void sendHeartbeat()
  }, HOUR_MS)
}

export const startHeartbeat = startHeartbeatLoop
