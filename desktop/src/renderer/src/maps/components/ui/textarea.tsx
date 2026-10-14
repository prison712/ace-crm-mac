import { cn } from '@/lib/utils'
import type { TextareaHTMLAttributes } from 'react'

/**
 * 多行输入框（地图模块专用；桌面端 Input 无 Textarea）。
 * @param props textarea 原生属性
 */
export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>): React.ReactElement {
  return (
    <textarea
      className={cn(
        'flex w-full border border-input bg-transparent px-2 py-1.5 text-[13px] transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}
