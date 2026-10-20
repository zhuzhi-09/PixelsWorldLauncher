<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { ResourceType } from '@shared/types'
import FavoritesPanel from '../components/download/FavoritesPanel.vue'
import MinecraftPanel from '../components/download/MinecraftPanel.vue'
import ResourceBrowser from '../components/download/ResourceBrowser.vue'
import { favorites, loadFavorites } from '../store'

type Section = 'minecraft' | ResourceType | 'favorites'

const NAV: { title: string; items: { key: Section; label: string; icon: string }[] }[] = [
  { title: '游戏', items: [{ key: 'minecraft', label: 'Minecraft', icon: 'deployed_code' }] },
  {
    title: '社区资源',
    items: [
      { key: 'mod', label: '模组', icon: 'extension' },
      { key: 'modpack', label: '整合包', icon: 'inventory_2' },
      { key: 'datapack', label: '数据包', icon: 'data_object' },
      { key: 'resourcepack', label: '资源包', icon: 'texture' },
      { key: 'shader', label: '光影', icon: 'wb_sunny' },
      { key: 'favorites', label: '收藏夹', icon: 'favorite' }
    ]
  }
]

const section = ref<Section>('minecraft')
onMounted(loadFavorites)
</script>

<template>
  <div class="download">
    <nav class="side">
      <template v-for="g in NAV" :key="g.title">
        <div class="side-title md-typescale-title-small">{{ g.title }}</div>
        <button
          v-for="it in g.items"
          :key="it.key"
          class="side-item md-typescale-label-large"
          :class="{ on: section === it.key }"
          @click="section = it.key"
        >
          <md-ripple></md-ripple>
          <md-icon>{{ it.icon }}</md-icon>
          <span class="grow">{{ it.label }}</span>
          <span v-if="it.key === 'favorites' && favorites.length" class="badge">{{ favorites.length }}</span>
        </button>
      </template>
    </nav>
    <div class="content page">
      <KeepAlive>
        <MinecraftPanel v-if="section === 'minecraft'" key="minecraft" />
        <FavoritesPanel v-else-if="section === 'favorites'" key="favorites" />
        <ResourceBrowser v-else :key="section" :type="section" />
      </KeepAlive>
    </div>
  </div>
</template>

<style scoped>
.download {
  height: 100%;
  display: flex;
}
/* MD3 导航抽屉（标准样式，内嵌在页面中） */
.side {
  width: 220px;
  flex: none;
  padding: 16px 12px;
  overflow-y: auto;
  border-right: 1px solid var(--md-sys-color-outline-variant);
}
.side-title {
  padding: 16px 16px 8px;
  color: var(--md-sys-color-on-surface-variant);
}
.side-title:first-child {
  padding-top: 4px;
}
.side-item {
  all: unset;
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 48px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  border-radius: 24px;
  cursor: pointer;
  color: var(--md-sys-color-on-surface-variant);
}
.side-item:focus-visible {
  outline: 2px solid var(--md-sys-color-secondary);
}
.side-item.on {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}
.side-item.on md-icon {
  font-variation-settings: 'FILL' 1;
}
.badge {
  font-size: 12px;
}
.content {
  flex: 1;
  min-width: 0;
}
</style>
