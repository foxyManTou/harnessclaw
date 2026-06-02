/**
 * 渲染进程埋点辅助函数
 *
 * 通过 window.appRuntime.telemetry.* IPC 上报到主进程
 * 主进程负责字段补全 (event_id / device_id / timestamp 等) 和 HTTP 发送
 */

export interface TelemetryEventInput {
  category: string
  action: string
  properties?: Record<string, unknown>
}

/**
 * 上报埋点事件 (异步,不阻塞调用方,失败静默)
 */
export function trackTelemetry(input: TelemetryEventInput): void {
  try {
    void window.appRuntime.telemetry.track(input)
  } catch (err) {
    // 渲染进程内部错误,静默
    console.debug('[Telemetry] track failed:', err)
  }
}

// ---------------------------------------------------------------------------
// 业务侧便捷函数 (按事件类型封装,确保 properties 结构正确)
// ---------------------------------------------------------------------------

export function trackSessionCreate(): void {
  trackTelemetry({ category: 'session', action: 'session_create' })
}

export function trackMessageSent(properties: {
  message_length: number
  has_attachments: boolean
  coordinator_mode?: string
}): void {
  trackTelemetry({ category: 'session', action: 'message_sent', properties })
}

export function trackProjectCreated(): void {
  trackTelemetry({ category: 'project', action: 'project_created' })
}

export function trackAgentCreated(properties: { agent_type?: string } = {}): void {
  trackTelemetry({ category: 'team', action: 'agent_created', properties })
}

export function trackProviderEnabled(provider_key: string): void {
  trackTelemetry({
    category: 'feature_usage',
    action: 'provider_enabled',
    properties: { provider_key },
  })
}

export function trackModelAdded(provider_key: string): void {
  trackTelemetry({
    category: 'feature_usage',
    action: 'model_added',
    properties: { provider_key },
  })
}

export function trackSettingsChanged(setting_key: string): void {
  trackTelemetry({
    category: 'feature_usage',
    action: 'settings_changed',
    properties: { setting_key },
  })
}

export function trackUpdateChecked(): void {
  trackTelemetry({ category: 'feature_usage', action: 'update_checked' })
}

export function trackSearchUsed(): void {
  trackTelemetry({ category: 'feature_usage', action: 'search_used' })
}

export function trackMessageRated(properties: {
  rating: 'up' | 'down'
  message_id: string
}): void {
  trackTelemetry({ category: 'feedback', action: 'message_rated', properties })
}
