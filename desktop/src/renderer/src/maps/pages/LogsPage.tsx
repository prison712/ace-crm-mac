import { Button } from '@/components/ui/button'
import { api } from '@/maps/services/api'
import type { LogRow } from '@/maps/types'
import { useEffect, useState } from 'react'

/**
 * 日志页：展示运行状态。
 */
export function LogsPage(): React.ReactElement {
  const [logs, setLogs] = useState<LogRow[]>([])

  async function load(): Promise<void> {
    setLogs(await api.listLogs(400))
  }

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 2000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">运行日志</h2>
        <Button
          className="ml-auto"
          variant="secondary"
          onClick={() => void api.clearLogs().then(load)}
        >
          清空日志
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-auto font-mono text-xs">
        {logs.map((log) => (
          <div key={log.id} className="rounded bg-[var(--background)] px-2 py-1">
            <span className="text-[var(--muted-foreground)]">{log.createdAt}</span>{' '}
            <span
              className={
                log.level === 'error'
                  ? 'text-[var(--destructive)]'
                  : log.level === 'warn'
                    ? 'text-amber-700'
                    : ''
              }
            >
              [{log.level}]
            </span>{' '}
            {log.message}
          </div>
        ))}
        {logs.length === 0 && <p className="text-[var(--muted-foreground)]">暂无日志</p>}
      </div>
    </div>
  )
}
