<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { ResourceHit, ResourceSearch, ResourceType } from '@shared/types'
import ResourceCard from './ResourceCard.vue'
import ResourceDialog from './ResourceDialog.vue'
import { api, errorText, store } from '../../store'
import { RESOURCE_LABEL } from '../../format'

/** Modrinth 资源浏览：搜索、筛选、分页 */
const props = defineProps<{ type: ResourceType }>()

const SORTS = [
  { v: 'relevance', l: '相关性' },
  { v: 'downloads', l: '下载量' },
  { v: 'follows', l: '关注数' },
  { v: 'updated', l: '最近更新' },
  { v: 'newest', l: '最新发布' }
] as const

const LOADERS = [
  { v: 'fabric', l: 'Fabric' },
  { v: 'forge', l: 'Forge' },
  { v: 'neoforge', l: 'NeoForge' },
  { v: 'quilt', l: 'Quilt' },
  { v: 'legacy-fabric', l: 'Legacy Fabric' },
  { v: 'liteloader', l: 'LiteLoader' }
]

/** 本启动器加载器 -> Modrinth 标签 */
const LOADER_TAG: Record<string, string> = {
  fabric: 'fabric',
  quilt: 'quilt',
  legacyfabric: 'legacy-fabric',
  forge: 'forge',
  neoforge: 'neoforge',
  cleanroom: 'forge',
  liteloader: 'liteloader'
}

// md-select 无法显示空字符串值，用占位值表示「全部」
const ALL = '__all__'
const pick = (e: Event) => {
  const v = (e.target as HTMLSelectElement).value
  return v === ALL ? '' : v
}

const query = ref('')
const sort = ref<ResourceSearch['sort']>('relevance')
const gameVersion = ref('')
const loader = ref('')
const hits = ref<ResourceHit[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
const gameVersions = ref<string[]>([])
const opened = ref<string | null>(null)

const hasLoader = computed(() => props.type === 'mod' || props.type === 'modpack')
const current = computed(() => store.installed.find((v) => v.id === store.config?.selectedVersion))

let seq = 0
async function run(append = false): Promise<void> {
  const my = ++seq
  loading.value = true
  error.value = ''
  try {
    const r = await api.resources.search({
      type: props.type,
      query: query.value.trim(),
      sort: sort.value,
      gameVersion: gameVersion.value || undefined,
      loader: hasLoader.value ? loader.value || undefined : undefined,
      offset: append ? hits.value.length : 0
    })
    if (my !== seq) return
    hits.value = append ? [...hits.value, ...r.hits] : r.hits
    total.value = r.total
  } catch (e) {
    if (my === seq) error.value = errorText(e)
  } finally {
    if (my === seq) loading.value = false
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
watch(query, () => {
  clearTimeout(timer)
  timer = setTimeout(() => run(), 400)
})
watch([sort, gameVersion, loader], () => run())

/** 一键按当前选择的游戏版本筛选 */
function matchCurrent(): void {
  const c = current.value
  if (!c) return
  gameVersion.value = c.gameVersion
  if (hasLoader.value) loader.value = LOADER_TAG[c.loader] ?? ''
}
const matching = computed(
  () => !!current.value && gameVersion.value === current.value.gameVersion &&
    (!hasLoader.value || loader.value === (LOADER_TAG[current.value.loader] ?? ''))
)

onMounted(async () => {
  run()
  gameVersions.value = await api.resources.gameVersions().catch(() => [])
})
</script>

<template>
  <div class="panel">
    <div class="row head">
      <h2 class="md-typescale-headline-small grow">{{ RESOURCE_LABEL[type] }}</h2>
      <span class="md-typescale-body-small muted">数据来自 Modrinth</span>
    </div>

    <div class="filters">
      <md-outlined-text-field
        class="search"
        :placeholder="`搜索${RESOURCE_LABEL[type]}`"
        :value="query"
        @input="query = ($event.target as any).value"
      >
        <md-icon slot="leading-icon">search</md-icon>
      </md-outlined-text-field>
      <md-outlined-select label="排序" :value="sort" @change="sort = ($event.target as any).value">
        <md-select-option v-for="s in SORTS" :key="s.v" :value="s.v" :selected="s.v === sort">
          <div slot="headline">{{ s.l }}</div>
        </md-select-option>
      </md-outlined-select>
      <md-outlined-select label="游戏版本" :value="gameVersion || ALL" @change="gameVersion = pick($event)">
        <md-select-option :value="ALL" :selected="!gameVersion"><div slot="headline">全部</div></md-select-option>
        <md-select-option v-for="v in gameVersions" :key="v" :value="v" :selected="v === gameVersion">
          <div slot="headline">{{ v }}</div>
        </md-select-option>
      </md-outlined-select>
      <md-outlined-select v-if="hasLoader" label="加载器" :value="loader || ALL" @change="loader = pick($event)">
        <md-select-option :value="ALL" :selected="!loader"><div slot="headline">全部</div></md-select-option>
        <md-select-option v-for="l in LOADERS" :key="l.v" :value="l.v" :selected="l.v === loader">
          <div slot="headline">{{ l.l }}</div>
        </md-select-option>
      </md-outlined-select>
    </div>
    <md-chip-set v-if="current">
      <md-filter-chip
        :label="`适配当前版本：${current.id}`"
        :selected="matching"
        @click.prevent="matching ? ((gameVersion = ''), (loader = '')) : matchCurrent()"
      ></md-filter-chip>
    </md-chip-set>

    <div v-if="error" class="empty">
      <md-icon>cloud_off</md-icon>
      <div>{{ error }}</div>
      <md-filled-tonal-button @click="run()">重试</md-filled-tonal-button>
    </div>
    <div v-else class="list">
      <ResourceCard v-for="h in hits" :key="h.id" :hit="h" @open="opened = h.id" />
      <div v-if="loading" class="empty small"><md-circular-progress indeterminate></md-circular-progress></div>
      <div v-else-if="!hits.length" class="empty"><md-icon>search_off</md-icon>没有找到相关{{ RESOURCE_LABEL[type] }}</div>
      <div v-else-if="hits.length < total" class="more">
        <md-filled-tonal-button @click="run(true)">加载更多（共 {{ total }} 个）</md-filled-tonal-button>
      </div>
    </div>

    <ResourceDialog :id="opened" :type="type" @close="opened = null" />
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head h2 {
  margin: 0;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.search {
  flex: 1;
  min-width: 220px;
  --md-outlined-text-field-container-shape: 28px;
}
.filters md-outlined-select {
  width: 150px;
  min-width: 150px;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.more {
  display: flex;
  justify-content: center;
  padding: 8px;
}
.empty.small {
  padding: 24px;
}
</style>
