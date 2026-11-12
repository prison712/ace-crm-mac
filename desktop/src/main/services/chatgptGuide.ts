import { BrowserWindow, shell, type IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { loadAuthState } from './auth'
import { loadSettings } from './settings'

let guideWin: BrowserWindow | null = null

function guideHtmlPath(): string {
  const built = join(__dirname, '../renderer/chatgpt-guide.html')
  if (existsSync(built)) return built
  return join(process.cwd(), 'src/renderer/public/chatgpt-guide.html')
}

function guidePreloadPath(): string {
  const built = join(__dirname, '../preload/chatgpt-guide.js')
  if (existsSync(built)) return built
  return join(process.cwd(), 'out/preload/chatgpt-guide.js')
}

function isLocalBackend(backendUrl: string): boolean {
  try {
    const u = new URL(backendUrl)
    const host = (u.hostname || '').toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  } catch {
    return false
  }
}

/** 猜测本机 mcp-bridge 入口（开发仓库旁或环境变量） */
function guessBridgePath(): string | null {
  if (process.env.ACE_MCP_BRIDGE_ENTRY) return process.env.ACE_MCP_BRIDGE_ENTRY
  const candidates = [
    join(process.cwd(), '..', 'mcp-bridge', 'src', 'index.js'),
    join(process.cwd(), 'mcp-bridge', 'src', 'index.js'),
    join(dirname(process.execPath), '..', 'mcp-bridge', 'src', 'index.js')
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

export function getChatgptGuideConfig(): {
  backendUrl: string
  loggedIn: boolean
  localBackend: boolean
  writeAllowed: boolean
  bridgePath: string | null
  mcpJson: string
} {
  const { backendUrl } = loadSettings()
  const auth = loadAuthState()
  const localBackend = isLocalBackend(backendUrl)
  const writeAllowed = localBackend || process.env.ACE_ALLOW_REMOTE_WRITE === '1'
  const bridgePath = guessBridgePath()
  const argsPath = bridgePath || '请改成/本机/mcp-bridge/src/index.js的绝对路径'
  const env: Record<string, string> = { ACE_BACKEND_URL: backendUrl }
  const mcp = {
    mcpServers: {
      'ace-crm': {
        command: 'node',
        args: [argsPath.replace(/\\/g, '/')],
        env
      }
    }
  }
  return {
    backendUrl,
    loggedIn: Boolean(auth?.token),
    localBackend,
    writeAllowed,
    bridgePath,
    mcpJson: JSON.stringify(mcp, null, 2)
  }
}

export function checkChatgptBridge(): { ok: boolean; message: string } {
  const cfg = getChatgptGuideConfig()
  const parts: string[] = []
  if (!cfg.loggedIn) {
    return { ok: false, message: '请先打开智能工作台桌面端并登录' }
  }
  parts.push(`后端 ${cfg.backendUrl}`)
  parts.push(cfg.localBackend ? '本机后端' : '远程后端（写回默认关闭）')
  parts.push(cfg.writeAllowed ? '写回允许' : '写回禁用')
  if (cfg.bridgePath) parts.push(`已找到桥: ${cfg.bridgePath}`)
  else parts.push('未自动找到 mcp-bridge，请手动改配置里的路径')
  return { ok: true, message: parts.join(' · ') }
}

/**
 * 打开 ChatGPT 对接引导小窗。
 */
export function showChatgptGuide(event: IpcMainInvokeEvent): { ok: boolean } {
  const parent = BrowserWindow.fromWebContents(event.sender)
  if (!parent || parent.isDestroyed()) return { ok: false }

  if (guideWin && !guideWin.isDestroyed()) {
    guideWin.focus()
    return { ok: true }
  }

  const preload = guidePreloadPath()
  guideWin = new BrowserWindow({
    width: 420,
    height: 640,
    parent,
    modal: false,
    show: false,
    title: 'ChatGPT 对接',
    autoHideMenuBar: true,
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: existsSync(preload) ? preload : undefined,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  guideWin.on('closed', () => {
    guideWin = null
  })
  void guideWin.loadFile(guideHtmlPath()).then(() => {
    if (guideWin && !guideWin.isDestroyed()) guideWin.show()
  })
  return { ok: true }
}

export async function openChatgptSite(): Promise<{ ok: boolean }> {
  await shell.openExternal('https://chatgpt.com')
  return { ok: true }
}
