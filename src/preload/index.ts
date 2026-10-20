import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { LauncherApi } from '../shared/types'

const invoke = (ch: string, ...args: unknown[]) => ipcRenderer.invoke(ch, ...args)

function listen<T>(ch: string) {
  return (cb: (v: T) => void) => {
    const fn = (_e: IpcRendererEvent, v: T) => cb(v)
    ipcRenderer.on(ch, fn)
    return () => {
      ipcRenderer.removeListener(ch, fn)
    }
  }
}

const api: LauncherApi = {
  platform: process.platform,
  config: {
    get: () => invoke('config:get'),
    set: (p) => invoke('config:set', p),
    pickDirectory: () => invoke('config:pickDirectory'),
    pickFile: () => invoke('config:pickFile')
  },
  versions: {
    manifest: () => invoke('versions:manifest'),
    installed: () => invoke('versions:installed'),
    install: (id, name) => invoke('versions:install', id, name),
    loaderVersions: (kind, gv) => invoke('versions:loaderVersions', kind, gv),
    installLoader: (kind, gv, lv, name) => invoke('versions:installLoader', kind, gv, lv, name),
    worlds: (id) => invoke('versions:worlds', id),
    remove: (id) => invoke('versions:remove', id),
    openFolder: (id) => invoke('versions:openFolder', id),
    settings: (id) => invoke('versions:settings', id),
    setSettings: (id, patch) => invoke('versions:setSettings', id, patch),
    memoryPreview: (id) => invoke('versions:memoryPreview', id)
  },
  resources: {
    search: (q) => invoke('resources:search', q),
    project: (id) => invoke('resources:project', id),
    versions: (id, filter) => invoke('resources:versions', id, filter),
    install: (req) => invoke('resources:install', req),
    gameVersions: () => invoke('resources:gameVersions')
  },
  favorites: {
    list: () => invoke('favorites:list'),
    add: (f) => invoke('favorites:add', f),
    remove: (id) => invoke('favorites:remove', id)
  },
  folders: {
    list: () => invoke('folders:list'),
    add: (path, name) => invoke('folders:add', path, name),
    remove: (path) => invoke('folders:remove', path),
    select: (path) => invoke('folders:select', path)
  },
  pcl: {
    detect: () => invoke('pcl:detect'),
    import: (opts) => invoke('pcl:import', opts)
  },
  accounts: {
    list: () => invoke('accounts:list'),
    addOffline: (n) => invoke('accounts:addOffline', n),
    loginMicrosoft: () => invoke('accounts:loginMicrosoft'),
    cancelMicrosoft: () => invoke('accounts:cancelMicrosoft'),
    remove: (id) => invoke('accounts:remove', id)
  },
  java: { list: () => invoke('java:list') },
  game: {
    launch: () => invoke('game:launch'),
    kill: () => invoke('game:kill'),
    status: () => invoke('game:status')
  },
  app: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggleMaximize'),
    close: () => ipcRenderer.send('win:close'),
    openGameDir: () => invoke('app:openGameDir'),
    openExternal: (url) => invoke('app:openExternal', url),
    version: () => invoke('app:version')
  },
  on: {
    task: listen('task'),
    gameLog: listen('game:log'),
    gameStatus: listen('game:status'),
    msCode: listen('ms:code'),
    maximized: listen('maximized')
  }
}

contextBridge.exposeInMainWorld('launcher', api)
