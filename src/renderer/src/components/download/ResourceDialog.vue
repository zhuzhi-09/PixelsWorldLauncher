<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { InstalledVersion, ResourceProject, ResourceType, ResourceVersion } from '@shared/types'
import { api, errorText, favorites, store, toast, toggleFavorite } from '../../store'
import { compactVersions, formatCount, formatSize, RESOURCE_ICON, RESOURCE_LABEL, timeAgo } from '../../format'

/** 资源详情：介绍 + 选择要安装到的游戏版本 + 文件列表 */
const props = defineProps<{ id: string | null; type: ResourceType }>()
const emit = defineEmits<{ close: [] }>()

const project = ref<ResourceProject | null>(null)
const versions = ref<ResourceVersion[]>([])
const loading = ref(false)
const error = ref('')
const showAll = ref(false)
const instanceId = ref('')
const worlds = ref<string[]>([])
const world = ref('')
const installing = ref('')

/** 加载器 -> Modrinth 标签 */
const LOADER_TAGS: Record<string, string[]> = {
  fabric: ['fabric'],
  quilt: ['quilt', 'fabric'],
  legacyfabric: ['legacy-fabric'],
  forge: ['forge'],
  neoforge: ['neoforge'],
  cleanroom: ['forge'],
  liteloader: ['liteloader']
}

const instance = computed<InstalledVersion | undefined>(() => store.installed.find((v) => v.id === instanceId.value))
const needsLoader = computed(() => props.type === 'mod')

/** 默认安装目标：当前版本；模组则优先选择装了加载器的版本 */
function defaultInstance(): string {
  const selected = store.installed.find((v) => v.id === store.config?.selectedVersion)
  if (props.type !== 'mod' || (selected && LOADER_TAGS[selected.loader])) return selected?.id ?? store.installed[0]?.id ?? ''
  return (store.installed.find((v) => LOADER_TAGS[v.loader]) ?? selected ?? store.installed[0])?.id ?? ''
}

/** 与所选游戏版本兼容的文件 */
const compatible = computed(() => {
  const inst = instance.value
  if (!inst) return versions.value
  const tags = LOADER_TAGS[inst.loader] ?? []
  return versions.value.filter(
    (v) =>
      v.gameVersions.includes(inst.gameVersion) &&
      (!needsLoader.value || v.loaders.some((l) => tags.includes(l)))
  )
})
const shown = computed(() => (showAll.value ? versions.value : compatible.value))

watch(
  () => props.id,
  async (id) => {
    project.value = null
    versions.value = []
    error.value = ''
    showAll.value = false
    if (!id) return
    instanceId.value = defaultInstance()
    loading.value = true
    try {
      const [p, vs] = await Promise.all([api.resources.project(id), api.resources.versions(id, {})])
      if (props.id !== id) return
      project.value = p
      versions.value = vs
    } catch (e) {
      error.value = errorText(e)
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)

watch([instanceId, () => props.type], async () => {
  worlds.value = []
  world.value = ''
  if (props.type !== 'datapack' || !instanceId.value) return
  worlds.value = await api.versions.worlds(instanceId.value).catch(() => [])
  world.value = worlds.value[0] ?? ''
})

const isFav = computed(() => !!project.value && favorites.value.some((f) => f.id === project.value!.id))

const warning = computed(() => {
  const inst = instance.value
  if (!inst) return '还没有安装任何游戏版本'
  if (props.type === 'modpack') return '整合包安装将在后续版本提供'
  if (props.type === 'mod' && !LOADER_TAGS[inst.loader]) return `${inst.id} 没有安装模组加载器，模组不会生效`
  if (props.type === 'datapack' && !worlds.value.length) return `${inst.id} 还没有存档，请先进入游戏创建一个世界`
  return ''
})

async function install(v: ResourceVersion): Promise<void> {
  if (!instance.value) return
  installing.value = v.id
  try {
    const r = await api.resources.install({
      versionId: v.id,
      instanceId: instance.value.id,
      type: props.type,
      world: props.type === 'datapack' ? world.value : undefined
    })
    const parts = [`已安装 ${r.installed.length} 个文件`]
    if (r.skipped.length) parts.push(`${r.skipped.length} 个已存在`)
    if (r.missing.length) parts.push(`找不到兼容的前置：${r.missing.join('、')}`)
    toast(parts.join('，'))
  } catch (e) {
    toast(`安装失败：${errorText(e)}`)
  } finally {
    installing.value = ''
  }
}

const TYPE_LABEL = { release: '正式', beta: 'Beta', alpha: 'Alpha' }
</script>

<template>
  <md-dialog :open="!!id" class="res-dialog" @closed="emit('close')">
    <div slot="headline" class="headline">
      <img v-if="project?.icon" :src="project.icon" class="icon" alt="" />
      <span v-else class="icon placeholder"><md-icon>{{ RESOURCE_ICON[type] }}</md-icon></span>
      <div class="grow">
        <div class="md-typescale-title-large">{{ project?.title ?? '加载中…' }}</div>
        <div v-if="project" class="md-typescale-body-medium muted">
          {{ project.author }} · {{ RESOURCE_LABEL[type] }} · {{ formatCount(project.downloads) }} 次下载 · 更新于 {{ timeAgo(project.updated) }}
        </div>
      </div>
      <md-icon-button v-if="project" :title="isFav ? '取消收藏' : '收藏'" @click="toggleFavorite(project)">
        <md-icon :class="{ fav: isFav }">{{ isFav ? 'favorite' : 'favorite_border' }}</md-icon>
      </md-icon-button>
    </div>

    <div slot="content" class="body">
      <div v-if="loading" class="empty"><md-circular-progress indeterminate></md-circular-progress></div>
      <div v-else-if="error" class="empty"><md-icon>error</md-icon>{{ error }}</div>
      <template v-else-if="project">
        <p class="md-typescale-body-large desc">{{ project.description }}</p>
        <div class="row tags">
          <span v-for="c in project.categories.slice(0, 8)" :key="c" class="tag">{{ c }}</span>
          <span class="grow"></span>
          <md-text-button @click="api.app.openExternal(project.links.page)">
            在 Modrinth 查看<md-icon slot="icon">open_in_new</md-icon>
          </md-text-button>
        </div>
        <div v-if="project.gallery.length" class="gallery">
          <img v-for="g in project.gallery.slice(0, 4)" :key="g" :src="g" alt="" loading="lazy" />
        </div>

        <div class="card target">
          <div class="row">
            <!-- 按资源重建下拉框，避免对话框复用时选中项显示为空 -->
            <md-outlined-select
              :key="`${id}-${store.installed.length}`"
              class="grow"
              label="安装到"
              :value="instanceId"
              @change="instanceId = ($event.target as any).value"
            >
              <md-select-option v-for="v in store.installed" :key="v.id" :value="v.id" :selected="v.id === instanceId">
                <div slot="headline">{{ v.id }}</div>
                <div slot="supporting-text">{{ v.gameVersion }}</div>
              </md-select-option>
            </md-outlined-select>
            <md-outlined-select
              v-if="type === 'datapack' && worlds.length"
              class="grow"
              label="世界"
              :value="world"
              @change="world = ($event.target as any).value"
            >
              <md-select-option v-for="w in worlds" :key="w" :value="w" :selected="w === world">
                <div slot="headline">{{ w }}</div>
              </md-select-option>
            </md-outlined-select>
          </div>
          <div v-if="warning" class="warn md-typescale-body-small"><md-icon>info</md-icon>{{ warning }}</div>
        </div>

        <div class="row list-head">
          <span class="md-typescale-title-small grow">
            {{ showAll ? `全部文件（${versions.length}）` : `兼容 ${instance?.id ?? ''} 的文件（${compatible.length}）` }}
          </span>
          <label class="row switch md-typescale-body-medium">
            显示全部
            <md-switch :selected="showAll" @change="showAll = ($event.target as any).selected"></md-switch>
          </label>
        </div>
        <div v-if="!shown.length" class="muted md-typescale-body-medium pad">没有兼容的文件，可以打开「显示全部」查看</div>
        <div class="files">
          <div v-for="v in shown.slice(0, 50)" :key="v.id" class="file">
            <div class="grow">
              <div class="md-typescale-body-large ellipsis">{{ v.name }}</div>
              <div class="md-typescale-body-small muted">
                <span class="tag mini" :class="v.type">{{ TYPE_LABEL[v.type] }}</span>
                {{ compactVersions(v.gameVersions) }} · {{ v.loaders.join(', ') }} · {{ formatSize(v.file.size) }} · {{ timeAgo(v.published) }}
              </div>
            </div>
            <md-filled-tonal-button
              :disabled="!!installing || !instance || type === 'modpack' || (type === 'datapack' && !world)"
              @click="install(v)"
            >
              {{ installing === v.id ? '安装中…' : '安装' }}
            </md-filled-tonal-button>
          </div>
        </div>
      </template>
    </div>
    <div slot="actions">
      <md-text-button @click="emit('close')">关闭</md-text-button>
    </div>
  </md-dialog>
</template>

<style scoped>
.res-dialog {
  width: 760px;
  max-width: min(760px, calc(100vw - 48px));
  max-height: calc(100vh - 64px);
}
.headline {
  display: flex;
  align-items: center;
  gap: 16px;
}
.icon {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  object-fit: cover;
  flex: none;
}
.icon.placeholder {
  display: grid;
  place-items: center;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}
.fav {
  color: var(--md-sys-color-error);
}
.body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.desc {
  margin: 0;
}
.tags {
  flex-wrap: wrap;
  gap: 6px;
}
.gallery {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.gallery img {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 10px;
}
.target {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--md-sys-color-surface-container-highest);
}
.warn {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--md-sys-color-tertiary);
}
.warn md-icon {
  --md-icon-size: 18px;
}
.list-head {
  margin-top: 4px;
}
.switch {
  gap: 8px;
  cursor: pointer;
}
.files {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.file {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--md-sys-color-surface-container);
}
.mini {
  height: 18px;
  font-size: 11px;
  padding: 0 6px;
  margin-right: 4px;
}
.mini.beta,
.mini.alpha {
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}
.pad {
  padding: 8px 4px;
}
</style>
