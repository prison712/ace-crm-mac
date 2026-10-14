import { useCallback, useEffect, useState } from 'react'
import { ArrowDownUp, ClipboardCopy, Languages, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/context/I18nContext'
import {
  MANUAL_SOURCE_AUTO,
  TARGET_LANGUAGES,
  normalizeManualSourceLanguage,
  normalizeTargetLanguage,
  targetLanguageLabel,
  type ManualSourceLangCode,
  type TargetLanguageCode
} from '@/lib/languages'
import { useApp } from '@/store/AppProvider'

const COLLAPSED_KEY = 'acecrm_manual_translate_collapsed'

function loadCollapsed(): boolean {
  try {
    const v = localStorage.getItem(COLLAPSED_KEY)
    // 未设置过时默认收起，避免挡住聊天回车自动翻译
    if (v === null) return true
    return v === '1'
  } catch {
    return true
  }
}

function saveCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export function ManualTranslatePanel(): React.JSX.Element {
  const { t, lang } = useI18n()
  const { activeTab, updateTab } = useApp()
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const [sourceText, setSourceText] = useState('')
  const [targetText, setTargetText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const sourceLang = normalizeManualSourceLanguage(activeTab?.manualSourceLang)
  const targetLang = normalizeTargetLanguage(
    activeTab?.manualTargetLang ?? activeTab?.sendTargetLang,
    'en'
  )

  useEffect(() => {
    setSourceText('')
    setTargetText('')
    setError(null)
    setCopied(false)
  }, [activeTab?.id])

  const setCollapsedPersist = useCallback((next: boolean) => {
    setCollapsed(next)
    saveCollapsed(next)
  }, [])

  // 面板展开/收起必须同步到各 WebView：收起后才允许回车自动翻译
  useEffect(() => {
    void window.api.syncManualPanel({ expanded: !collapsed }).catch(console.error)
    return () => {
      // 离开社媒模式卸载面板时恢复自动翻译
      void window.api.syncManualPanel({ expanded: false }).catch(() => {
        /* ignore */
      })
    }
  }, [collapsed])

  const persistLangs = useCallback(
    (next: { source?: ManualSourceLangCode; target?: TargetLanguageCode }) => {
      if (!activeTab) return
      updateTab({
        ...activeTab,
        manualSourceLang: next.source ?? sourceLang,
        manualTargetLang: next.target ?? targetLang
      })
    },
    [activeTab, sourceLang, targetLang, updateTab]
  )

  const swapLangs = useCallback(() => {
    if (sourceLang === MANUAL_SOURCE_AUTO) return
    persistLangs({
      source: targetLang,
      target: sourceLang as TargetLanguageCode
    })
    setSourceText(targetText)
    setTargetText(sourceText)
  }, [persistLangs, sourceLang, sourceText, targetLang, targetText])

  const runTranslate = useCallback(async () => {
    if (!activeTab) {
      setError(t('manual.needTab'))
      return
    }
    const text = sourceText.trim()
    if (!text) {
      setError(t('manual.emptySource'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await window.api.translateManual({
        webviewLabel: activeTab.webviewLabel,
        text,
        sourceLang,
        targetLang
      })
      if (!res.ok) {
        setError(res.data.error || t('manual.fail'))
        return
      }
      setTargetText(res.data.translated_text)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [activeTab, sourceLang, sourceText, t, targetLang])

  const copyTarget = useCallback(async () => {
    const text = targetText.trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError(t('manual.copyFail'))
    }
  }, [t, targetText])

  const sendTarget = useCallback(async () => {
    if (!activeTab) {
      setError(t('manual.needTab'))
      return
    }
    let text = targetText.trim()
    if (!text) {
      if (!sourceText.trim()) {
        setError(t('manual.emptySource'))
        return
      }
      setBusy(true)
      setError(null)
      try {
        const res = await window.api.translateManual({
          webviewLabel: activeTab.webviewLabel,
          text: sourceText.trim(),
          sourceLang,
          targetLang
        })
        if (!res.ok) {
          setError(res.data.error || t('manual.fail'))
          return
        }
        text = res.data.translated_text
        setTargetText(text)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return
      } finally {
        setBusy(false)
      }
    }
    try {
      await window.api.injectPush({
        label: activeTab.webviewLabel,
        message: { type: 'compose_send', text }
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [activeTab, sourceLang, sourceText, t, targetLang, targetText])

  const selectClass =
    'h-8 w-full border border-input bg-background px-2 text-xs text-foreground'

  if (collapsed) {
    return (
      <aside className="app-chrome relative z-20 flex h-full w-10 shrink-0 flex-col border-l border-border bg-background">
        <button
          type="button"
          className="flex h-full w-full flex-col items-center gap-2 px-1 py-3 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={t('manual.expand')}
          aria-label={t('manual.expand')}
          onClick={() => setCollapsedPersist(false)}
        >
          <span
            className="text-[12px] font-medium tracking-wide"
            style={{ writingMode: 'vertical-rl' }}
          >
            {t('manual.expand')}
          </span>
        </button>
      </aside>
    )
  }

  return (
    <aside className="app-chrome relative z-20 flex h-full w-72 shrink-0 flex-col border-l border-border bg-background">
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-2">
        <Languages className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {t('manual.title')}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          title={t('manual.collapse')}
          aria-label={t('manual.collapse')}
          onClick={() => setCollapsedPersist(true)}
        >
          {t('manual.collapse')}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2.5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-1.5">
          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">{t('manual.sourceLang')}</Label>
            <select
              className={selectClass}
              value={sourceLang}
              disabled={!activeTab}
              onChange={(e) =>
                persistLangs({ source: e.target.value as ManualSourceLangCode })
              }
            >
              <option value={MANUAL_SOURCE_AUTO}>{t('manual.autoDetect')}</option>
              {TARGET_LANGUAGES.map((item) => (
                <option key={item.code} value={item.code}>
                  {targetLanguageLabel(item.code, lang)}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mb-0.5"
            disabled={!activeTab || sourceLang === MANUAL_SOURCE_AUTO}
            title={t('manual.swap')}
            onClick={swapLangs}
          >
            <ArrowDownUp className="h-3.5 w-3.5" />
          </Button>
          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">{t('manual.targetLang')}</Label>
            <select
              className={selectClass}
              value={targetLang}
              disabled={!activeTab}
              onChange={(e) =>
                persistLangs({ target: e.target.value as TargetLanguageCode })
              }
            >
              {TARGET_LANGUAGES.map((item) => (
                <option key={item.code} value={item.code}>
                  {targetLanguageLabel(item.code, lang)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2">
          <div className="flex min-h-0 flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">{t('manual.sourceText')}</Label>
            <textarea
              className="min-h-0 flex-1 resize-none border border-input bg-background p-2 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder={t('manual.sourcePlaceholder')}
              value={sourceText}
              disabled={!activeTab || busy}
              onChange={(e) => setSourceText(e.target.value)}
            />
          </div>

          <div className="grid shrink-0 gap-1.5">
            <div className="flex items-center justify-between gap-2 border border-border px-2 py-1.5">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-foreground">{t('manual.prompt')}</p>
                <p className="text-[10px] leading-snug text-muted-foreground">
                  {t('manual.promptHint')}
                </p>
              </div>
              <Switch
                checked={Boolean(activeTab?.manualTranslatePromptEnabled)}
                disabled={!activeTab}
                onCheckedChange={(checked) => {
                  if (!activeTab) return
                  updateTab({ ...activeTab, manualTranslatePromptEnabled: checked })
                }}
              />
            </div>
            <textarea
              className={`h-16 w-full resize-none border border-input bg-background px-2 py-1.5 text-[12px] leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                !activeTab?.manualTranslatePromptEnabled
                  ? 'pointer-events-none opacity-50'
                  : ''
              }`}
              value={activeTab?.manualTranslatePrompt || ''}
              maxLength={2000}
              disabled={!activeTab || !activeTab.manualTranslatePromptEnabled}
              placeholder={t('manual.promptPlaceholder')}
              onChange={(e) => {
                if (!activeTab) return
                updateTab({
                  ...activeTab,
                  manualTranslatePrompt: e.target.value.slice(0, 2000)
                })
              }}
            />
          </div>

          <div className="flex min-h-0 flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">{t('manual.targetText')}</Label>
            <textarea
              className="min-h-0 flex-1 resize-none border border-input bg-muted/30 p-2 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder={t('manual.targetPlaceholder')}
              value={targetText}
              disabled={!activeTab || busy}
              onChange={(e) => setTargetText(e.target.value)}
            />
          </div>
        </div>

        {error ? (
          <p className="text-[11px] leading-snug text-destructive">{error}</p>
        ) : null}

        <div className="grid grid-cols-3 gap-1.5">
          <Button
            type="button"
            className="col-span-3"
            disabled={!activeTab || busy || !sourceText.trim()}
            onClick={() => void runTranslate()}
          >
            {busy ? t('manual.translating') : t('manual.translate')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!targetText.trim()}
            onClick={() => void copyTarget()}
          >
            <ClipboardCopy className="h-3.5 w-3.5" />
            {copied ? t('manual.copied') : t('manual.copy')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="col-span-2"
            disabled={!activeTab || busy || (!targetText.trim() && !sourceText.trim())}
            onClick={() => void sendTarget()}
          >
            <Send className="h-3.5 w-3.5" />
            {t('manual.send')}
          </Button>
        </div>
      </div>
    </aside>
  )
}
