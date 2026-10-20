import { execFile } from 'node:child_process'
import { createDecipheriv, createHash, hkdfSync } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

/**
 * 解密 PCL-CE 加密保存的配置（账户档案等）。
 * 参考 PCL.Core/Utils/Secret/EncryptHelper.cs 与 PlainToolkit.CngProtectedData。
 *
 * 结构：
 *   UserKey.bin = EncryptionData(version 1: CAPI DPAPI | version 2: CNG DPAPI)，解出 32 字节用户密钥
 *   加密值     = base64(EncryptionData(version 0: ChaCha20 | 1: ChaCha20-Poly1305 | 2: AES-GCM))
 */

const ENTROPY = Buffer.from('PCL CE Encryption Key', 'utf8')
const DATA_MAGIC = 0x454e4321 // "ENC!"，大端
const CPD_MAGIC = 0x5f445043 // "CPD_"，小端（结构体直接写入内存）

interface EncryptionData {
  version: number
  data: Buffer
}

function parseEncryptionData(buf: Buffer): EncryptionData | null {
  if (buf.length < 12 || buf.readUInt32BE(0) !== DATA_MAGIC) return null
  const len = buf.readInt32BE(8)
  if (len < 0 || len > buf.length - 12) throw new Error('加密数据长度无效')
  return { version: buf.readUInt32BE(4), data: buf.subarray(12, 12 + len) }
}

// ---------- 系统 DPAPI（仅 Windows），通过 PowerShell 调用 ----------

const NCRYPT_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PwNcrypt {
  [DllImport("ncrypt.dll")]
  public static extern int NCryptUnprotectSecret(out IntPtr desc, uint flags, byte[] blob, uint cb,
    IntPtr memPara, IntPtr hwnd, out IntPtr data, out uint cbData);
  [DllImport("ncrypt.dll")] public static extern int NCryptCloseProtectionDescriptor(IntPtr desc);
  [DllImport("kernel32.dll")] public static extern IntPtr LocalFree(IntPtr mem);
  public static string Unprotect(string b64) {
    byte[] blob = Convert.FromBase64String(b64);
    IntPtr desc, data; uint cb;
    int hr = NCryptUnprotectSecret(out desc, 0, blob, (uint)blob.Length, IntPtr.Zero, IntPtr.Zero, out data, out cb);
    if (hr != 0) throw new Exception("NCryptUnprotectSecret 0x" + hr.ToString("X"));
    try { byte[] o = new byte[cb]; Marshal.Copy(data, o, 0, (int)cb); return Convert.ToBase64String(o); }
    finally { LocalFree(data); if (desc != IntPtr.Zero) NCryptCloseProtectionDescriptor(desc); }
  }
}
"@
[Console]::Out.Write([PwNcrypt]::Unprotect($env:PW_BLOB))
`

const CAPI_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$o = [System.Security.Cryptography.ProtectedData]::Unprotect(
  [Convert]::FromBase64String($env:PW_BLOB),
  [Convert]::FromBase64String($env:PW_ENTROPY),
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($o))
`

function powershell(script: string, env: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, ...env }, windowsHide: true, timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr.trim() || err.message))
        resolve(Buffer.from(stdout.trim(), 'base64'))
      }
    )
  })
}

/** PlainToolkit.CngProtectedData 的解包：[header 8][nonce 12][ciphertext][tag 16]，熵通过 AES-GCM 模拟 */
function cpdUnpack(packed: Buffer): Buffer {
  if (packed.length < 8 || packed.readUInt32LE(0) !== CPD_MAGIC) throw new Error('无法识别的 CNG 保护数据')
  const hasEntropy = (packed[5] & 1) !== 0
  if (!hasEntropy) return packed.subarray(8)
  const key = createHash('sha256').update(ENTROPY).digest()
  const nonce = packed.subarray(8, 20)
  const tag = packed.subarray(packed.length - 16)
  const cipher = packed.subarray(20, packed.length - 16)
  const d = createDecipheriv('aes-256-gcm', key, nonce)
  d.setAAD(packed.subarray(0, 8))
  d.setAuthTag(tag)
  return Buffer.concat([d.update(cipher), d.final()])
}

/** 读取并解开 %APPDATA%\PCLCE\UserKey.bin */
export async function loadUserKey(keyFile: string): Promise<Buffer> {
  if (process.platform !== 'win32') throw new Error('PCL-CE 的账户密钥只能在 Windows 上解开')
  if (!existsSync(keyFile)) throw new Error('找不到 PCL-CE 用户密钥 UserKey.bin')
  const ed = parseEncryptionData(readFileSync(keyFile))
  if (!ed) throw new Error('UserKey.bin 格式无法识别')
  if (ed.version === 2) {
    return cpdUnpack(await powershell(NCRYPT_PS, { PW_BLOB: ed.data.toString('base64') }))
  }
  if (ed.version === 1) {
    return powershell(CAPI_PS, {
      PW_BLOB: ed.data.toString('base64'),
      PW_ENTROPY: ENTROPY.toString('base64')
    })
  }
  throw new Error(`不支持的 UserKey 版本 ${ed.version}`)
}

/** 对应 EncryptHelper.SecretDecrypt */
export function secretDecrypt(value: string, key: Buffer): string {
  if (!value) return ''
  const ed = parseEncryptionData(Buffer.from(value, 'base64'))
  // 非常老的 PCL 使用与硬件绑定的 AES-CBC 密钥，这里不支持
  if (!ed) throw new Error('旧版加密格式，不支持导入')
  const { data } = ed
  let plain: Buffer
  switch (ed.version) {
    case 2: {
      // [nonce 12][tag 16][ciphertext]
      const d = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12))
      d.setAuthTag(data.subarray(12, 28))
      plain = Buffer.concat([d.update(data.subarray(28)), d.final()])
      break
    }
    case 1: {
      // [salt 16][nonce 12][tag 16][ciphertext]，密钥经 HKDF-SHA256 派生
      const salt = data.subarray(0, 16)
      const derived = Buffer.from(hkdfSync('sha256', key, salt, 'PCL.Core.Utils.Encryption.ChaCha20', 32))
      const d = createDecipheriv('chacha20-poly1305', derived, data.subarray(16, 28), { authTagLength: 16 })
      d.setAuthTag(data.subarray(28, 44))
      plain = Buffer.concat([d.update(data.subarray(44)), d.final()])
      break
    }
    case 0: {
      // [nonce 12][ciphertext]，纯 ChaCha20，计数器从 0 开始
      const iv = Buffer.concat([Buffer.alloc(4), data.subarray(0, 12)])
      const d = createDecipheriv('chacha20', key, iv)
      plain = Buffer.concat([d.update(data.subarray(12)), d.final()])
      break
    }
    default:
      throw new Error(`不支持的加密版本 ${ed.version}`)
  }
  return plain.toString('utf8')
}
