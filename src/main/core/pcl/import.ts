import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Account, AfterLaunch, IsolationMode, LauncherConfig, PclDetection, PclImportResult, ProcessPriority, WindowMode } from '@shared/types'
import { importAccounts } from '../accounts'
import { getConfig, setConfig } from '../config'
import { readCatIni } from './ini'
import { loadUserKey, secretDecrypt } from './crypto'

/**
 * 从 PCL-CE 导入全局设置、游戏文件夹与账户。
 * 全局配置分两处（PCL.Core/App/Configuration/ConfigService.cs）：
 *  - 共享配置：%APPDATA%\PCLCE\config.v1.json
 *  - 本地配置：<PCL 所在目录>\PCL\config.v1.yml（旧版为 setup.ini）
 */
// PW_PCL_SHARED_DIR 仅用于测试，避免读写真实的 PCL-CE 数据
const sharedDir = () => process.env.PW_PCL_SHARED_DIR ?? join(app.getPath('appData'), 'PCLCE')
const oldSharedDir = () => join(app.getPath('appData'), '.PCLCE')

function readShared(): Record<string, unknown> | null {
  for (const file of [join(sharedDir(), 'config.v1.json'), join(sharedDir(), 'config.json'), join(oldSharedDir(), 'Config.json')]) {
    if (!existsSync(file)) continue
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      // 尝试下一个
    }
  }
  return null
}

function readLocal(pclDir?: string): Record<string, unknown> {
  if (!pclDir) return {}
  const yml = join(pclDir, 'PCL', 'config.v1.yml')
  if (existsSync(yml)) {
    try {
      return (parseYaml(readFileSync(yml, 'utf8')) as Record<string, unknown>) ?? {}
    } catch {
      return {}
    }
  }
  return Object.fromEntries(readCatIni(join(pclDir, 'PCL', 'setup.ini')))
}

/** PCL 的 LaunchFolders：`名称>路径\|名称>路径\` */
function parseFolders(raw: unknown, pclDir?: string): { name: string; path: string }[] {
  return String(raw ?? '')
    .split('|')
    .filter((f) => f.includes('>'))
    .map((f) => {
      const [name, path] = f.split('>')
      return { name, path: (pclDir ? path.replace('$', pclDir + '\\') : path).replace(/[\\/]+$/, '') }
    })
    .filter((f) => f.path && !f.path.includes('$') && existsSync(f.path))
}

// ---------- 枚举映射（JSON 中为名称，YAML/旧版中可能为数字） ----------

function enumValue<T>(v: unknown, names: string[], map: T[]): T | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const s = String(v)
  const i = /^\d+$/.test(s) ? Number(s) : names.findIndex((n) => n.toLowerCase() === s.toLowerCase())
  return i >= 0 && i < map.length ? map[i] : undefined
}

const windowMode = (v: unknown) =>
  enumValue<WindowMode>(v, ['Fullscreen', 'Default', 'Launcher', 'Custom', 'Maximized'], ['fullscreen', 'default', 'launcher', 'custom', 'maximized'])
const visibility = (v: unknown) =>
  enumValue<AfterLaunch>(
    v,
    ['ExitImmediately', 'ObsoleteCaseDoNotUse', 'HideAndExit', 'HideAndReopen', 'MinimizeAndReopen', 'DoNothing'],
    ['exit', 'hideAndExit', 'hideAndExit', 'hideAndReopen', 'minimizeAndReopen', 'keep']
  )
const priority = (v: unknown) =>
  enumValue<ProcessPriority>(v, ['AboveNormal', 'Normal', 'BelowNormal', 'High', 'RealTime'], ['aboveNormal', 'normal', 'belowNormal', 'high', 'realtime'])
const ipStack = (v: unknown) =>
  enumValue<LauncherConfig['preferredIpStack']>(v, ['PreferV4', 'Default', 'PreferV6'], ['v4', 'default', 'v6'])

const num = (v: unknown) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v))
const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v))
const bool = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : v === true || /^(true|1)$/i.test(String(v)))

// ---------- 账户 ----------

interface PclProfile {
  username?: string
  uuid?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: string
  profileType?: string | number
}

async function readProfiles(shared: Record<string, unknown>): Promise<{ lastUsed: number; profiles: PclProfile[] }> {
  const raw = shared.Profile
  if (typeof raw !== 'string' || !raw) return { lastUsed: -1, profiles: [] }
  let text = raw
  if (!raw.trimStart().startsWith('{')) {
    const key = await loadUserKey(join(sharedDir(), 'UserKey.bin'))
    text = secretDecrypt(raw, key)
  }
  const json = JSON.parse(text) as { lastUsed?: number; profiles?: PclProfile[] }
  return { lastUsed: json.lastUsed ?? -1, profiles: json.profiles ?? [] }
}

const profileType = (t: unknown) =>
  enumValue<string>(t, ['Microsoft', 'Offline', 'Authlib', 'YggdrasilConnect'], ['microsoft', 'offline', 'authlib', 'yggdrasil'])

// ---------- 对外接口 ----------

export function detectPcl(): PclDetection {
  const shared = readShared()
  const configPath = join(sharedDir(), 'config.v1.json')
  if (!shared) return { found: false, configPath, folders: 0, accounts: 0 }
  // 账户是加密的，这里只粗略判断是否存在
  return {
    found: true,
    configPath,
    folders: parseFolders(shared.LaunchFolders).length,
    accounts: typeof shared.Profile === 'string' && shared.Profile.length > 40 ? 1 : 0
  }
}

export async function importFromPcl(opts: {
  settings: boolean
  folders: boolean
  accounts: boolean
  pclDir?: string
}): Promise<PclImportResult> {
  const shared = readShared()
  if (!shared && !opts.pclDir) throw new Error('没有找到 PCL-CE 的配置（%APPDATA%\\PCLCE）')
  const s = shared ?? {}
  const local = readLocal(opts.pclDir)
  const result: PclImportResult = { settings: [], folders: 0, accounts: { imported: 0, skipped: [] }, warnings: [] }
  const patch: Partial<LauncherConfig> = {}
  const take = <K extends keyof LauncherConfig>(key: K, value: LauncherConfig[K] | undefined, label: string) => {
    if (value === undefined) return
    patch[key] = value
    result.settings.push(label)
  }

  if (opts.settings) {
    // 共享配置
    take('preferredIpStack', ipStack(s.LaunchPreferredIpStack), 'IP 协议偏好')
    take('gpuPreference', bool(s.LaunchAdvanceGraphicCard), '高性能显卡')
    take('afterLaunch', visibility(s.LaunchArgumentVisible), '启动后启动器行为')
    take('processPriority', priority(s.LaunchArgumentPriority), '进程优先级')
    const java = str(s.LaunchArgumentJavaSelect)
    if (java && existsSync(java)) take('javaPath', java, 'Java 选择')

    // 本地配置（需要 PCL 所在目录）
    if (opts.pclDir) {
      const indie = num(local.LaunchArgumentIndieV2)
      if (indie !== undefined && indie >= 0 && indie <= 4) take('isolationMode', indie as IsolationMode, '版本隔离')
      const ramType = num(local.LaunchRamType)
      if (ramType !== undefined) take('memoryMode', ramType === 1 ? 'custom' : 'auto', '内存模式')
      take('memoryTick', num(local.LaunchRamCustom), '自定义内存')
      take('memoryInitialTick', num(local.LaunchRamCustomInitial), '初始内存')
      take('lockMemory', bool(local.LaunchAdvanceLockMemory), '锁定内存')
      take('jvmArgs', str(local.LaunchAdvanceJvm), 'JVM 参数')
      take('gameArgs', str(local.LaunchAdvanceGame), '游戏参数')
      take('preLaunchCommand', str(local.LaunchAdvanceRun), '启动前命令')
      take('preLaunchWait', bool(local.LaunchAdvanceRunWait), '等待启动前命令')
      take('versionType', str(local.LaunchArgumentInfo), '版本类型')
      take('windowMode', windowMode(local.LaunchArgumentWindowType), '窗口模式')
      take('windowWidth', num(local.LaunchArgumentWindowWidth), '窗口宽度')
      take('windowHeight', num(local.LaunchArgumentWindowHeight), '窗口高度')
    } else {
      result.warnings.push('内存、JVM 参数、版本隔离等设置保存在 PCL-CE 程序目录中，选择该目录后才能导入')
    }
  }

  if (opts.folders) {
    const found = parseFolders(s.LaunchFolders, opts.pclDir)
    // PCL 程序目录下的 .minecraft 也算
    if (opts.pclDir && existsSync(join(opts.pclDir, '.minecraft', 'versions')))
      found.push({ name: 'PCL-CE 文件夹', path: join(opts.pclDir, '.minecraft') })
    const cfg = getConfig()
    const gameFolders = [...cfg.gameFolders]
    for (const f of found) {
      if (gameFolders.some((g) => g.path.toLowerCase() === f.path.toLowerCase())) continue
      gameFolders.push({ ...f, type: 'custom' })
      result.folders++
    }
    patch.gameFolders = gameFolders
    // PCL 当前选择的文件夹
    const selected = str(local.LaunchFolderSelect)?.replace('$', (opts.pclDir ?? '') + '\\').replace(/[\\/]+$/, '')
    if (selected && existsSync(join(selected, 'versions'))) {
      patch.gameDir = selected
      const ver = str(local.LaunchInstanceSelect) || readCatIni(join(selected, 'PCL.ini')).get('Version')
      if (ver && existsSync(join(selected, 'versions', ver))) patch.selectedVersion = ver
    }
  }

  if (opts.accounts) {
    try {
      const { lastUsed, profiles } = await readProfiles(s)
      const list: Omit<Account, 'id'>[] = []
      let selectIndex = -1
      profiles.forEach((p, i) => {
        const type = profileType(p.profileType) ?? 'offline'
        const name = p.username ?? ''
        if (!name) return
        if (type === 'authlib' || type === 'yggdrasil') {
          result.accounts.skipped.push(`${name}（第三方验证暂不支持）`)
          return
        }
        if (i === lastUsed) selectIndex = list.length
        list.push({
          type: type === 'microsoft' ? 'microsoft' : 'offline',
          name,
          uuid: (p.uuid ?? '').replace(/-/g, ''),
          accessToken: p.accessToken || crypto.randomUUID().replace(/-/g, ''),
          expiresAt: p.expiresAt ? Date.parse(p.expiresAt) : undefined,
          importedFrom: type === 'microsoft' ? 'pcl' : undefined
        })
      })
      result.accounts.imported = await importAccounts(list, selectIndex)
    } catch (e) {
      result.warnings.push(`账户导入失败：${(e as Error).message}`)
    }
  }

  if (Object.keys(patch).length) await setConfig(patch)
  return result
}
