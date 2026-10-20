import { app } from 'electron'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  Favorite,
  ResourceHit,
  ResourceInstallRequest,
  ResourceInstallResult,
  ResourceProject,
  ResourceSearch,
  ResourceSearchResult,
  ResourceType,
  ResourceVersion
} from '@shared/types'
import { downloadAll } from './download'
import { analyzeInstance, gameDirFor } from './instance'
import { Task } from './tasks'

const API = 'https://api.modrinth.com/v2'
// Modrinth 要求 User-Agent 能识别出应用
const UA = `zhuzhi-09/PixelsWorldLauncher/${app.getVersion()} (github.com/zhuzhi-09/PixelsWorldLauncher)`

async function api<T>(path: string): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(API + path, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(20_000)
      })
      if (res.status === 404) throw new Error('Modrinth 上找不到该资源')
      if (res.status === 429) throw new Error('请求过于频繁，请稍后再试')
      if (!res.ok) throw new Error(`Modrinth 请求失败（${res.status}）`)
      return (await res.json()) as T
    } catch (e) {
      lastErr = e
      if ((e as Error).message.startsWith('Modrinth 上找不到')) break
      await new Promise((r) => setTimeout(r, 400 * (i + 1)))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

const qs = (o: Record<string, string | number | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')

// ---------- 搜索 ----------

interface MrHit {
  project_id: string
  slug: string
  project_type: string
  title: string
  description: string
  author: string
  icon_url?: string
  downloads: number
  follows: number
  date_modified: string
  display_categories?: string[]
  categories: string[]
  versions: string[]
}

const toHit = (h: MrHit, type: ResourceType): ResourceHit => ({
  id: h.project_id,
  slug: h.slug,
  type,
  title: h.title,
  description: h.description,
  author: h.author,
  icon: h.icon_url || undefined,
  downloads: h.downloads,
  follows: h.follows,
  updated: h.date_modified,
  categories: h.display_categories ?? h.categories,
  gameVersions: h.versions
})

export async function search(q: ResourceSearch): Promise<ResourceSearchResult> {
  const facets: string[][] = [[`project_type:${q.type}`]]
  if (q.gameVersion) facets.push([`versions:${q.gameVersion}`])
  if (q.loader) facets.push([`categories:${q.loader}`])
  const data = await api<{ hits: MrHit[]; total_hits: number }>(
    `/search?${qs({ query: q.query, facets: JSON.stringify(facets), index: q.sort, offset: q.offset, limit: 20 })}`
  )
  return { hits: data.hits.map((h) => toHit(h, q.type)), total: data.total_hits }
}

let gameVersionCache: string[] | null = null
/** Modrinth 收录的正式版游戏版本，用于筛选 */
export async function gameVersions(): Promise<string[]> {
  if (gameVersionCache) return gameVersionCache
  const tags = await api<{ version: string; version_type: string }[]>('/tag/game_version')
  gameVersionCache = tags.filter((t) => t.version_type === 'release').map((t) => t.version)
  return gameVersionCache
}

// ---------- 项目详情 ----------

interface MrProject {
  id: string
  slug: string
  project_type: string
  title: string
  description: string
  body: string
  icon_url?: string
  downloads: number
  followers: number
  updated: string
  categories: string[]
  game_versions: string[]
  source_url?: string
  wiki_url?: string
  issues_url?: string
  gallery?: { url: string }[]
  team: string
}

export async function project(id: string): Promise<ResourceProject> {
  const p = await api<MrProject>(`/project/${encodeURIComponent(id)}`)
  const members = await api<{ user: { username: string }; role: string }[]>(`/team/${p.team}/members`).catch(() => [])
  const owner = members.find((m) => m.role === 'Owner') ?? members[0]
  return {
    id: p.id,
    slug: p.slug,
    type: p.project_type as ResourceType,
    title: p.title,
    description: p.description,
    author: owner?.user.username ?? '',
    icon: p.icon_url || undefined,
    downloads: p.downloads,
    follows: p.followers,
    updated: p.updated,
    categories: p.categories,
    gameVersions: p.game_versions,
    body: p.body,
    links: {
      page: `https://modrinth.com/${p.project_type}/${p.slug}`,
      source: p.source_url,
      wiki: p.wiki_url,
      issues: p.issues_url
    },
    gallery: (p.gallery ?? []).map((g) => g.url)
  }
}

// ---------- 版本 ----------

interface MrVersion {
  id: string
  project_id: string
  name: string
  version_number: string
  version_type: 'release' | 'beta' | 'alpha'
  game_versions: string[]
  loaders: string[]
  date_published: string
  downloads: number
  files: { url: string; filename: string; primary: boolean; size: number; hashes: { sha1: string } }[]
  dependencies: { project_id: string | null; version_id: string | null; dependency_type: string }[]
}

const toVersion = (v: MrVersion): ResourceVersion => {
  const f = v.files.find((x) => x.primary) ?? v.files[0]
  return {
    id: v.id,
    name: v.name,
    versionNumber: v.version_number,
    type: v.version_type,
    gameVersions: v.game_versions,
    loaders: v.loaders,
    published: v.date_published,
    downloads: v.downloads,
    file: { name: f.filename, url: f.url, size: f.size, sha1: f.hashes.sha1 },
    requires: v.dependencies
      .filter((d) => d.dependency_type === 'required' && d.project_id)
      .map((d) => d.project_id!)
  }
}

async function rawVersions(id: string, gameVersion?: string, loaders?: string[]): Promise<MrVersion[]> {
  return api<MrVersion[]>(
    `/project/${encodeURIComponent(id)}/version?${qs({
      game_versions: gameVersion ? JSON.stringify([gameVersion]) : undefined,
      loaders: loaders?.length ? JSON.stringify(loaders) : undefined
    })}`
  )
}

export async function versions(id: string, filter: { gameVersion?: string; loaders?: string[] }): Promise<ResourceVersion[]> {
  return (await rawVersions(id, filter.gameVersion, filter.loaders)).filter((v) => v.files.length).map(toVersion)
}

// ---------- 安装 ----------

/** 实例的加载器 -> 可用的 Modrinth 加载器标签 */
async function instanceTarget(instanceId: string): Promise<{ gameVersion: string; loaders: string[]; dir: string }> {
  const info = await analyzeInstance(instanceId)
  const map: Record<string, string[]> = {
    fabric: ['fabric'],
    quilt: ['quilt', 'fabric'],
    legacyfabric: ['legacy-fabric'],
    forge: ['forge'],
    neoforge: ['neoforge'],
    cleanroom: ['forge'],
    liteloader: ['liteloader']
  }
  // 安装资源时确定版本隔离，与启动时一致
  const dir = await gameDirFor(instanceId, true)
  return { gameVersion: info.gameVersion, loaders: map[info.loader] ?? [], dir }
}

const TARGET_DIR: Record<ResourceType, string> = {
  mod: 'mods',
  modpack: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
  datapack: 'datapacks'
}

export async function worldsOf(instanceId: string): Promise<string[]> {
  const saves = join(await gameDirFor(instanceId), 'saves')
  try {
    return readdirSync(saves, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(saves, d.name, 'level.dat')))
      .map((d) => d.name)
  } catch {
    return []
  }
}

export async function install(req: ResourceInstallRequest, task: Task): Promise<ResourceInstallResult> {
  if (req.type === 'modpack') throw new Error('整合包安装将在后续版本提供')
  const target = await instanceTarget(req.instanceId)
  let dir: string
  if (req.type === 'datapack') {
    if (!req.world) throw new Error('请选择要安装数据包的世界')
    dir = join(target.dir, 'saves', req.world, 'datapacks')
  } else {
    dir = join(target.dir, TARGET_DIR[req.type])
  }
  await mkdir(dir, { recursive: true })
  const existing = new Set(existsSync(dir) ? readdirSync(dir) : [])

  task.stage('获取版本信息')
  const main = await api<MrVersion>(`/version/${encodeURIComponent(req.versionId)}`)
  const files: MrVersion[] = [main]
  const missing: string[] = []

  // 只有模组需要处理前置
  if (req.type === 'mod') {
    const seen = new Set([main.project_id])
    const queue = [...toVersion(main).requires]
    while (queue.length) {
      const pid = queue.shift()!
      if (seen.has(pid)) continue
      seen.add(pid)
      task.stage(`解析前置 (${seen.size - 1})`)
      const candidates = await rawVersions(pid, target.gameVersion, target.loaders).catch(() => [])
      const best = candidates.find((v) => v.version_type === 'release') ?? candidates[0]
      if (!best) {
        const title = await api<{ title: string }>(`/project/${pid}`).then((p) => p.title).catch(() => pid)
        missing.push(title)
        continue
      }
      files.push(best)
      queue.push(...toVersion(best).requires)
    }
  }

  const installed: string[] = []
  const skipped: string[] = []
  const items = []
  for (const v of files) {
    const f = toVersion(v).file
    if (existing.has(f.name)) {
      skipped.push(f.name)
      continue
    }
    items.push({ url: f.url, path: join(dir, f.name), sha1: f.sha1, size: f.size })
    installed.push(f.name)
  }
  task.stage('下载文件')
  await downloadAll(items, (d, t) => task.progress(d, t))
  return { installed, skipped, missing }
}

// ---------- 收藏夹 ----------

const favFile = () => join(app.getPath('userData'), 'favorites.json')

export function listFavorites(): Favorite[] {
  try {
    return JSON.parse(readFileSync(favFile(), 'utf8'))
  } catch {
    return []
  }
}

async function saveFavorites(list: Favorite[]): Promise<Favorite[]> {
  await writeFile(favFile(), JSON.stringify(list, null, 2))
  return list
}

export const addFavorite = (f: Omit<Favorite, 'addedAt'>) =>
  saveFavorites([{ ...f, addedAt: Date.now() }, ...listFavorites().filter((x) => x.id !== f.id)])

export const removeFavorite = (id: string) => saveFavorites(listFavorites().filter((x) => x.id !== id))
