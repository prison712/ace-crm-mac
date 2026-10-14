import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LangSwitch } from '@/components/layout/LangSwitch'
import { TitleBar } from '@/components/layout/TitleBar'

interface LoginPageProps {
  initialBackendUrl?: string
  onLoggedIn: () => void
}

export function LoginPage({ initialBackendUrl = '', onLoggedIn }: LoginPageProps): React.JSX.Element {
  const [backendUrl, setBackendUrl] = useState(initialBackendUrl || 'http://localhost:3001')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e?: FormEvent): Promise<void> => {
    e?.preventDefault()
    const trimmedUrl = backendUrl.trim()
    if (!trimmedUrl) {
      setError('请先填写后端地址')
      return
    }
    if (!username.trim() || !password) {
      setError('请输入用户名和密码')
      return
    }

    setLoading(true)
    setError('')
    try {
      const res = await window.api.authLogin({
        backendUrl: trimmedUrl,
        username: username.trim(),
        password
      })
      if (res.ok) {
        onLoggedIn()
      } else {
        setError(res.error || '登录失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <TitleBar langSwitch={<LangSwitch className="h-6 px-1.5 text-[10px]" />} />

      <div className="flex flex-1 items-center justify-center p-6">
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="w-full max-w-[320px] space-y-4 border border-border bg-card p-5"
        >
          <div className="space-y-1 text-center">
            <h1 className="text-base font-semibold text-foreground">子账户登录</h1>
            <p className="text-[11px] text-muted-foreground">仅子账户可登录桌面端，管理员请使用后台网页</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="backendUrl">后端地址</Label>
            <Input
              id="backendUrl"
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
              placeholder="http://8.219.152.183:3088"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="username">用户名</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {error ? <p className="text-[11px] text-destructive">{error}</p> : null}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? '登录中…' : '登录'}
          </Button>
        </form>
      </div>
    </div>
  )
}
