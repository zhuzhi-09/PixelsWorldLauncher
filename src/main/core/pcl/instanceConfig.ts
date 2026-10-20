import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Document, parseDocument } from 'yaml'
import type { InstanceSettings } from '@shared/types'
import { readCatIni } from './ini'

/**
 * PCL-CE 的实例独立配置：`versions/<id>/PCL/config.v1.yml`（扁平的 YAML 映射）。
 * 旧版 PCL 使用 `versions/<id>/PCL/setup.ini`，读取时自动迁移，写入时保留未知键，
 * 以便与 PCL-CE 互相切换时不丢设置。
 */
const yamlPath = (versionDir: string) => join(versionDir, 'PCL', 'config.v1.yml')
const iniPath = (versionDir: string) => join(versionDir, 'PCL', 'setup.ini')

function loadDoc(versionDir: string): Document {
  const file = yamlPath(versionDir)
  if (existsSync(file)) {
    const doc = parseDocument(readFileSync(file, 'utf8'))
    if (!doc.errors.length) return doc
  }
  const doc = new Document({})
  // 与 PCL-CE 的 CatIniMigration 一致：每行 key:value
  for (const [k, v] of readCatIni(iniPath(versionDir))) doc.set(k, v)
  return doc
}

function raw(versionDir: string): Record<string, unknown> {
  const data = loadDoc(versionDir).toJS() as Record<string, unknown> | null
  return data ?? {}
}

const str = (v: unknown, d = ''): string => (v === undefined || v === null ? d : String(v))
const num = (v: unknown, d: number): number => {
  const n = Number(v)
  return v === undefined || v === null || v === '' || Number.isNaN(n) ? d : n
}
const bool = (v: unknown): boolean | undefined =>
  v === undefined || v === null || v === '' ? undefined : v === true || /^(true|1)$/i.test(String(v))

/** Java 选择：新版为 JSON（kind: exist/global/relative/auto），旧版为路径或「使用全局设置」 */
function parseJava(v: unknown): InstanceSettings['java'] {
  const s = str(v, '使用全局设置').trim()
  if (!s || s === '使用全局设置') return s ? { kind: 'global' } : { kind: 'auto' }
  try {
    const j = JSON.parse(s) as Record<string, string>
    const kind = String(j.kind ?? j.Kind ?? '').toLowerCase()
    if (kind === 'exist') return { kind: 'exist', path: j.javaExePath ?? j.JavaExePath ?? '' }
    if (kind === 'relative') return { kind: 'relative', path: j.relativePath ?? j.RelativePath ?? '' }
    if (kind === 'auto') return { kind: 'auto' }
    return { kind: 'global' }
  } catch {
    return { kind: 'exist', path: s }
  }
}

function serializeJava(j: InstanceSettings['java']): string {
  if (j.kind === 'global') return '使用全局设置'
  if (j.kind === 'auto') return JSON.stringify({ kind: 'auto' })
  if (j.kind === 'relative') return JSON.stringify({ kind: 'relative', RelativePath: j.path })
  return JSON.stringify({ kind: 'exist', JavaExePath: j.path })
}

export function readInstanceSettings(versionDir: string | null): InstanceSettings {
  const r = versionDir ? raw(versionDir) : {}
  // 版本隔离：V2 为布尔；未设置时尝试旧版 V1（1 开启 / 2 关闭）
  let isolation = bool(r.VersionArgumentIndieV2)
  if (isolation === undefined) {
    const v1 = num(r.VersionArgumentIndie, -1)
    if (v1 === 1) isolation = true
    else if (v1 === 2) isolation = false
  }
  const ramType = num(r.VersionRamType, 2)
  return {
    isolation: isolation ?? null,
    memoryMode: ramType === 0 ? 'auto' : ramType === 1 ? 'custom' : 'global',
    memoryTick: num(r.VersionRamCustom, 15),
    memoryInitialTick: num(r.VersionRamCustomInitial, 0),
    jvmArgs: str(r.VersionAdvanceJvm),
    gameArgs: str(r.VersionAdvanceGame),
    java: parseJava(r.VersionArgumentJavaSelect),
    server: str(r.VersionServerEnter),
    versionType: str(r.VersionArgumentInfo),
    title: str(r.VersionArgumentTitle),
    preLaunchCommand: str(r.VersionAdvanceRun),
    preLaunchWait: bool(r.VersionAdvanceRunWait) ?? true,
    classpathHead: str(r.VersionAdvanceClasspathHead)
  }
}

/** 只写入变化的键，其余键（包括 PixelsWorld 不认识的）原样保留 */
export async function writeInstanceSettings(versionDir: string, patch: Partial<InstanceSettings>): Promise<void> {
  const doc = loadDoc(versionDir)
  const set = (k: string, v: unknown) => doc.set(k, v)
  if ('isolation' in patch && patch.isolation !== null && patch.isolation !== undefined)
    set('VersionArgumentIndieV2', patch.isolation)
  if (patch.memoryMode) set('VersionRamType', { auto: 0, custom: 1, global: 2 }[patch.memoryMode])
  if (patch.memoryTick !== undefined) set('VersionRamCustom', patch.memoryTick)
  if (patch.memoryInitialTick !== undefined) set('VersionRamCustomInitial', patch.memoryInitialTick)
  if (patch.jvmArgs !== undefined) set('VersionAdvanceJvm', patch.jvmArgs)
  if (patch.gameArgs !== undefined) set('VersionAdvanceGame', patch.gameArgs)
  if (patch.java) set('VersionArgumentJavaSelect', serializeJava(patch.java))
  if (patch.server !== undefined) set('VersionServerEnter', patch.server)
  if (patch.versionType !== undefined) set('VersionArgumentInfo', patch.versionType)
  if (patch.title !== undefined) set('VersionArgumentTitle', patch.title)
  if (patch.preLaunchCommand !== undefined) set('VersionAdvanceRun', patch.preLaunchCommand)
  if (patch.preLaunchWait !== undefined) set('VersionAdvanceRunWait', patch.preLaunchWait)
  if (patch.classpathHead !== undefined) set('VersionAdvanceClasspathHead', patch.classpathHead)
  const file = yamlPath(versionDir)
  await mkdir(join(versionDir, 'PCL'), { recursive: true })
  await writeFile(file, doc.toString())
}
