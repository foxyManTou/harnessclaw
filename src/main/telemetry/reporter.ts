import { randomUUID } from 'crypto'
import { app } from 'electron'
import { getApiKey, clearApiKey } from './device'
import { ensureApiKey } from './register'
import type { TelemetryConfigManager } from './config'
import type { TelemetryEvent, TelemetryEventBatch, TelemetryEventInput } from './events'

/**
 * Telemetry 上报器
 *
 * 职责:
 * 1. 检查隐私开关
 * 2. 补全事件字段 (event_id / device_id / timestamp / app_version 等)
 * 3. 异步发送到服务端 (fire-and-forget,失败静默,不重试)
 * 4. 管理 API Key (首次启动注册,失效后重新注册)
 */
export class TelemetryReporter {
  private appVersion: string
  private platform: string
  private environment: string
  private apiKey: string | null = null
  private apiKeyPromise: Promise<string | null> | null = null

  constructor(
    private deviceId: string,
    private clientSessionId: string,
    private configManager: TelemetryConfigManager,
    private harnessclawDir: string
  ) {
    this.appVersion = app.getVersion()
    this.platform = process.platform
    this.environment = process.env.NODE_ENV === 'development' ? 'development' : 'production'
    this.apiKey = getApiKey(this.harnessclawDir)
  }

  /**
   * 从 endpoint 中提取 baseUrl (去掉 /api/v1/telemetry/events 路径)
   */
  private getBaseUrl(): string {
    const endpoint = this.configManager.getConfig().endpoint
    return endpoint.replace(/\/api\/v1\/telemetry\/events\/?$/, '')
  }

  /**
   * 确保 API Key 可用 (首次启动或被吊销后重新注册)
   * 并发请求复用同一个 Promise，避免重复注册
   */
  private async ensureKey(): Promise<string | null> {
    if (this.apiKey) return this.apiKey
    if (this.apiKeyPromise) return this.apiKeyPromise

    this.apiKeyPromise = ensureApiKey(this.getBaseUrl(), this.deviceId, this.harnessclawDir)
      .then((key) => {
        this.apiKey = key
        this.apiKeyPromise = null
        return key
      })
      .catch(() => {
        this.apiKeyPromise = null
        return null
      })

    return this.apiKeyPromise
  }

  /**
   * 上报单个事件 (异步,不阻塞调用方)
   */
  report(input: TelemetryEventInput): void {
    if (!this.configManager.shouldReport(input.category, input.action)) {
      return
    }
    const event = this.buildEvent(input)
    void this.send([event])
  }

  /**
   * 同步上报 (用于 app_exit 等需要等待发送完成的场景)
   */
  async reportSync(input: TelemetryEventInput, timeoutMs = 2000): Promise<void> {
    if (!this.configManager.shouldReport(input.category, input.action)) {
      return
    }
    const event = this.buildEvent(input)
    await this.send([event], timeoutMs)
  }

  /**
   * 构建事件对象
   */
  private buildEvent(input: TelemetryEventInput): TelemetryEvent {
    return {
      event_id: randomUUID(),
      device_id: this.deviceId,
      client_session_id: this.clientSessionId,
      timestamp: Date.now(),
      category: input.category,
      action: input.action,
      app_version: this.appVersion,
      platform: this.platform,
      environment: this.environment,
      properties: input.properties || {}
    }
  }

  private async send(events: TelemetryEvent[], timeoutMs = 5000): Promise<void> {
    // 确保 API Key 可用
    const apiKey = await this.ensureKey()
    if (!apiKey) {
      console.debug('[Telemetry] No API Key available, skipping send')
      return
    }

    const config = this.configManager.getConfig()
    const batch: TelemetryEventBatch = { schema_version: '1.0', events }
    const body = JSON.stringify(batch)

    try {
      const res = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body,
        signal: AbortSignal.timeout(timeoutMs)
      })

      // API Key 失效或被吊销：清除本地缓存 (下次自动重新注册)
      if (res.status === 401 || res.status === 403) {
        console.warn('[Telemetry] API Key invalid, clearing cache')
        clearApiKey(this.harnessclawDir)
        this.apiKey = null
      }

      if (!res.ok) {
        console.debug(
          `[Telemetry] Server returned ${res.status} for ${events[0]?.category}.${events[0]?.action}`
        )
      }
    } catch (err) {
      // 静默失败 — 埋点不能影响主流程
      if (err instanceof Error) {
        console.debug(`[Telemetry] Send failed (silent): ${err.message}`)
      }
    }
  }

  getDeviceId(): string {
    return this.deviceId
  }

  getClientSessionId(): string {
    return this.clientSessionId
  }
}
