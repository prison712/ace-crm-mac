/**
 * 外壳当前模式。社媒、地图、工作台各有一层原生 BrowserView，
 * 只有当前模式允许把自己的视图挂回主窗口，避免切页后两层叠在一起花屏。
 */
export type ShellMode = 'workbench' | 'social' | 'maps'

let mode: ShellMode = 'workbench'
/** 用户设置盖住主区域时，工作台和地图不能再挂回窗口。 */
let userSettingsOverlay = false

/**
 * 读取当前外壳模式。
 * @returns 工作台、社媒或地图
 */
export function getShellMode(): ShellMode {
  return mode
}

/**
 * 记录当前外壳模式。应在挂载任何 BrowserView 之前调用。
 * @param next 新模式
 */
export function setShellMode(next: ShellMode): void {
  mode = next
}

/**
 * 用户设置是否正盖住主区域。
 * @returns 为 true 时不要把工作台或地图挂回窗口
 */
export function isUserSettingsOverlay(): boolean {
  return userSettingsOverlay
}

/**
 * 记录用户设置是否打开。打开期间原生页面必须让出主区域。
 * @param open 是否打开用户设置
 * @returns void
 */
export function setUserSettingsOverlay(open: boolean): void {
  userSettingsOverlay = open
}
