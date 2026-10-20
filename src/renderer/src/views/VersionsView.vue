<script setup lang="ts">
import { onActivated, onMounted, ref } from 'vue'
import type { GameFolder, InstalledVersion } from '@shared/types'
import InstanceSettingsDialog from '../components/InstanceSettingsDialog.vue'
import { api, errorText, loaderLabel, refreshInstalled, store, switchFolder, toast, updateConfig } from '../store'

const editing = ref<InstalledVersion | null>(null)

// ---------- 游戏文件夹 ----------
const folders = ref<GameFolder[]>([])
const loadFolders = async () => (folders.value = await api.folders.list())
onMounted(loadFolders)
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
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1 class="md-typescale-headline-medium">版本管理</h1>
      <md-filled-tonal-button @click="store.page = 'download'">
        <md-icon slot="icon">add</md-icon>
        安装新版本
      </md-filled-tonal-button>
      <md-icon-button title="刷新" @click="refreshInstalled(), loadFolders()"><md-icon>refresh</md-icon></md-icon-button>
    </div>

    <div class="row folder-row">
      <md-icon class="muted">folder</md-icon>
      <md-outlined-select
        class="folder-select"
        label="游戏文件夹"
        :value="store.config?.gameDir"
        @change="switchFolder(($event.target as any).value)"
      >
        <md-select-option v-for="f in folders" :key="f.path" :value="f.path" :selected="f.path === store.config?.gameDir">
          <div slot="headline">{{ f.name }}</div>
          <div slot="supporting-text">{{ f.path }}</div>
        </md-select-option>
      </md-outlined-select>
      <md-icon-button title="添加文件夹" @click="addFolder"><md-icon>create_new_folder</md-icon></md-icon-button>
    </div>

    <div v-if="!store.installed.length" class="empty">
      <md-icon>deployed_code</md-icon>
      <div class="md-typescale-body-large">这个文件夹里还没有安装任何版本</div>
      <md-filled-tonal-button @click="store.page = 'download'">去下载</md-filled-tonal-button>
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
              <md-icon v-if="v.isolation" class="iso" title="已开启版本隔离：存档、Mod 等保存在版本文件夹中">call_split</md-icon>
            </div>
          </div>
        </div>
        <div class="row actions">
          <md-filled-tonal-button v-if="v.id !== store.config?.selectedVersion" @click="select(v)">设为当前</md-filled-tonal-button>
          <span v-else class="current-label md-typescale-label-large"><md-icon>check_circle</md-icon> 当前版本</span>
          <span class="grow"></span>
          <md-icon-button title="版本设置" @click="editing = v"><md-icon>tune</md-icon></md-icon-button>
          <md-icon-button title="打开文件夹" @click="api.versions.openFolder(v.id)"><md-icon>folder_open</md-icon></md-icon-button>
          <md-icon-button title="删除" @click="removing = v"><md-icon>delete</md-icon></md-icon-button>
        </div>
      </div>
    </div>

    <InstanceSettingsDialog :version="editing" @close="editing = null" />

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
  margin-bottom: 20px;
}
.folder-select {
  flex: 1;
  max-width: 560px;
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
  flex-wrap: wrap;
}
.iso {
  --md-icon-size: 16px;
  color: var(--md-sys-color-primary);
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
.danger {
  --md-filled-button-container-color: var(--md-sys-color-error);
  --md-filled-button-label-text-color: var(--md-sys-color-on-error);
}
</style>
