<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import SkinAvatar from '../components/SkinAvatar.vue'
import { api, errorText, loaderLabel, store, toast, updateConfig } from '../store'

const account = computed(
  () => store.accounts.find((a) => a.id === store.config?.selectedAccount) ?? store.accounts[0]
)
const version = computed(() => store.installed.find((v) => v.id === store.config?.selectedVersion))

const pickerOpen = ref(false)
const showLogs = ref(false)
const logBox = ref<HTMLElement>()

const greeting = computed(() => {
  const h = new Date().getHours()
  return h < 6 ? '夜深了' : h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好'
})

async function launch(): Promise<void> {
  if (store.game.state === 'running') return void api.game.kill()
  if (!store.accounts.length) {
    toast('请先添加一个账户')
    store.page = 'accounts'
    return
  }
  if (!version.value) {
    toast('请先安装一个游戏版本')
    store.page = 'versions'
    return
  }
  store.logs = []
  try {
    await api.game.launch()
  } catch (e) {
    toast(errorText(e))
  }
}

async function pick(id: string): Promise<void> {
  pickerOpen.value = false
  await updateConfig({ selectedVersion: id })
}

watch(
  () => store.logs.length,
  async () => {
    if (!showLogs.value || !logBox.value) return
    const el = logBox.value
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    await nextTick()
    if (atBottom) el.scrollTop = el.scrollHeight
  }
)

const fabLabel = computed(() =>
  store.game.state === 'preparing' ? '准备中…' : store.game.state === 'running' ? '结束游戏' : '开始游戏'
)
const fabIcon = computed(() => (store.game.state === 'running' ? 'stop' : 'play_arrow'))
const logLevel = (l: string) =>
  /\/(ERROR|FATAL)\]|Exception|^\s+at /.test(l) ? 'err' : /\/WARN\]/.test(l) ? 'warn' : ''
</script>

<template>
  <div class="page home">
    <section class="hero">
      <div class="pixels" aria-hidden="true">
        <span v-for="i in 24" :key="i" :style="{ '--i': i }"></span>
      </div>
      <div class="hero-text">
        <div class="md-typescale-title-medium">{{ greeting }}{{ account ? `，${account.name}` : '' }}</div>
        <h1 class="md-typescale-display-medium">PixelsWorld</h1>
        <p class="md-typescale-body-large">一个跨平台的 Minecraft 启动器</p>
      </div>
    </section>

    <section class="cards">
      <button class="card select-card" @click="store.page = 'accounts'">
        <md-ripple></md-ripple>
        <SkinAvatar v-if="account" :name="account.name" :skin-url="account.skinUrl" :size="48" />
        <div v-else class="placeholder"><md-icon>person_add</md-icon></div>
        <div class="grow">
          <div class="md-typescale-label-medium muted">账户</div>
          <div class="md-typescale-title-medium ellipsis">{{ account?.name ?? '添加账户' }}</div>
          <div v-if="account" class="md-typescale-body-small muted">
            {{ account.type === 'microsoft' ? '微软账户' : '离线账户' }}
          </div>
        </div>
        <md-icon class="muted">chevron_right</md-icon>
      </button>

      <button class="card select-card" @click="store.installed.length ? (pickerOpen = true) : (store.page = 'versions')">
        <md-ripple></md-ripple>
        <div class="placeholder version"><md-icon>deployed_code</md-icon></div>
        <div class="grow">
          <div class="md-typescale-label-medium muted">游戏版本</div>
          <div class="md-typescale-title-medium ellipsis">{{ version?.id ?? '安装版本' }}</div>
          <div v-if="version" class="md-typescale-body-small muted">
            {{ loaderLabel[version.loader] }} · {{ version.gameVersion }}
          </div>
        </div>
        <md-icon class="muted">unfold_more</md-icon>
      </button>
    </section>

    <section v-if="store.logs.length" class="card logs">
      <div class="row">
        <md-icon>terminal</md-icon>
        <span class="md-typescale-title-small grow">游戏日志</span>
        <md-text-button @click="showLogs = !showLogs">{{ showLogs ? '收起' : '展开' }}</md-text-button>
      </div>
      <div v-if="showLogs" ref="logBox" class="log-box">
        <div v-for="(l, i) in store.logs" :key="i" :class="logLevel(l)">{{ l }}</div>
      </div>
    </section>

    <md-fab
      class="launch"
      variant="primary"
      size="large"
      :label="fabLabel"
      :disabled="store.game.state === 'preparing'"
      @click="launch"
    >
      <md-icon slot="icon">{{ fabIcon }}</md-icon>
    </md-fab>

    <md-dialog :open="pickerOpen" @closed="pickerOpen = false">
      <div slot="headline">选择版本</div>
      <md-list slot="content" class="picker">
        <md-list-item
          v-for="v in store.installed"
          :key="v.id"
          type="button"
          :class="{ selected: v.id === store.config?.selectedVersion }"
          @click="pick(v.id)"
        >
          <md-icon slot="start">{{ v.loader === 'vanilla' ? 'grass' : 'extension' }}</md-icon>
          <div slot="headline">{{ v.id }}</div>
          <div slot="supporting-text">{{ loaderLabel[v.loader] }} · {{ v.gameVersion }}</div>
          <md-icon v-if="v.id === store.config?.selectedVersion" slot="end">check</md-icon>
        </md-list-item>
      </md-list>
      <div slot="actions">
        <md-text-button @click="(pickerOpen = false), (store.page = 'versions')">管理版本</md-text-button>
        <md-text-button @click="pickerOpen = false">关闭</md-text-button>
      </div>
    </md-dialog>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.hero {
  position: relative;
  overflow: hidden;
  border-radius: 28px;
  min-height: 220px;
  padding: 36px 40px;
  display: flex;
  align-items: flex-end;
  background: linear-gradient(
    135deg,
    var(--md-sys-color-primary-container),
    var(--md-sys-color-tertiary-container)
  );
  color: var(--md-sys-color-on-primary-container);
}
.hero h1 {
  margin: 4px 0 2px;
  font-weight: 700;
  letter-spacing: -0.5px;
}
.hero p {
  margin: 0;
  opacity: 0.8;
}
.hero-text {
  position: relative;
}
/* 漂浮的像素方块装饰 */
.pixels {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  grid-template-rows: repeat(3, 1fr);
  opacity: 0.5;
}
.pixels span {
  margin: auto;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--md-sys-color-primary);
  opacity: calc(mod(var(--i) * 7, 10) / 22);
  transform: rotate(calc(var(--i) * 17deg)) scale(calc(0.5 + mod(var(--i) * 3, 5) / 6));
  animation: float 6s ease-in-out infinite;
  animation-delay: calc(var(--i) * -0.37s);
}
.pixels span:nth-child(3n) {
  background: var(--md-sys-color-tertiary);
}
@keyframes float {
  50% {
    translate: 0 -10px;
  }
}
.cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.select-card {
  all: unset;
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  border-radius: 20px;
  background: var(--md-sys-color-surface-container-low);
  cursor: pointer;
  overflow: hidden;
}
.select-card:focus-visible {
  outline: 2px solid var(--md-sys-color-secondary);
}
.placeholder {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}
.placeholder.version {
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}
.logs {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.log-box {
  height: 260px;
  overflow: auto;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.5;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--md-sys-color-surface-container-highest);
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
}
.log-box .warn {
  color: var(--md-sys-color-tertiary);
}
.log-box .err {
  color: var(--md-sys-color-error);
}
.launch {
  position: absolute;
  right: 28px;
  bottom: 28px;
  z-index: 5;
}
.picker {
  max-height: 50vh;
}
.picker .selected {
  --md-list-item-label-text-color: var(--md-sys-color-primary);
  --md-list-item-leading-icon-color: var(--md-sys-color-primary);
}
</style>
