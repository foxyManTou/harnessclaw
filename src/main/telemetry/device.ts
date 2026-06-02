import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

/**
 * 获取或创建设备唯一标识符 (device_id)
 *
 * - 格式: anon-{uuid}
 * - 持久化到 ~/.harnessclaw/device_id
 * - 卸载重装会生成新 device_id (合规优先,不读硬件指纹)
 */
export function getOrCreateDeviceId(harnessclawDir: string): string {
  const deviceIdPath = path.join(harnessclawDir, 'device_id')

  if (fs.existsSync(deviceIdPath)) {
    try {
      const existing = fs.readFileSync(deviceIdPath, 'utf-8').trim()
      if (existing && existing.startsWith('anon-')) {
        return existing
      }
    } catch (err) {
      console.warn('[Telemetry] Failed to read device_id, regenerating:', err)
    }
  }

  const deviceId = `anon-${randomUUID()}`
  try {
    fs.writeFileSync(deviceIdPath, deviceId, 'utf-8')
  } catch (err) {
    console.error('[Telemetry] Failed to persist device_id:', err)
  }
  return deviceId
}

/**
 * 生成客户端会话 ID (每次启动一个,串联同次启动期间的事件)
 */
export function generateClientSessionId(): string {
  return `session-${randomUUID()}`
}
