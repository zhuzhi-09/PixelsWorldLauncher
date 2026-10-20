<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../store'

const isMac = api.platform === 'darwin'
const maximized = ref(false)
onMounted(() => api.on.maximized((m) => (maximized.value = m)))
</script>

<template>
  <header class="titlebar" :class="{ mac: isMac }" @dblclick="api.app.toggleMaximize()">
    <div class="brand">
      <span class="logo" aria-hidden="true"></span>
      <span class="md-typescale-title-small">PixelsWorld</span>
    </div>
    <div class="spacer"></div>
    <div v-if="!isMac" class="controls" @dblclick.stop>
      <button title="最小化" @click="api.app.minimize()">
        <md-icon>remove</md-icon>
      </button>
      <button :title="maximized ? '还原' : '最大化'" @click="api.app.toggleMaximize()">
        <md-icon>{{ maximized ? 'filter_none' : 'crop_square' }}</md-icon>
      </button>
      <button class="close" title="关闭" @click="api.app.close()">
        <md-icon>close</md-icon>
      </button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  height: 44px;
  flex: none;
  display: flex;
  align-items: center;
  -webkit-app-region: drag;
  padding-left: 20px;
}
.titlebar.mac {
  padding-left: 84px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--md-sys-color-on-surface);
}
/* 像素风格的小方块 logo */
.logo {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background:
    linear-gradient(var(--md-sys-color-primary) 0 0) 0 0 / 50% 50% no-repeat,
    linear-gradient(var(--md-sys-color-tertiary) 0 0) 100% 0 / 50% 50% no-repeat,
    linear-gradient(var(--md-sys-color-secondary) 0 0) 0 100% / 50% 50% no-repeat,
    linear-gradient(var(--md-sys-color-primary-container) 0 0) 100% 100% / 50% 50% no-repeat;
}
.spacer {
  flex: 1;
}
.controls {
  display: flex;
  height: 100%;
  -webkit-app-region: no-drag;
}
.controls button {
  width: 46px;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  display: grid;
  place-items: center;
  cursor: default;
  transition: background-color 0.15s;
}
.controls md-icon {
  --md-icon-size: 18px;
}
.controls button:hover {
  background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
}
.controls button.close:hover {
  background: #c42b1c;
  color: #fff;
}
</style>
