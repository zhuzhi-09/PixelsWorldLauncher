import { app } from 'electron'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { GameFolder, LauncherConfig } from '@shared/types'
import { getConfig, setConfig } from './config'
import { readCatIni, writeCatIni } from './pcl/ini'

const norm = (p: string) => {
  const r = resolve(p)
  return process.platform === 'win32' ? r.toLowerCase() : r
}
const same = (a: string, b: string) => norm(a) === norm(b)
const hasVersions = (dir: string) => existsSync(join(dir, 'versions'))

/** 启动器所在目录（便携版取解压前的位置） */
export function launcherDir(): string {
  return process.env.PORTABLE_EXECUTABLE_DIR ?? dirname(app.getPath('exe'))
}

/** 官方启动器的 .minecraft 位置 */
export function officialMinecraftDir(): string {
  if (process.platform === 'win32') return join(app.getPath('appData'), '.minecraft')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'minecraft')
  return join(homedir(), '.minecraft')
}

/** 与 PCL-CE 的 McFolderListLoadSub 一致的自动发现规则 */
function discover(): GameFolder[] {
  const out: GameFolder[] = []
  if (app.isPackaged) {
    const exeDir = launcherDir()
    if (hasVersions(exeDir)) out.push({ name: '当前文件夹', path: exeDir, type: 'original' })
    try {
      for (const d of readdirSync(exeDir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue
        const p = join(exeDir, d.name)
        if (d.name === '.minecraft' || hasVersions(p)) out.push({ name: d.name, path: p, type: 'original' })
      }
    } catch {
      // 没有权限扫描启动器目录
    }
  }
  const official = officialMinecraftDir()
  if (hasVersions(official)) out.push({ name: '官方启动器文件夹', path: official, type: 'original' })
  // 启动器自己的默认目录
  out.push({ name: '启动器默认文件夹', path: join(app.getPath('userData'), '.minecraft'), type: 'original' })
  return out
}

export function listFolders(cfg: LauncherConfig = getConfig()): GameFolder[] {
  const result: GameFolder[] = []
  const push = (f: GameFolder) => {
    if (!result.some((x) => same(x.path, f.path))) result.push(f)
  }
  // 自定义文件夹在前，名称以用户设置为准
  for (const f of cfg.gameFolders) if (existsSync(f.path)) push(f)
  for (const f of discover()) push(f)
  // 当前目录即使不在列表中也要显示
  if (!result.some((f) => same(f.path, cfg.gameDir))) {
    push({ name: basename(cfg.gameDir) || cfg.gameDir, path: cfg.gameDir, type: 'custom' })
  }
  return result
}

export async function addFolder(path: string, name?: string): Promise<GameFolder[]> {
  if (!isAbsolute(path)) throw new Error(`无效的文件夹路径：${path}`)
  path = resolve(path)
  const cfg = getConfig()
  const gameFolders = cfg.gameFolders.filter((f) => !same(f.path, path))
  gameFolders.push({ name: name || basename(path) || path, path, type: 'custom' })
  await setConfig({ gameFolders })
  return listFolders()
}

export async function removeFolder(path: string): Promise<GameFolder[]> {
  const cfg = getConfig()
  await setConfig({ gameFolders: cfg.gameFolders.filter((f) => !same(f.path, path)) })
  return listFolders()
}

/** 切换游戏文件夹，并读取该文件夹在 PCL.ini 中记录的上次选择的版本 */
export async function selectFolder(path: string): Promise<LauncherConfig> {
  if (!isAbsolute(path)) throw new Error(`无效的文件夹路径：${path}`)
  path = resolve(path)
  await mkdir(join(path, 'versions'), { recursive: true })
  await ensureLauncherProfiles(path)
  const last = readCatIni(join(path, 'PCL.ini')).get('Version') ?? ''
  return setConfig({
    gameDir: path,
    selectedVersion: last && existsSync(join(path, 'versions', last)) ? last : ''
  })
}

/** 记住当前文件夹选择的版本，PCL-CE 也会读取 */
export async function rememberVersion(id: string): Promise<void> {
  await writeCatIni(join(getConfig().gameDir, 'PCL.ini'), 'Version', id).catch(() => undefined)
}

/** Forge 等安装器需要 launcher_profiles.json 存在 */
export async function ensureLauncherProfiles(folder: string): Promise<void> {
  const file = join(folder, 'launcher_profiles.json')
  if (existsSync(file)) return
  const now = new Date().toISOString()
  const json = {
    profiles: {
      PixelsWorld: {
        icon: 'Grass',
        name: 'PixelsWorld',
        lastVersionId: 'latest-release',
        type: 'latest-release',
        lastUsed: now,
        created: now
      }
    },
    selectedProfile: 'PixelsWorld',
    clientToken: '23323323323323323323323323323333'
  }
  await mkdir(folder, { recursive: true })
  await writeFile(file, JSON.stringify(json, null, 2))
}
