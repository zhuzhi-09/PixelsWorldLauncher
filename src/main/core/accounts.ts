import { app, safeStorage } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Account, MsDeviceCode, PublicAccount } from '@shared/types'
import { getConfig, setConfig } from './config'

const file = () => join(app.getPath('userData'), 'accounts.dat')

let accounts: Account[] | null = null

function load(): Account[] {
  if (accounts) return accounts
  accounts = []
  try {
    if (existsSync(file())) {
      const raw = readFileSync(file())
      const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8')
      accounts = JSON.parse(text)
    }
  } catch {
    accounts = []
  }
  return accounts!
}

async function save(): Promise<void> {
  const text = JSON.stringify(load())
  // 令牌使用系统钥匙串加密保存
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text)
  await writeFile(file(), data)
}

export const toPublic = ({ accessToken: _a, refreshToken: _r, ...rest }: Account): PublicAccount => rest

export const listAccounts = (): PublicAccount[] => load().map(toPublic)

async function upsert(acc: Account): Promise<PublicAccount> {
  const list = load()
  const i = list.findIndex((a) => a.type === acc.type && a.uuid === acc.uuid)
  if (i >= 0) {
    acc.id = list[i].id
    list[i] = acc
  } else list.push(acc)
  await save()
  await setConfig({ selectedAccount: acc.id })
  return toPublic(acc)
}

/** 批量导入（PCL-CE），已存在的同类型同 UUID 账户会被覆盖；返回导入数量 */
export async function importAccounts(items: Omit<Account, 'id'>[], selectIndex: number): Promise<number> {
  const list = load()
  let selectedId = ''
  items.forEach((item, i) => {
    // 离线账户按名称匹配，避免 UUID 生成方式不同导致重复
    const existing = list.findIndex((a) =>
      a.type === item.type && (item.type === 'offline' ? a.name === item.name : a.uuid === item.uuid)
    )
    const acc: Account = { ...item, id: existing >= 0 ? list[existing].id : randomUUID() }
    if (existing >= 0) list[existing] = acc
    else list.push(acc)
    if (i === selectIndex) selectedId = acc.id
  })
  await save()
  if (selectedId) await setConfig({ selectedAccount: selectedId })
  else if (!getConfig().selectedAccount && list[0]) await setConfig({ selectedAccount: list[0].id })
  return items.length
}

export async function removeAccount(id: string): Promise<void> {
  accounts = load().filter((a) => a.id !== id)
  await save()
  if (getConfig().selectedAccount === id) await setConfig({ selectedAccount: accounts[0]?.id ?? '' })
}

// ---------- 离线账户 ----------

/** 与 Java UUID.nameUUIDFromBytes("OfflinePlayer:" + name) 一致 */
function offlineUuid(name: string): string {
  const h = createHash('md5').update(`OfflinePlayer:${name}`).digest()
  h[6] = (h[6] & 0x0f) | 0x30
  h[8] = (h[8] & 0x3f) | 0x80
  return h.toString('hex')
}

export async function addOffline(name: string): Promise<PublicAccount> {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('用户名需为 3-16 位字母、数字或下划线')
  return upsert({
    id: randomUUID(),
    type: 'offline',
    name,
    uuid: offlineUuid(name),
    accessToken: randomUUID().replace(/-/g, '')
  })
}

// ---------- 微软账户（设备代码流） ----------

const MS_AUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'

async function post<T>(url: string, body: unknown, form = false): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: form
      ? { 'Content-Type': 'application/x-www-form-urlencoded' }
      : { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: form ? new URLSearchParams(body as Record<string, string>) : JSON.stringify(body)
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; XErr?: number }
  if (!res.ok && !(form && data.error)) {
    if (data.XErr === 2148916233) throw new Error('该微软账户尚未创建 Xbox 档案')
    if (data.XErr === 2148916238) throw new Error('未成年账户需要加入家庭组后才能登录')
    throw new Error(`请求失败 (${res.status})：${url}`)
  }
  return data
}

let cancelFlag = false
export const cancelMicrosoft = () => {
  cancelFlag = true
}

interface MsToken {
  access_token: string
  refresh_token: string
  error?: string
}

async function minecraftFromMs(ms: MsToken, existingId?: string): Promise<Account> {
  const xbl = await post<{ Token: string; DisplayClaims: { xui: { uhs: string }[] } }>(
    'https://user.auth.xboxlive.com/user/authenticate',
    {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${ms.access_token}` },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    }
  )
  const xsts = await post<{ Token: string }>('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT'
  })
  const uhs = xbl.DisplayClaims.xui[0].uhs
  const mc = await post<{ access_token: string; expires_in: number }>(
    'https://api.minecraftservices.com/authentication/login_with_xbox',
    { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` }
  )
  const res = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${mc.access_token}` }
  })
  if (res.status === 404) throw new Error('该账户没有购买 Minecraft: Java Edition')
  if (!res.ok) throw new Error(`获取档案失败 (${res.status})`)
  const profile = (await res.json()) as {
    id: string
    name: string
    skins?: { state: string; url: string }[]
  }
  return {
    id: existingId ?? randomUUID(),
    type: 'microsoft',
    name: profile.name,
    uuid: profile.id,
    accessToken: mc.access_token,
    refreshToken: ms.refresh_token,
    expiresAt: Date.now() + mc.expires_in * 1000,
    skinUrl: profile.skins?.find((s) => s.state === 'ACTIVE')?.url
  }
}

export async function loginMicrosoft(onCode: (c: MsDeviceCode) => void): Promise<PublicAccount> {
  const clientId = getConfig().msClientId.trim()
  if (!clientId) throw new Error('请先在「设置」中填写 Azure 应用 Client ID')
  cancelFlag = false

  const dc = await post<{
    device_code: string
    user_code: string
    verification_uri: string
    interval: number
    expires_in: number
  }>(`${MS_AUTH}/devicecode`, { client_id: clientId, scope: 'XboxLive.signin offline_access' }, true)
  onCode({ userCode: dc.user_code, verificationUri: dc.verification_uri, expiresIn: dc.expires_in })

  let interval = dc.interval * 1000
  const deadline = Date.now() + dc.expires_in * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval))
    if (cancelFlag) throw new Error('已取消登录')
    const t = await post<MsToken>(
      `${MS_AUTH}/token`,
      {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: clientId,
        device_code: dc.device_code
      },
      true
    )
    if (t.error === 'authorization_pending') continue
    if (t.error === 'slow_down') {
      interval += 5000
      continue
    }
    if (t.error) throw new Error(`登录失败：${t.error}`)
    return upsert(await minecraftFromMs(t))
  }
  throw new Error('登录超时')
}

/** 启动前获取可用账户，微软账户过期时自动刷新 */
export async function accountForLaunch(id: string): Promise<Account> {
  const acc = load().find((a) => a.id === id) ?? load()[0]
  if (!acc) throw new Error('请先添加一个账户')
  if (acc.type !== 'microsoft' || (acc.expiresAt ?? 0) > Date.now() + 5 * 60_000) return acc
  // 从 PCL-CE 导入的令牌无法用本启动器的 Client ID 刷新
  if (acc.importedFrom === 'pcl') {
    if (!acc.expiresAt) return acc
    throw new Error(`账户 ${acc.name} 的登录已过期（导入自 PCL-CE），请使用微软登录重新添加`)
  }

  const clientId = getConfig().msClientId.trim()
  if (!clientId || !acc.refreshToken) throw new Error('微软账户已过期，请重新登录')
  const t = await post<MsToken>(
    `${MS_AUTH}/token`,
    {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: acc.refreshToken,
      scope: 'XboxLive.signin offline_access'
    },
    true
  )
  if (t.error) throw new Error('微软账户已过期，请重新登录')
  const refreshed = await minecraftFromMs(t, acc.id)
  await upsert(refreshed)
  return refreshed
}
