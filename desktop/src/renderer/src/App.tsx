import { useCallback, useEffect, useState } from 'react'
import { I18nProvider } from '@/context/I18nContext'
import { ModeContext } from '@/context/ModeContext'
import { LoginPage } from '@/pages/LoginPage'
import { AppShell } from '@/pages/AppShell'
import { AppProvider } from '@/store/AppProvider'
import { setStorageScope } from '@/lib/storage'
import type { AuthPublicState } from '../../preload/index.d'

const EMPTY_AUTH: AuthPublicState = {
  authenticated: false,
  inviteCode: null,
  inviteCodeId: null,
  token: null,
  backendUrl: 'http://localhost:3001',
  userId: null,
  username: null,
  displayName: null,
  scopeKey: null
}

export default function App(): React.JSX.Element {
  const [booting, setBooting] = useState(true)
  const [auth, setAuth] = useState<AuthPublicState>(EMPTY_AUTH)
  const [appMode, setAppMode] = useState<'workbench' | 'social' | 'maps'>('workbench')

  const refreshAuth = useCallback(async () => {
    const state = await window.api.authGetState()
    setStorageScope(state.scopeKey || state.userId || state.username || 'anonymous')
    setAuth(state)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await refreshAuth()
      } finally {
        setBooting(false)
      }
    })()

    return window.api.onAuthExpired(() => {
      setStorageScope('anonymous')
      setAuth((prev) => ({
        ...prev,
        authenticated: false,
        inviteCode: null,
        inviteCodeId: null,
        token: null,
        userId: null,
        username: null,
        displayName: null,
        scopeKey: null
      }))
    })
  }, [refreshAuth])

  useEffect(() => {
    if (typeof window.api.onAppModeChanged !== 'function') return
    return window.api.onAppModeChanged((mode) => {
      if (mode === 'workbench' || mode === 'social' || mode === 'maps') setAppMode(mode)
    })
  }, [])

  if (booting) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
        加载中…
      </div>
    )
  }

  if (!auth.authenticated) {
    return (
      <I18nProvider>
        <LoginPage
          initialBackendUrl={auth.backendUrl}
          onLoggedIn={() => {
            void refreshAuth()
          }}
        />
      </I18nProvider>
    )
  }

  const providerKey =
    auth.scopeKey || auth.userId || auth.username || auth.inviteCode || 'session'

  return (
    <I18nProvider>
      <ModeContext.Provider value={{ appMode, setAppMode }}>
        {/* key 随账号变化：强制重载标签状态，避免沿用上一账号的内存态 */}
        <AppProvider key={providerKey}>
          <AppShell
            inviteCode={auth.displayName || auth.username || auth.inviteCode}
            onLogout={() => {
              setStorageScope('anonymous')
              void refreshAuth()
            }}
          />
        </AppProvider>
      </ModeContext.Provider>
    </I18nProvider>
  )
}
