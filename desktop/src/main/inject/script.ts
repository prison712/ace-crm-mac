import { readFileSync } from 'fs'
import { join } from 'path'
import { loadSettings } from '../services/settings'

function loadInjectFile(name: string): string {
  const fromOut = [
    join(__dirname, 'inject', name),
    join(__dirname, '..', 'inject', name)
  ]
  const fromSrc = join(__dirname, '../../src/main/inject', name)
  // 开发态优先读源文件：copyInjectPlugin 只在 closeBundle 复制，改 tab.js 否则不生效
  const candidates =
    process.env.NODE_ENV === 'production'
      ? [...fromOut, fromSrc]
      : [fromSrc, ...fromOut]
  for (const p of candidates) {
    try {
      return readFileSync(p, 'utf-8')
    } catch {
      /* try next */
    }
  }
  throw new Error(`inject/${name} not found`)
}

let cachedTabJs: string | null = null
let cachedLineContactsJs: string | null = null
let cachedWhatsAppContactsJs: string | null = null
let cachedChatLangFabJs: string | null = null

function loadTabJs(): string {
  if (process.env.NODE_ENV !== 'production') return loadInjectFile('tab.js')
  if (!cachedTabJs) cachedTabJs = loadInjectFile('tab.js')
  return cachedTabJs
}

function loadLineContactsJs(): string {
  if (!cachedLineContactsJs) cachedLineContactsJs = loadInjectFile('line-contacts.js')
  return cachedLineContactsJs
}

function loadWhatsAppContactsJs(): string {
  if (!cachedWhatsAppContactsJs) {
    cachedWhatsAppContactsJs = loadInjectFile('whatsapp-contacts.js')
  }
  return cachedWhatsAppContactsJs
}

/**
 * 加载「对话发送语言」悬浮按钮脚本（可重复注入）。
 * @returns JS 源码
 */
function loadChatLangFabJs(): string {
  if (process.env.NODE_ENV !== 'production') return loadInjectFile('chat-lang-fab.js')
  if (!cachedChatLangFabJs) cachedChatLangFabJs = loadInjectFile('chat-lang-fab.js')
  return cachedChatLangFabJs
}

/** 注入 groupId 标记 + tab.js */
export function buildInjectBootstrap(
  groupId: string,
  opts?: { lineHomeUrl?: string; testModeEnabled?: boolean }
): string {
  const gid = JSON.stringify(String(groupId || ''))
  const lineHome = opts?.lineHomeUrl
    ? `window.__OMNI_LINE_HOME__=${JSON.stringify(opts.lineHomeUrl)};`
    : ''
  const testMode =
    typeof opts?.testModeEnabled === 'boolean'
      ? opts.testModeEnabled
      : loadSettings().testModeEnabled
  const tabJs = loadTabJs()
  return `${lineHome}window.__OMNI_TAB_GROUP_ID__=${gid};window.__OMNI_TEST_MODE__=${testMode ? 'true' : 'false'};${tabJs}`
}

/** LINE：好友 + 推荐联系人增量采集 */
export function buildLineContactsInject(): string {
  return loadLineContactsJs()
}

/** WhatsApp：好友增量采集（Store.Chat） */
export function buildWhatsAppContactsInject(): string {
  return loadWhatsAppContactsJs()
}

/**
 * 每个对话的显著「发送语言」设置按钮（独立脚本，可重复执行）。
 * @returns 可直接 executeJavaScript 的源码
 */
export function buildChatLangFabInject(): string {
  return loadChatLangFabJs()
}
