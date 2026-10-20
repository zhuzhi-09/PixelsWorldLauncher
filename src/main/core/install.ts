import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { InstalledVersion, RemoteManifest, RemoteVersion } from '@shared/types'
import { isAprilFools } from '@shared/versions'
import { describeInstance, gameDirFor } from './instance'
import { DownloadItem, downloadAll, downloadFile, fetchJson, isComplete } from './download'
import { Task } from './tasks'
import { paths, resolveLibraries, resolveVersion, VersionJson } from './version'

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

let manifestCache: { at: number; data: RemoteManifest } | null = null

export async function remoteManifest(): Promise<RemoteManifest> {
  if (manifestCache && Date.now() - manifestCache.at < 10 * 60_000) return manifestCache.data
  const data = await fetchJson<RemoteManifest>(MANIFEST)
  for (const v of data.versions) v.fool = isAprilFools(v.id, v.releaseTime)
  manifestCache = { at: Date.now(), data }
  return data
}

export async function remoteVersions(): Promise<RemoteVersion[]> {
  return (await remoteManifest()).versions
}

// ---------- 已安装版本 ----------

export async function installedVersions(): Promise<InstalledVersion[]> {
  const dir = paths.versions()
  if (!existsSync(dir)) return []
  const out: InstalledVersion[] = []
  for (const id of await readdir(dir)) {
    try {
      const v = await describeInstance(id)
      if (v) out.push(v)
    } catch {
      // 不是有效的版本目录
    }
  }
  return out.sort((a, b) => (b.releaseTime ?? '').localeCompare(a.releaseTime ?? ''))
}

export async function removeVersion(id: string): Promise<void> {
  const dir = paths.versionDir(id)
  // 防止路径穿越
  if (!id || id.includes('..') || /[\\/]/.test(id)) throw new Error('非法版本号')
  await rm(dir, { recursive: true, force: true })
}

// ---------- 文件补全（安装与启动前都会调用） ----------

interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>
  virtual?: boolean
  map_to_resources?: boolean
}

export async function ensureVersionFiles(id: string, task: Task): Promise<VersionJson> {
  const v = await resolveVersion(id)
  const items: DownloadItem[] = []

  // 客户端 jar
  const jarId = v.jar ?? v.id
  if (v.downloads?.client) {
    items.push({ ...v.downloads.client, path: paths.versionJar(jarId) })
  }

  // 依赖库
  for (const lib of resolveLibraries(v)) items.push(lib)

  // 日志配置（修复 Log4Shell）
  const log = v.logging?.client?.file
  if (log) items.push({ ...log, path: join(paths.assets(), 'log_configs', log.id) })

  task.stage('下载游戏本体与依赖库')
  await downloadAll(items, (d, t) => task.progress(d, t))

  // 资源文件
  if (v.assetIndex) {
    task.stage('下载资源索引')
    const indexItem = {
      ...v.assetIndex,
      path: join(paths.assets(), 'indexes', `${v.assetIndex.id}.json`)
    }
    if (!(await isComplete(indexItem))) await downloadFile(indexItem)
    const index: AssetIndex = JSON.parse(await readFile(indexItem.path, 'utf8'))

    const objects = Object.entries(index.objects).map(([name, o]) => ({
      name,
      url: `https://resources.download.minecraft.net/${o.hash.slice(0, 2)}/${o.hash}`,
      path: join(paths.assets(), 'objects', o.hash.slice(0, 2), o.hash),
      sha1: o.hash,
      size: o.size
    }))
    task.stage('下载资源文件')
    await downloadAll(objects, (d, t) => task.progress(d, t))

    // 旧版本资源需要按原文件名展开
    if (index.virtual || index.map_to_resources) {
      task.stage('整理旧版资源')
      const target = index.map_to_resources
        ? join(await gameDirFor(id), 'resources')
        : join(paths.assets(), 'virtual', v.assetIndex.id)
      for (const o of objects) {
        const dest = join(target, o.name)
        if (existsSync(dest)) continue
        await mkdir(dirname(dest), { recursive: true })
        await copyFile(o.path, dest)
      }
    }
  }
  return v
}


// ---------- 安装 ----------

/** 版本名称用作文件夹名，排除非法字符 */
export function checkVersionName(name: string): string {
  const n = name.trim()
  if (!n || n.length > 64 || /[\\/:*?"<>|]/.test(n) || n === '.' || n === '..') {
    throw new Error('版本名称不能为空，且不能包含 \\ / : * ? " < > |')
  }
  if (existsSync(paths.versionDir(n))) throw new Error(`已存在名为 ${n} 的版本`)
  return n
}

/** 写入版本 JSON（可改名）并补全文件，返回最终版本名 */
export async function saveVersionJson(json: VersionJson, task: Task, name?: string): Promise<string> {
  const id = name ? checkVersionName(name) : json.id
  json.id = id
  await mkdir(paths.versionDir(id), { recursive: true })
  await writeFile(paths.versionJson(id), JSON.stringify(json, null, 2))
  await ensureVersionFiles(id, task)
  return id
}

export async function installVanilla(id: string, task: Task, name?: string): Promise<string> {
  task.stage('获取版本信息')
  const entry = (await remoteVersions()).find((v) => v.id === id)
  if (!entry) throw new Error(`找不到版本 ${id}`)
  const json = await fetchJson<VersionJson>(entry.url)
  return saveVersionJson(json, task, name && name !== id ? name : undefined)
}

/** 确保加载器依赖的原版已安装（以原版版本号命名） */
export async function ensureVanilla(gameVersion: string, task: Task): Promise<void> {
  if (!existsSync(paths.versionJson(gameVersion))) await installVanilla(gameVersion, task)
}
