import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import type { TaskProgress } from '@shared/types'

export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}

export class Task {
  private p: TaskProgress
  private last = 0

  constructor(title: string) {
    this.p = { id: randomUUID(), title, stage: '准备中', done: 0, total: 0, state: 'running' }
    this.emit(true)
  }

  stage(stage: string, done = 0, total = 0): void {
    Object.assign(this.p, { stage, done, total })
    this.emit(true)
  }

  progress(done: number, total: number): void {
    Object.assign(this.p, { done, total })
    this.emit(done === total)
  }

  success(stage = '完成'): void {
    Object.assign(this.p, { stage, state: 'success' })
    this.emit(true)
  }

  fail(err: unknown): void {
    Object.assign(this.p, { state: 'error', error: err instanceof Error ? err.message : String(err) })
    this.emit(true)
  }

  /** 节流，避免高频 IPC */
  private emit(force: boolean): void {
    const now = Date.now()
    if (!force && now - this.last < 100) return
    this.last = now
    broadcast('task', { ...this.p })
  }
}

/** 包装一个任务，自动处理成功/失败状态 */
export async function runTask<T>(title: string, fn: (t: Task) => Promise<T>): Promise<T> {
  const task = new Task(title)
  try {
    const r = await fn(task)
    task.success()
    return r
  } catch (e) {
    task.fail(e)
    throw e
  }
}
