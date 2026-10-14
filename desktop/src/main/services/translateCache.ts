import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const MAX_ENTRIES = 10_000
const CACHE_FILE = 'translate_cache.json'

interface CacheEntry {
  translatedText: string
  provider: string
}

interface PersistedEntry {
  source_text: string
  target_lang: string
  translated_text: string
  provider: string
}

interface State {
  map: Map<string, CacheEntry>
  order: string[]
  cachePath: string | null
}

function makeKey(sourceText: string, targetLang: string, provider = ''): string {
  const p = String(provider || '').trim().toLowerCase()
  return `${sourceText.trim()}\0${targetLang.trim().toLowerCase()}\0${p}`
}

function parseKey(key: string): { sourceText: string; targetLang: string; provider: string } | null {
  const parts = key.split('\0')
  if (parts.length < 2) return null
  return {
    sourceText: parts[0] || '',
    targetLang: parts[1] || '',
    provider: parts[2] || ''
  }
}

const state: State = {
  map: new Map(),
  order: [],
  cachePath: null
}

function cachePath(): string {
  return join(app.getPath('userData'), CACHE_FILE)
}

function trimToMax(): void {
  while (state.order.length > MAX_ENTRIES) {
    const old = state.order.shift()
    if (old) state.map.delete(old)
  }
}

function saveToDisk(): void {
  if (!state.cachePath) return
  const entries: PersistedEntry[] = []
  for (const key of state.order) {
    const entry = state.map.get(key)
    const parsed = parseKey(key)
    if (!entry || !parsed) continue
    entries.push({
      source_text: parsed.sourceText,
      target_lang: parsed.targetLang,
      translated_text: entry.translatedText,
      provider: entry.provider
    })
  }
  try {
    const dir = join(state.cachePath, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(state.cachePath, JSON.stringify({ entries }), 'utf-8')
  } catch (e) {
    console.error('[omnitranslate] translate cache write failed:', e)
  }
}

export function initTranslateCache(): void {
  const path = cachePath()
  state.cachePath = path
  state.map.clear()
  state.order = []
  try {
    if (!existsSync(path)) {
      console.log('[omnitranslate] translate cache empty')
      return
    }
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as { entries?: PersistedEntry[] }
    for (const e of raw.entries ?? []) {
      if (!e.source_text?.trim() || !e.target_lang?.trim() || !e.translated_text?.trim()) continue
      const key = makeKey(e.source_text, e.target_lang, e.provider || '')
      if (state.map.has(key)) {
        state.map.set(key, { translatedText: e.translated_text.trim(), provider: e.provider || '' })
      } else {
        state.order.push(key)
        state.map.set(key, { translatedText: e.translated_text.trim(), provider: e.provider || '' })
      }
    }
    trimToMax()
    console.log(`[omnitranslate] translate cache loaded ${state.order.length} entries`)
  } catch (e) {
    console.error('[omnitranslate] translate cache load failed:', e)
  }
}

export function getCachedTranslation(
  sourceText: string,
  targetLang: string,
  provider = ''
): { translatedText: string; provider: string } | null {
  const key = makeKey(sourceText, targetLang, provider)
  if (!sourceText.trim() || !targetLang.trim()) return null
  const hit = state.map.get(key)
  if (!hit) return null
  return { translatedText: hit.translatedText, provider: hit.provider || provider }
}

export function putCachedTranslation(
  sourceText: string,
  targetLang: string,
  translatedText: string,
  provider: string
): void {
  const key = makeKey(sourceText, targetLang, provider)
  const translated = translatedText.trim()
  if (!sourceText.trim() || !targetLang.trim() || !translated) return

  const entry: CacheEntry = { translatedText: translated, provider }
  if (state.map.has(key)) {
    state.map.set(key, entry)
  } else {
    while (state.order.length >= MAX_ENTRIES) {
      const old = state.order.shift()
      if (old) state.map.delete(old)
    }
    state.order.push(key)
    state.map.set(key, entry)
  }
  saveToDisk()
}
