<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { InstalledVersion, InstanceSettings, JavaInfo } from '@shared/types'
import MemorySlider from './MemorySlider.vue'
import { api, errorText, ISOLATION_OPTIONS, refreshInstalled, store, toast } from '../store'

/** 版本独立设置，直接读写 versions/<id>/PCL/config.v1.yml，与 PCL-CE 共用 */
const props = defineProps<{ version: InstalledVersion | null }>()
const emit = defineEmits<{ close: [] }>()

const s = ref<InstanceSettings | null>(null)
const javas = ref<JavaInfo[]>([])
const mem = ref({ allocated: 0, free: 0, total: 8 })

const val = (e: Event) => (e.target as HTMLInputElement).value

async function refreshMemory(): Promise<void> {
  if (props.version) mem.value = await api.versions.memoryPreview(props.version.id)
}

watch(
  () => props.version,
  async (v) => {
    s.value = null
    if (!v) return
    s.value = await api.versions.settings(v.id)
    refreshMemory()
    if (!javas.value.length) javas.value = await api.java.list()
  },
  { immediate: true }
)

async function save(patch: Partial<InstanceSettings>): Promise<void> {
  if (!props.version) return
  try {
    s.value = await api.versions.setSettings(props.version.id, patch)
    if ('memoryMode' in patch || 'memoryTick' in patch) refreshMemory()
    if ('isolation' in patch) refreshInstalled()
  } catch (e) {
    toast(errorText(e))
  }
}

const globalIsolation = computed(
  () => ISOLATION_OPTIONS.find((o) => o.value === store.config?.isolationMode)?.label ?? ''
)

const javaKey = computed(() => {
  const j = s.value?.java
  if (!j) return 'global'
  return j.kind === 'exist' || j.kind === 'relative' ? `path:${j.path}` : j.kind
})

function chooseJava(key: string): void {
  if (key === 'global' || key === 'auto') save({ java: { kind: key } })
  else if (key.startsWith('path:')) save({ java: { kind: 'exist', path: key.slice(5) } })
}

async function browseJava(): Promise<void> {
  const f = await api.config.pickFile()
  if (f) save({ java: { kind: 'exist', path: f } })
}
</script>

<template>
  <md-dialog :open="!!version" class="inst-dialog" @closed="emit('close')">
    <div slot="headline">{{ version?.id }} 的设置</div>
    <div v-if="s" slot="content" class="body">
      <div class="hint md-typescale-body-small muted">
        <md-icon>sync_alt</md-icon>
        这些设置保存在版本文件夹的 PCL/config.v1.yml 中，与 PCL-CE 互通
      </div>

      <section>
        <div class="md-typescale-title-small title">版本隔离</div>
        <div class="segmented">
          <button :class="{ on: s.isolation === true }" @click="save({ isolation: true })">
            <md-ripple></md-ripple>开启
          </button>
          <button :class="{ on: s.isolation === false }" @click="save({ isolation: false })">
            <md-ripple></md-ripple>关闭
          </button>
        </div>
        <div v-if="s.isolation === null" class="md-typescale-body-small muted">
          尚未决定：首次启动时按全局策略「{{ globalIsolation }}」决定，之后固定
        </div>
      </section>

      <section>
        <div class="md-typescale-title-small title">游戏内存</div>
        <div class="segmented">
          <button
            v-for="m in [
              { v: 'global', l: '跟随全局' },
              { v: 'auto', l: '自动' },
              { v: 'custom', l: '自定义' }
            ] as const"
            :key="m.v"
            :class="{ on: s.memoryMode === m.v }"
            @click="save({ memoryMode: m.v })"
          >
            <md-ripple></md-ripple>{{ m.l }}
          </button>
        </div>
        <MemorySlider
          v-if="s.memoryMode === 'custom'"
          label="最大内存"
          :tick="s.memoryTick"
          :total-gb="mem.total"
          @change="(t) => save({ memoryTick: t })"
        />
        <MemorySlider
          v-if="s.memoryMode === 'custom'"
          label="初始内存"
          :min="0"
          :tick="s.memoryInitialTick"
          :total-gb="mem.total"
          @change="(t) => save({ memoryInitialTick: t })"
        />
        <div class="md-typescale-body-small muted">
          将分配 {{ mem.allocated.toFixed(1) }} GB · 当前可用 {{ mem.free.toFixed(1) }} / {{ mem.total.toFixed(1) }} GB
        </div>
      </section>

      <section>
        <div class="md-typescale-title-small title">Java</div>
        <div class="row">
          <md-outlined-select class="grow" :value="javaKey" @change="chooseJava(val($event))">
            <md-select-option value="global" :selected="javaKey === 'global'">
              <div slot="headline">跟随全局设置</div>
            </md-select-option>
            <md-select-option value="auto" :selected="javaKey === 'auto'">
              <div slot="headline">自动选择</div>
            </md-select-option>
            <md-select-option
              v-for="j in javas"
              :key="j.path"
              :value="`path:${j.path}`"
              :selected="javaKey === `path:${j.path}`"
            >
              <div slot="headline">Java {{ j.major }}</div>
              <div slot="supporting-text">{{ j.path }}</div>
            </md-select-option>
            <md-select-option
              v-if="javaKey.startsWith('path:') && !javas.some((j) => `path:${j.path}` === javaKey)"
              :value="javaKey"
              selected
            >
              <div slot="headline">{{ javaKey.slice(5) }}</div>
            </md-select-option>
          </md-outlined-select>
          <md-outlined-button @click="browseJava">浏览</md-outlined-button>
        </div>
      </section>

      <section class="fields">
        <div class="md-typescale-title-small title">高级</div>
        <md-outlined-text-field
          label="自动进入服务器"
          placeholder="mc.example.com:25565"
          :value="s.server"
          @change="save({ server: val($event).trim() })"
        ></md-outlined-text-field>
        <md-outlined-text-field
          label="JVM 参数（留空跟随全局）"
          :value="s.jvmArgs"
          @change="save({ jvmArgs: val($event) })"
        ></md-outlined-text-field>
        <md-outlined-text-field
          label="游戏参数（留空跟随全局）"
          :value="s.gameArgs"
          @change="save({ gameArgs: val($event) })"
        ></md-outlined-text-field>
        <md-outlined-text-field
          label="版本类型显示（留空跟随全局）"
          :value="s.versionType"
          @change="save({ versionType: val($event) })"
        ></md-outlined-text-field>
        <md-outlined-text-field
          label="启动前执行的命令"
          :value="s.preLaunchCommand"
          @change="save({ preLaunchCommand: val($event) })"
        ></md-outlined-text-field>
        <label class="row switch-row md-typescale-body-medium">
          <span class="grow">等待命令执行完成再启动游戏</span>
          <md-switch
            :selected="s.preLaunchWait"
            @change="save({ preLaunchWait: ($event.target as any).selected })"
          ></md-switch>
        </label>
      </section>
    </div>
    <div slot="content" v-else class="row"><md-circular-progress indeterminate></md-circular-progress></div>
    <div slot="actions">
      <md-text-button @click="version && api.versions.openFolder(version.id)">打开文件夹</md-text-button>
      <md-filled-tonal-button @click="emit('close')">完成</md-filled-tonal-button>
    </div>
  </md-dialog>
</template>

<style scoped>
.inst-dialog {
  max-width: min(640px, calc(100vw - 48px));
  width: 640px;
}
.body {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.title {
  color: var(--md-sys-color-primary);
}
.hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 12px;
  background: var(--md-sys-color-surface-container-highest);
}
.hint md-icon {
  --md-icon-size: 18px;
}
.fields md-outlined-text-field {
  width: 100%;
}
.switch-row {
  cursor: pointer;
}
</style>
