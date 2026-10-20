import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * PCL 的 "cat ini" 格式：每行 `键:值`，没有分节。
 * 用于 `.minecraft/PCL.ini`、旧版 `PCL/setup.ini` 与 `options.txt`。
 */
export function readCatIni(file: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!existsSync(file)) return map
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    map.set(line.slice(0, i), line.slice(i + 1))
  }
  return map
}

/** 修改单个键并保留其余内容与顺序 */
export async function writeCatIni(file: string, key: string, value: string): Promise<void> {
  const map = readCatIni(file)
  map.set(key, value)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, [...map].map(([k, v]) => `${k}:${v}`).join('\n'))
}
