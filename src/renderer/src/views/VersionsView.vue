<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import type { FabricLoaderVersion, GameFolder, InstalledVersion, RemoteVersion } from '@shared/types'
import InstanceSettingsDialog from '../components/InstanceSettingsDialog.vue'
import { api, errorText, loaderLabel, refreshInstalled, store, switchFolder, toast, updateConfig } from '../store'

const tab = ref(0)
const editing = ref<InstalledVersion | null>(null)

// ---------- 游戏文件夹 ----------
const folders = ref<GameFolder[]>([])
const loadFolders = async () => (folders.value = await api.folders.list())
onActivated(loadFolders)

async function addFolder(): Promise<void> {
  const dir = await api.config.pickDirectory()
  if (!dir) return
  folders.value = await api.folders.add(dir)
  await switchFolder(dir)
  toast('已添加并切换到该文件夹')
}

// ---------- 已安装 ----------
const removing = ref<InstalledVersion | null>(null)

async function confirmRemove(): Promise<void> {
  const v = removing.value
  removing.value = null
  if (!v) return
  try {
    await api.versions.remove(v.id)
    await refreshInstalled()
    toast(`已删除 ${v.id}`)
  } catch (e) {
    toast(errorText(e))
  }
}

async function select(v: InstalledVersion): Promise<void> {
  await updateConfig({ selectedVersion: v.id })
  toast(`已选择 ${v.id}`)
}

// ---------- 远程版本 ----------
const remote = ref<RemoteVersion[]>([])
const loading = ref(false)
const loadError = ref('')
const query = ref('')
const filters = ref({ release: true, snapshot: false, old: false })
const limit = ref(60)

async function loadRemote(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    remote.value = await api.versions.remote()
  } catch (e) {
    loadError.value = errorText(e)
  } finally {
    loading.value = false
  }
}

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return remote.value.filter((v) => {
    const okType =
      (filters.value.release && v.type === 'release') ||
      (filters.value.snapshot && v.type === 'snapshot') ||
      (filters.value.old && v.type.startsWith('old_'))
    return okType && (!q || v.id.toLowerCase().includes(q))
  })
})

const typeLabel = (t: string) =>
  ({ release: '正式版', snapshot: '快照', old_beta: 'Beta', old_alpha: 'Alpha' })[t] ?? t
const date = (s?: string) => (s ? new Date(s).toLocaleDateString() : '')
const isInstalled = (id: string) => store.installed.some((v) => v.id === id)

// ---------- 安装对话框 ----------
const target = ref<RemoteVersion | null>(null)
const loaderType = ref<'vanilla' | 'fabric'>('vanilla')
const fabricList = ref<FabricLoaderVersion[]>([])
const fabricVersion = ref('')
const fabricLoading = ref(false)

function openInstall(v: RemoteVersion): void {
  target.value = v
  loaderType.value = 'vanilla'
  fabricList.value = []
  fabricVersion.value = ''
}

async function chooseFabric(): Promise<void> {
  loaderType.value = 'fabric'
  if (fabricList.value.length || !target.value) return
  fabricLoading.value = true
  try {
    fabricList.value = await api.versions.fabricLoaders(target.value.id)
    fabricVersion.value = (fabricList.value.find((l) => l.stable) ?? fabricList.value[0])?.version ?? ''
  } catch (e) {
    toast(errorText(e))
  } finally {
    fabricLoading.value = false
  }
}

async function install(): Promise<void> {
  const v = target.value
  if (!v) return
  const type = loaderType.value
  const loader = fabricVersion.value
  target.value = null
  try {
    if (type === 'fabric') {
      const id = await api.versions.installFabric(v.id, loader)
      await updateConfig({ selectedVersion: id })
    } else {
      await api.versions.install(v.id)
      await updateConfig({ selectedVersion: v.id })
    }
    await refreshInstalled()
    toast('安装完成')
  } catch (e) {
    toast(`安装失败：${errorText(e)}`)
  }
}

// 在首次渲染前决定默认标签页，避免 md-tabs 初始化时覆盖
if (!store.installed.length) tab.value = 1
onMounted(() => {
  loadFolders()
  loadRemote()
})
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1 class="md-typescale-headline-medium">版本管理</h1>
      <md-icon-button title="刷新" @click="refreshInstalled(), loadRemote()"><md-icon>refresh</md-icon></md-icon-button>
    </div>

    <div class="row folder-row">
      <md-icon class="muted">folder</md-icon>
      <md-outlined-select class="folder-select" label="游戏文件夹" :value="store.config?.gameDir" @change="switchFolder(($event.target as any).value)">
        <md-select-option
          v-for="f in folders"
          :key="f.path"
          :value="f.path"
          :selected="f.path === store.config?.gameDir"
        >
          <div slot="headline">{{ f.name }}</div>
          <div slot="supporting-text">{{ f.path }}</div>
        </md-select-option>
      </md-outlined-select>
      <md-icon-button title="添加文件夹" @click="addFolder"><md-icon>create_new_folder</md-icon></md-icon-button>
    </div>

    <md-tabs @change="tab = ($event.target as any).activeTabIndex">
      <md-primary-tab :active="tab === 0">
        <md-icon slot="icon">inventory_2</md-icon>
        已安装 ({{ store.installed.length }})
      </md-primary-tab>
      <md-primary-tab :active="tab === 1">
        <md-icon slot="icon">download</md-icon>
        安装新版本
      </md-primary-tab>
    </md-tabs>

    <!-- 已安装 -->
    <div v-if="tab === 0" class="tab-body">
      <div v-if="!store.installed.length" class="empty">
        <md-icon>deployed_code</md-icon>
        <div class="md-typescale-body-large">还没有安装任何版本</div>
        <md-filled-tonal-button @click="tab = 1">去安装</md-filled-tonal-button>
      </div>
      <div class="grid">
        <div
          v-for="v in store.installed"
          :key="v.id"
          class="card version"
          :class="{ current: v.id === store.config?.selectedVersion }"
        >
          <div class="row">
            <div class="icon-box" :class="v.loader">
              <md-icon>{{ v.loader === 'vanilla' ? 'grass' : 'extension' }}</md-icon>
            </div>
            <div class="grow">
              <div class="md-typescale-title-medium ellipsis" :title="v.id">{{ v.id }}</div>
              <div class="row tags">
                <span class="tag" :class="{ tertiary: v.loader !== 'vanilla' }">{{ loaderLabel[v.loader] }}</span>
                <span v-for="a in v.addons.filter((x) => x !== v.loader)" :key="a" class="tag tertiary">
                  {{ loaderLabel[a] }}
                </span>
                <span class="md-typescale-body-small muted">{{ v.gameVersion }}</span>
                <md-icon
                  v-if="v.isolation"
                  class="iso"
                  title="已开启版本隔离：存档、Mod 等保存在版本文件夹中"
                >call_split</md-icon>
              </div>
            </div>
          </div>
          <div class="row actions">
            <md-filled-tonal-button
              v-if="v.id !== store.config?.selectedVersion"
              @click="select(v)"
            >
              设为当前
            </md-filled-tonal-button>
            <span v-else class="current-label md-typescale-label-large">
              <md-icon>check_circle</md-icon> 当前版本
            </span>
            <span class="grow"></span>
            <md-icon-button title="版本设置" @click="editing = v"><md-icon>tune</md-icon></md-icon-button>
            <md-icon-button title="打开文件夹" @click="api.versions.openFolder(v.id)">
              <md-icon>folder_open</md-icon>
            </md-icon-button>
            <md-icon-button title="删除" @click="removing = v"><md-icon>delete</md-icon></md-icon-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 远程版本 -->
    <div v-else class="tab-body">
      <div class="row filters">
        <md-outlined-text-field
          class="search"
          placeholder="搜索版本号"
          :value="query"
          @input="(query = ($event.target as any).value), (limit = 60)"
        >
          <md-icon slot="leading-icon">search</md-icon>
        </md-outlined-text-field>
        <md-chip-set>
          <md-filter-chip label="正式版" :selected="filters.release" @click="filters.release = !filters.release"></md-filter-chip>
          <md-filter-chip label="快照" :selected="filters.snapshot" @click="filters.snapshot = !filters.snapshot"></md-filter-chip>
          <md-filter-chip label="远古版" :selected="filters.old" @click="filters.old = !filters.old"></md-filter-chip>
        </md-chip-set>
      </div>

      <div v-if="loading" class="empty"><md-circular-progress indeterminate></md-circular-progress></div>
      <div v-else-if="loadError" class="empty">
        <md-icon>cloud_off</md-icon>
        <div>获取版本列表失败：{{ loadError }}</div>
        <md-filled-tonal-button @click="loadRemote">重试</md-filled-tonal-button>
      </div>
      <div v-else class="card list-card">
        <md-list>
          <template v-for="(v, i) in filtered.slice(0, limit)" :key="v.id">
            <md-divider v-if="i > 0"></md-divider>
            <md-list-item type="button" @click="openInstall(v)">
              <md-icon slot="start">{{ v.type === 'release' ? 'grass' : v.type === 'snapshot' ? 'science' : 'history' }}</md-icon>
              <div slot="headline">{{ v.id }}</div>
              <div slot="supporting-text">{{ typeLabel(v.type) }} · {{ date(v.releaseTime) }}</div>
              <span v-if="isInstalled(v.id)" slot="end" class="tag">已安装</span>
              <md-icon v-else slot="end">download</md-icon>
            </md-list-item>
          </template>
        </md-list>
        <div v-if="filtered.length > limit" class="more">
          <md-text-button @click="limit += 100">显示更多（剩余 {{ filtered.length - limit }}）</md-text-button>
        </div>
        <div v-if="!filtered.length" class="empty">没有匹配的版本</div>
      </div>
    </div>

    <!-- 安装对话框 -->
    <md-dialog :open="!!target" @closed="target = null">
      <div slot="headline">安装 {{ target?.id }}</div>
      <div slot="content" class="install-body">
        <div class="loader-options">
          <button class="loader-opt" :class="{ on: loaderType === 'vanilla' }" @click="loaderType = 'vanilla'">
            <md-ripple></md-ripple>
            <md-icon>grass</md-icon>
            <div>
              <div class="md-typescale-title-small">原版</div>
              <div class="md-typescale-body-small muted">纯净的 Minecraft</div>
            </div>
          </button>
          <button class="loader-opt" :class="{ on: loaderType === 'fabric' }" @click="chooseFabric">
            <md-ripple></md-ripple>
            <md-icon>extension</md-icon>
            <div>
              <div class="md-typescale-title-small">Fabric</div>
              <div class="md-typescale-body-small muted">轻量模组加载器</div>
            </div>
          </button>
        </div>
        <template v-if="loaderType === 'fabric'">
          <md-linear-progress v-if="fabricLoading" indeterminate></md-linear-progress>
          <div v-else-if="!fabricList.length" class="muted md-typescale-body-medium">该版本暂不支持 Fabric</div>
          <md-outlined-select
            v-else
            label="Fabric Loader 版本"
            :value="fabricVersion"
            @change="fabricVersion = ($event.target as any).value"
          >
            <md-select-option
              v-for="l in fabricList.slice(0, 30)"
              :key="l.version"
              :value="l.version"
              :selected="l.version === fabricVersion"
            >
              <div slot="headline">{{ l.version }}{{ l.stable ? '' : '（测试版）' }}</div>
            </md-select-option>
          </md-outlined-select>
        </template>
      </div>
      <div slot="actions">
        <md-text-button @click="target = null">取消</md-text-button>
        <md-filled-button :disabled="loaderType === 'fabric' && !fabricVersion" @click="install">
          安装
        </md-filled-button>
      </div>
    </md-dialog>

    <InstanceSettingsDialog :version="editing" @close="editing = null" />

    <!-- 删除确认 -->
    <md-dialog :open="!!removing" @closed="removing = null">
      <md-icon slot="icon">delete</md-icon>
      <div slot="headline">删除 {{ removing?.id }}？</div>
      <div slot="content">版本目录将被删除，开启版本隔离时其中的存档和模组也会一并删除。此操作无法撤销。</div>
      <div slot="actions">
        <md-text-button @click="removing = null">取消</md-text-button>
        <md-filled-button class="danger" @click="confirmRemove">删除</md-filled-button>
      </div>
    </md-dialog>
  </div>
</template>

<style scoped>
.folder-row {
  margin-bottom: 12px;
}
.folder-select {
  flex: 1;
  max-width: 560px;
}
.iso {
  --md-icon-size: 16px;
  color: var(--md-sys-color-primary);
}
md-tabs {
  --md-primary-tab-container-color: transparent;
  margin-bottom: 20px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}
.version {
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: background-color 0.2s;
}
.version.current {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}
.icon-box {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}
.icon-box:not(.vanilla) {
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}
.tags {
  gap: 8px;
  margin-top: 4px;
}
.actions {
  gap: 4px;
}
.current-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--md-sys-color-primary);
  padding-left: 8px;
}
.current-label md-icon {
  --md-icon-size: 20px;
}
.filters {
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.search {
  width: 260px;
  --md-outlined-text-field-container-shape: 28px;
}
.list-card {
  padding: 8px 0;
}
.more {
  display: flex;
  justify-content: center;
  padding: 8px;
}
.install-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.loader-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.loader-opt {
  all: unset;
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid var(--md-sys-color-outline-variant);
  cursor: pointer;
  transition: all 0.2s;
}
.loader-opt.on {
  border-color: transparent;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}
md-outlined-select {
  width: 100%;
}
.danger {
  --md-filled-button-container-color: var(--md-sys-color-error);
  --md-filled-button-label-text-color: var(--md-sys-color-on-error);
}
</style>
