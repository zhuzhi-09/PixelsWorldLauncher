<script setup lang="ts">
import { computed } from 'vue'
import type { ResourceHit } from '@shared/types'
import { favorites, toggleFavorite } from '../../store'
import { compactVersions, formatCount, RESOURCE_ICON, timeAgo } from '../../format'

const props = defineProps<{ hit: ResourceHit }>()
const emit = defineEmits<{ open: [] }>()
const isFav = computed(() => favorites.value.some((f) => f.id === props.hit.id))
</script>

<template>
  <div class="res-card" role="button" tabindex="0" @click="emit('open')" @keydown.enter="emit('open')">
    <md-ripple></md-ripple>
    <img v-if="hit.icon" :src="hit.icon" class="icon" alt="" loading="lazy" />
    <span v-else class="icon placeholder"><md-icon>{{ RESOURCE_ICON[hit.type] }}</md-icon></span>
    <div class="grow info">
      <div class="row title-row">
        <span class="md-typescale-title-medium ellipsis">{{ hit.title }}</span>
        <span class="md-typescale-body-small muted ellipsis">by {{ hit.author }}</span>
      </div>
      <div class="md-typescale-body-medium desc">{{ hit.description }}</div>
      <div class="row meta md-typescale-body-small muted">
        <span v-for="c in hit.categories.slice(0, 4)" :key="c" class="tag mini">{{ c }}</span>
        <span class="stat"><md-icon>download</md-icon>{{ formatCount(hit.downloads) }}</span>
        <span class="stat"><md-icon>update</md-icon>{{ timeAgo(hit.updated) }}</span>
        <span v-if="hit.gameVersions.length" class="stat ellipsis"><md-icon>sports_esports</md-icon>{{ compactVersions(hit.gameVersions) }}</span>
      </div>
    </div>
    <md-icon-button :title="isFav ? '取消收藏' : '收藏'" @click.stop="toggleFavorite(hit)">
      <md-icon :class="{ fav: isFav }">{{ isFav ? 'favorite' : 'favorite_border' }}</md-icon>
    </md-icon-button>
  </div>
</template>

<style scoped>
.res-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 12px 14px 16px;
  border-radius: 16px;
  background: var(--md-sys-color-surface-container-low);
  cursor: pointer;
  outline: none;
}
.res-card:focus-visible {
  outline: 2px solid var(--md-sys-color-secondary);
}
.icon {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  object-fit: cover;
  flex: none;
  background: var(--md-sys-color-surface-container-highest);
}
.icon.placeholder {
  display: grid;
  place-items: center;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}
.info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.title-row {
  gap: 8px;
  align-items: baseline;
}
.desc {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--md-sys-color-on-surface-variant);
}
.meta {
  gap: 10px;
  flex-wrap: wrap;
}
.mini {
  height: 20px;
  font-size: 11px;
  padding: 0 6px;
}
.stat {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.stat md-icon {
  --md-icon-size: 15px;
}
.fav {
  color: var(--md-sys-color-error);
}
</style>
