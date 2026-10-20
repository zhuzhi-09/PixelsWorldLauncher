import {
  argbFromHex,
  Hct,
  hexFromArgb,
  MaterialDynamicColors,
  SchemeTonalSpot
} from '@material/material-color-utilities'
import type { ThemeMode } from '@shared/types'

const media = window.matchMedia('(prefers-color-scheme: dark)')
let current: { seed: string; mode: ThemeMode } = { seed: '#4CAF50', mode: 'system' }

export const isDark = () => current.mode === 'dark' || (current.mode === 'system' && media.matches)

/** 根据种子颜色生成 MD3 全套颜色 token，写入 --md-sys-color-* */
export function applyTheme(seed: string, mode: ThemeMode): void {
  current = { seed, mode }
  const dark = isDark()
  const scheme = new SchemeTonalSpot(Hct.fromInt(argbFromHex(seed)), dark, 0)
  const root = document.documentElement
  for (const color of new MaterialDynamicColors().allColors) {
    const name = color.name.replace(/_/g, '-')
    root.style.setProperty(`--md-sys-color-${name}`, hexFromArgb(color.getArgb(scheme)))
  }
  root.dataset.theme = dark ? 'dark' : 'light'
}

media.addEventListener('change', () => applyTheme(current.seed, current.mode))

export const SEED_PRESETS = [
  { name: '草方块', color: '#4CAF50' },
  { name: '钻石', color: '#26C6DA' },
  { name: '青金石', color: '#3F51B5' },
  { name: '紫水晶', color: '#9C27B0' },
  { name: '下界', color: '#C62828' },
  { name: '金锭', color: '#FFB300' },
  { name: '樱花', color: '#EC6A9C' },
  { name: '橡木', color: '#8D6E63' }
]
