import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readdir, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import type { InstanceSettings, JavaInfo } from '@shared/types'
import { getConfig } from './config'
import { downloadAll, fetchJson } from './download'
import { launcherDir } from './folders'
import { Task } from './tasks'
import type { VersionJson } from './version'

const isWin = process.platform === 'win32'
const javaExe = isWin ? 'java.exe' : 'java'

export const runtimeDir = () => join(app.getPath('userData'), 'runtime')

function managedJavaPath(component: string): string {
  const base = join(runtimeDir(), component)
  return process.platform === 'darwin'
    ? join(base, 'jre.bundle', 'Contents', 'Home', 'bin', 'java')
    : join(base, 'bin', javaExe)
}

/** 解析 `java -version` 输出 */
export function probe(path: string): Promise<{ version: string; major: number; is64: boolean } | null> {
  return new Promise((resolve) => {
    execFile(path, ['-version'], { timeout: 8000, windowsHide: true }, (err, _out, stderr) => {
      if (err) return resolve(null)
      const m = /version "([^"]+)"/.exec(stderr)
      if (!m) return resolve(null)
      const version = m[1]
      const parts = version.split(/[._-]/).map(Number)
      const major = parts[0] === 1 ? parts[1] : parts[0]
      // 64 位 JVM 会输出 "64-Bit Server VM"
      resolve({ version, major, is64: /64-Bit/i.test(stderr) })
    })
  })
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => join(dir, d.name))
  } catch {
    return []
  }
}

async function candidates(): Promise<string[]> {
  const set = new Set<string>()
  const addHome = (home: string) => set.add(join(home, 'bin', javaExe))

  if (process.env.JAVA_HOME) addHome(process.env.JAVA_HOME)
  for (const p of (process.env.PATH ?? '').split(delimiter)) {
    if (p && existsSync(join(p, javaExe))) set.add(join(p, javaExe))
  }

  const roots: string[] = [join(homedir(), '.jdks')]
  if (isWin) {
    for (const pf of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']]) {
      if (!pf) continue
      for (const vendor of ['Java', 'Eclipse Adoptium', 'Zulu', 'Microsoft', 'BellSoft', 'Amazon Corretto', 'Semeru'])
        roots.push(join(pf, vendor))
    }
  } else if (process.platform === 'darwin') {
    for (const d of await listDirs('/Library/Java/JavaVirtualMachines'))
      addHome(join(d, 'Contents', 'Home'))
  } else {
    roots.push('/usr/lib/jvm', '/usr/java', '/opt/java')
  }
  for (const root of roots) for (const d of await listDirs(root)) addHome(d)

  return [...set].filter((p) => existsSync(p))
}

export async function listJavas(): Promise<JavaInfo[]> {
  const out: JavaInfo[] = []
  for (const comp of await listDirs(runtimeDir())) {
    const p = managedJavaPath(comp.split(/[\\/]/).pop()!)
    const info = existsSync(p) ? await probe(p) : null
    if (info) out.push({ path: p, version: info.version, major: info.major, source: 'managed' })
  }
  const probed = await Promise.all((await candidates()).map(async (p) => ({ p, info: await probe(p) })))
  for (const { p, info } of probed)
    if (info) out.push({ path: p, version: info.version, major: info.major, source: 'system' })
  return out.sort((a, b) => b.major - a.major)
}

// ---------- Mojang 官方 Java 运行时 ----------

const RUNTIME_INDEX =
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'

function runtimePlatform(): string | null {
  const a = process.arch
  switch (process.platform) {
    case 'win32':
      return a === 'arm64' ? 'windows-arm64' : a === 'ia32' ? 'windows-x86' : 'windows-x64'
    case 'darwin':
      return a === 'arm64' ? 'mac-os-arm64' : 'mac-os'
    case 'linux':
      return a === 'ia32' ? 'linux-i386' : a === 'x64' ? 'linux' : null
    default:
      return null
  }
}

type RuntimeIndex = Record<string, Record<string, { manifest: { url: string } }[]>>
type RuntimeManifest = {
  files: Record<
    string,
    | { type: 'directory' }
    | { type: 'file'; executable?: boolean; downloads: { raw: { url: string; sha1: string; size: number } } }
    | { type: 'link'; target: string }
  >
}

async function installRuntime(component: string, task: Task): Promise<string | null> {
  const platform = runtimePlatform()
  if (!platform) return null
  task.stage(`获取 Java 运行时 (${component})`)
  const index = await fetchJson<RuntimeIndex>(RUNTIME_INDEX)
  const entry = index[platform]?.[component]?.[0]
  if (!entry) return null

  const manifest = await fetchJson<RuntimeManifest>(entry.manifest.url)
  const base = join(runtimeDir(), component)
  const files: { url: string; path: string; sha1: string; size: number; exec: boolean }[] = []
  const links: [string, string][] = []
  for (const [rel, f] of Object.entries(manifest.files)) {
    const p = join(base, rel)
    if (f.type === 'directory') await mkdir(p, { recursive: true })
    else if (f.type === 'file') files.push({ ...f.downloads.raw, path: p, exec: !!f.executable })
    else if (f.type === 'link') links.push([p, f.target])
  }

  task.stage(`下载 Java 运行时 (${component})`)
  await downloadAll(files, (d, t) => task.progress(d, t))

  if (!isWin) {
    for (const f of files) if (f.exec) await chmod(f.path, 0o755)
    for (const [p, target] of links) {
      if (existsSync(p)) continue
      await mkdir(dirname(p), { recursive: true })
      await symlink(target, p).catch(() => undefined)
    }
  }
  await writeFile(join(base, '.installed'), entry.manifest.url)
  const java = managedJavaPath(component)
  return existsSync(java) ? java : null
}

export interface SelectedJava {
  path: string
  major: number
  is64: boolean
}

async function describe(path: string): Promise<SelectedJava> {
  if (!existsSync(path)) throw new Error(`Java 路径不存在：${path}`)
  const info = await probe(path)
  if (!info) throw new Error(`无法运行 Java：${path}`)
  return { path, major: info.major, is64: info.is64 }
}

/**
 * 为指定版本选择合适的 Java，必要时自动下载。
 * 优先级与 PCL-CE 一致：实例指定 > 全局指定 > 自动选择。
 */
export async function ensureJava(
  v: VersionJson,
  task: Task,
  pref: InstanceSettings['java'] = { kind: 'global' }
): Promise<SelectedJava> {
  if (pref.kind === 'exist' && pref.path) return describe(pref.path)
  if (pref.kind === 'relative' && pref.path) return describe(resolve(launcherDir(), pref.path))
  const custom = getConfig().javaPath
  if (pref.kind === 'global' && custom) return describe(custom)

  const major = v.javaVersion?.majorVersion ?? 8
  const component = v.javaVersion?.component ?? 'jre-legacy'

  const managed = managedJavaPath(component)
  if (existsSync(join(runtimeDir(), component, '.installed')) && existsSync(managed)) return describe(managed)

  task.stage('检测 Java')
  const javas = await listJavas()
  const exact = javas.find((j) => j.major === major)
  if (exact) return describe(exact.path)

  let downloadError = ''
  const downloaded = await installRuntime(component, task).catch((e: Error) => {
    downloadError = e.message
    return null
  })
  if (downloaded) return describe(downloaded)

  // 无法下载时，退而求其次使用更新的 Java
  const newer = javas.filter((j) => j.major > major).sort((a, b) => a.major - b.major)[0]
  if (newer) return describe(newer.path)
  throw new Error(
    `找不到 Java ${major}，请在设置中手动指定 Java 路径${downloadError ? `（自动下载失败：${downloadError}）` : ''}`
  )
}
