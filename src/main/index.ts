import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import type { InstanceSettings, LauncherConfig } from '@shared/types'
import { addFolder, listFolders, rememberVersion, removeFolder, selectFolder } from './core/folders'
import { analyzeInstance, gameDirFor } from './core/instance'
import { planMemory, systemMemory } from './core/memory'
import { detectPcl, importFromPcl } from './core/pcl/import'
import { readInstanceSettings, writeInstanceSettings } from './core/pcl/instanceConfig'
import { addOffline, cancelMicrosoft, listAccounts, loginMicrosoft, removeAccount } from './core/accounts'
import { getConfig, setConfig } from './core/config'
import {
  fabricLoaders,
  installedVersions,
  installFabric,
  installVanilla,
  remoteVersions,
  removeVersion
} from './core/install'
import { listJavas } from './core/java'
import { gameStatus, killGame, launchGame } from './core/launch'
import { broadcast, runTask } from './core/tasks'
import { paths } from './core/version'

let win: BrowserWindow | null = null

/** 版本号用于拼接路径，禁止路径穿越 */
function safeId(id: string): string {
  if (!id || id.includes('..') || /[\\/]/.test(id)) throw new Error('非法版本号')
  return id
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 900,
    minHeight: 580,
    show: false,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#121212',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.on('maximize', () => win?.webContents.send('maximized', true))
  win.on('unmaximize', () => win?.webContents.send('maximized', false))

  // 外部链接用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  const handle = (ch: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(ch, (_e, ...args) => fn(...args))

  // 配置
  handle('config:get', () => getConfig())
  handle('config:set', async (patch: Partial<LauncherConfig>) => {
    const cfg = await setConfig(patch)
    // 与 PCL-CE 一样，在文件夹的 PCL.ini 中记住所选版本
    if (patch.selectedVersion) await rememberVersion(patch.selectedVersion)
    return cfg
  })
  handle('config:pickDirectory', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  handle('config:pickFile', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'] })
    return r.canceled ? null : r.filePaths[0]
  })

  // 版本
  handle('versions:remote', () => remoteVersions())
  handle('versions:installed', () => installedVersions())
  handle('versions:install', (id: string) => runTask(`安装 ${id}`, (t) => installVanilla(id, t)))
  handle('versions:fabricLoaders', (gv: string) => fabricLoaders(gv))
  handle('versions:installFabric', (gv: string, loader: string) =>
    runTask(`安装 Fabric ${gv}`, (t) => installFabric(gv, loader, t))
  )
  handle('versions:remove', (id: string) => removeVersion(id))
  handle('versions:openFolder', (id: string) => shell.openPath(paths.versionDir(id)))
  handle('versions:settings', (id: string) => readInstanceSettings(paths.versionDir(safeId(id))))
  handle('versions:setSettings', async (id: string, patch: Partial<InstanceSettings>) => {
    await writeInstanceSettings(paths.versionDir(safeId(id)), patch)
    return readInstanceSettings(paths.versionDir(id))
  })
  handle('versions:memoryPreview', async (id: string | null) => {
    const cfg = getConfig()
    // 不传版本时按全局设置、普通原版估算
    const inst = readInstanceSettings(id ? paths.versionDir(safeId(id)) : null)
    const info = id ? await analyzeInstance(id) : { modable: false, optifine: false }
    const gameDir = id ? await gameDirFor(id) : paths.root()
    const plan = planMemory(cfg, inst, { ...info, gameDir })
    return { allocated: plan.max, ...systemMemory() }
  })

  // 游戏文件夹
  handle('folders:list', () => listFolders())
  handle('folders:add', (path: string, name?: string) => addFolder(path, name))
  handle('folders:remove', (path: string) => removeFolder(path))
  handle('folders:select', (path: string) => selectFolder(path))

  // PCL-CE 兼容
  handle('pcl:detect', () => detectPcl())
  handle('pcl:import', (opts: Parameters<typeof importFromPcl>[0]) => importFromPcl(opts))

  // 账户
  handle('accounts:list', () => listAccounts())
  handle('accounts:addOffline', (name: string) => addOffline(name))
  handle('accounts:loginMicrosoft', () => loginMicrosoft((c) => broadcast('ms:code', c)))
  handle('accounts:cancelMicrosoft', () => cancelMicrosoft())
  handle('accounts:remove', (id: string) => removeAccount(id))

  // Java
  handle('java:list', () => listJavas())

  // 游戏
  handle('game:launch', () =>
    launchGame(
      // 启动器可见性，与 PCL-CE 的 LauncherVisibility 一致
      () => {
        const after = getConfig().afterLaunch
        if (after === 'exit') app.quit()
        else if (after === 'minimizeAndReopen') win?.minimize()
        else if (after === 'hideAndExit' || after === 'hideAndReopen') win?.hide()
      },
      () => {
        const after = getConfig().afterLaunch
        if (after === 'hideAndExit') return app.quit()
        if (after === 'hideAndReopen' || after === 'minimizeAndReopen') {
          win?.show()
          win?.restore()
        }
      }
    )
  )
  handle('game:kill', () => killGame())
  handle('game:status', () => gameStatus())

  // 窗口
  ipcMain.on('win:minimize', () => win?.minimize())
  ipcMain.on('win:toggleMaximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()))
  ipcMain.on('win:close', () => win?.close())
  handle('app:openGameDir', () => shell.openPath(paths.root()))
  handle('app:openExternal', (url: string) => /^https?:/.test(url) && shell.openExternal(url))
  handle('app:version', () => app.getVersion())
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
