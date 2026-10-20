/** 已知的愚人节版本（不区分大小写的前缀） */
const KNOWN_FOOLS = [
  '2.0',
  '15w14a',
  '1.rv-pre1',
  '3d shareware',
  '20w14infinite',
  '20w14∞',
  '22w13oneblockatatime',
  '23w13a_or_b',
  '24w14potato',
  '25w14craftmine'
]

/**
 * 判断是否为愚人节版本：已知名单，或在 4 月 1 日前后发布、且版本号不符合常规快照格式的快照
 */
export function isAprilFools(id: string, releaseTime?: string): boolean {
  const lower = id.toLowerCase()
  if (KNOWN_FOOLS.some((f) => lower.startsWith(f))) return true
  if (!releaseTime) return false
  const t = new Date(releaseTime)
  const month = t.getUTCMonth() + 1
  const day = t.getUTCDate()
  const nearAprilFirst = (month === 3 && day === 31) || (month === 4 && day <= 2)
  const regular = /^\d{2}w\d{2}[a-z]$/.test(lower) || /-(pre|rc|snapshot)/.test(lower) || /^[\d.]+$/.test(lower)
  return nearAprilFirst && !regular
}
