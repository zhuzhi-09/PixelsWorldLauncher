import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { InstalledVersion, LoaderType } from '@shared/types'
import { getConfig } from './config'
import { readInstanceSettings, writeInstanceSettings } from './pcl/instanceConfig'
import { paths, readVersionJson, resolveVersion, VersionJson } from './version'

/** 对应 PCL-CE 的 McInstance 中与分类相关的信息 */
export interface InstanceInfo {
  loader: LoaderType
  addons: LoaderType[]
  gameVersion: string
  modable: boolean
  optifine: boolean
  nonRelease: boolean
}

const MODABLE: LoaderType[] = ['fabric', 'legacyfabric', 'quilt', 'forge', 'liteloader', 'neoforge', 'cleanroom']

function detectAddons(v: VersionJson): LoaderType[] {
  const main = v.mainClass ?? ''
  const libs = v.libraries.map((l) => l.name.toLowerCase())
  const has = (prefix: string) => libs.some((n) => n.startsWith(prefix))
  const out: LoaderType[] = []
  if (has('com.cleanroommc:cleanroom')) out.push('cleanroom')
  else if (has('net.neoforged')) out.push('neoforge')
  else if (has('net.minecraftforge:forge') || has('net.minecraftforge:fmlloader') || main.includes('cpw.mods'))
    out.push('forge')
  if (has('org.quiltmc:quilt-loader')) out.push('quilt')
  else if (has('net.legacyfabric')) out.push('legacyfabric')
  else if (has('net.fabricmc:fabric-loader')) out.push('fabric')
  if (has('com.mumfrey:liteloader')) out.push('liteloader')
  if (has('optifine:optifine')) out.push('optifine')
  if (main.toLowerCase().includes('labymod') || has('net.labymod')) out.push('labymod')
  return out
}

/** 沿 inheritsFrom 找到原版版本号 */
async function rootVersionId(id: string, depth = 0): Promise<string> {
  const v = await readVersionJson(id)
  if (!v.inheritsFrom || depth > 8) return (v as { clientVersion?: string }).clientVersion ?? v.id
  return rootVersionId(v.inheritsFrom, depth + 1)
}

/** 愚人节版本的常见名称 */
const FOOL = /^(2\.0|15w14a|1\.rv-pre1|3d shareware|20w14infinite|22w13oneblockatatime|23w13a_or_b|24w14potato|25w14craftmine)/i

/** PCL-CE 的 McInstanceState 判断：愚人节 / 远古 / 快照均视为非正式版 */
function isNonRelease(v: VersionJson, vanilla: string, name: string): boolean {
  const type = v.type ?? ''
  if (type === 'fool' || FOOL.test(vanilla)) return true
  if (type.startsWith('old_')) return true
  if (type === 'snapshot' || type === 'pending') return true
  if (/combat/i.test(name)) return true
  return ['w', 'snapshot', 'rc', 'pre', 'experimental', '-'].some((s) => vanilla.toLowerCase().includes(s))
}

export async function analyzeInstance(id: string): Promise<InstanceInfo> {
  const v = await resolveVersion(id)
  const addons = detectAddons(v)
  const gameVersion = await rootVersionId(id).catch(() => id)
  const loader: LoaderType = addons.find((a) => MODABLE.includes(a) || a === 'labymod') ?? addons[0] ?? (v.inheritsFrom ? 'unknown' : 'vanilla')
  return {
    loader,
    addons,
    gameVersion,
    modable: addons.some((a) => MODABLE.includes(a)),
    optifine: addons.includes('optifine'),
    nonRelease: isNonRelease(v, gameVersion, id)
  }
}

function hasContent(dir: string, kind: 'file' | 'dir'): boolean {
  try {
    return readdirSync(dir, { withFileTypes: true }).some((d) => (kind === 'file' ? d.isFile() : d.isDirectory()))
  } catch {
    return false
  }
}

/** 按 PCL-CE 的规则决定版本隔离（McInstance.PathIndie） */
function shouldIsolate(id: string, info: InstanceInfo): boolean {
  const dir = paths.versionDir(id)
  // 版本文件夹里已有 mods 或存档，说明之前就是隔离使用的
  if (hasContent(join(dir, 'mods'), 'file') || hasContent(join(dir, 'saves'), 'dir')) return true
  const labyOrModable = info.addons.includes('labymod') || info.modable
  switch (getConfig().isolationMode) {
    case 0:
      return false
    case 1:
      return labyOrModable
    case 2:
      return info.nonRelease
    case 3:
      return labyOrModable || info.nonRelease
    default:
      return true
  }
}

export async function isolationFor(id: string, info?: InstanceInfo): Promise<boolean> {
  const decided = readInstanceSettings(paths.versionDir(id)).isolation
  if (decided !== null) return decided
  return shouldIsolate(id, info ?? (await analyzeInstance(id)))
}

/** 实际运行目录；首次使用时把隔离结果写入实例配置，之后不再随全局设置变化（与 PCL-CE 一致） */
export async function gameDirFor(id: string, persist = false): Promise<string> {
  const settings = readInstanceSettings(paths.versionDir(id))
  let isolate = settings.isolation
  if (isolate === null) {
    isolate = shouldIsolate(id, await analyzeInstance(id))
    if (persist) await writeInstanceSettings(paths.versionDir(id), { isolation: isolate })
  }
  return isolate ? paths.versionDir(id) : paths.root()
}

export async function describeInstance(id: string): Promise<InstalledVersion | null> {
  if (!existsSync(paths.versionJson(id))) return null
  const v = await readVersionJson(id)
  const info = await analyzeInstance(id)
  return {
    id,
    type: v.type ?? 'release',
    releaseTime: v.releaseTime,
    inheritsFrom: v.inheritsFrom,
    loader: info.loader,
    addons: info.addons,
    gameVersion: info.gameVersion,
    modable: info.modable,
    nonRelease: info.nonRelease,
    isolation: readInstanceSettings(paths.versionDir(id)).isolation
  }
}
