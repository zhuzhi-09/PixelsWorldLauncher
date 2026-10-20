<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ResourceHit, ResourceType } from '@shared/types'
import ResourceCard from './ResourceCard.vue'
import ResourceDialog from './ResourceDialog.vue'
import { favorites } from '../../store'
import { RESOURCE_LABEL } from '../../format'

const filter = ref<ResourceType | ''>('')
const opened = ref<{ id: string; type: ResourceType } | null>(null)

const types = computed(() => [...new Set(favorites.value.map((f) => f.type))])

/** 收藏只保存了基本信息，转换为卡片需要的结构 */
const items = computed<ResourceHit[]>(() =>
  favorites.value
    .filter((f) => !filter.value || f.type === filter.value)
    .map((f) => ({
      id: f.id,
      slug: f.id,
      type: f.type,
      title: f.title,
      description: f.description,
      author: f.author,
      icon: f.icon,
      downloads: 0,
      follows: 0,
      updated: new Date(f.addedAt).toISOString(),
      categories: [RESOURCE_LABEL[f.type]],
      gameVersions: []
    }))
)
</script>

<template>
  <div class="panel">
    <div class="row head">
      <h2 class="md-typescale-headline-small grow">收藏夹</h2>
    </div>
    <md-chip-set v-if="types.length > 1">
      <md-filter-chip label="全部" :selected="!filter" @click.prevent="filter = ''"></md-filter-chip>
      <md-filter-chip
        v-for="t in types"
        :key="t"
        :label="RESOURCE_LABEL[t]"
        :selected="filter === t"
        @click.prevent="filter = t"
      ></md-filter-chip>
    </md-chip-set>
    <div v-if="!items.length" class="empty">
      <md-icon>favorite_border</md-icon>
      <div class="md-typescale-body-large">还没有收藏</div>
      <div class="md-typescale-body-medium">在资源列表中点击爱心即可收藏</div>
    </div>
    <div class="list">
      <ResourceCard v-for="h in items" :key="h.id" :hit="h" @open="opened = { id: h.id, type: h.type }" />
    </div>
    <ResourceDialog :id="opened?.id ?? null" :type="opened?.type ?? 'mod'" @close="opened = null" />
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
.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
