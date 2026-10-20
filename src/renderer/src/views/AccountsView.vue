<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { MsDeviceCode, PublicAccount } from '@shared/types'
import SkinAvatar from '../components/SkinAvatar.vue'
import { api, errorText, refreshAccounts, store, toast, updateConfig } from '../store'

// ---------- 离线账户 ----------
const offlineOpen = ref(false)
const offlineName = ref('')
const offlineError = ref('')

async function addOffline(): Promise<void> {
  try {
    await api.accounts.addOffline(offlineName.value.trim())
    offlineOpen.value = false
    offlineName.value = ''
    await refreshAccounts()
  } catch (e) {
    offlineError.value = errorText(e)
  }
}

// ---------- 微软账户 ----------
const msOpen = ref(false)
const msCode = ref<MsDeviceCode | null>(null)

onMounted(() => api.on.msCode((c) => (msCode.value = c)))

async function loginMs(): Promise<void> {
  if (!store.config?.msClientId) {
    toast('请先在「设置 → 微软登录」中填写 Azure Client ID')
    store.page = 'settings'
    return
  }
  msCode.value = null
  msOpen.value = true
  try {
    const acc = await api.accounts.loginMicrosoft()
    toast(`欢迎，${acc.name}`)
    await refreshAccounts()
  } catch (e) {
    if (msOpen.value) toast(errorText(e))
  } finally {
    msOpen.value = false
  }
}

function cancelMs(): void {
  msOpen.value = false
  api.accounts.cancelMicrosoft()
}

async function copyCode(): Promise<void> {
  if (!msCode.value) return
  await navigator.clipboard.writeText(msCode.value.userCode)
  toast('代码已复制')
}

// ---------- 列表操作 ----------
const removing = ref<PublicAccount | null>(null)

async function confirmRemove(): Promise<void> {
  const a = removing.value
  removing.value = null
  if (!a) return
  await api.accounts.remove(a.id)
  await refreshAccounts()
}

const isCurrent = (a: PublicAccount) =>
  a.id === store.config?.selectedAccount || (!store.config?.selectedAccount && a === store.accounts[0])
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1 class="md-typescale-headline-medium">账户</h1>
      <md-outlined-button @click="(offlineOpen = true), (offlineError = '')">
        <md-icon slot="icon">person_add</md-icon>
        离线账户
      </md-outlined-button>
      <md-filled-button @click="loginMs">
        <md-icon slot="icon">login</md-icon>
        微软登录
      </md-filled-button>
    </div>

    <div v-if="!store.accounts.length" class="empty">
      <md-icon>account_circle</md-icon>
      <div class="md-typescale-body-large">还没有账户</div>
      <div class="md-typescale-body-medium">添加离线账户即可开始单人游戏，正版用户请使用微软登录</div>
    </div>

    <div class="grid">
      <div
        v-for="a in store.accounts"
        :key="a.id"
        class="card account"
        :class="{ current: isCurrent(a) }"
        @click="updateConfig({ selectedAccount: a.id })"
      >
        <md-ripple></md-ripple>
        <SkinAvatar :name="a.name" :skin-url="a.skinUrl" :size="56" />
        <div class="grow">
          <div class="md-typescale-title-medium ellipsis">{{ a.name }}</div>
          <div class="row tag-row">
            <span class="tag" :class="{ tertiary: a.type === 'microsoft' }">
              {{ a.type === 'microsoft' ? '微软' : '离线' }}
            </span>
            <span v-if="a.importedFrom === 'pcl'" class="tag" title="导入自 PCL-CE，登录过期后需要重新登录">PCL-CE</span>
            <span v-if="isCurrent(a)" class="md-typescale-label-medium current-label">当前使用</span>
          </div>
        </div>
        <md-icon-button title="删除" @click.stop="removing = a"><md-icon>delete</md-icon></md-icon-button>
      </div>
    </div>

    <md-dialog :open="offlineOpen" @closed="offlineOpen = false">
      <md-icon slot="icon">person_add</md-icon>
      <div slot="headline">添加离线账户</div>
      <form slot="content" id="offline-form" method="dialog" @submit.prevent="addOffline">
        <md-outlined-text-field
          label="用户名"
          :value="offlineName"
          maxlength="16"
          :error="!!offlineError"
          :error-text="offlineError"
          supporting-text="3-16 位字母、数字或下划线"
          @input="(offlineName = ($event.target as any).value), (offlineError = '')"
        ></md-outlined-text-field>
      </form>
      <div slot="actions">
        <md-text-button @click="offlineOpen = false">取消</md-text-button>
        <md-filled-button :disabled="!offlineName.trim()" @click="addOffline">添加</md-filled-button>
      </div>
    </md-dialog>

    <md-dialog :open="msOpen" @cancel.prevent>
      <md-icon slot="icon">login</md-icon>
      <div slot="headline">微软账户登录</div>
      <div slot="content" class="ms-body">
        <template v-if="msCode">
          <div class="md-typescale-body-medium">请在浏览器中打开下面的地址，并输入代码：</div>
          <md-text-button @click="api.app.openExternal(msCode.verificationUri)">
            {{ msCode.verificationUri }}
            <md-icon slot="icon">open_in_new</md-icon>
          </md-text-button>
          <button class="code" title="点击复制" @click="copyCode">
            <md-ripple></md-ripple>
            {{ msCode.userCode }}
          </button>
          <div class="row muted md-typescale-body-small">
            <md-circular-progress indeterminate class="small"></md-circular-progress>
            正在等待你完成登录…
          </div>
        </template>
        <div v-else class="row">
          <md-circular-progress indeterminate class="small"></md-circular-progress>
          正在连接微软服务…
        </div>
      </div>
      <div slot="actions">
        <md-text-button @click="cancelMs">取消</md-text-button>
      </div>
    </md-dialog>

    <md-dialog :open="!!removing" @closed="removing = null">
      <div slot="headline">删除账户 {{ removing?.name }}？</div>
      <div slot="actions">
        <md-text-button @click="removing = null">取消</md-text-button>
        <md-filled-button @click="confirmRemove">删除</md-filled-button>
      </div>
    </md-dialog>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}
.account {
  display: flex;
  align-items: center;
  gap: 16px;
  cursor: pointer;
  overflow: hidden;
  transition: background-color 0.2s;
}
.account.current {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}
.tag-row {
  gap: 8px;
  margin-top: 6px;
}
.current-label {
  color: var(--md-sys-color-primary);
}
md-outlined-text-field {
  width: 100%;
}
.ms-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}
.code {
  all: unset;
  position: relative;
  font-family: var(--mono);
  font-size: 32px;
  font-weight: 700;
  letter-spacing: 6px;
  padding: 12px 24px;
  border-radius: 16px;
  cursor: pointer;
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  user-select: text;
}
.small {
  --md-circular-progress-size: 24px;
}
</style>
