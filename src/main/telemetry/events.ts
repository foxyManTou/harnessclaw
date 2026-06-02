/**
 * Telemetry 事件类型定义
 *
 * 与服务端 POST /api/v1/telemetry/events 接口对齐 (17 个事件白名单)
 */

export interface TelemetryEvent {
  event_id: string
  device_id: string
  client_session_id: string
  timestamp: number
  category: string
  action: string
  app_version: string
  platform: string
  environment: string
  properties: Record<string, unknown>
}

export interface TelemetryEventBatch {
  schema_version: string
  events: TelemetryEvent[]
}

export interface TelemetryEventInput {
  category: string
  action: string
  properties?: Record<string, unknown>
}

/**
 * 17+1 个事件白名单 (供调用方引用,避免拼写错误)
 */
export const EVENT_TYPES = {
  APP_START: { category: 'app_lifecycle', action: 'app_start' },
  APP_EXIT: { category: 'app_lifecycle', action: 'app_exit' },
  SESSION_CREATE: { category: 'session', action: 'session_create' },
  MESSAGE_SENT: { category: 'session', action: 'message_sent' },
  LLM_REQUEST_START: { category: 'llm_call', action: 'llm_request_start' },
  LLM_REQUEST_SUCCESS: { category: 'llm_call', action: 'llm_request_success' },
  LLM_REQUEST_FAILURE: { category: 'llm_call', action: 'llm_request_failure' },
  TOOL_CALL_START: { category: 'tool_execution', action: 'tool_call_start' },
  TOOL_CALL_SUCCESS: { category: 'tool_execution', action: 'tool_call_success' },
  TOOL_CALL_FAILURE: { category: 'tool_execution', action: 'tool_call_failure' },
  PROJECT_CREATED: { category: 'project', action: 'project_created' },
  AGENT_CREATED: { category: 'team', action: 'agent_created' },
  PROVIDER_ENABLED: { category: 'feature_usage', action: 'provider_enabled' },
  MODEL_ADDED: { category: 'feature_usage', action: 'model_added' },
  SETTINGS_CHANGED: { category: 'feature_usage', action: 'settings_changed' },
  UPDATE_CHECKED: { category: 'feature_usage', action: 'update_checked' },
  SEARCH_USED: { category: 'feature_usage', action: 'search_used' },
  MESSAGE_RATED: { category: 'feedback', action: 'message_rated' }
} as const
