import { app } from 'electron'
import { getApiKey, setApiKey } from './device'

interface RegisterResponse {
  api_key: string
  device_id: string
}

/**
 * 向服务端注册设备并获取 API Key
 *
 * @param baseUrl 服务端基础 URL（不含 /api/v1/telemetry/events 路径）
 * @param deviceId 设备唯一标识
 * @param harnessclawDir harnessclaw 配置目录
 * @returns API Key，失败返回 null
 */
export async function ensureApiKey(
  baseUrl: string,
  deviceId: string,
  harnessclawDir: string
): Promise<string | null> {
  // 检查是否已有 API Key
  const cached = getApiKey(harnessclawDir)
  if (cached) {
    return cached
  }

  const platform = process.platform
  const appVersion = app.getVersion()

  try {
    const res = await fetch(`${baseUrl}/api/v1/telemetry/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: deviceId,
        app_version: appVersion,
        platform
      }),
      signal: AbortSignal.timeout(10000)
    })

    if (!res.ok) {
      console.error(`[Telemetry] Registration failed: ${res.status}`)
      return null
    }

    const data: RegisterResponse = await res.json()
    setApiKey(harnessclawDir, data.api_key)
    console.info(`[Telemetry] Device registered successfully: ${deviceId}`)
    return data.api_key
  } catch (err) {
    console.error('[Telemetry] Registration error:', err)
    return null
  }
}
