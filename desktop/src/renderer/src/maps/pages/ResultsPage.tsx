import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { collectionEngine } from '@/maps/collection/engine'
import { showToast } from '@/maps/components/ui/toast'
import { api } from '@/maps/services/api'
import type { BusinessRow, TaskRow } from '@/maps/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'

/** 加入客户管理时要核对的字段。客户名称必填。 */
interface CustomerDraft {
  businessId: number
  name: string
  company: string
  contactPerson: string
  email: string
  phone: string
  website: string
  country: string
  notes: string
}

/**
 * 结果页：分页表格 + Excel 导出；每采到一条立即刷新。
 */
export function ResultsPage({
  currentTask
}: {
  currentTask: TaskRow | null
}): React.ReactElement {
  const [rows, setRows] = useState<BusinessRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)
  const [draft, setDraft] = useState<CustomerDraft | null>(null)
  const [savingCustomer, setSavingCustomer] = useState(false)
  const pageSize = 20
  const taskId = currentTask?.id ?? null
  const pageRef = useRef(page)
  const taskIdRef = useRef(taskId)

  useEffect(() => {
    pageRef.current = page
  }, [page])
  useEffect(() => {
    taskIdRef.current = taskId
  }, [taskId])

  /**
   * 从数据库拉取当前页结果。
   */
  const load = useCallback(async () => {
    const [list, count] = await api.listBusinesses(taskIdRef.current, pageRef.current, pageSize)
    setRows(list)
    setTotal(count)
  }, [pageSize])

  useEffect(() => {
    void load()
  }, [page, taskId, load])

  useEffect(() => {
    return collectionEngine.subscribeStats(() => {
      void load()
    })
  }, [load])

  /**
   * 导出当前任务（或全部）为 Excel，弹出系统另存为对话框。
   */
  async function handleExport(): Promise<void> {
    if (exporting) return
    setExporting(true)
    try {
      const data = await api.exportBusinesses(taskId)
      if (data.length === 0) {
        showToast('没有可导出的数据', 'info')
        await api.addLog('warn', '导出取消：没有数据')
        return
      }

      const defaultName = `maps-businesses-${Date.now()}.xlsx`
      const path = await api.pickExportPath(defaultName)
      if (!path) {
        showToast('已取消导出', 'info')
        return
      }

      const sheetData = data.map((row) => ({
        任务ID: row.taskId,
        关键词: row.keyword,
        地点: row.location,
        业务类别: row.category || '',
        商家名称: row.name,
        手机: row.phone || '',
        邮箱: row.email || '',
        网站: row.website || '',
        地图链接: row.mapsUrl || '',
        采集时间: row.createdAt
      }))
      const sheet = XLSX.utils.json_to_sheet(sheetData)
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, '商家')
      const buffer = XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
      const bytes = Array.from(new Uint8Array(buffer))
      await api.writeExportFile(path, bytes)

      showToast(`已导出 ${data.length} 条`, 'success')
      await api.addLog('info', `已导出 ${data.length} 条到 ${path}`)
    } catch (error) {
      showToast(`导出失败：${String(error)}`, 'error')
      await api.addLog('error', `导出失败: ${String(error)}`)
    } finally {
      setExporting(false)
    }
  }

  /**
   * 用采集结果预填客户表。国家取地点最后一段。
   * @param row 商家行
   */
  function openCustomerDraft(row: BusinessRow): void {
    const parts = String(row.location || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    setDraft({
      businessId: row.id,
      name: row.name || '',
      company: row.name || '',
      contactPerson: '',
      email: row.email || '',
      phone: row.phone || '',
      website: row.website || '',
      country: parts[parts.length - 1] || '',
      notes: [`关键词: ${row.keyword || ''}`, `地点: ${row.location || ''}`, row.mapsUrl || '']
        .filter(Boolean)
        .join('\n')
    })
  }

  /**
   * 把核对后的商家写入客户管理。
   */
  async function saveCustomer(): Promise<void> {
    if (!draft || savingCustomer) return
    if (!draft.name.trim()) {
      showToast('请填写客户名称', 'error')
      return
    }
    setSavingCustomer(true)
    try {
      const created = await api.createCustomer(draft)
      showToast('已加入客户管理', 'success')
      await api.addLog('info', `已加入客户管理: ${draft.name} (${created.id})`)
      setDraft(null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setSavingCustomer(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">采集结果</h2>
        <span className="text-xs text-[var(--muted-foreground)]">
          {taskId ? `任务 #${taskId}` : '全部任务'} · 共 {total} 条
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" disabled={exporting} onClick={() => void handleExport()}>
            {exporting ? '导出中…' : '导出 Excel'}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-[var(--accent)]">
            <tr>
              {['名称', '类别', '手机', '邮箱', '网站', '地点', '关键词', '操作'].map((h) => (
                <th key={h} className="px-2 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-[var(--border)]">
                <td className="px-2 py-2">{row.name}</td>
                <td className="px-2 py-2">{row.category}</td>
                <td className="px-2 py-2">{row.phone}</td>
                <td className="px-2 py-2">{row.email}</td>
                <td className="max-w-[180px] truncate px-2 py-2" title={row.website || ''}>
                  {row.website}
                </td>
                <td className="px-2 py-2">{row.location}</td>
                <td className="px-2 py-2">{row.keyword}</td>
                <td className="px-2 py-2">
                  <Button className="h-7 text-xs" variant="secondary" onClick={() => openCustomerDraft(row)}>
                    加入客户
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-2 py-8 text-center text-[var(--muted-foreground)]">
                  暂无数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          上一页
        </Button>
        <span className="text-sm text-[var(--muted-foreground)]">
          {page} / {totalPages}
        </span>
        <Button
          variant="secondary"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          下一页
        </Button>
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-lg"
            onSubmit={(event) => {
              event.preventDefault()
              void saveCustomer()
            }}
          >
            <h3 className="text-sm font-semibold">加入客户管理</h3>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              客户名称必填。电话、邮箱、网站已从采集结果带入，联系人需要的话请补上。来源记为地图采集。
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="text-xs">
                客户名称
                <Input
                  className="mt-1"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label className="text-xs">
                公司
                <Input
                  className="mt-1"
                  value={draft.company}
                  onChange={(event) => setDraft({ ...draft, company: event.target.value })}
                />
              </label>
              <label className="text-xs">
                联系人
                <Input
                  className="mt-1"
                  value={draft.contactPerson}
                  onChange={(event) => setDraft({ ...draft, contactPerson: event.target.value })}
                />
              </label>
              <label className="text-xs">
                国家
                <Input
                  className="mt-1"
                  value={draft.country}
                  onChange={(event) => setDraft({ ...draft, country: event.target.value })}
                />
              </label>
              <label className="text-xs">
                电话
                <Input
                  className="mt-1"
                  value={draft.phone}
                  onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                />
              </label>
              <label className="text-xs">
                邮箱
                <Input
                  className="mt-1"
                  value={draft.email}
                  onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                />
              </label>
              <label className="text-xs sm:col-span-2">
                网站
                <Input
                  className="mt-1"
                  value={draft.website}
                  onChange={(event) => setDraft({ ...draft, website: event.target.value })}
                />
              </label>
              <label className="text-xs sm:col-span-2">
                备注
                <textarea
                  className="mt-1 min-h-[72px] w-full rounded-md border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
                  value={draft.notes}
                  onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                />
              </label>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDraft(null)}>
                取消
              </Button>
              <Button type="submit" disabled={savingCustomer}>
                {savingCustomer ? '提交中…' : '确认加入'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
