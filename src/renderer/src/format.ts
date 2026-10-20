import type { ResourceType } from '@shared/types'

/** 12345 -> 1.2 万 */
export function formatCount(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)} 亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万`
  return String(n)
}

/** 相对时间：3 天前 */
export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} 分钟前`
  if (s < 86400) return `${Math.round(s / 3600)} 小时前`
  if (s < 86400 * 30) return `${Math.round(s / 86400)} 天前`
  if (s < 86400 * 365) return `${Math.round(s / 86400 / 30)} 个月前`
  return `${Math.round(s / 86400 / 365)} 年前`
}

export const formatDate = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '')

export const formatSize = (b: number) =>
  b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`

export const RESOURCE_LABEL: Record<ResourceType, string> = {
  mod: '模组',
  modpack: '整合包',
  resourcepack: '资源包',
  shader: '光影',
  datapack: '数据包'
}

export const RESOURCE_ICON: Record<ResourceType, string> = {
  mod: 'extension',
  modpack: 'inventory_2',
  resourcepack: 'texture',
  shader: 'wb_sunny',
  datapack: 'data_object'
}

/** 把版本列表压缩成区间，便于显示：1.20, 1.20.1, 1.20.2 -> 1.20–1.20.2 */
export function compactVersions(list: string[], max = 4): string {
  const rel = list.filter((v) => /^\d+\.\d+(\.\d+)?$/.test(v))
  const show = rel.length ? rel : list
  if (show.length <= max) return show.join(', ')
  return `${show[0]} – ${show[show.length - 1]}`
}
