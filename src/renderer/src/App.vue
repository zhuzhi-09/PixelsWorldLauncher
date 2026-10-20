<script setup lang="ts">
import { computed } from 'vue'
import TitleBar from './components/TitleBar.vue'
import NavRail from './components/NavRail.vue'
import TaskPanel from './components/TaskPanel.vue'
import Snackbar from './components/Snackbar.vue'
import HomeView from './views/HomeView.vue'
import VersionsView from './views/VersionsView.vue'
import AccountsView from './views/AccountsView.vue'
import SettingsView from './views/SettingsView.vue'
import { store } from './store'

const views = { home: HomeView, versions: VersionsView, accounts: AccountsView, settings: SettingsView }
const view = computed(() => views[store.page])
</script>

<template>
  <div class="shell">
    <TitleBar />
    <div class="body">
      <NavRail />
      <main class="content">
        <Transition name="fade" mode="out-in">
          <KeepAlive>
            <component :is="view" :key="store.page" />
          </KeepAlive>
        </Transition>
        <TaskPanel />
        <Snackbar />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.content {
  flex: 1;
  min-width: 0;
  position: relative;
  background: var(--md-sys-color-surface);
  border-top-left-radius: 24px;
  overflow: hidden;
  transition: background-color 0.3s;
}
</style>
