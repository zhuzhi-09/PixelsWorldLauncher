import { app, BrowserWindow, screen } from 'electron'
import AdmZip from 'adm-zip'
import { ChildProcess, execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { setPriority, constants as osConstants } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import type { Account, GameStatus, InstanceSettings, LauncherConfig } from '@shared/types'
import { accountForLaunch } from './accounts'
import { getConfig } from './config'
import { ensureLauncherProfiles, officialMinecraftDir, rememberVersion } from './folders'
import { ensureVersionFiles } from './install'
import { analyzeInstance, gameDirFor, InstanceInfo } from './instance'
import { ensureJava, SelectedJava } from './java'
import { MemoryPlan, planMemory } from './memory'
import { readCatIni, writeCatIni } from './pcl/ini'
import { readInstanceSettings } from './pcl/instanceConfig'
import { broadcast, runTask, Task } from './tasks'
import { allowed, Argument, paths, resolveLibraries, VersionJson } from './version'

let child: ChildProcess | null = null
let status: GameStatus = { state: 'idle' }

function setStatus(s: GameStatus): void {
  status = s
  broadcast('game:status', s)
}

export const gameStatus = () => status

export function killGame(): void {
  child?.kill()
}

const log = (...lines: string[]) => broadcast('game:log', lines.map((l) => `[PixelsWorld] ${l}`))
const isAscii = (s: string) => /^[\x00-\x7f]*$/.test(s)

// ---------- natives ----------

/** 与 PCL-CE 相同的 natives 目录：versions/<id>/<id>-natives，路径含非 ASCII 字符时换到别处 */
function nativesDirFor(id: string): string {
  const preferred = join(paths.versionDir(id), `${id}-natives`)
  if (process.platform !== 'win32' || isAscii(preferred)) return preferred
  const fallback = join(officialMinecraftDir(), 'bin', 'natives')
  if (isAscii(fallback)) return fallback
  return join(process.env.ProgramData ?? 'C:\\ProgramData', 'PixelsWorld', 'natives')
}

async function extractNatives(v: VersionJson, dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  for (const lib of resolveLibraries(v)) {
    if (!lib.native || !existsSync(lib.path)) continue
    const zip = new AdmZip(lib.path)
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue
      if (lib.exclude.some((ex) => e.entryName.startsWith(ex))) continue
      if (e.entryName.startsWith('META-INF/')) continue
      // 只要动态库文件，扁平化放置
      if (!/\.(dll|so|dylib|jnilib)$/i.test(e.entryName)) continue
      const name = e.entryName.split('/').pop()!
      await writeFile(join(dir, name), e.getData())
    }
  }
}

// ---------- 参数 ----------

function expandArgs(args: Argument[], features: Record<string, boolean>): string[] {
  const out: string[] = []
  for (const a of args) {
    if (typeof a === 'string') out.push(a)
    else if (allowed(a.rules, features)) out.push(...(Array.isArray(a.value) ? a.value : [a.value]))
  }
  return out
}

/** 简单拆分命令行参数，支持引号 */
function splitArgs(s: string): string[] {
  return (s.match(/"[^"]*"|\S+/g) ?? []).map((x) => x.replace(/^"|"$/g, ''))
}

/**
 * 把 `-X` 与其后不以 `-` 开头的值合并后去重（PCL-CE 的做法，
 * 避免 Forge 1.17 的两个 --add-exports 被误去重）
 */
function dedupeJvm(list: string[]): string[] {
  const groups: string[][] = []
  for (let i = 0; i < list.length; i++) {
    const g = [list[i]]
    if (list[i].startsWith('-')) {
      while (i + 1 < list.length && !list[i + 1].startsWith('-')) g.push(list[++i])
    }
    groups.push(g)
  }
  const seen = new Set<string>()
  return groups
    .filter((g) => {
      const key = g.join('\u0000')
      if (seen.has(key) || key === '-XX:MaxDirectMemorySize=256M') return false
      seen.add(key)
      return true
    })
    .flat()
}

function windowSize(cfg: LauncherConfig): { width: number; height: number } {
  switch (cfg.windowMode) {
    case 'custom':
      return { width: Math.max(100, cfg.windowWidth), height: Math.max(100, cfg.windowHeight) }
    case 'launcher': {
      const win = BrowserWindow.getAllWindows()[0]
      const [width, height] = win?.getContentSize() ?? [854, 480]
      return { width, height }
    }
    case 'maximized': {
      const { width, height } = screen.getPrimaryDisplay().workAreaSize
      return { width, height }
    }
    default:
      return { width: 854, height: 480 }
  }
}

interface BuildContext {
  v: VersionJson
  id: string
  acc: Account
  java: SelectedJava
  memory: MemoryPlan
  inst: InstanceSettings
  info: InstanceInfo
  nativesDir: string
  gameDir: string
}

function buildArgs(ctx: BuildContext): string[] {
  const { v, acc, java, memory, inst } = ctx
  const cfg = getConfig()

  // classpath：OptiFine 放在倒数第二位，实例可指定 classpath 头部
  const libs = resolveLibraries(v).filter((l) => l.classpath)
  const optifine = libs.find((l) => /^optifine:optifine:/i.test(l.name))
  const cp = [...new Set(libs.filter((l) => l !== optifine).map((l) => l.path))]
  cp.push(paths.versionJar(v.jar ?? v.id))
  if (optifine) cp.splice(Math.max(0, cp.length - 2), 0, optifine.path)
  for (const head of inst.classpathHead.split(';').reverse()) if (head.trim()) cp.unshift(head.trim())

  const size = windowSize(cfg)
  const versionType = inst.versionType || cfg.versionType
  const assetsId = v.assetIndex?.id ?? v.assets ?? 'legacy'
  const vars: Record<string, string> = {
    auth_player_name: acc.name,
    version_name: ctx.id,
    game_directory: ctx.gameDir,
    assets_root: paths.assets(),
    game_assets: join(paths.assets(), 'virtual', assetsId),
    assets_index_name: assetsId,
    auth_uuid: acc.uuid,
    auth_access_token: acc.accessToken,
    access_token: acc.accessToken,
    auth_session: acc.accessToken,
    auth_xuid: '0',
    clientid: '0',
    // PCL-CE 对所有账户都使用 msa（PCL #1221）
    user_type: 'msa',
    user_properties: '{}',
    version_type: versionType,
    natives_directory: ctx.nativesDir,
    launcher_name: 'PixelsWorld',
    launcher_version: app.getVersion(),
    classpath: cp.join(delimiter),
    classpath_separator: delimiter,
    library_directory: paths.libraries(),
    libraries_directory: paths.libraries(),
    resolution_width: String(Math.round(size.width)),
    resolution_height: String(Math.round(size.height))
  }
  const fill = (s: string) => s.replace(/\$\{(\w+)\}/g, (m, k) => vars[k] ?? m)
  const fullscreen = cfg.windowMode === 'fullscreen'
  const features = { has_custom_resolution: !fullscreen }

  // ---- JVM ----
  const jvm: string[] = [...splitArgs(inst.jvmArgs || cfg.jvmArgs)]
  if (v.arguments?.jvm) {
    jvm.push(...expandArgs(v.arguments.jvm, features))
  } else {
    if (process.platform === 'darwin') jvm.push('-XstartOnFirstThread')
    jvm.push('-Djava.library.path=${natives_directory}', '-cp', '${classpath}')
  }
  if (cfg.preferredIpStack === 'v4') jvm.push('-Djava.net.preferIPv4Stack=true', '-Djava.net.preferIPv4Addresses=true')
  if (cfg.preferredIpStack === 'v6') jvm.push('-Djava.net.preferIPv6Stack=true', '-Djava.net.preferIPv6Addresses=true')

  const maxMb = Math.floor(memory.max * 1024)
  jvm.push(`-Xmn${Math.floor(maxMb * 0.15)}m`, `-Xmx${maxMb}m`)
  if (memory.initial !== null && !jvm.some((a) => /-Xms/i.test(a))) jvm.push(`-Xms${Math.floor(memory.initial * 1024)}m`)
  if (!jvm.includes('-Dlog4j2.formatMsgNoLookups=true')) jvm.push('-Dlog4j2.formatMsgNoLookups=true')

  // 编码（PCL #4700、#5892、#5909）
  if (java.major > 8) {
    if (!jvm.some((a) => a.startsWith('-Dstdout.encoding='))) jvm.unshift('-Dstdout.encoding=UTF-8')
    if (!jvm.some((a) => a.startsWith('-Dstderr.encoding='))) jvm.unshift('-Dstderr.encoding=UTF-8')
  } else {
    jvm.unshift('-Dsun.stdout.encoding=UTF-8', '-Dsun.stderr.encoding=UTF-8')
  }
  if (java.major >= 18 && !jvm.some((a) => a.startsWith('-Dfile.encoding='))) jvm.unshift('-Dfile.encoding=COMPAT')

  // 旧版本的 Log4Shell 修复配置
  const logging = v.logging?.client
  if (logging) jvm.push(logging.argument.replace('${path}', join(paths.assets(), 'log_configs', logging.file.id)))

  // ---- Game ----
  let game = v.arguments?.game ? expandArgs(v.arguments.game, features) : splitArgs(v.minecraftArguments ?? '')
  if (!v.arguments?.game && !fullscreen) game.push('--width', '${resolution_width}', '--height', '${resolution_height}')
  if (fullscreen) game.push('--fullscreen')
  game.push(...splitArgs(inst.gameArgs || cfg.gameArgs))
  // 版本类型为空时去掉 --versionType
  if (!versionType) {
    const i = game.indexOf('--versionType')
    if (i >= 0) game = [...game.slice(0, i), ...game.slice(i + 2)]
  }

  // 自动进入服务器：2023-04-04 之后的版本用 QuickPlay
  const server = inst.server.trim()
  if (server) {
    if (new Date(v.releaseTime ?? 0) > new Date('2023-04-04')) {
      game.push('--quickPlayMultiplayer', server)
    } else {
      const [host, port] = server.split(':')
      game.push('--server', host, '--port', port || '25565')
    }
  }

  return [...dedupeJvm(jvm), v.mainClass, ...game].map(fill)
}

// ---------- 启动前处理 ----------

/** options.txt：按 PCL-CE 的规则设置语言与全屏 */
async function prepareOptions(cfg: LauncherConfig, gameDir: string, releaseTime?: string): Promise<void> {
  let file = join(gameDir, 'options.txt')
  // Yosbr 兼容
  const yosbr = join(gameDir, 'config', 'yosbr', 'options.txt')
  if (!existsSync(file) && existsSync(yosbr)) file = yosbr

  if (cfg.autoGameLanguage) {
    const time = releaseTime ? new Date(releaseTime) : null
    const current = readCatIni(file).get('lang') ?? 'none'
    const unconfigured = current.toLowerCase() === 'none'
    const useLauncher = unconfigured || !existsSync(join(gameDir, 'saves'))
    let lang = 'none'
    // 1.1 之前没有语言选项；1.1~1.10 需要大写地区（zh_CN），之后为小写
    if (!(time && time > new Date('2000-01-01') && time <= new Date('2011-11-18'))) {
      const legacy = !!time && time >= new Date('2012-01-12') && time <= new Date('2016-06-08')
      const code = (useLauncher ? app.getLocale() : current).replace('-', '_')
      const [l, r] = code.split('_')
      lang = r ? `${l.toLowerCase()}_${legacy ? r.toUpperCase() : r.toLowerCase()}` : code.toLowerCase()
    }
    if (current !== lang) {
      await writeCatIni(file, 'lang', '-')
      await writeCatIni(file, 'lang', lang)
    }
    if (useLauncher && /^(zh|ja|ko)/i.test(app.getLocale())) await writeCatIni(file, 'forceUnicodeFont', 'true')
  }

  if (cfg.windowMode === 'fullscreen') await writeCatIni(file, 'fullscreen', 'true')
  else if (cfg.windowMode !== 'default') await writeCatIni(file, 'fullscreen', 'false')
}

/** 微软账户：更新 launcher_profiles.json，部分安装器与 Mod 会读取 */
async function updateLauncherProfiles(acc: Account): Promise<void> {
  if (acc.type !== 'microsoft') return
  const file = join(paths.root(), 'launcher_profiles.json')
  await ensureLauncherProfiles(paths.root())
  try {
    const json = JSON.parse(readFileSync(file, 'utf8'))
    // 与官方启动器的结构一致，以账户 UUID 作为键
    json.authenticationDatabase = {
      ...json.authenticationDatabase,
      [acc.uuid]: { username: acc.name, profiles: { [acc.uuid]: { displayName: acc.name } } }
    }
    json.selectedUser = { account: acc.uuid, profile: acc.uuid }
    await writeFile(file, JSON.stringify(json, null, 2))
  } catch {
    // 文件损坏时不影响启动
  }
}

/** Windows：让 Java 使用高性能显卡（写入当前用户的图形偏好） */
function setGpuPreference(javaPath: string): Promise<void> {
  if (process.platform !== 'win32') return Promise.resolve()
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['add', 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences', '/v', javaPath, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f'],
      { windowsHide: true },
      () => resolve()
    )
  })
}

/** 启动前自定义命令（全局 + 实例），在游戏文件夹中执行 */
async function runPreLaunch(command: string, wait: boolean): Promise<void> {
  if (!command.trim()) return
  log(`执行启动前命令：${command}`)
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
  const args = process.platform === 'win32' ? ['/c', command] : ['-c', command]
  const proc = spawn(shell, args, { cwd: paths.root(), windowsHide: true, stdio: 'ignore' })
  if (wait) await new Promise((r) => proc.on('exit', r).on('error', r))
}

/** 写出最近一次的启动脚本（令牌已隐藏），对应 PCL 的 LatestLaunch.bat */
async function writeLaunchScript(java: string, args: string[], gameDir: string, acc: Account, title: string) {
  const quote = (a: string) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)
  const masked = args.map((a) => (acc.accessToken && a === acc.accessToken ? '<access_token>' : a))
  const win = process.platform === 'win32'
  const script = win
    ? ['chcp 65001>nul', '@echo off', `title ${title}`, `cd /D ${quote(gameDir)}`, `${quote(java)} ${masked.map(quote).join(' ')}`, 'pause'].join('\r\n')
    : ['#!/bin/sh', `cd ${quote(gameDir)}`, `${quote(java)} ${masked.map(quote).join(' ')}`].join('\n')
  await writeFile(join(app.getPath('userData'), win ? 'LatestLaunch.bat' : 'LatestLaunch.sh'), script).catch(() => undefined)
}

const PRIORITY = {
  realtime: osConstants.priority.PRIORITY_HIGHEST,
  high: osConstants.priority.PRIORITY_HIGH,
  aboveNormal: osConstants.priority.PRIORITY_ABOVE_NORMAL,
  normal: osConstants.priority.PRIORITY_NORMAL,
  belowNormal: osConstants.priority.PRIORITY_BELOW_NORMAL
}

// ---------- 日志处理：把 log4j XML 事件转为可读文本 ----------

class LogParser {
  private buf = ''
  constructor(private emit: (lines: string[]) => void) {}

  push(chunk: string): void {
    this.buf += chunk
    const lines: string[] = []
    for (;;) {
      const start = this.buf.indexOf('<log4j:Event')
      if (start === -1) {
        const nl = this.buf.lastIndexOf('\n')
        if (nl === -1) break
        lines.push(...this.buf.slice(0, nl).split(/\r?\n/).filter((l) => l.trim()))
        this.buf = this.buf.slice(nl + 1)
        break
      }
      if (start > 0) {
        lines.push(...this.buf.slice(0, start).split(/\r?\n/).filter((l) => l.trim()))
        this.buf = this.buf.slice(start)
        continue
      }
      const end = this.buf.indexOf('</log4j:Event>')
      if (end === -1) break
      const ev = this.buf.slice(0, end)
      this.buf = this.buf.slice(end + '</log4j:Event>'.length)
      const attr = (n: string) => new RegExp(`${n}="([^"]*)"`).exec(ev)?.[1] ?? ''
      const msg = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(ev)?.[1] ?? ''
      const time = new Date(Number(attr('timestamp'))).toTimeString().slice(0, 8)
      lines.push(`[${time}] [${attr('thread')}/${attr('level')}]: ${msg}`)
      const thrown = /<log4j:Throwable><!\[CDATA\[([\s\S]*?)\]\]>/.exec(ev)?.[1]
      if (thrown) lines.push(...thrown.split(/\r?\n/))
    }
    if (lines.length) this.emit(lines)
  }
}

// ---------- 启动 ----------

export async function launchGame(onLaunched: () => void, onExit: () => void): Promise<void> {
  if (status.state !== 'idle') throw new Error('游戏已在运行')
  const cfg = getConfig()
  const id = cfg.selectedVersion
  if (!id) throw new Error('请先选择一个游戏版本')

  setStatus({ state: 'preparing', versionId: id })
  try {
    await runTask(`启动 ${id}`, async (task: Task) => {
      task.stage('验证账户')
      const acc = await accountForLaunch(cfg.selectedAccount)

      const v = await ensureVersionFiles(id, task)
      const inst = readInstanceSettings(paths.versionDir(id))
      const info = await analyzeInstance(id)
      const java = await ensureJava(v, task, inst.java)

      task.stage('解压本地库')
      const nativesDir = nativesDirFor(id)
      await extractNatives(v, nativesDir)

      // 首次启动时决定并记录版本隔离
      const gameDir = await gameDirFor(id, true)
      await mkdir(gameDir, { recursive: true })
      const memory = planMemory(cfg, inst, { modable: info.modable, optifine: info.optifine, gameDir }, java.is64)
      const args = buildArgs({ v, id, acc, java, memory, inst, info, nativesDir, gameDir })

      task.stage('准备启动')
      await prepareOptions(cfg, gameDir, v.releaseTime).catch(() => undefined)
      await updateLauncherProfiles(acc)
      await rememberVersion(id)
      if (cfg.gpuPreference) await setGpuPreference(java.path)
      await writeLaunchScript(java.path, args, gameDir, acc, `启动 - ${id}`)
      await runPreLaunch(cfg.preLaunchCommand, cfg.preLaunchWait)
      await runPreLaunch(inst.preLaunchCommand, inst.preLaunchWait)

      task.stage('启动游戏')
      log(
        `Java: ${java.path}（Java ${java.major}，${java.is64 ? '64' : '32'} 位）`,
        `内存: ${memory.max.toFixed(1)} GB${memory.initial !== null ? `，初始 ${memory.initial.toFixed(1)} GB` : ''}`,
        `工作目录: ${gameDir}`
      )
      const env: NodeJS.ProcessEnv = { ...process.env }
      const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
      env[pathKey] = [...new Set([...(env[pathKey] ?? '').split(delimiter), dirname(java.path)])].join(delimiter)
      // PCL-CE 把 APPDATA 指向游戏文件夹，部分老 Mod 依赖此行为
      if (process.platform === 'win32') env.APPDATA = paths.root()

      const proc = spawn(java.path, args, {
        cwd: gameDir,
        env,
        windowsHide: true,
        // 「启动后直接退出」时游戏需要脱离启动器独立运行
        detached: cfg.afterLaunch === 'exit',
        stdio: cfg.afterLaunch === 'exit' ? 'ignore' : 'pipe'
      })
      child = proc
      try {
        if (proc.pid) setPriority(proc.pid, PRIORITY[cfg.processPriority])
      } catch {
        log('设置进程优先级失败')
      }
      const parser = new LogParser((lines) => broadcast('game:log', lines))
      proc.stdout?.setEncoding('utf8').on('data', (d: string) => parser.push(d))
      proc.stderr?.setEncoding('utf8').on('data', (d: string) => parser.push(d))
      proc.on('error', (e) => log(`启动失败: ${e.message}`))
      proc.on('exit', (code) => {
        parser.push('\n')
        log(`游戏已退出，代码 ${code}`)
        child = null
        setStatus({ state: 'idle', versionId: id, exitCode: code })
        onExit()
      })
      if (cfg.afterLaunch === 'exit') proc.unref()
      setStatus({ state: 'running', versionId: id })
    })
    onLaunched()
  } catch (e) {
    if (!child) setStatus({ state: 'idle', versionId: id })
    throw e
  }
}
