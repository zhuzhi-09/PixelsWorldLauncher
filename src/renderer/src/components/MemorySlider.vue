<script setup lang="ts">
import { computed } from 'vue'
import { formatGb, maxTickFor, ramFromTick } from '@shared/ram'

/** PCL-CE 风格的内存刻度滑块：刻度越大步长越大 */
const props = withDefaults(defineProps<{ tick: number; totalGb: number; min?: number; label?: string }>(), {
  min: 1,
  label: ''
})
const emit = defineEmits<{ change: [tick: number] }>()

const max = computed(() => Math.max(props.min + 1, maxTickFor(Math.max(1, props.totalGb))))
const valueText = computed(() => (props.tick <= 0 ? '不设置' : formatGb(ramFromTick(props.tick))))
</script>

<template>
  <div class="mem">
    <div class="row">
      <span class="md-typescale-body-medium muted grow">{{ label }}</span>
      <span class="md-typescale-title-small value">{{ valueText }}</span>
    </div>
    <md-slider
      :min="min"
      :max="max"
      :value="Math.min(Math.max(tick, min), max)"
      @change="emit('change', Number(($event.target as HTMLInputElement).value))"
    ></md-slider>
  </div>
</template>

<style scoped>
.mem {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
md-slider {
  width: 100%;
}
.value {
  color: var(--md-sys-color-primary);
}
</style>
