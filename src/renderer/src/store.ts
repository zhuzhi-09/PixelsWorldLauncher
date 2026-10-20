import { reactive, ref } from 'vue'
import type {
  Favorite,
  GameStatus,
  InstalledVersion,
  LauncherConfig,
  PublicAccount,
  ResourceHit,
  TaskProgress
} from '@shared/types'
import { applyTheme } from './theme'

export const api = window.launcher

export type Page = 'home' | 'versions' | 'download' | 'accounts' | 'settings'

export const store = reactive({
  page: 'home' as Page,
  config: null as LauncherConfig | null,
  accounts: [] as PublicAccount[],
  installed: [] as InstalledVersion[],
  tasks: [] as TaskProgress[],
  game: { state: 'idle' } as GameStatus,
  logs: [] as string[],
  snackbar: { text: '', key: 0 }
})

export function toast(text: string): void {
  store.snackbar = { text, key: store.snackbar.key + 1 }
}

export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  // 去掉 Electron IPC 的前缀
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export async function updateConfig(patch: Partial<LauncherConfig>): Promise<void> {
  store.config = await api.config.set(patch)
  if ('themeSeed' in patch || 'themeMode' in patch) {
    applyTheme(store.config.themeSeed, store.config.themeMode)
  }
}

export async function refreshAccounts(): Promise<void> {
  store.accounts = await api.accounts.list()
  store.config = await api.config.get()
}

export async function refreshInstalled(): Promise<void> {
  store.installed = await api.versions.installed()
  const cfg = store.config
  if (cfg && !store.installed.some((v) => v.id === cfg.selectedVersion) && store.installed[0]) {
    await updateConfig({ selectedVersion: store.installed[0].id })
  }
}

const MAX_LOGS = 2000

export async function initStore(): Promise<void> {
  // 先注册事件监听，避免初始化期间丢失状态变化
  api.on.task((t) => {
    const i = store.tasks.findIndex((x) => x.id === t.id)
    if (i >= 0) store.tasks[i] = t
    else store.tasks.unshift(t)
    if (t.state === 'success') {
      refreshInstalled()
      // 成功的任务几秒后自动消失
      setTimeout(() => (store.tasks = store.tasks.filter((x) => x.id !== t.id)), 4000)
    }
  })
  api.on.gameLog((lines) => {
    store.logs.push(...lines)
    if (store.logs.length > MAX_LOGS) store.logs.splice(0, store.logs.length - MAX_LOGS)
  })
  api.on.gameStatus((s) => {
    store.game = s
    if (s.state === 'idle' && s.exitCode !== undefined && s.exitCode !== 0 && s.exitCode !== null) {
      toast(`游戏异常退出（代码 ${s.exitCode}），可在主页查看日志`)
    }
  })

  store.config = await api.config.get()
  applyTheme(store.config.themeSeed, store.config.themeMode)
  store.game = await api.game.status()
  await Promise.all([refreshAccounts(), refreshInstalled()])
}

export const loaderLabel: Record<InstalledVersion['loader'], string> = {
  vanilla: '原版',
  fabric: 'Fabric',
  legacyfabric: 'Legacy Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
  cleanroom: 'Cleanroom',
  liteloader: 'LiteLoader',
  optifine: 'OptiFine',
  labymod: 'LabyMod',
  unknown: '其他'
}

export const ISOLATION_OPTIONS = [
  { value: 0, label: '关闭' },
  { value: 1, label: '仅隔离可安装 Mod 的版本' },
  { value: 2, label: '仅隔离非正式版' },
  { value: 3, label: '隔离非正式版与可安装 Mod 的版本' },
  { value: 4, label: '隔离所有版本' }
] as const

// ---------- 收藏夹 ----------

export const favorites = ref<Favorite[]>([])

export async function loadFavorites(): Promise<void> {
  favorites.value = await api.favorites.list()
}

export async function toggleFavorite(r: ResourceHit): Promise<void> {
  if (favorites.value.some((f) => f.id === r.id)) {
    favorites.value = await api.favorites.remove(r.id)
    toast(`已取消收藏 ${r.title}`)
  } else {
    favorites.value = await api.favorites.add({
      id: r.id,
      type: r.type,
      title: r.title,
      icon: r.icon,
      author: r.author,
      description: r.description
    })
    toast(`已收藏 ${r.title}`)
  }
}

/** 切换游戏文件夹后刷新版本列表 */
export async function switchFolder(path: string): Promise<void> {
  store.config = await api.folders.select(path)
  await refreshInstalled()
}
