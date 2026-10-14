/**
 * 地图采集专用工具：搜索 URL / 队列 / 地点键 / 店名对齐。
 * （与 @/lib/utils 的 cn 分离，避免冲突）
 */

/**
 * 把关键词与地点编成谷歌地图搜索 URL。
 * @param keyword 搜索关键词
 * @param location 地点文案
 * @returns 完整搜索地址
 */
export function buildMapsSearchUrl(keyword: string, location: string): string {
  const q = `${keyword.trim()} in ${location.trim()}`.replace(/\s+/g, '+')
  return `https://www.google.com/maps/search/${q}`
}

/**
 * 多关键词与多地点做笛卡尔积。
 * @param keywords 关键词列表
 * @param locations 地点列表
 * @returns 待采集队列
 */
export function buildSearchQueue(
  keywords: string[],
  locations: string[]
): Array<{ keyword: string; location: string; url: string }> {
  const queue: Array<{ keyword: string; location: string; url: string }> = []
  for (const keyword of keywords) {
    const k = keyword.trim()
    if (!k) continue
    for (const location of locations) {
      const loc = location.trim()
      if (!loc) continue
      queue.push({ keyword: k, location: loc, url: buildMapsSearchUrl(k, loc) })
    }
  }
  return queue
}

/**
 * 解析多行/逗号分隔的关键词输入。
 * @param text 原始文本
 * @returns 去重后的关键词
 */
export function parseKeywordInput(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,，;；]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ]
}

/**
 * 从谷歌地图链接提取稳定地点键（同一商家不同追踪参数会归并）。
 * @param url 地图链接
 * @returns 地点键；无法解析时返回空串
 */
export function mapsPlaceKey(url?: string | null): string {
  if (!url) return ''
  const id = url.match(/!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/)
  if (id) return id[1].toLowerCase()
  const ftid = url.match(/[?&/]ftid=(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/i)
  if (ftid) return ftid[1].toLowerCase()
  const path = url.match(/\/maps\/place\/([^/@?#]+)/)
  if (path) {
    try {
      return decodeURIComponent(path[1]).toLowerCase()
    } catch {
      return path[1].toLowerCase()
    }
  }
  return ''
}

/**
 * 粗略判断两个商家名是否同一家（防详情未切换）。
 * @param a 名称 A
 * @param b 名称 B
 * @returns 是否对齐
 */
export function businessNamesMatch(a?: string | null, b?: string | null): boolean {
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[\s\u3000]+/g, '')
      .replace(/[（(].*$/, '')
      .trim()
  const na = norm(a || '')
  const nb = norm(b || '')
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}
