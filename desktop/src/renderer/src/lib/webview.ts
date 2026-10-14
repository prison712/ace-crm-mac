import type { PlatformId, ProxyConfig, WebviewBounds } from './types'

export type { WebviewBounds }

interface ViewResult {
  ok: boolean
  error?: string
}

export async function createContentWebview(
  label: string,
  tabId: string,
  groupId: PlatformId,
  url: string,
  bounds: WebviewBounds,
  proxyUrl?: string | null,
  force = false
): Promise<void> {
  if (force) {
    await window.api.viewDestroy({ label })
  }
  const res = (await window.api.viewCreate({
    label,
    tabId,
    groupId,
    url,
    bounds,
    proxyUrl: proxyUrl ?? null
  })) as ViewResult
  if (!res.ok) {
    throw new Error(res.error || 'view:create failed')
  }
}

export async function recreateContentWebview(
  label: string,
  tabId: string,
  groupId: PlatformId,
  url: string,
  bounds: WebviewBounds,
  proxyUrl: string | null,
  visible = true
): Promise<void> {
  const res = (await window.api.viewRecreate({
    label,
    tabId,
    groupId,
    url,
    bounds,
    proxyUrl,
    visible
  })) as ViewResult
  if (!res.ok) {
    throw new Error(res.error || 'view:recreate failed')
  }
}

export async function destroyContentWebview(
  label: string,
  opts?: { tabId?: string; purgeFingerprint?: boolean }
): Promise<void> {
  await window.api.viewDestroy({
    label,
    tabId: opts?.tabId,
    purgeFingerprint: opts?.purgeFingerprint
  })
}

export async function showContentWebview(
  label: string,
  bounds?: WebviewBounds
): Promise<void> {
  const res = (await window.api.viewShow({ label, bounds })) as ViewResult
  if (!res.ok) {
    throw new Error(res.error || 'view:show failed')
  }
}

export async function hideContentWebview(label: string): Promise<void> {
  await window.api.viewHide({ label })
}

export async function suspendContentWebview(label: string): Promise<void> {
  await hideContentWebview(label)
}

export async function resizeContentWebview(
  label: string,
  bounds: WebviewBounds
): Promise<void> {
  await window.api.viewSetBounds({ label, bounds })
}

export async function reloadContentWebview(label: string): Promise<void> {
  const res = (await window.api.viewReload({ label })) as ViewResult
  if (!res.ok) {
    throw new Error(res.error || 'view:reload failed')
  }
}

export async function getContentWebviewUrl(label: string): Promise<string | null> {
  return window.api.viewGetUrl({ label })
}

export async function closeContentWebview(
  label: string,
  opts?: { tabId?: string; purgeFingerprint?: boolean }
): Promise<void> {
  await destroyContentWebview(label, opts)
}

export async function hideAllContentWebviews(): Promise<void> {
  await window.api.viewHideAll()
}

/** 主进程只保留这些 label 的视图，其余（含窗口上游离 BrowserView）全部销毁 */
export async function reconcileContentWebviews(keepLabels: string[]): Promise<void> {
  await window.api.viewReconcile({ keepLabels })
}

export function buildProxyArg(proxy: ProxyConfig | null | undefined): string | null {
  if (!proxy) return null
  return null
}
