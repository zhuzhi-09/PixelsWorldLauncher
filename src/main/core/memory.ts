import { freemem, totalmem } from 'node:os'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { InstanceSettings, LauncherConfig } from '@shared/types'

import { ramFromTick } from '@shared/ram'

const GB = 1024 ** 3

export interface MemoryContext {
  modable: boolean
  optifine: boolean
  /** 实际运行目录（考虑版本隔离），用于统计 mods 数量 */
  gameDir: string
}

function countMods(gameDir: string): number {
  try {
    return readdirSync(join(gameDir, 'mods'), { withFileTypes: true }).filter((d) => d.isFile()).length
  } catch {
    return 0
  }
}

/**
 * 自动分配内存，返回 GB。
 * 先按版本类型估算需求（原版 2G、OptiFine 3G、Mod 版本 3G + 每个 Mod 30M，最多 12G），
 * 再限制在系统可承受范围内：给系统保留总内存的 20%（至少 1.5G），且不超过当前空闲内存的 90%。
 */
export function autoRam(ctx: MemoryContext): number {
  const total = totalmem() / GB
  const free = freemem() / GB
  const need = ctx.modable ? Math.min(12, 3 + countMods(ctx.gameDir) * 0.03) : ctx.optifine ? 3 : 2
  const cap = Math.min(total - Math.max(1.5, total * 0.2), free * 0.9)
  const give = Math.max(1, Math.min(need, cap))
  // 取 0.5G 的整数倍，更符合常见设置习惯
  return Math.max(1, Math.floor(give * 2) / 2)
}

export interface MemoryPlan {
  /** -Xmx，GB */
  max: number
  /** -Xms，GB；null 表示不设置 */
  initial: number | null
}

/** 合并全局与实例设置（含 PCL-CE 实例配置中的内存选项），得到最终内存 */
export function planMemory(
  cfg: LauncherConfig,
  inst: InstanceSettings,
  ctx: MemoryContext,
  is64BitJava = true
): MemoryPlan {
  const useGlobal = inst.memoryMode === 'global'
  const mode = useGlobal ? cfg.memoryMode : inst.memoryMode
  let max = mode === 'auto' ? autoRam(ctx) : ramFromTick(useGlobal ? cfg.memoryTick : inst.memoryTick)
  // 32 位 Java 最多 1G
  if (!is64BitJava) max = Math.min(1, max)

  let initial: number | null = null
  // 自定义 JVM 参数里已有 -Xms 时以它为准
  const jvm = inst.jvmArgs || cfg.jvmArgs
  if (/-Xms/i.test(jvm)) initial = null
  else if (cfg.lockMemory) initial = max
  else if (mode === 'custom') {
    const tick = useGlobal ? cfg.memoryInitialTick : inst.memoryInitialTick
    if (tick > 0) initial = Math.min(ramFromTick(tick), max)
  }
  return { max, initial }
}

export const systemMemory = () => ({
  free: Math.round((freemem() / GB) * 10) / 10,
  total: Math.round((totalmem() / GB) * 10) / 10
})
