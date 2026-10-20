import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LauncherConfig } from '@shared/types'

const configFile = () => join(app.getPath('userData'), 'config.json')

const CONFIG_VERSION = 2

/** PCL-CE 的默认 JVM 参数（LaunchAdvanceJvm） */
export const PCL_DEFAULT_JVM_ARGS =
  '-XX:+UseG1GC -XX:-UseAdaptiveSizePolicy -XX:-OmitStackTraceInFastThrow -Djdk.lang.Process.allowAmbiguousCommands=true -Dfml.ignoreInvalidMinecraftCertificates=True -Dfml.ignorePatchDiscrepancies=True -Dlog4j2.formatMsgNoLookups=true'

function defaults(): LauncherConfig {
  return {
    configVersion: CONFIG_VERSION,
    gameDir: join(app.getPath('userData'), '.minecraft'),
    gameFolders: [],
    isolationMode: 4,
    javaPath: '',
    memoryMode: 'auto',
    memoryTick: 15,
    memoryInitialTick: 0,
    lockMemory: false,
    jvmArgs: PCL_DEFAULT_JVM_ARGS,
    gameArgs: '',
    preferredIpStack: 'default',
    windowMode: 'default',
    windowWidth: 854,
    windowHeight: 480,
    versionType: 'PixelsWorld',
    preLaunchCommand: '',
    preLaunchWait: true,
    processPriority: 'normal',
    autoGameLanguage: true,
    gpuPreference: true,
    // 中文系统默认使用 BMCLAPI 镜像
    downloadSource: app.getLocale().startsWith('zh') ? 'bmclapi' : 'official',
    concurrency: 16,
    themeSeed: '#4CAF50',
    themeMode: 'system',
    selectedVersion: '',
    selectedAccount: '',
    msClientId: '',
    afterLaunch: 'keep'
  }
}

/** 从 0.1.0 的配置迁移 */
function migrate(saved: Record<string, unknown>): Partial<LauncherConfig> {
  if ((saved.configVersion as number) >= CONFIG_VERSION) return saved as Partial<LauncherConfig>
  const out: Record<string, unknown> = { ...saved, configVersion: CONFIG_VERSION }
  if (typeof saved.versionIsolation === 'boolean') out.isolationMode = saved.versionIsolation ? 4 : 0
  if (typeof saved.maxMemory === 'number') {
    out.memoryMode = 'custom'
    out.memoryTick = tickFromMb(saved.maxMemory)
  }
  if (typeof saved.fullscreen === 'boolean') out.windowMode = saved.fullscreen ? 'fullscreen' : 'custom'
  if (saved.afterLaunch === 'minimize') out.afterLaunch = 'minimizeAndReopen'
  if (saved.afterLaunch === 'hide') out.afterLaunch = 'hideAndReopen'
  if (!saved.jvmArgs) out.jvmArgs = PCL_DEFAULT_JVM_ARGS
  for (const k of ['versionIsolation', 'maxMemory', 'minMemory', 'fullscreen']) delete out[k]
  return out as Partial<LauncherConfig>
}

/** MB -> 最接近的 PCL 内存刻度 */
function tickFromMb(mb: number): number {
  const gb = mb / 1024
  if (gb <= 1.5) return Math.max(1, Math.round((gb - 0.3) / 0.1))
  if (gb <= 8) return Math.round((gb - 1.5) / 0.5) + 12
  if (gb <= 16) return Math.round(gb - 8) + 25
  return Math.round((gb - 16) / 2) + 33
}

let cache: LauncherConfig | null = null

export function getConfig(): LauncherConfig {
  if (cache) return cache
  let saved: Record<string, unknown> = {}
  try {
    if (existsSync(configFile())) saved = JSON.parse(readFileSync(configFile(), 'utf8'))
  } catch {
    // 配置损坏时回落到默认值
  }
  cache = { ...defaults(), ...migrate(saved) }
  return cache
}

export async function setConfig(patch: Partial<LauncherConfig>): Promise<LauncherConfig> {
  cache = { ...getConfig(), ...patch }
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(configFile(), JSON.stringify(cache, null, 2))
  return cache
}
