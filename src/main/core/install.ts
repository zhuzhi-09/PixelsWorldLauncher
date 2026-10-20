import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { FabricLoaderVersion, InstalledVersion, RemoteVersion } from '@shared/types'
import { describeInstance, gameDirFor } from './instance'
import { DownloadItem, downloadAll, downloadFile, fetchJson, isComplete } from './download'
import { Task } from './tasks'
import { paths, resolveLibraries, resolveVersion, VersionJson } from './version'

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const FABRIC_META = 'https://meta.fabricmc.net/v2'

let manifestCache: { at: number; versions: RemoteVersion[] } | null = null

export async function remoteVersions(): Promise<RemoteVersion[]> {
  if (manifestCache && Date.now() - manifestCache.at < 10 * 60_000) return manifestCache.versions
  const data = await fetchJson<{ versions: RemoteVersion[] }>(MANIFEST)
  manifestCache = { at: Date.now(), versions: data.versions }
  return data.versions
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


// ---------- 安装原版 ----------

export async function installVanilla(id: string, task: Task): Promise<void> {
  task.stage('获取版本信息')
  const entry = (await remoteVersions()).find((v) => v.id === id)
  if (!entry) throw new Error(`找不到版本 ${id}`)
  const json = await fetchJson<VersionJson>(entry.url)
  await mkdir(paths.versionDir(id), { recursive: true })
  await writeFile(paths.versionJson(id), JSON.stringify(json, null, 2))
  await ensureVersionFiles(id, task)
}

// ---------- Fabric ----------

export async function fabricLoaders(gameVersion: string): Promise<FabricLoaderVersion[]> {
  const list = await fetchJson<{ loader: FabricLoaderVersion }[]>(
    `${FABRIC_META}/versions/loader/${encodeURIComponent(gameVersion)}`
  )
  return list.map((x) => x.loader)
}

export async function installFabric(gameVersion: string, loader: string, task: Task): Promise<string> {
  if (!existsSync(paths.versionJson(gameVersion))) {
    await installVanilla(gameVersion, task)
  }
  task.stage('获取 Fabric 配置')
  const profile = await fetchJson<VersionJson>(
    `${FABRIC_META}/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loader)}/profile/json`
  )
  const id = profile.id
  await mkdir(paths.versionDir(id), { recursive: true })
  await writeFile(paths.versionJson(id), JSON.stringify(profile, null, 2))
  await ensureVersionFiles(id, task)
  return id
}
