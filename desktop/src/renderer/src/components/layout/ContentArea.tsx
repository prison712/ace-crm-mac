import { useEffect, useRef } from 'react'
import { useI18n } from '@/context/I18nContext'
import { useAppMode } from '@/context/ModeContext'
import { useApp } from '@/store/AppProvider'
import { cn } from '@/lib/utils'

const MIN_CONTENT_SIZE = 80

export function ContentArea(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const { setContentBounds, activeTab, contentBounds, settingsView } = useApp()
  const { appMode } = useAppMode()
  const { t } = useI18n()
  const showPlaceholder = appMode !== 'workbench' && (settingsView != null || !activeTab)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const update = (): void => {
      const rect = el.getBoundingClientRect()
      if (rect.width < MIN_CONTENT_SIZE || rect.height < MIN_CONTENT_SIZE) {
        return
      }
      setContentBounds({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      })
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    window.addEventListener('resize', update)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [setContentBounds])

  return (
    <div
      ref={ref}
      data-content-area
      className={cn(
        'relative flex min-h-0 flex-1 items-center justify-center border border-border bg-background'
      )}
    >
      {showPlaceholder ? (
        <div className="pointer-events-none select-none px-4 text-center text-[12px] text-muted-foreground">
          <p>{t('content.placeholder')}</p>
          {activeTab ? (
            <p className="mt-1 text-[11px]">
              {activeTab.title}
              {contentBounds
                ? ` · ${Math.round(contentBounds.width)}×${Math.round(contentBounds.height)}`
                : null}
            </p>
          ) : null}
        </div>
      ) : appMode === 'workbench' ? (
        <div className="pointer-events-none select-none px-4 text-center text-[12px] text-muted-foreground">
          <p>工作台由上层视图承载；若长时间空白，请切到社媒再切回重试。</p>
        </div>
      ) : null}
    </div>
  )
}
