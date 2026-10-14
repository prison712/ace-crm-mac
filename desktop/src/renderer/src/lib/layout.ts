import type { WebviewBounds } from './types'

const MIN_CONTENT_SIZE = 80

export function measureContentAreaBounds(): WebviewBounds | null {
  const el = document.querySelector('[data-content-area]')
  if (!el) return null

  const rect = el.getBoundingClientRect()
  if (rect.width < MIN_CONTENT_SIZE || rect.height < MIN_CONTENT_SIZE) {
    return null
  }

  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  }
}

export async function waitForContentAreaBounds(): Promise<WebviewBounds> {
  let last: WebviewBounds | null = null

  for (let i = 0; i < 12; i++) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })

    const bounds = measureContentAreaBounds()
    if (!bounds) continue

    if (
      last &&
      Math.abs(last.x - bounds.x) < 1 &&
      Math.abs(last.y - bounds.y) < 1 &&
      Math.abs(last.width - bounds.width) < 1 &&
      Math.abs(last.height - bounds.height) < 1
    ) {
      return bounds
    }

    last = bounds
  }

  const bounds = measureContentAreaBounds()
  if (!bounds) {
    throw new Error('content area bounds not available')
  }
  return bounds
}
