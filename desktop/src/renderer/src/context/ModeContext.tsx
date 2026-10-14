import { createContext, useContext } from 'react'

export type AppMode = 'workbench' | 'social' | 'maps'

export const ModeContext = createContext<{
  appMode: AppMode
  setAppMode: (mode: AppMode) => void
}>({
  appMode: 'workbench',
  setAppMode: () => undefined
})

export function useAppMode() {
  return useContext(ModeContext)
}
