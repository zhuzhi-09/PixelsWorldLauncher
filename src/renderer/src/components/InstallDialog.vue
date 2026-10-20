<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LoaderKind, LoaderVersion, RemoteVersion } from '@shared/types'
import { api, errorText, refreshInstalled, toast, updateConfig } from '../store'

/** 安装 Minecraft：可选择加载器和版本名称 */
const props = defineProps<{ version: RemoteVersion | null }>()
const emit = defineEmits<{ close: [] }>()

type Choice = 'vanilla' | LoaderKind

const OPTIONS: { kind: Choice; label: string; desc: string; icon: string }[] = [
  { kind: 'vanilla', label: '原版', desc: '纯净的 Minecraft', icon: 'grass' },
  { kind: 'fabric', label: 'Fabric', desc: '轻量、更新快的模组加载器', icon: 'extension' },
  { kind: 'quilt', label: 'Quilt', desc: '兼容大部分 Fabric 模组', icon: 'extension' },
  { kind: 'legacyfabric', label: 'Legacy Fabric', desc: '为 1.13.2 及更早版本移植的 Fabric', icon: 'extension' },
  { kind: 'liteloader', label: 'LiteLoader', desc: '1.12.2 及更早版本的轻量加载器', icon: 'extension' }
]

const choice = ref<Choice>('vanilla')
const lists = ref<Partial<Record<LoaderKind, LoaderVersion[]>>>({})
const loading = ref(false)
const loaderVersion = ref('')
const name = ref('')

watch(
  () => props.version,
  async (v) => {
    choice.value = 'vanilla'
    lists.value = {}
    loaderVersion.value = ''
    name.value = ''
    if (!v) return
    loading.value = true
    const kinds: LoaderKind[] = ['fabric', 'quilt', 'legacyfabric', 'liteloader']
    const results = await Promise.all(kinds.map((k) => api.versions.loaderVersions(k, v.id).catch(() => [])))
    if (props.version?.id !== v.id) return
    kinds.forEach((k, i) => (lists.value[k] = results[i]))
    loading.value = false
  },
  { immediate: true }
)

const available = (k: Choice) => k === 'vanilla' || (lists.value[k]?.length ?? 0) > 0
const currentList = computed(() => (choice.value === 'vanilla' ? [] : (lists.value[choice.value] ?? [])))

function pick(k: Choice): void {
  if (!available(k)) return
  choice.value = k
  const list = k === 'vanilla' ? [] : (lists.value[k] ?? [])
  loaderVersion.value = (list.find((l) => l.stable) ?? list[0])?.version ?? ''
}

const placeholder = computed(() => {
  const v = props.version?.id ?? ''
  if (choice.value === 'vanilla') return v
  if (choice.value === 'liteloader') return `${v}-LiteLoader`
  const prefix = choice.value === 'quilt' ? 'quilt-loader' : 'fabric-loader'
  return `${prefix}-${loaderVersion.value}-${v}`
})

async function install(): Promise<void> {
  const v = props.version
  if (!v) return
  const kind = choice.value
  const lv = loaderVersion.value
  const custom = name.value.trim() || undefined
  emit('close')
  try {
    const id =
      kind === 'vanilla'
        ? await api.versions.install(v.id, custom)
        : await api.versions.installLoader(kind, v.id, lv, custom)
    await updateConfig({ selectedVersion: id })
    await refreshInstalled()
    toast(`${id} 安装完成`)
  } catch (e) {
    toast(`安装失败：${errorText(e)}`)
  }
}
</script>

<template>
  <md-dialog :open="!!version" class="install-dialog" @closed="emit('close')">
    <div slot="headline">安装 Minecraft {{ version?.id }}</div>
    <div slot="content" class="body">
      <div class="options">
        <button
          v-for="o in OPTIONS"
          :key="o.kind"
          class="opt"
          :class="{ on: choice === o.kind, off: !loading && !available(o.kind) }"
          :disabled="!loading && !available(o.kind)"
          @click="pick(o.kind)"
        >
          <md-ripple></md-ripple>
          <md-icon>{{ o.icon }}</md-icon>
          <div class="grow">
            <div class="md-typescale-title-small">{{ o.label }}</div>
            <div class="md-typescale-body-small muted">
              {{ o.kind !== 'vanilla' && !loading && !available(o.kind) ? '该版本不可用' : o.desc }}
            </div>
          </div>
          <md-circular-progress v-if="loading && o.kind !== 'vanilla'" indeterminate class="tiny"></md-circular-progress>
          <md-icon v-else-if="choice === o.kind" class="check">check_circle</md-icon>
        </button>
      </div>

      <md-outlined-select
        v-if="choice !== 'vanilla' && currentList.length"
        label="加载器版本"
        :value="loaderVersion"
        @change="loaderVersion = ($event.target as any).value"
      >
        <md-select-option
          v-for="l in currentList.slice(0, 40)"
          :key="l.version"
          :value="l.version"
          :selected="l.version === loaderVersion"
        >
          <div slot="headline">{{ l.version }}{{ l.stable ? '' : '（测试版）' }}</div>
        </md-select-option>
      </md-outlined-select>

      <md-outlined-text-field
        label="版本名称（可选）"
        :placeholder="placeholder"
        :value="name"
        supporting-text="留空则使用默认名称"
        @input="name = ($event.target as any).value"
      ></md-outlined-text-field>
    </div>
    <div slot="actions">
      <md-text-button @click="emit('close')">取消</md-text-button>
      <md-filled-button :disabled="choice !== 'vanilla' && !loaderVersion" @click="install">安装</md-filled-button>
    </div>
  </md-dialog>
</template>

<style scoped>
.install-dialog {
  width: 560px;
}
.body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.opt {
  all: unset;
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 16px;
  border-radius: 14px;
  cursor: pointer;
  transition: background-color 0.2s;
}
.opt:hover {
  background: var(--md-sys-color-surface-container-highest);
}
.opt.on {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}
.opt.off {
  opacity: 0.45;
  cursor: default;
}
.check {
  color: var(--md-sys-color-primary);
}
.tiny {
  --md-circular-progress-size: 20px;
}
md-outlined-select,
md-outlined-text-field {
  width: 100%;
}
</style>
