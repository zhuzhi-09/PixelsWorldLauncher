<script setup lang="ts">
import { store, type Page } from '../store'

const items: { page: Page; icon: string; label: string }[] = [
  { page: 'home', icon: 'home', label: '主页' },
  { page: 'versions', icon: 'deployed_code', label: '版本' },
  { page: 'download', icon: 'download', label: '下载' },
  { page: 'accounts', icon: 'account_circle', label: '账户' },
  { page: 'settings', icon: 'settings', label: '设置' }
]
</script>

<template>
  <nav class="rail">
    <button
      v-for="item in items"
      :key="item.page"
      class="item"
      :class="{ active: store.page === item.page }"
      @click="store.page = item.page"
    >
      <span class="indicator">
        <md-ripple></md-ripple>
        <md-icon>{{ item.icon }}</md-icon>
      </span>
      <span class="label md-typescale-label-medium">{{ item.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.rail {
  width: 88px;
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding-top: 12px;
}
.item {
  all: unset;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 72px;
  cursor: pointer;
  color: var(--md-sys-color-on-surface-variant);
}
.item:focus-visible .indicator {
  outline: 2px solid var(--md-sys-color-secondary);
  outline-offset: 2px;
}
.indicator {
  position: relative;
  width: 56px;
  height: 32px;
  border-radius: 16px;
  display: grid;
  place-items: center;
  transition: background-color 0.2s cubic-bezier(0.2, 0, 0, 1);
}
.indicator md-icon {
  transition: font-variation-settings 0.2s;
}
.item.active {
  color: var(--md-sys-color-on-surface);
}
.item.active .indicator {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}
.item.active md-icon {
  font-variation-settings: 'FILL' 1;
}
.item.active .label {
  font-weight: 700;
}
</style>
