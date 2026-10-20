<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import type { GameFolder, JavaInfo, LauncherConfig, PclDetection, PclImportResult, ThemeMode } from '@shared/types'
import MemorySlider from '../components/MemorySlider.vue'
import { api, errorText, ISOLATION_OPTIONS, refreshAccounts, refreshInstalled, store, switchFolder, toast, updateConfig } from '../store'
import { SEED_PRESETS } from '../theme'

const cfg = computed(() => store.config as LauncherConfig)
const set = <K extends keyof LauncherConfig>(k: K, v: LauncherConfig[K]) => updateConfig({ [k]: v })
const val = (e: Event) => (e.target as HTMLInputElement).value
const num = (e: Event) => Number((e.target as HTMLInputElement).value)
const checked = (e: Event) => (e.target as HTMLInputElement & { selected: boolean }).selected
const isWin = api.platform === 'win32'

const PCL_DEFAULT_JVM =
  '-XX:+UseG1GC -XX:-UseAdaptiveSizePolicy -XX:-OmitStackTraceInFastThrow -Djdk.lang.Process.allowAmbiguousCommands=true -Dfml.ignoreInvalidMinecraftCertificates=True -Dfml.ignorePatchDiscrepancies=True -Dlog4j2.formatMsgNoLookups=true'

const modes: { v: ThemeMode; label: string; icon: string }[] = [
  { v: 'system', label: '跟随系统', icon: 'brightness_auto' },
  { v: 'light', label: '浅色', icon: 'light_mode' },
  { v: 'dark', label: '深色', icon: 'dark_mode' }
]

const WINDOW_MODES = [
  { v: 'default', l: '默认（854 × 480）' },
  { v: 'launcher', l: '与启动器一致' },
  { v: 'custom', l: '自定义' },
  { v: 'maximized', l: '最大化' },
  { v: 'fullscreen', l: '全屏' }
] as const

const AFTER_LAUNCH = [
  { v: 'keep', l: '保持不变' },
  { v: 'minimizeAndReopen', l: '最小化，游戏退出后恢复' },
  { v: 'hideAndReopen', l: '隐藏，游戏退出后重新显示' },
  { v: 'hideAndExit', l: '隐藏，游戏退出后关闭启动器' },
  { v: 'exit', l: '直接关闭启动器' }
] as const

const PRIORITIES = [
  { v: 'high', l: '最高' },
  { v: 'aboveNormal', l: '较高' },
  { v: 'normal', l: '中' },
  { v: 'belowNormal', l: '较低' }
] as const

// ---------- 游戏文件夹 ----------
const folders = ref<GameFolder[]>([])
const loadFolders = async () => (folders.value = await api.folders.list())

async function addFolder(): Promise<void> {
  const d = await api.config.pickDirectory()
  if (!d) return
  folders.value = await api.folders.add(d)
}
async function removeFolder(f: GameFolder): Promise<void> {
  folders.value = await api.folders.remove(f.path)
}

// ---------- 内存 ----------
const mem = ref({ allocated: 0, free: 0, total: 8 })
const refreshMem = async () => (mem.value = await api.versions.memoryPreview(null))
async function setMem(patch: Partial<LauncherConfig>): Promise<void> {
  await updateConfig(patch)
  refreshMem()
}

// ---------- Java ----------
const javas = ref<JavaInfo[]>([])
const scanning = ref(false)
async function scanJava(): Promise<void> {
  scanning.value = true
  javas.value = await api.java.list().finally(() => (scanning.value = false))
}
async function browseJava(): Promise<void> {
  const f = await api.config.pickFile()
  if (f) await set('javaPath', f)
}

// ---------- PCL-CE 导入 ----------
const pcl = ref<PclDetection | null>(null)
const importOpen = ref(false)
const importing = ref(false)
const importOpts = ref({ settings: true, folders: true, accounts: true, pclDir: '' })
const importResult = ref<PclImportResult | null>(null)

async function pickPclDir(): Promise<void> {
  const d = await api.config.pickDirectory()
  if (d) importOpts.value.pclDir = d
}

async function runImport(): Promise<void> {
  importing.value = true
  try {
    const o = importOpts.value
    importResult.value = await api.pcl.import({ ...o, pclDir: o.pclDir || undefined })
    store.config = await api.config.get()
    await Promise.all([refreshAccounts(), refreshInstalled(), loadFolders(), refreshMem()])
  } catch (e) {
    toast(errorText(e))
  } finally {
    importing.value = false
  }
}

function openImport(): void {
  importResult.value = null
  importOpen.value = true
}

const appVersion = ref('')
onMounted(async () => {
  appVersion.value = await api.app.version()
  pcl.value = await api.pcl.detect()
  scanJava()
})
onActivated(() => {
  loadFolders()
  refreshMem()
})
</script>

<template>
  <div v-if="cfg" class="page settings">
    <div class="page-header">
      <h1 class="md-typescale-headline-medium">设置</h1>
    </div>

    <!-- PCL-CE -->
    <div v-if="pcl?.found" class="card pcl-banner">
      <md-icon>move_down</md-icon>
      <div class="grow">
        <div class="md-typescale-title-small">检测到 PCL-CE</div>
        <div class="md-typescale-body-medium">可以导入它的设置、游戏文件夹和账户。版本独立设置无需导入，两者直接共用。</div>
      </div>
      <md-filled-tonal-button @click="openImport">导入</md-filled-tonal-button>
    </div>

    <!-- 外观 -->
    <h2 class="section-title md-typescale-title-small">外观</h2>
    <div class="card group">
      <div class="item">
        <md-icon>contrast</md-icon>
        <div class="grow md-typescale-body-large">主题模式</div>
        <div class="segmented" role="radiogroup">
          <button
            v-for="m in modes"
            :key="m.v"
            role="radio"
            :aria-checked="cfg.themeMode === m.v"
            :class="{ on: cfg.themeMode === m.v }"
            @click="set('themeMode', m.v)"
          >
            <md-ripple></md-ripple>
            <md-icon>{{ cfg.themeMode === m.v ? 'check' : m.icon }}</md-icon>
            {{ m.label }}
          </button>
        </div>
      </div>
      <md-divider></md-divider>
      <div class="item column">
        <div class="row">
          <md-icon>palette</md-icon>
          <div class="grow">
            <div class="md-typescale-body-large">主题色</div>
            <div class="md-typescale-body-medium muted">基于 Material You 动态配色生成整套颜色</div>
          </div>
        </div>
        <div class="swatches">
          <button
            v-for="p in SEED_PRESETS"
            :key="p.color"
            class="swatch"
            :title="p.name"
            :class="{ on: cfg.themeSeed.toLowerCase() === p.color.toLowerCase() }"
            :style="{ '--c': p.color }"
            @click="set('themeSeed', p.color)"
          >
            <md-icon>check</md-icon>
          </button>
          <label class="swatch custom" title="自定义颜色">
            <md-icon>colorize</md-icon>
            <input type="color" :value="cfg.themeSeed" @change="set('themeSeed', val($event))" />
          </label>
        </div>
      </div>
    </div>

    <!-- 游戏文件夹 -->
    <h2 class="section-title md-typescale-title-small">游戏文件夹</h2>
    <div class="card group">
      <md-list class="folder-list">
        <md-list-item
          v-for="f in folders"
          :key="f.path"
          type="button"
          @click="switchFolder(f.path).then(loadFolders)"
        >
          <md-icon slot="start">
            {{ f.path === cfg.gameDir ? 'radio_button_checked' : 'radio_button_unchecked' }}
          </md-icon>
          <div slot="headline">{{ f.name }}</div>
          <div slot="supporting-text" class="ellipsis">{{ f.path }}</div>
          <md-icon-button
            v-if="f.type === 'custom'"
            slot="end"
            title="从列表移除（不会删除文件）"
            @click.stop="removeFolder(f)"
          >
            <md-icon>close</md-icon>
          </md-icon-button>
        </md-list-item>
      </md-list>
      <div class="item actions-row">
        <span class="md-typescale-body-small muted grow">
          与 PCL-CE 相同：自动识别启动器旁的 .minecraft 与官方启动器文件夹
        </span>
        <md-icon-button title="打开当前文件夹" @click="api.app.openGameDir()"><md-icon>open_in_new</md-icon></md-icon-button>
        <md-outlined-button @click="addFolder">
          <md-icon slot="icon">create_new_folder</md-icon>
          添加
        </md-outlined-button>
      </div>
    </div>

    <!-- 启动 -->
    <h2 class="section-title md-typescale-title-small">启动</h2>
    <div class="card group">
      <div class="item">
        <md-icon>call_split</md-icon>
        <div class="grow">
          <div class="md-typescale-body-large">版本隔离</div>
          <div class="md-typescale-body-medium muted">新版本首次启动时按此规则决定，之后可在版本设置中单独修改</div>
        </div>
        <md-outlined-select :value="String(cfg.isolationMode)" @change="set('isolationMode', num($event) as any)">
          <md-select-option
            v-for="o in ISOLATION_OPTIONS"
            :key="o.value"
            :value="String(o.value)"
            :selected="cfg.isolationMode === o.value"
          >
            <div slot="headline">{{ o.label }}</div>
          </md-select-option>
        </md-outlined-select>
      </div>
      <md-divider></md-divider>
      <div class="item">
        <md-icon>aspect_ratio</md-icon>
        <div class="grow md-typescale-body-large">游戏窗口</div>
        <template v-if="cfg.windowMode === 'custom'">
          <md-outlined-text-field
            class="small-field"
            label="宽"
            type="number"
            :value="String(cfg.windowWidth)"
            @change="set('windowWidth', num($event))"
          ></md-outlined-text-field>
          <md-outlined-text-field
            class="small-field"
            label="高"
            type="number"
            :value="String(cfg.windowHeight)"
            @change="set('windowHeight', num($event))"
          ></md-outlined-text-field>
        </template>
        <md-outlined-select :value="cfg.windowMode" @change="set('windowMode', val($event) as any)">
          <md-select-option v-for="m in WINDOW_MODES" :key="m.v" :value="m.v" :selected="cfg.windowMode === m.v">
            <div slot="headline">{{ m.l }}</div>
          </md-select-option>
        </md-outlined-select>
      </div>
      <md-divider></md-divider>
      <div class="item">
        <md-icon>rocket_launch</md-icon>
        <div class="grow md-typescale-body-large">游戏启动后</div>
        <md-outlined-select :value="cfg.afterLaunch" @change="set('afterLaunch', val($event) as any)">
          <md-select-option v-for="m in AFTER_LAUNCH" :key="m.v" :value="m.v" :selected="cfg.afterLaunch === m.v">
            <div slot="headline">{{ m.l }}</div>
          </md-select-option>
        </md-outlined-select>
      </div>
      <md-divider></md-divider>
      <div class="item">
        <md-icon>speed</md-icon>
        <div class="grow md-typescale-body-large">进程优先级</div>
        <md-outlined-select :value="cfg.processPriority" @change="set('processPriority', val($event) as any)">
          <md-select-option v-for="m in PRIORITIES" :key="m.v" :value="m.v" :selected="cfg.processPriority === m.v">
            <div slot="headline">{{ m.l }}</div>
          </md-select-option>
        </md-outlined-select>
      </div>
      <md-divider></md-divider>
      <div class="item">
        <md-icon>label</md-icon>
        <div class="grow">
          <div class="md-typescale-body-large">版本类型显示</div>
          <div class="md-typescale-body-medium muted">显示在游戏主界面左下角，留空则不显示</div>
        </div>
        <md-outlined-text-field
          class="mid-field"
          :value="cfg.versionType"
          @change="set('versionType', val($event))"
        ></md-outlined-text-field>
      </div>
      <md-divider></md-divider>
      <label class="item">
        <md-icon>translate</md-icon>
        <div class="grow">
          <div class="md-typescale-body-large">自动设置游戏语言</div>
          <div class="md-typescale-body-medium muted">新版本或没有存档时，把游戏语言设为与启动器一致</div>
        </div>
        <md-switch :selected="cfg.autoGameLanguage" @change="set('autoGameLanguage', checked($event))"></md-switch>
      </label>
      <template v-if="isWin">
        <md-divider></md-divider>
        <label class="item">
          <md-icon>memory_alt</md-icon>
          <div class="grow">
            <div class="md-typescale-body-large">使用高性能显卡</div>
            <div class="md-typescale-body-medium muted">在 Windows 图形设置中为所用的 Java 选择高性能 GPU</div>
          </div>
          <md-switch :selected="cfg.gpuPreference" @change="set('gpuPreference', checked($event))"></md-switch>
        </label>
      </template>
    </div>

    <!-- 内存 -->
    <h2 class="section-title md-typescale-title-small">内存</h2>
    <div class="card group">
      <div class="item">
        <md-icon>memory</md-icon>
        <div class="grow">
          <div class="md-typescale-body-large">游戏内存</div>
          <div class="md-typescale-body-medium muted">
            将分配 {{ mem.allocated.toFixed(1) }} GB · 当前可用 {{ mem.free.toFixed(1) }} / {{ mem.total.toFixed(1) }} GB
          </div>
        </div>
        <div class="segmented">
          <button :class="{ on: cfg.memoryMode === 'auto' }" @click="setMem({ memoryMode: 'auto' })">
            <md-ripple></md-ripple>自动
          </button>
          <button :class="{ on: cfg.memoryMode === 'custom' }" @click="setMem({ memoryMode: 'custom' })">
            <md-ripple></md-ripple>自定义
          </button>
        </div>
      </div>
      <div v-if="cfg.memoryMode === 'custom'" class="item column">
        <MemorySlider
          label="最大内存"
          :tick="cfg.memoryTick"
          :total-gb="mem.total"
          @change="(t) => setMem({ memoryTick: t })"
        />
        <MemorySlider
          v-if="!cfg.lockMemory"
          label="初始内存"
          :min="0"
          :tick="cfg.memoryInitialTick"
          :total-gb="mem.total"
          @change="(t) => setMem({ memoryInitialTick: t })"
        />
      </div>
      <md-divider></md-divider>
      <label class="item">
        <md-icon>lock</md-icon>
        <div class="grow">
          <div class="md-typescale-body-large">锁定内存</div>
          <div class="md-typescale-body-medium muted">初始内存与最大内存相同，减少卡顿，适合 ZGC</div>
        </div>
        <md-switch :selected="cfg.lockMemory" @change="setMem({ lockMemory: checked($event) })"></md-switch>
      </label>
    </div>

    <!-- Java -->
    <h2 class="section-title md-typescale-title-small">Java</h2>
    <div class="card group">
      <div class="item">
        <md-icon>coffee</md-icon>
        <div class="grow">
          <div class="md-typescale-body-large">Java 路径</div>
          <div class="md-typescale-body-medium muted">自动模式会按版本需求选择或下载官方 Java 运行时</div>
        </div>
        <md-icon-button title="重新扫描" :disabled="scanning" @click="scanJava"><md-icon>refresh</md-icon></md-icon-button>
        <md-outlined-button @click="browseJava">浏览</md-outlined-button>
      </div>
      <md-list class="java-list">
        <md-list-item type="button" @click="set('javaPath', '')">
          <md-icon slot="start">{{ !cfg.javaPath ? 'radio_button_checked' : 'radio_button_unchecked' }}</md-icon>
          <div slot="headline">自动选择（推荐）</div>
        </md-list-item>
        <md-list-item v-for="j in javas" :key="j.path" type="button" @click="set('javaPath', j.path)">
          <md-icon slot="start">{{ cfg.javaPath === j.path ? 'radio_button_checked' : 'radio_button_unchecked' }}</md-icon>
          <div slot="headline">Java {{ j.major }} <span class="muted">({{ j.version }})</span></div>
          <div slot="supporting-text" class="ellipsis">{{ j.path }}</div>
          <span v-if="j.source === 'managed'" slot="end" class="tag">启动器下载</span>
        </md-list-item>
        <md-list-item v-if="cfg.javaPath && !javas.some((j) => j.path === cfg.javaPath)">
          <md-icon slot="start">radio_button_checked</md-icon>
          <div slot="headline">自定义</div>
          <div slot="supporting-text">{{ cfg.javaPath }}</div>
        </md-list-item>
      </md-list>
    </div>

    <!-- 高级 -->
    <h2 class="section-title md-typescale-title-small">高级</h2>
    <div class="card group">
      <div class="item column">
        <div class="row">
          <md-outlined-text-field
            class="grow"
            label="JVM 参数"
            :value="cfg.jvmArgs"
            @change="set('jvmArgs', val($event))"
          ></md-outlined-text-field>
          <md-text-button v-if="cfg.jvmArgs !== PCL_DEFAULT_JVM" @click="set('jvmArgs', PCL_DEFAULT_JVM)">
            恢复默认
          </md-text-button>
        </div>
        <md-outlined-text-field
          label="游戏参数"
          placeholder="--demo"
          :value="cfg.gameArgs"
          @change="set('gameArgs', val($event))"
        ></md-outlined-text-field>
        <md-outlined-text-field
          label="启动前执行的命令"
          :supporting-text="isWin ? '通过 cmd 在游戏文件夹中执行' : '通过 sh 在游戏文件夹中执行'"
          :value="cfg.preLaunchCommand"
          @change="set('preLaunchCommand', val($event))"
        ></md-outlined-text-field>
        <label class="row inline-switch md-typescale-body-medium">
          <span class="grow">等待命令执行完成再启动游戏</span>
          <md-switch :selected="cfg.preLaunchWait" @change="set('preLaunchWait', checked($event))"></md-switch>
        </label>
      </div>
      <md-divider></md-divider>
      <div class="item">
        <md-icon>lan</md-icon>
        <div class="grow md-typescale-body-large">IP 协议偏好</div>
        <md-outlined-select :value="cfg.preferredIpStack" @change="set('preferredIpStack', val($event) as any)">
          <md-select-option value="v4" :selected="cfg.preferredIpStack === 'v4'"><div slot="headline">优先 IPv4</div></md-select-option>
          <md-select-option value="default" :selected="cfg.preferredIpStack === 'default'"><div slot="headline">默认</div></md-select-option>
          <md-select-option value="v6" :selected="cfg.preferredIpStack === 'v6'"><div slot="headline">优先 IPv6</div></md-select-option>
        </md-outlined-select>
      </div>
    </div>

    <!-- 下载 -->
    <h2 class="section-title md-typescale-title-small">下载</h2>
    <div class="card group">
      <div class="item">
        <md-icon>cloud_download</md-icon>
        <div class="grow">
          <div class="md-typescale-body-large">下载源</div>
          <div class="md-typescale-body-medium muted">中国大陆用户推荐 BMCLAPI 镜像，失败时会自动回退官方源</div>
        </div>
        <md-outlined-select :value="cfg.downloadSource" @change="set('downloadSource', val($event) as any)">
          <md-select-option value="official" :selected="cfg.downloadSource === 'official'"><div slot="headline">官方</div></md-select-option>
          <md-select-option value="bmclapi" :selected="cfg.downloadSource === 'bmclapi'"><div slot="headline">BMCLAPI</div></md-select-option>
        </md-outlined-select>
      </div>
      <md-divider></md-divider>
      <div class="item column">
        <div class="row">
          <md-icon>speed</md-icon>
          <div class="grow md-typescale-body-large">并发下载数</div>
          <span class="value md-typescale-title-medium">{{ cfg.concurrency }}</span>
        </div>
        <md-slider min="1" max="64" :value="cfg.concurrency" @change="set('concurrency', num($event))"></md-slider>
      </div>
    </div>

    <!-- 微软登录 -->
    <h2 class="section-title md-typescale-title-small">微软登录</h2>
    <div class="card group">
      <div class="item column">
        <md-outlined-text-field
          label="Azure 应用 Client ID"
          :value="cfg.msClientId"
          placeholder="00000000-0000-0000-0000-000000000000"
          @change="set('msClientId', val($event).trim())"
        ></md-outlined-text-field>
        <div class="md-typescale-body-small muted">
          正版登录需要在 Azure 注册一个「个人 Microsoft 账户」类型的公共客户端应用，开启“允许公共客户端流”，
          并向 Mojang 申请 Minecraft API 访问权限。
          <a href="https://learn.microsoft.com/entra/identity-platform/quickstart-register-app" target="_blank">注册指南</a>
        </div>
      </div>
    </div>

    <!-- 兼容 -->
    <h2 class="section-title md-typescale-title-small">兼容</h2>
    <div class="card group">
      <div class="item">
        <md-icon>move_down</md-icon>
        <div class="grow">
          <div class="md-typescale-body-large">从 PCL-CE 导入</div>
          <div class="md-typescale-body-medium muted">
            {{ pcl?.found ? `已找到配置：${pcl.configPath}` : '未在本机找到 PCL-CE 的配置，可手动选择 PCL-CE 所在文件夹' }}
          </div>
        </div>
        <md-outlined-button @click="openImport">导入…</md-outlined-button>
      </div>
    </div>

    <h2 class="section-title md-typescale-title-small">关于</h2>
    <div class="card group">
      <div class="item">
        <md-icon>info</md-icon>
        <div class="grow">
          <div class="md-typescale-body-large">PixelsWorld Launcher</div>
          <div class="md-typescale-body-medium muted">版本 {{ appVersion }} · Apache-2.0 · 不是 Minecraft 官方产品，与 Mojang 或 Microsoft 无关</div>
        </div>
        <md-icon-button title="源代码" @click="api.app.openExternal('https://github.com/zhuzhi-09/PixelsWorldLauncher')">
          <md-icon>code</md-icon>
        </md-icon-button>
      </div>
      <md-divider></md-divider>
      <div class="item">
        <md-icon>favorite</md-icon>
        <div class="grow">
          <div class="md-typescale-body-large">致谢</div>
          <div class="md-typescale-body-medium muted">
            PCL-CE 兼容功能参考了
            <a href="https://github.com/PCL-Community/PCL-CE" target="_blank">PCL-CE</a>
            的配置与加密格式（PCL.Core，Apache-2.0）。本启动器与 PCL / PCL-CE 项目无关。
          </div>
        </div>
      </div>
    </div>

    <!-- 导入对话框 -->
    <md-dialog :open="importOpen" @closed="importOpen = false">
      <md-icon slot="icon">move_down</md-icon>
      <div slot="headline">从 PCL-CE 导入</div>
      <div slot="content" class="import-body">
        <template v-if="!importResult">
          <label class="row check"><md-checkbox :checked="importOpts.settings" @change="importOpts.settings = ($event.target as any).checked"></md-checkbox>启动设置（内存、JVM 参数、版本隔离、窗口等）</label>
          <label class="row check"><md-checkbox :checked="importOpts.folders" @change="importOpts.folders = ($event.target as any).checked"></md-checkbox>游戏文件夹列表</label>
          <label class="row check"><md-checkbox :checked="importOpts.accounts" @change="importOpts.accounts = ($event.target as any).checked"></md-checkbox>账户（离线、微软）</label>
          <div class="pcl-dir">
            <div class="md-typescale-body-medium">PCL-CE 所在文件夹（可选）</div>
            <div class="md-typescale-body-small muted">
              PCL-CE 把部分设置保存在程序旁边的 PCL 文件夹里，选择后可一并导入
            </div>
            <div class="row">
              <span class="grow ellipsis md-typescale-body-medium">{{ importOpts.pclDir || '未选择' }}</span>
              <md-text-button @click="pickPclDir">选择</md-text-button>
            </div>
          </div>
          <div class="md-typescale-body-small muted">
            微软账户的令牌会一并导入，过期后需要在本启动器中重新登录。
          </div>
        </template>
        <template v-else>
          <div class="md-typescale-body-medium">
            导入了 {{ importResult.settings.length }} 项设置、{{ importResult.folders }} 个文件夹、{{ importResult.accounts.imported }} 个账户。
          </div>
          <div v-if="importResult.settings.length" class="md-typescale-body-small muted">
            {{ importResult.settings.join('、') }}
          </div>
          <div v-for="s in importResult.accounts.skipped" :key="s" class="md-typescale-body-small warn">跳过账户：{{ s }}</div>
          <div v-for="w in importResult.warnings" :key="w" class="md-typescale-body-small warn">{{ w }}</div>
        </template>
      </div>
      <div slot="actions">
        <template v-if="!importResult">
          <md-text-button @click="importOpen = false">取消</md-text-button>
          <md-filled-button :disabled="importing" @click="runImport">{{ importing ? '导入中…' : '导入' }}</md-filled-button>
        </template>
        <md-filled-tonal-button v-else @click="importOpen = false">完成</md-filled-tonal-button>
      </div>
    </md-dialog>
  </div>
</template>

<style scoped>
.settings {
  max-width: 920px;
  margin: 0 auto;
}
.section-title:first-of-type {
  margin-top: 0;
}
.group {
  padding: 4px 0;
}
.item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 20px;
  min-height: 64px;
}
.item.column {
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
}
.item > md-icon,
.item .row > md-icon {
  color: var(--md-sys-color-on-surface-variant);
}
label.item {
  cursor: pointer;
}
.value {
  color: var(--md-sys-color-primary);
}
md-slider {
  width: 100%;
}
.small-field {
  width: 96px;
}
.mid-field {
  width: 200px;
}
.inline-switch {
  gap: 8px;
  cursor: pointer;
}
md-outlined-select {
  min-width: 200px;
}
.java-list,
.folder-list {
  padding: 0 8px 8px;
}
.actions-row {
  min-height: 0;
  padding-top: 0;
}
a {
  color: var(--md-sys-color-primary);
}
.pcl-banner {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}
.import-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.check {
  gap: 8px;
  cursor: pointer;
}
.pcl-dir {
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--md-sys-color-surface-container-highest);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.warn {
  color: var(--md-sys-color-error);
}

.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding-left: 40px;
}
.swatch {
  all: unset;
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: var(--c);
  display: grid;
  place-items: center;
  cursor: pointer;
  color: #fff;
  transition:
    border-radius 0.2s,
    transform 0.2s;
}
.swatch md-icon {
  opacity: 0;
  transition: opacity 0.2s;
}
.swatch.on {
  border-radius: 50%;
  box-shadow:
    0 0 0 3px var(--md-sys-color-surface-container-low),
    0 0 0 5px var(--c);
}
.swatch.on md-icon {
  opacity: 1;
}
.swatch:hover {
  transform: scale(1.06);
}
.swatch.custom {
  background: var(--md-sys-color-surface-container-highest);
  color: var(--md-sys-color-on-surface-variant);
}
.swatch.custom md-icon {
  opacity: 1;
}
.swatch input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
</style>
