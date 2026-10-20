<script setup lang="ts">
import { store } from '../store'
import type { TaskProgress } from '@shared/types'

const dismiss = (t: TaskProgress) => (store.tasks = store.tasks.filter((x) => x.id !== t.id))
const pct = (t: TaskProgress) => (t.total ? t.done / t.total : 0)
</script>

<template>
  <div class="tasks">
    <TransitionGroup name="task">
      <div v-for="t in store.tasks" :key="t.id" class="task" :class="t.state">
        <div class="row">
          <md-icon class="state-icon">
            {{ t.state === 'success' ? 'check_circle' : t.state === 'error' ? 'error' : 'downloading' }}
          </md-icon>
          <div class="grow">
            <div class="md-typescale-title-small ellipsis">{{ t.title }}</div>
            <div class="md-typescale-body-small muted ellipsis" :title="t.error">
              {{ t.state === 'error' ? t.error : t.stage }}
              <template v-if="t.state === 'running' && t.total"> · {{ t.done }}/{{ t.total }}</template>
            </div>
          </div>
          <md-icon-button v-if="t.state !== 'running'" @click="dismiss(t)">
            <md-icon>close</md-icon>
          </md-icon-button>
        </div>
        <md-linear-progress
          v-if="t.state === 'running'"
          :indeterminate="!t.total"
          :value="pct(t)"
        ></md-linear-progress>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.tasks {
  position: absolute;
  left: 20px;
  bottom: 20px;
  width: 340px;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  z-index: 10;
  pointer-events: none;
}
.task {
  pointer-events: auto;
  background: var(--md-sys-color-surface-container-high);
  border-radius: 16px;
  padding: 12px 8px 12px 16px;
  box-shadow:
    0 1px 3px rgb(0 0 0 / 0.15),
    0 4px 8px 3px rgb(0 0 0 / 0.08);
}
.state-icon {
  color: var(--md-sys-color-primary);
}
.task.error .state-icon {
  color: var(--md-sys-color-error);
}
md-linear-progress {
  width: calc(100% - 8px);
  margin-top: 10px;
  --md-linear-progress-track-shape: 4px;
}
.task-enter-active,
.task-leave-active {
  transition: all 0.3s cubic-bezier(0.2, 0, 0, 1);
}
.task-enter-from,
.task-leave-to {
  opacity: 0;
  transform: translateY(16px);
}
</style>
