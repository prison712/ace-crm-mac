import { useEffect, useState } from 'react'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

type Listener = (items: ToastItem[]) => void

let seq = 1
let items: ToastItem[] = []
const listeners = new Set<Listener>()

/**
 * 通知所有订阅者刷新提示条列表。
 */
function emit(): void {
  for (const listener of listeners) listener([...items])
}

/**
 * 弹出顶部提示条。
 * @param message 文案
 * @param kind 类型，默认 success
 * @param durationMs 自动关闭毫秒
 */
export function showToast(
  message: string,
  kind: ToastKind = 'success',
  durationMs = 3200
): void {
  const id = seq++
  items = [...items, { id, message, kind }]
  emit()
  window.setTimeout(() => {
    items = items.filter((item) => item.id !== id)
    emit()
  }, durationMs)
}

/**
 * 订阅提示条列表（供宿主组件渲染）。
 * @returns 当前提示列表
 */
export function useToasts(): ToastItem[] {
  const [list, setList] = useState<ToastItem[]>(items)
  useEffect(() => {
    listeners.add(setList)
    setList([...items])
    return () => {
      listeners.delete(setList)
    }
  }, [])
  return list
}

/**
 * 顶部浮动提示条宿主。
 */
export function ToastHost(): React.ReactElement | null {
  const list = useToasts()
  if (list.length === 0) return null

  return (
    <div className="pointer-events-none fixed right-3 top-12 z-[100] flex w-[min(360px,calc(100%-1.5rem))] flex-col gap-2">
      {list.map((item) => (
        <div
          key={item.id}
          className={`pointer-events-auto rounded-md border px-3 py-2 text-sm shadow-lg ${
            item.kind === 'success'
              ? 'border-[#9fd5c4] bg-[#e8f7f1] text-[#0d6b54]'
              : item.kind === 'error'
                ? 'border-[#f0b4ae] bg-[#fef3f2] text-[var(--destructive)]'
                : 'border-[var(--border)] bg-white text-[var(--foreground)]'
          }`}
          role="status"
        >
          {item.message}
        </div>
      ))}
    </div>
  )
}
