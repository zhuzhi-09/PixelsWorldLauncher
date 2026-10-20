/** PCL-CE 内存滑块刻度 -> GB（PageSetupLaunch.GetRamFromTick） */
export function ramFromTick(tick: number): number {
  if (tick <= 12) return tick * 0.1 + 0.3
  if (tick <= 25) return (tick - 12) * 0.5 + 1.5
  if (tick <= 33) return tick - 25 + 8
  return (tick - 33) * 2 + 16
}

/** 不超过 maxGb 的最大刻度，用于限制滑块范围 */
export function maxTickFor(maxGb: number): number {
  let t = 1
  while (ramFromTick(t + 1) <= maxGb) t++
  return t
}

export const formatGb = (gb: number) => `${gb.toFixed(1)} GB`
