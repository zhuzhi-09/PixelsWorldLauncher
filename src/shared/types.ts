export type DownloadSource = 'official' | 'bmclapi'
export type ThemeMode = 'system' | 'light' | 'dark'

/**
 * 版本隔离默认策略，与 PCL-CE 的 LaunchArgumentIndieV2 取值一致：
 * 0 关闭 / 1 仅隔离可安装 Mod 的版本 / 2 仅隔离非正式版 / 3 隔离非正式版与可安装 Mod 的版本 / 4 隔离所有版本
 */
export type IsolationMode = 0 | 1 | 2 | 3 | 4

/** 与 PCL-CE 的 GameWindowSizeMode 对应 */
export type WindowMode = 'fullscreen' | 'default' | 'launcher' | 'custom' | 'maximized'

/** 与 PCL-CE 的 LauncherVisibility 对应 */
export type AfterLaunch = 'exit' | 'hideAndExit' | 'hideAndReopen' | 'minimizeAndReopen' | 'keep'

export type ProcessPriority = 'realtime' | 'high' | 'aboveNormal' | 'normal' | 'belowNormal'

export interface GameFolder {
  name: string
  path: string
  /** original：自动发现；custom：用户添加或从 PCL-CE 导入 */
  type: 'original' | 'custom'
}

export interface LauncherConfig {
  configVersion: number
  /** 当前 .minecraft 目录 */
  gameDir: string
  /** 自定义的游戏文件夹（与 PCL-CE 的 LaunchFolders 对应） */
  gameFolders: GameFolder[]
  isolationMode: IsolationMode
  /** 自定义 Java 路径，留空则自动选择 */
  javaPath: string
  memoryMode: 'auto' | 'custom'
  /** PCL 的内存刻度（见 memory.ts 的 ramFromTick） */
  memoryTick: number
  /** 初始内存刻度，0 表示不设置 -Xms */
  memoryInitialTick: number
  /** 锁定内存：-Xms 等于 -Xmx */
  lockMemory: boolean
  jvmArgs: string
  gameArgs: string
  preferredIpStack: 'v4' | 'default' | 'v6'
  windowMode: WindowMode
  windowWidth: number
  windowHeight: number
  /** 传给游戏的 --versionType，留空则不显示 */
  versionType: string
  preLaunchCommand: string
  preLaunchWait: boolean
  processPriority: ProcessPriority
  /** 首次启动时按启动器语言设置游戏语言 */
  autoGameLanguage: boolean
  /** Windows：让 Java 使用高性能显卡 */
  gpuPreference: boolean
  downloadSource: DownloadSource
  concurrency: number
  themeSeed: string
  themeMode: ThemeMode
  selectedVersion: string
  selectedAccount: string
  /** 微软登录所需的 Azure 应用 Client ID */
  msClientId: string
  afterLaunch: AfterLaunch
}

/** 实例独立设置，读写 versions/<id>/PCL/config.v1.yml，与 PCL-CE 共用 */
export interface InstanceSettings {
  /** null 表示尚未决定，首次启动时按全局策略决定并写入 */
  isolation: boolean | null
  memoryMode: 'global' | 'auto' | 'custom'
  memoryTick: number
  memoryInitialTick: number
  jvmArgs: string
  gameArgs: string
  java: { kind: 'global' } | { kind: 'auto' } | { kind: 'exist'; path: string } | { kind: 'relative'; path: string }
  server: string
  versionType: string
  title: string
  preLaunchCommand: string
  preLaunchWait: boolean
  classpathHead: string
}

export interface PclDetection {
  found: boolean
  configPath: string
  folders: number
  accounts: number
}

export interface PclImportResult {
  settings: string[]
  folders: number
  accounts: { imported: number; skipped: string[] }
  warnings: string[]
}

export type AccountType = 'offline' | 'microsoft'

export interface Account {
  id: string
  type: AccountType
  name: string
  uuid: string
  accessToken: string
  refreshToken?: string
  /** 毫秒时间戳 */
  expiresAt?: number
  /** 从 PCL-CE 导入的微软账户：刷新令牌属于 PCL-CE 的应用，过期后需要重新登录 */
  importedFrom?: 'pcl'
  skinUrl?: string
}

/** 不含敏感令牌的账户信息，传给渲染进程 */
export type PublicAccount = Omit<Account, 'accessToken' | 'refreshToken'>

export interface RemoteVersion {
  id: string
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha' | string
  url: string
  releaseTime: string
  sha1?: string
}

export interface InstalledVersion {
  id: string
  type: string
  releaseTime?: string
  inheritsFrom?: string
  loader: LoaderType
  /** 同时安装的附加组件，例如 Forge + OptiFine */
  addons: LoaderType[]
  /** 对应的原版版本号 */
  gameVersion: string
  /** 可安装 Mod（PCL 的 Modable） */
  modable: boolean
  /** 是否为非正式版（快照、远古版、愚人节版本） */
  nonRelease: boolean
  /** 版本隔离：已决定的结果；null 表示首次启动时按全局策略决定 */
  isolation: boolean | null
}

export type LoaderType =
  | 'vanilla'
  | 'fabric'
  | 'legacyfabric'
  | 'quilt'
  | 'forge'
  | 'neoforge'
  | 'cleanroom'
  | 'liteloader'
  | 'optifine'
  | 'labymod'
  | 'unknown'

export interface FabricLoaderVersion {
  version: string
  stable: boolean
}

export interface JavaInfo {
  path: string
  version: string
  major: number
  /** 来源：系统检测 / 启动器下载 */
  source: 'system' | 'managed'
}

export interface TaskProgress {
  id: string
  title: string
  stage: string
  done: number
  total: number
  state: 'running' | 'success' | 'error'
  error?: string
}

export type GameState = 'idle' | 'preparing' | 'running'

export interface GameStatus {
  state: GameState
  versionId?: string
  exitCode?: number | null
}

export interface MsDeviceCode {
  userCode: string
  verificationUri: string
  expiresIn: number
}

export interface LauncherApi {
  platform: NodeJS.Platform
  config: {
    get(): Promise<LauncherConfig>
    set(patch: Partial<LauncherConfig>): Promise<LauncherConfig>
    pickDirectory(): Promise<string | null>
    pickFile(): Promise<string | null>
  }
  versions: {
    remote(): Promise<RemoteVersion[]>
    installed(): Promise<InstalledVersion[]>
    install(id: string): Promise<void>
    fabricLoaders(gameVersion: string): Promise<FabricLoaderVersion[]>
    installFabric(gameVersion: string, loader: string): Promise<string>
    remove(id: string): Promise<void>
    openFolder(id: string): Promise<void>
    settings(id: string): Promise<InstanceSettings>
    setSettings(id: string, patch: Partial<InstanceSettings>): Promise<InstanceSettings>
    /** 按当前设置计算出的实际内存（GB），用于界面显示 */
    memoryPreview(id: string | null): Promise<{ allocated: number; free: number; total: number }>
  }
  folders: {
    list(): Promise<GameFolder[]>
    add(path: string, name?: string): Promise<GameFolder[]>
    remove(path: string): Promise<GameFolder[]>
    select(path: string): Promise<LauncherConfig>
  }
  pcl: {
    detect(): Promise<PclDetection>
    import(options: { settings: boolean; folders: boolean; accounts: boolean; pclDir?: string }): Promise<PclImportResult>
  }
  accounts: {
    list(): Promise<PublicAccount[]>
    addOffline(name: string): Promise<PublicAccount>
    loginMicrosoft(): Promise<PublicAccount>
    cancelMicrosoft(): Promise<void>
    remove(id: string): Promise<void>
  }
  java: {
    list(): Promise<JavaInfo[]>
  }
  game: {
    launch(): Promise<void>
    kill(): Promise<void>
    status(): Promise<GameStatus>
  }
  app: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    openGameDir(): Promise<void>
    openExternal(url: string): Promise<void>
    version(): Promise<string>
  }
  on: {
    task(cb: (t: TaskProgress) => void): () => void
    gameLog(cb: (lines: string[]) => void): () => void
    gameStatus(cb: (s: GameStatus) => void): () => void
    msCode(cb: (c: MsDeviceCode) => void): () => void
    maximized(cb: (m: boolean) => void): () => void
  }
}
