import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getConfig } from './config'

const BMCLAPI = 'https://bmclapi2.bangbang93.com'

const MIRRORS: [string, string][] = [
  ['https://piston-meta.mojang.com', BMCLAPI],
  ['https://launchermeta.mojang.com', BMCLAPI],
  ['https://piston-data.mojang.com', BMCLAPI],
  ['https://launcher.mojang.com', BMCLAPI],
  ['https://resources.download.minecraft.net', `${BMCLAPI}/assets`],
  ['https://libraries.minecraft.net', `${BMCLAPI}/maven`],
  ['https://maven.fabricmc.net', `${BMCLAPI}/maven`],
  ['https://meta.fabricmc.net', `${BMCLAPI}/fabric-meta`]
]

/** 根据下载源设置把官方地址替换为镜像地址 */
export function mirror(url: string): string {
  if (getConfig().downloadSource !== 'bmclapi') return url
  for (const [from, to] of MIRRORS) {
    if (url.startsWith(from)) return to + url.slice(from.length)
  }
  return url
}

const UA = 'PixelsWorldLauncher/0.1'

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  const candidates = [mirror(url)]
  if (candidates[0] !== url) candidates.push(url) // 镜像失败时回退到官方源
  let lastErr: unknown
  for (const target of candidates) {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(target, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(60_000)
        })
        if (res.ok) return res
        lastErr = new Error(`HTTP ${res.status} ${target}`)
        if (res.status === 404) break
      } catch (e) {
        lastErr = e
      }
      await new Promise((r) => setTimeout(r, 500 * (i + 1)))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export async function fetchJson<T>(url: string): Promise<T> {
  return (await fetchWithRetry(url)).json() as Promise<T>
}

export function sha1File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha1')
    createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

export interface DownloadItem {
  url: string
  path: string
  sha1?: string
  size?: number
}

/** 文件已存在且大小匹配即视为完整（全量校验 sha1 太慢） */
export async function isComplete(item: DownloadItem): Promise<boolean> {
  try {
    const s = await stat(item.path)
    if (!s.isFile()) return false
    if (item.size !== undefined) return s.size === item.size
    return s.size > 0
  } catch {
    return false
  }
}

export async function downloadFile(item: DownloadItem): Promise<void> {
  const res = await fetchWithRetry(item.url)
  const buf = Buffer.from(await res.arrayBuffer())
  if (item.sha1) {
    const actual = createHash('sha1').update(buf).digest('hex')
    if (actual !== item.sha1) throw new Error(`校验失败: ${item.path}`)
  }
  await mkdir(dirname(item.path), { recursive: true })
  const tmp = `${item.path}.${process.pid}.tmp`
  await writeFile(tmp, buf)
  await rename(tmp, item.path)
}

/** 并发下载，跳过已完整的文件 */
export async function downloadAll(
  items: DownloadItem[],
  onProgress: (done: number, total: number) => void
): Promise<void> {
  const unique = [...new Map(items.map((i) => [i.path, i])).values()]
  const pending: DownloadItem[] = []
  for (const item of unique) if (!(await isComplete(item))) pending.push(item)

  let done = 0
  const total = pending.length
  onProgress(0, total)
  if (!total) return

  const errors: Error[] = []
  let cursor = 0
  const worker = async () => {
    while (cursor < pending.length) {
      const item = pending[cursor++]
      try {
        await downloadFile(item)
      } catch (e) {
        errors.push(e as Error)
      }
      onProgress(++done, total)
    }
  }
  const n = Math.max(1, Math.min(getConfig().concurrency, 64))
  await Promise.all(Array.from({ length: n }, worker))
  if (errors.length) {
    throw new Error(`${errors.length} 个文件下载失败，例如：${errors[0].message}`)
  }
}
