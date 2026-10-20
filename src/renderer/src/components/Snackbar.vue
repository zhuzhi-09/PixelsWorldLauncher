<script setup lang="ts">
import { ref, watch } from 'vue'
import { store } from '../store'

const visible = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

watch(
  () => store.snackbar.key,
  () => {
    visible.value = true
    clearTimeout(timer)
    timer = setTimeout(() => (visible.value = false), 4000)
  }
)
</script>

<template>
  <Transition name="snack">
    <div v-if="visible" class="snackbar md-typescale-body-medium" role="status">
      <span class="grow">{{ store.snackbar.text }}</span>
      <md-icon-button @click="visible = false"><md-icon>close</md-icon></md-icon-button>
    </div>
  </Transition>
</template>

<style scoped>
.snackbar {
  position: absolute;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  min-width: 320px;
  max-width: 560px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 4px 4px 16px;
  min-height: 48px;
  border-radius: 4px;
  background: var(--md-sys-color-inverse-surface);
  color: var(--md-sys-color-inverse-on-surface);
  box-shadow: 0 3px 8px rgb(0 0 0 / 0.25);
  z-index: 20;
  --md-icon-button-icon-color: var(--md-sys-color-inverse-on-surface);
}
.snack-enter-active,
.snack-leave-active {
  transition: all 0.25s cubic-bezier(0.2, 0, 0, 1);
}
.snack-enter-from,
.snack-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
</style>
