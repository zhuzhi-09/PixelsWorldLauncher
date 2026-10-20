import type { LoaderKind, LoaderVersion } from '@shared/types'
import { fetchJson } from './download'
import { ensureVanilla, saveVersionJson } from './install'
import { Task } from './tasks'
import { mavenPath, readVersionJson, VersionJson } from './version'

/** Fabric、Quilt、Legacy Fabric 使用相同格式的元数据接口 */
const FABRIC_LIKE: Record<Exclude<LoaderKind, 'liteloader'>, { meta: string; name: string }> = {
  fabric: { meta: 'https://meta.fabricmc.net/v2', name: 'Fabric' },
  quilt: { meta: 'https://meta.quiltmc.org/v3', name: 'Quilt' },
  legacyfabric: { meta: 'https://meta.legacyfabric.net/v2', name: 'Legacy Fabric' }
}

export const LOADER_NAMES: Record<LoaderKind, string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  legacyfabric: 'Legacy Fabric',
  liteloader: 'LiteLoader'
}

// ---------- LiteLoader ----------

const LITELOADER_MANIFEST = 'http://dl.liteloader.com/versions/versions.json'
const BMCLAPI = 'https://bmclapi2.bangbang93.com'

interface LiteLoaderBuild {
  version: string
  tweakClass: string
  libraries: { name: string; url?: string }[]
  stream: 'RELEASE' | 'SNAPSHOT'
  md5?: string
}

interface LiteLoaderManifest {
  versions: Record<string, Record<string, Record<string, Record<string, LiteLoaderBuild>>>>
}

let liteCache: LiteLoaderManifest | null = null

async function liteLoaderBuilds(gameVersion: string): Promise<LiteLoaderBuild[]> {
  if (!liteCache) {
    try {
      liteCache = await fetchJson<LiteLoaderManifest>(LITELOADER_MANIFEST)
    } catch {
      // 官方服务器只有 HTTP 且不稳定，改用 BMCLAPI 的逐版本接口
      const one = await fetchJson<{ build: LiteLoaderBuild } | null>(
        `${BMCLAPI}/liteloader/list?mcversion=${encodeURIComponent(gameVersion)}`
      ).catch(() => null)
      return one?.build ? [one.build] : []
    }
  }
  const entry = liteCache.versions[gameVersion]
  if (!entry) return []
  const builds: LiteLoaderBuild[] = []
  for (const group of ['artefacts', 'snapshots'] as const) {
    const artefacts = entry[group]?.['com.mumfrey:liteloader']
    if (!artefacts) continue
    for (const [key, b] of Object.entries(artefacts)) if (key !== 'latest') builds.push(b)
  }
  return builds
}

async function installLiteLoader(gameVersion: string, version: string, task: Task, name?: string): Promise<string> {
  const build = (await liteLoaderBuilds(gameVersion)).find((b) => b.version === version)
  if (!build) throw new Error(`找不到 LiteLoader ${version}`)
  await ensureVanilla(gameVersion, task)
  const parent = await readVersionJson(gameVersion)
  if (!parent.minecraftArguments) throw new Error('LiteLoader 只支持 1.12.2 及更早的版本')

  const liteName = `com.mumfrey:liteloader:${build.version}`
  const json: VersionJson = {
    id: `${gameVersion}-LiteLoader`,
    inheritsFrom: gameVersion,
    jar: gameVersion,
    type: parent.type,
    releaseTime: parent.releaseTime,
    time: parent.time,
    mainClass: 'net.minecraft.launchwrapper.Launch',
    minecraftArguments: `${parent.minecraftArguments} --tweakClass ${build.tweakClass}`,
    libraries: [
      {
        name: liteName,
        downloads: {
          artifact: {
            path: mavenPath(liteName),
            url: `${BMCLAPI}/liteloader/download?version=${encodeURIComponent(build.version)}`
          }
        }
      },
      ...build.libraries.map((l) => ({
        name: l.name,
        // launchwrapper 在 Mojang 仓库，ASM 在 Maven Central
        url: l.name.startsWith('net.minecraft:') ? 'https://libraries.minecraft.net/' : 'https://repo1.maven.org/maven2/'
      }))
    ]
  }
  task.stage('安装 LiteLoader')
  return saveVersionJson(json, task, name)
}

// ---------- 对外接口 ----------

export async function loaderVersions(kind: LoaderKind, gameVersion: string): Promise<LoaderVersion[]> {
  if (kind === 'liteloader') {
    return (await liteLoaderBuilds(gameVersion))
      .map((b) => ({ version: b.version, stable: b.stream === 'RELEASE' }))
      .reverse()
  }
  const list = await fetchJson<{ loader: { version: string; stable?: boolean } }[]>(
    `${FABRIC_LIKE[kind].meta}/versions/loader/${encodeURIComponent(gameVersion)}`
  ).catch(() => [])
  return list.map(({ loader }) => ({
    version: loader.version,
    // Quilt 没有 stable 字段，按版本号判断
    stable: loader.stable ?? !/beta|alpha|pre|rc/i.test(loader.version)
  }))
}

export async function installLoader(
  kind: LoaderKind,
  gameVersion: string,
  loaderVersion: string,
  task: Task,
  name?: string
): Promise<string> {
  if (kind === 'liteloader') return installLiteLoader(gameVersion, loaderVersion, task, name)
  await ensureVanilla(gameVersion, task)
  task.stage(`获取 ${FABRIC_LIKE[kind].name} 配置`)
  const profile = await fetchJson<VersionJson>(
    `${FABRIC_LIKE[kind].meta}/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`
  )
  return saveVersionJson(profile, task, name)
}
