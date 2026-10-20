import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getConfig } from './config'

// ---------- Mojang 版本 JSON 的类型 ----------

export interface Rule {
  action: 'allow' | 'disallow'
  os?: { name?: string; arch?: string; version?: string }
  features?: Record<string, boolean>
}

export type Argument = string | { rules?: Rule[]; value: string | string[] }

export interface Artifact {
  path?: string
  url: string
  sha1?: string
  size?: number
}

export interface Library {
  name: string
  url?: string
  rules?: Rule[]
  natives?: Record<string, string>
  extract?: { exclude?: string[] }
  downloads?: {
    artifact?: Artifact
    classifiers?: Record<string, Artifact>
  }
  sha1?: string
  size?: number
}

export interface VersionJson {
  id: string
  type?: string
  time?: string
  releaseTime?: string
  inheritsFrom?: string
  jar?: string
  mainClass: string
  minecraftArguments?: string
  arguments?: { game?: Argument[]; jvm?: Argument[] }
  assetIndex?: { id: string; url: string; sha1: string; size: number; totalSize?: number }
  assets?: string
  downloads?: { client?: Artifact }
  libraries: Library[]
  javaVersion?: { component: string; majorVersion: number }
  logging?: {
    client?: { argument: string; file: { id: string; url: string; sha1: string; size: number } }
  }
}

// ---------- 目录 ----------

export const paths = {
  root: () => getConfig().gameDir,
  versions: () => join(getConfig().gameDir, 'versions'),
  versionDir: (id: string) => join(getConfig().gameDir, 'versions', id),
  versionJson: (id: string) => join(getConfig().gameDir, 'versions', id, `${id}.json`),
  versionJar: (id: string) => join(getConfig().gameDir, 'versions', id, `${id}.jar`),
  libraries: () => join(getConfig().gameDir, 'libraries'),
  assets: () => join(getConfig().gameDir, 'assets')
}

// ---------- 规则判断 ----------

export const osName = (): string =>
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'

export function allowed(rules: Rule[] | undefined, features: Record<string, boolean> = {}): boolean {
  if (!rules?.length) return true
  let result = false
  for (const rule of rules) {
    let match = true
    if (rule.os) {
      if (rule.os.name && rule.os.name !== osName()) match = false
      if (rule.os.arch === 'x86' && process.arch !== 'ia32') match = false
      if (rule.os.arch === 'arm64' && process.arch !== 'arm64') match = false
    }
    if (rule.features) {
      for (const [k, v] of Object.entries(rule.features)) if (!!features[k] !== v) match = false
    }
    if (match) result = rule.action === 'allow'
  }
  return result
}

// ---------- Maven 坐标 ----------

/** group:artifact:version[:classifier][@ext] -> 相对路径 */
export function mavenPath(name: string): string {
  let ext = 'jar'
  let coord = name
  const at = coord.indexOf('@')
  if (at >= 0) {
    ext = coord.slice(at + 1)
    coord = coord.slice(0, at)
  }
  const [group, artifact, version, classifier] = coord.split(':')
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`
  return [...group.split('.'), artifact, version, file].join('/')
}

/** 用于去重的键：group:artifact[:classifier]，忽略版本 */
function libKey(name: string): string {
  const [group, artifact, , classifier] = name.split('@')[0].split(':')
  return [group, artifact, classifier].filter(Boolean).join(':')
}

// ---------- 读取 & 合并继承 ----------

export async function readVersionJson(id: string): Promise<VersionJson> {
  const file = paths.versionJson(id)
  if (!existsSync(file)) throw new Error(`版本 ${id} 未安装`)
  return JSON.parse(await readFile(file, 'utf8'))
}

/** 解析 inheritsFrom（Fabric 等加载器），返回完整版本 JSON */
export async function resolveVersion(id: string): Promise<VersionJson> {
  const self = await readVersionJson(id)
  if (!self.inheritsFrom) return self
  const parent = await resolveVersion(self.inheritsFrom)

  // 子版本库优先，同一构件只保留一份
  const seen = new Set<string>()
  const libraries: Library[] = []
  for (const lib of [...self.libraries, ...parent.libraries]) {
    const key = libKey(lib.name)
    if (seen.has(key)) continue
    seen.add(key)
    libraries.push(lib)
  }

  return {
    ...parent,
    ...self,
    jar: self.jar ?? parent.jar ?? parent.id,
    mainClass: self.mainClass ?? parent.mainClass,
    libraries,
    arguments:
      self.arguments || parent.arguments
        ? {
            game: [...(parent.arguments?.game ?? []), ...(self.arguments?.game ?? [])],
            jvm: [...(parent.arguments?.jvm ?? []), ...(self.arguments?.jvm ?? [])]
          }
        : undefined,
    minecraftArguments: self.minecraftArguments ?? parent.minecraftArguments,
    assetIndex: self.assetIndex ?? parent.assetIndex,
    assets: self.assets ?? parent.assets,
    downloads: self.downloads ?? parent.downloads,
    javaVersion: self.javaVersion ?? parent.javaVersion,
    logging: self.logging ?? parent.logging
  }
}

// ---------- 库文件解析 ----------

export interface ResolvedLibrary {
  /** Maven 坐标 */
  name: string
  path: string
  url: string
  sha1?: string
  size?: number
  /** 需要解压到 natives 目录 */
  native: boolean
  /** 是否加入 classpath */
  classpath: boolean
  exclude: string[]
}

const archBits = () => (process.arch === 'ia32' ? '32' : '64')

export function resolveLibraries(v: VersionJson): ResolvedLibrary[] {
  const out: ResolvedLibrary[] = []
  const libDir = paths.libraries()
  for (const lib of v.libraries) {
    if (!allowed(lib.rules)) continue
    const exclude = lib.extract?.exclude ?? []

    // 旧格式 natives：通过 classifier 下载
    const nativeClassifier = lib.natives?.[osName()]?.replace('${arch}', archBits())
    if (nativeClassifier) {
      const a = lib.downloads?.classifiers?.[nativeClassifier]
      const rel = a?.path ?? mavenPath(`${lib.name}:${nativeClassifier}`)
      out.push({
        name: lib.name,
        path: join(libDir, rel),
        url: a?.url ?? `${lib.url ?? 'https://libraries.minecraft.net/'}${rel}`,
        sha1: a?.sha1,
        size: a?.size,
        native: true,
        classpath: false,
        exclude
      })
    }

    const a = lib.downloads?.artifact
    if (a || !lib.downloads) {
      const rel = a?.path ?? mavenPath(lib.name)
      const base = (lib.url ?? 'https://libraries.minecraft.net/').replace(/\/?$/, '/')
      if (a && !a.url) continue // 部分加载器的库需要本地生成，跳过下载
      out.push({
        name: lib.name,
        path: join(libDir, rel),
        url: a?.url ?? base + rel,
        sha1: a?.sha1 ?? lib.sha1,
        size: a?.size ?? lib.size,
        // 新格式（1.19+）natives 直接放在 classpath 中，同时也解压一份
        native: /:natives-/.test(lib.name),
        classpath: true,
        exclude
      })
    }
  }
  return out
}
