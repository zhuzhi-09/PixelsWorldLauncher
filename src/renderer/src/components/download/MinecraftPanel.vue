<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { RemoteManifest, RemoteVersion } from '@shared/types'
import InstallDialog from '../InstallDialog.vue'
import { api, errorText, store } from '../../store'
import { formatDate } from '../../format'

const manifest = ref<RemoteManifest | null>(null)
const loading = ref(false)
const error = ref('')
const query = ref('')
const target = ref<RemoteVersion | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    manifest.value = await api.versions.manifest()
  } catch (e) {
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

type GroupKey = 'release' | 'snapshot' | 'old' | 'fool'
const GROUPS: { key: GroupKey; label: string; icon: string }[] = [
  { key: 'release', label: '正式版', icon: 'grass' },
  { key: 'snapshot', label: '预览版', icon: 'science' },
  { key: 'old', label: '远古版', icon: 'history' },
  { key: 'fool', label: '愚人节版', icon: 'celebration' }
]

const groupOf = (v: RemoteVersion): GroupKey =>
  v.fool ? 'fool' : v.type === 'release' ? 'release' : v.type.startsWith('old_') ? 'old' : 'snapshot'

const groups = computed(() => {
  const out: Record<GroupKey, RemoteVersion[]> = { release: [], snapshot: [], old: [], fool: [] }
  const q = query.value.trim().toLowerCase()
  for (const v of manifest.value?.versions ?? []) {
    if (q && !v.id.toLowerCase().includes(q)) continue
    out[groupOf(v)].push(v)
  }
  return out
})

const latest = computed(() => {
  const m = manifest.value
  if (!m) return []
  const find = (id: string) => m.versions.find((v) => v.id === id)
  const release = find(m.latest.release)
  const snapshot = find(m.latest.snapshot)
  const list: { v: RemoteVersion; label: string; icon: string }[] = []
  if (release) list.push({ v: release, label: '最新正式版', icon: 'grass' })
  // 正式版刚发布时快照与正式版相同
  if (snapshot && snapshot.id !== release?.id) list.push({ v: snapshot, label: '最新预览版', icon: 'science' })
  return list
})

const expanded = ref<Record<GroupKey, boolean>>({ release: false, snapshot: false, old: false, fool: false })
const limits = ref<Record<GroupKey, number>>({ release: 60, snapshot: 60, old: 60, fool: 60 })
const isInstalled = (id: string) => store.installed.some((v) => v.gameVersion === id)
</script>

<template>
  <div class="panel">
    <div class="row head">
      <h2 class="md-typescale-headline-small grow">Minecraft</h2>
      <md-outlined-text-field class="search" placeholder="搜索版本号" :value="query" @input="query = ($event.target as any).value">
        <md-icon slot="leading-icon">search</md-icon>
      </md-outlined-text-field>
      <md-icon-button title="刷新" @click="load"><md-icon>refresh</md-icon></md-icon-button>
    </div>

    <div v-if="loading" class="empty"><md-circular-progress indeterminate></md-circular-progress></div>
    <div v-else-if="error" class="empty">
      <md-icon>cloud_off</md-icon>
      <div>获取版本列表失败：{{ error }}</div>
      <md-filled-tonal-button @click="load">重试</md-filled-tonal-button>
    </div>

    <template v-else-if="manifest">
      <section v-if="!query" class="card latest">
        <div class="md-typescale-title-small section-label">最新版本</div>
        <button v-for="l in latest" :key="l.v.id" class="version-row" @click="target = l.v">
          <md-ripple></md-ripple>
          <span class="vicon"><md-icon>{{ l.icon }}</md-icon></span>
          <span class="grow">
            <span class="md-typescale-body-large">{{ l.v.id }}</span>
            <span class="md-typescale-body-small muted block">{{ l.label }} · 发布于 {{ formatDate(l.v.releaseTime) }}</span>
          </span>
          <span v-if="isInstalled(l.v.id)" class="tag">已安装</span>
          <md-icon class="muted">download</md-icon>
        </button>
      </section>

      <section v-for="g in GROUPS" :key="g.key" class="card group" :class="{ open: expanded[g.key] || !!query }">
        <button class="group-head" @click="expanded[g.key] = !expanded[g.key]">
          <md-ripple></md-ripple>
          <md-icon class="gicon">{{ g.icon }}</md-icon>
          <span class="md-typescale-title-small grow">{{ g.label }}（{{ groups[g.key].length }}）</span>
          <md-icon class="chev">expand_more</md-icon>
        </button>
        <div v-if="expanded[g.key] || !!query" class="group-body">
          <button v-for="v in groups[g.key].slice(0, limits[g.key])" :key="v.id" class="version-row" @click="target = v">
            <md-ripple></md-ripple>
            <span class="grow">
              <span class="md-typescale-body-large">{{ v.id }}</span>
              <span class="md-typescale-body-small muted block">发布于 {{ formatDate(v.releaseTime) }}</span>
            </span>
            <span v-if="isInstalled(v.id)" class="tag">已安装</span>
            <md-icon class="muted">download</md-icon>
          </button>
          <div v-if="groups[g.key].length > limits[g.key]" class="more">
            <md-text-button @click="limits[g.key] += 200">显示更多（剩余 {{ groups[g.key].length - limits[g.key] }}）</md-text-button>
          </div>
          <div v-if="!groups[g.key].length" class="muted md-typescale-body-medium pad">没有匹配的版本</div>
        </div>
      </section>
    </template>

    <InstallDialog :version="target" @close="target = null" />
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head {
  margin-bottom: 4px;
}
.head h2 {
  margin: 0;
}
.search {
  width: 240px;
  --md-outlined-text-field-container-shape: 28px;
}
.card {
  padding: 8px;
}
.section-label {
  padding: 8px 12px 4px;
  color: var(--md-sys-color-primary);
}
.version-row,
.group-head {
  all: unset;
  position: relative;
  box-sizing: border-box;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 12px;
  border-radius: 12px;
  cursor: pointer;
}
.version-row:focus-visible,
.group-head:focus-visible {
  outline: 2px solid var(--md-sys-color-secondary);
}
.block {
  display: block;
}
.vicon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}
.gicon {
  color: var(--md-sys-color-on-surface-variant);
}
.chev {
  transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1);
}
.group.open .chev {
  transform: rotate(180deg);
}
.group-body {
  border-top: 1px solid var(--md-sys-color-outline-variant);
  margin-top: 4px;
  padding-top: 4px;
}
.more {
  display: flex;
  justify-content: center;
  padding: 4px;
}
.pad {
  padding: 12px;
}
</style>
