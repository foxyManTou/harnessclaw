import { randomUUID, createHmac } from 'crypto'
import { app } from 'electron'
import type { TelemetryConfigManager } from './config'
import type { TelemetryEvent, TelemetryEventBatch, TelemetryEventInput } from './events'

// HMAC 签名密钥 — 与服务端 TELEMETRY_HMAC_SECRET 保持一致
// 注意:客户端代码会随 clone/打包一起交付,secret 会被看到,
// 这里的签名本质是"挡随手乱发的脏数据 + 基本身份校验",不是强加密
const HMAC_SECRET = 'harnessclaw-telemetry-2026-v1-shared-secret'

/**
 * Telemetry 上报器
 *
 * 职责:
 * 1. 检查隐私开关
 * 2. 补全事件字段 (event_id / device_id / timestamp / app_version 等)
 * 3. 异步发送到服务端 (fire-and-forget,失败静默,不重试)
 */
export class TelemetryReporter {
  private appVersion: string
  private platform: string
  private environment: string

  constructor(
    private deviceId: string,
    private clientSessionId: string,
    private configManager: TelemetryConfigManager
  ) {
    this.appVersion = app.getVersion()
    this.platform = process.platform
    this.environment = process.env.NODE_ENV === 'development' ? 'development' : 'production'
  }

  /**
   * 上报单个事件 (异步,不阻塞调用方)
   */
  report(input: TelemetryEventInput): void {
    if (!this.configManager.shouldReport(input.category, input.action)) {
      return
    }
    const event: TelemetryEvent = {
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
    void this.send([event])
  }

  /**
   * 同步上报 (用于 app_exit 等需要等待发送完成的场景)
   */
  async reportSync(input: TelemetryEventInput, timeoutMs = 2000): Promise<void> {
    if (!this.configManager.shouldReport(input.category, input.action)) {
      return
    }
    const event: TelemetryEvent = {
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
    await this.send([event], timeoutMs)
  }

  private async send(events: TelemetryEvent[], timeoutMs = 5000): Promise<void> {
    const config = this.configManager.getConfig()
    const batch: TelemetryEventBatch = { schema_version: '1.0', events }
    const body = JSON.stringify(batch)

    // HMAC-SHA256 签名:对 "{timestamp}.{body}" 算签名,服务端用同样规则验签。
    // timestamp 防重放(服务端可校验时间窗口),body 防篡改。
    const timestamp = Date.now().toString()
    const signature = createHmac('sha256', HMAC_SECRET)
      .update(`${timestamp}.${body}`)
      .digest('hex')

    try {
      const res = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telemetry-Timestamp': timestamp,
          'X-Telemetry-Signature': signature,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!res.ok) {
        console.debug(`[Telemetry] Server returned ${res.status} for ${events[0]?.category}.${events[0]?.action}`)
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
