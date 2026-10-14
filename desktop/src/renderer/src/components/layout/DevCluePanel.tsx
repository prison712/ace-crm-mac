import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PlatformId } from '@/lib/types'
import { useApp } from '@/store/AppProvider'

type CluePlatform = 'line' | 'whatsapp'

function isCluePlatform(id: PlatformId | null | undefined): id is CluePlatform {
  return id === 'line' || id === 'whatsapp'
}

/** 测试模式开启时：伪造添加好友 / 好友发消息 */
export function DevCluePanel(): React.JSX.Element | null {
  const { state, activeTab, testModeEnabled } = useApp()
  const [accountUid, setAccountUid] = useState('')
  const [accountName, setAccountName] = useState('')
  const [friendText, setFriendText] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')

  if (!testModeEnabled) return null
  if (!isCluePlatform(state.selectedGroupId)) return null
  if (!activeTab || activeTab.groupId !== state.selectedGroupId) return null

  const platform = state.selectedGroupId

  async function run(mode: 'add_friend' | 'friend_message'): Promise<void> {
    if (busy) return
    setBusy(true)
    setLog('上报中…')
    try {
      const res = await window.api.clueDevFake({
        mode,
        platform,
        tabId: activeTab!.id,
        webviewLabel: activeTab!.webviewLabel,
        accountUid,
        accountName,
        friendText
      })
      if (!res.ok) {
        setLog(res.error || res.reason || '失败')
        return
      }
      const f = res.friend
      setLog(
        [
          mode === 'add_friend' ? '已伪造添加好友' : '已伪造好友发消息',
          res.account ? `登录 ${res.account.name} (${res.account.uid})` : '',
          f ? `好友 ${f.name} (${f.uid})` : '',
          `+新${res.new_unique ?? 0}/重${res.new_duplicate ?? 0}/讯${res.new_messaged ?? 0}`
        ]
          .filter(Boolean)
          .join(' · ')
      )
      if (f && !friendText.trim()) {
        setFriendText(`${f.uid}|${f.name}`)
      }
      if (res.account) {
        if (!accountUid.trim()) setAccountUid(res.account.uid)
        if (!accountName.trim()) setAccountName(res.account.name)
      }
    } catch (e) {
      setLog(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="shrink-0 border-t border-amber-500/40 bg-amber-500/10 px-2 py-2">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
        测试 · {platform === 'whatsapp' ? 'WhatsApp' : 'LINE'} 线索
      </p>
      <div className="flex flex-col gap-1.5">
        <Input
          value={accountUid}
          onChange={(e) => setAccountUid(e.target.value)}
          placeholder="当前登录用户 ID（可空则自动）"
          className="h-7 text-[11px]"
          disabled={busy}
        />
        <Input
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          placeholder="当前登录用户名（可空则自动）"
          className="h-7 text-[11px]"
          disabled={busy}
        />
        <Input
          value={friendText}
          onChange={(e) => setFriendText(e.target.value)}
          placeholder="好友：uid 或 uid|名称（可空则自动生成）"
          className="h-7 text-[11px]"
          disabled={busy}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 w-full text-[11px]"
          disabled={busy}
          onClick={() => void run('add_friend')}
        >
          伪造添加好友
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 w-full text-[11px]"
          disabled={busy}
          onClick={() => void run('friend_message')}
        >
          伪造好友发消息
        </Button>
        {log ? (
          <p className="break-all text-[10px] leading-snug text-muted-foreground">{log}</p>
        ) : (
          <p className="text-[10px] leading-snug text-muted-foreground">
            上方填当前登录用户 ID/用户名；好友框两种按钮共用。建议先添加好友再测发消息。
          </p>
        )}
      </div>
    </div>
  )
}
