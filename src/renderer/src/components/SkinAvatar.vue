<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ name: string; skinUrl?: string; size?: number }>(), { size: 40 })
const canvas = ref<HTMLCanvasElement>()
const loaded = ref(false)

/** 从皮肤贴图裁剪出头像（脸 + 帽子层） */
function draw(): void {
  loaded.value = false
  if (!props.skinUrl) return
  const img = new Image()
  img.onload = () => {
    const ctx = canvas.value?.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, 8, 8)
    ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8)
    ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8)
    loaded.value = true
  }
  img.src = props.skinUrl
}

onMounted(draw)
watch(() => props.skinUrl, draw)
</script>

<template>
  <div class="avatar" :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${size * 0.45}px` }">
    <canvas v-show="loaded" ref="canvas" width="8" height="8"></canvas>
    <span v-if="!loaded">{{ name.slice(0, 1).toUpperCase() }}</span>
  </div>
</template>

<style scoped>
.avatar {
  flex: none;
  border-radius: 12px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  font-weight: 600;
}
canvas {
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
}
</style>
