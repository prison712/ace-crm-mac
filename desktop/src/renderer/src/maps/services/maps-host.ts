export interface MapsBounds {
  x: number
  y: number
  width: number
  height: number
}

/** 前端期望的地图可见性（防止 navigate/ensure 把已隐藏的地图又显示出来） */
let desiredVisible = false

/**
 * 当前是否期望显示地图。
 * @returns 期望可见
 */
export function isMapsDesiredVisible(): boolean {
  return desiredVisible
}

/**
 * 把当前期望的可见性重新应用到原生子 WebView。
 */
async function applyDesiredVisibility(): Promise<void> {
  await window.api.maps.setMapsVisible(desiredVisible)
}

/**
 * 在主窗口内嵌地图子 WebView，并同步到宿主 DOM 区域。
 * @param bounds 相对主窗口客户区的逻辑坐标
 * @param url 要加载的地址；已存在时也会导航
 */
export async function ensureMapsChild(bounds: MapsBounds, url: string): Promise<void> {
  await window.api.maps.ensureMapsChild(url, bounds.x, bounds.y, bounds.width, bounds.height)
  await applyDesiredVisibility()
}

/**
 * 仅更新地图子 WebView 几何，不改 URL。
 * @param bounds 逻辑坐标与尺寸
 */
export async function syncMapsBounds(bounds: MapsBounds): Promise<void> {
  if (!desiredVisible) {
    // 非搜索页时不要把隐藏的 WebView 拉回可视区域
    return
  }
  if (bounds.width < 40 || bounds.height < 40) return
  await window.api.maps.setMapsBounds(bounds.x, bounds.y, bounds.width, bounds.height)
}

/**
 * 显示或隐藏地图子 WebView（切换标签时用）。
 * @param visible 是否可见
 */
export async function setMapsVisible(visible: boolean): Promise<void> {
  desiredVisible = visible
  await window.api.maps.setMapsVisible(visible)
}

/**
 * 从宿主元素量出相对窗口的逻辑 bounds。
 * @param el 地图占位 DOM
 * @returns 逻辑像素矩形
 */
export function measureHostBounds(el: HTMLElement): MapsBounds {
  const rect = el.getBoundingClientRect()
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  }
}
