import { ElectronAPI } from '@electron-toolkit/preload'

interface AppBridgeAPI {
  isFirstLaunch: () => Promise<boolean>
  markLaunched: () => Promise<{ ok: boolean; error?: string }>
  getVersion: () => Promise<string>
  getUsername: () => string
  checkForUpdates: () => Promise<{ ok: boolean; version?: string; error?: string }>
  onUpdateEvent: (callback: (event: AppUpdateEvent) => void) => () => void
}

interface AppUpdateEvent {
  type:
    | 'checking'
    | 'available'
    | 'not-available'
    | 'download-started'
    | 'download-deferred'
    | 'download-progress'
    | 'downloaded'
    | 'error'
  version?: string
  releaseNotes?: unknown
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  message?: string
}

interface ConfigAPI {
  read: () => Promise<Record<string, unknown>>
  save: (data: unknown) => Promise<{ ok: boolean; error?: string }>
}

interface AppRuntimeStatus {
  localService: 'starting' | 'ready' | 'degraded'
  transport: 'disconnected' | 'connecting' | 'connected'
  llmConfigured: boolean
  applyingConfig: boolean
  lastError?: string
}

type LogViewerThreshold = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
type LogViewerFile = 'all' | 'harnessclaw'
type RuntimeLogFile = 'harnessclaw'
type RuntimeLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

interface RuntimeLogEntry {
  cursor: string
  timestamp: number
  isoTime: string
  level: RuntimeLogLevel
  source: string
  message: string
  metaText: string
  file: RuntimeLogFile
  raw: string
}

interface GetLogsOptions {
  after?: string
  level?: LogViewerThreshold
  query?: string
  file?: LogViewerFile
  limit?: number
}

interface GetLogsResult {
  items: RuntimeLogEntry[]
  cursor: string | null
  logDir: string
}

interface AppRuntimeAPI {
  getStatus: () => Promise<AppRuntimeStatus>
  getLogLevel: () => Promise<LogViewerThreshold>
  getLogs: (options?: GetLogsOptions) => Promise<GetLogsResult>
  openLogsDirectory: () => Promise<{ ok: boolean; path: string; error?: string }>
  openDatabaseLocation: (path?: string) => Promise<{ ok: boolean; path: string; error?: string }>
  logRenderer: (level: RuntimeLogLevel, message: string, details?: Record<string, unknown>) => Promise<{ ok: boolean }>
  trackUsage: (entry: {
    category: string
    action: string
    status: string
    details?: Record<string, unknown>
    sessionId?: string
  }) => Promise<{ ok: boolean }>
  exportData: (type: 'logs' | 'chat' | 'config') => Promise<{ ok: boolean; path?: string; error?: string }>
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>
  onStatus: (callback: (status: AppRuntimeStatus) => void) => () => void
}

interface HarnessclawAPI {
  connect: () => Promise<{ ok: boolean }>
  disconnect: () => Promise<{ ok: boolean }>
  send: (content: string, sessionId?: string, options?: { coordinatorMode?: 'react' | 'plan'; planConfirmation?: 'auto' | 'required' }) => Promise<{ ok: boolean; error?: string }>
  command: (cmd: string, sessionId?: string) => Promise<{ ok: boolean }>
  stop: (sessionId?: string) => Promise<{ ok: boolean; error?: string }>
  subscribe: (sessionId: string) => Promise<{ ok: boolean }>
  unsubscribe: (sessionId: string) => Promise<{ ok: boolean }>
  listSessions: () => Promise<{ ok: boolean }>
  probe: () => Promise<{ ok: boolean }>
  respondPermission: (requestId: string, approved: boolean, scope?: 'once' | 'session', message?: string) => Promise<{ ok: boolean; error?: string }>
  respondAskQuestion: (toolUseId: string, status: 'success' | 'cancelled', output?: string, errorMessage?: string) => Promise<{ ok: boolean; error?: string }>
  respondPlan: (planId: string, approved: boolean, sessionId?: string, options?: { steps?: Array<Record<string, unknown>>; reason?: string }) => Promise<{ ok: boolean; error?: string }>
  respondStepDecision: (requestId: string, decision: 'continue' | 'retry' | 'cancel', sessionId?: string, note?: string) => Promise<{ ok: boolean; error?: string }>
  getStatus: () => Promise<{ status: string; clientId: string; sessionId: string; subscriptions: string[] }>
  onStatus: (callback: (status: string) => void) => () => void
  onEvent: (callback: (event: Record<string, unknown>) => void) => () => void
}

interface SkillInfo {
  id: string
  name: string
  description: string
  allowedTools: string
  hasReferences: boolean
  hasTemplates: boolean
  source?: SkillSourceInfo
}

interface SkillSourceInfo {
  key: string
  repoId: string
  repoName: string
  repoUrl: string
  branch: string
  path: string
}

interface SkillRepository {
  id: string
  name: string
  provider: 'github'
  repoUrl: string
  owner: string
  repo: string
  branch: string
  basePath: string
  proxy: SkillRepositoryProxy
  enabled: boolean
  lastDiscoveredAt?: number
  lastError?: string
}

interface SkillRepositoryProxy {
  enabled: boolean
  protocol: 'http' | 'https' | 'socks5'
  host: string
  port: string
}

interface SkillDiscoveryEvent {
  type: 'started' | 'finished' | 'failed'
  taskId: string
  repositoryId?: string
  repositoryCount?: number
  successCount?: number
  errorCount?: number
  skillCount?: number
  error?: string
}

interface DiscoveredSkill {
  key: string
  repoId: string
  repoName: string
  repoUrl: string
  owner: string
  repo: string
  branch: string
  skillPath: string
  directoryName: string
  name: string
  description: string
  allowedTools: string
  hasReferences: boolean
  hasTemplates: boolean
}

interface SkillsAPI {
  list: () => Promise<SkillInfo[]>
  read: (id: string) => Promise<string>
  delete: (id: string) => Promise<{ ok: boolean; error?: string }>
  listRepositories: () => Promise<SkillRepository[]>
  saveRepository: (input: {
    id?: string
    name?: string
    repoUrl: string
    branch?: string
    basePath?: string
    proxy?: Partial<SkillRepositoryProxy>
    enabled?: boolean
  }) => Promise<{ ok: boolean; repo?: SkillRepository; error?: string }>
  removeRepository: (id: string) => Promise<{ ok: boolean; error?: string }>
  discover: (repositoryId?: string) => Promise<{ ok: boolean; started: boolean; taskId?: string; error?: string }>
  listDiscovered: (repositoryId?: string) => Promise<DiscoveredSkill[]>
  previewDiscovered: (repositoryId: string, skillPath: string) => Promise<string>
  installDiscovered: (repositoryId: string, skillPath: string) => Promise<{ ok: boolean; id?: string; error?: string }>
  onDiscoveryEvent: (callback: (event: SkillDiscoveryEvent) => void) => () => void
}

interface DbSessionRow {
  session_id: string
  title: string
  project_id: string | null
  project_context_json: string | null
  created_at: number
  updated_at: number
}

interface DbProjectRow {
  project_id: string
  name: string
  description: string
  created_at: number
  updated_at: number
  deleted_at: number | null
}

interface DbToolActivityRow {
  id: number
  message_id: string
  type: string
  name: string | null
  content: string
  call_id: string | null
  is_error: number
  duration_ms: number | null
  render_hint: string | null
  language: string | null
  file_path: string | null
  metadata_json: string | null
  subagent_json: string | null
  created_at: number
}

interface DbMessageRow {
  id: string
  session_id: string
  role: string
  content: string
  system_notice_json: string | null
  content_segments: string | null
  thinking: string | null
  tools_used: string | null
  usage_prompt: number | null
  usage_completion: number | null
  usage_total: number | null
  created_at: number
  tools: DbToolActivityRow[]
}

interface DbAPI {
  createSession: (sessionId: string, title?: string) => Promise<{ ok: boolean; error?: string }>
  createProjectSession: (input: { sessionId: string; projectId: string; title?: string }) => Promise<{ ok: boolean; error?: string }>
  listSessions: () => Promise<DbSessionRow[]>
  getMessages: (sessionId: string) => Promise<DbMessageRow[]>
  deleteSession: (sessionId: string) => Promise<{ ok: boolean; error?: string }>
  updateSessionTitle: (sessionId: string, title: string) => Promise<{ ok: boolean; error?: string }>
  updateSessionProject: (sessionId: string, projectId: string | null) => Promise<{ ok: boolean; error?: string }>
  listProjects: () => Promise<DbProjectRow[]>
  getProject: (projectId: string) => Promise<DbProjectRow | null>
  createProject: (input: { projectId: string; name: string; description?: string }) => Promise<{ ok: boolean; project?: DbProjectRow; error?: string }>
  deleteProject: (projectId: string) => Promise<{ ok: boolean; deletedSessions?: number; error?: string }>
  listProjectSessions: (projectId: string) => Promise<DbSessionRow[]>
  onSessionsChanged: (callback: () => void) => () => void
}

interface PickedLocalFile {
  name: string
  path: string
  url: string
  size: number
  extension: string
  kind: 'image' | 'video' | 'audio' | 'archive' | 'code' | 'document' | 'data' | 'other'
}

interface FilesAPI {
  pick: () => Promise<PickedLocalFile[]>
  resolve: (paths: string[]) => Promise<PickedLocalFile[]>
  read: (path: string) => Promise<{ ok: boolean; content?: string; path?: string; size?: number; error?: string }>
  save: (options: { defaultFileName?: string; content?: string }) =>
    Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>
}

interface ConsoleAgentDefinition {
  name: string
  display_name?: string
  description?: string
  agent_type?: string
  profile?: string
  system_prompt?: string
  model?: string
  max_turns?: number
  auto_team?: boolean
  tools?: string[]
  allowed_tools?: string[]
  disallowed_tools?: string[]
  skills?: string[]
  sub_agents?: Array<{ name: string; role?: string; agent_type?: string; profile?: string }>
  source?: string
}

interface ConsoleResponse<T = unknown> {
  code: string
  data?: T
  total?: number
  message?: string
}

// Session Metrics API — see harnessclaw-engine/docs/api/session-metrics-api.md.
interface SessionMetricsContextWindow {
  used: number
  limit: number
  history: number
  tool_results: number
  system_prompt: number
}

interface SessionMetricsPerModel {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  thinking_tokens: number
  llm_calls: number
}

interface SessionMetricsSubAgent {
  agent_run_id: string
  agent_id: string
  agent_type: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  thinking_tokens: number
  total_tokens: number
  llm_calls: number
  duration_ms: number
  status: string
}

interface SessionMetricsStats {
  session_id: string
  updated_at: string
  input_tokens: number
  output_tokens: number
  latency_ms_total: number
  latency_ms_avg: number
  cache_read_tokens: number
  cache_write_tokens: number
  cache_hit_rate: number
  thinking_tokens: number
  thinking_share: number
  context_window: SessionMetricsContextWindow
  per_model: SessionMetricsPerModel[]
  subagents: SessionMetricsSubAgent[]
  llm_calls: number
  tool_calls: number
}

type SessionMetricsResult =
  | { ok: true; data: SessionMetricsStats }
  | { ok: false; status: number; error: string; message?: string }

// Model Registry API — see harnessclaw-engine/docs/api/models-registry-api.md.
interface RegistryModelSupports {
  vision?: boolean
  pdf_input?: boolean
  audio_input?: boolean
  audio_output?: boolean
  video_input?: boolean
  streaming?: boolean
  function_calling?: boolean
  parallel_function_calling?: boolean
  tool_choice?: boolean
  computer_use?: boolean
  reasoning?: boolean
  reasoning_can_disable?: boolean
  reasoning_effort_levels?: string[]
  web_search?: boolean
  prompt_caching?: boolean
  explicit_cache_control?: boolean
  [key: string]: unknown
}

interface RegistryModelLimits {
  context_window?: number
  max_input_tokens?: number
  max_output_tokens?: number
  max_reasoning_tokens?: number | null
}

interface RegistryModelDefaults {
  temperature?: number
  top_p?: number
  max_output_tokens_default?: number
  [key: string]: unknown
}

interface RegistryModel {
  id: string
  provider: string
  model_id: string
  display_name?: string
  family?: string
  generation?: string
  knowledge_cutoff?: string
  modalities?: { input?: string[]; output?: string[] }
  supports?: RegistryModelSupports
  limits?: RegistryModelLimits
  defaults?: RegistryModelDefaults
}

type RegistryModelsResult =
  | { ok: true; data: RegistryModel[] }
  | { ok: false; status: number; error: string; message?: string }

type ProviderType = 'openai' | 'anthropic' | 'gemini'

interface ProviderEndpointInfo {
  name: string
  model: string
  max_tokens?: number
  temperature?: number
  enable_thinking?: boolean | null
  // Engine 2026-05-14+: when true the endpoint stays in chain but the
  // dispatcher skips it (no auto-recovery). Used as the canonical
  // enable/disable flag instead of DELETE-then-recreate.
  disabled?: boolean
  in_chain: boolean
}

interface ProviderInfo {
  name: string
  type: ProviderType
  base_url: string
  api_key: string
  // Engine 2026-05-14+: true = whole provider paused, dispatcher
  // skips every endpoint under it regardless of per-endpoint state.
  disabled?: boolean
  endpoints: ProviderEndpointInfo[]
}

interface ProviderChainEntry {
  index: number
  name: string
  provider: string
  endpoint: string
  state: 'healthy' | 'tripped' | 'ready_to_probe'
  // Engine 2026-05-14+: GET /agent entries include this flag.
  // Effective disabled = provider.disabled OR endpoint.disabled.
  // Orthogonal to `state` — dispatcher skips any disabled entry.
  disabled?: boolean
  tripped_until?: string
  cooldown_seconds: number
  consecutive_failures: number
}

// Flat-chain shape the renderer's drag list still uses. The main
// process adapts it on the fly from /api/v1/agent's
// `{primary, fallback_chain}` split.
interface ProviderChain {
  chain: string[]
  entries: ProviderChainEntry[]
}

interface ProviderCreatePayload {
  name: string
  type: ProviderType
  base_url?: string
  api_key?: string
  disabled?: boolean
}

interface ProviderPatchPayload {
  type?: ProviderType
  api_key?: string
  base_url?: string
  disabled?: boolean
}

interface EndpointCreatePayload {
  name: string
  model: string
  max_tokens?: number
  temperature?: number
  enable_thinking?: boolean | null
  disabled?: boolean
}

interface EndpointPatchPayload {
  model?: string
  max_tokens?: number
  temperature?: number
  enable_thinking?: boolean | null
  disabled?: boolean
}

// Engine 2026-05-14+ top-level `agent` block. The full payload of
// GET /api/v1/agent. `entries[]` covers `[primary, ...fallback_chain]`
// in order. Tuning fields apply at agent-scope and are baked into
// adapter defaults on PATCH (see API doc "调用参数生效规则").
interface AgentConfigInfo {
  primary: string
  fallback_chain: string[]
  max_tokens?: number
  // Canonical range [0, 1]; engine rescales per provider type
  // (anthropic ×1, openai/gemini ×2). 0 means "fall back to endpoint
  // self-Temperature in native range".
  temperature?: number
  context_window?: number
  entries: ProviderChainEntry[]
}

// PATCH body. Any subset; omitted = unchanged. `fallback_chain: []`
// explicitly clears the chain (≠ omitted).
interface AgentPatchPayload {
  primary?: string
  fallback_chain?: string[]
  max_tokens?: number
  temperature?: number
  context_window?: number
}

type ProvidersResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; message?: string }

interface AgentApiInterface {
  listAgents: (params?: { agent_type?: string; source?: string; limit?: number; offset?: number }) => Promise<ConsoleResponse<ConsoleAgentDefinition[]>>
  getAgent: (name: string) => Promise<ConsoleResponse<ConsoleAgentDefinition>>
  createAgent: (agent: Record<string, unknown>) => Promise<ConsoleResponse<ConsoleAgentDefinition>>
  updateAgent: (name: string, fields: Record<string, unknown>) => Promise<ConsoleResponse<ConsoleAgentDefinition>>
  deleteAgent: (name: string) => Promise<ConsoleResponse>
  probe: (port?: number) => Promise<{ ok: boolean; error?: string }>
  setPort: (port: number) => Promise<{ ok: boolean; port: number }>
  getPort: () => Promise<{ port: number }>
  getSessionMetrics: (sessionId: string) => Promise<SessionMetricsResult>
  listRegistryModels: () => Promise<RegistryModelsResult>
  listProviders: () => Promise<ProvidersResult<{ providers: ProviderInfo[] }>>
  createProvider: (
    payload: ProviderCreatePayload,
  ) => Promise<ProvidersResult<{ providers: ProviderInfo[] }>>
  getFallbackChain: () => Promise<ProvidersResult<ProviderChain>>
  updateFallbackChain: (chain: string[]) => Promise<ProvidersResult<ProviderChain>>
  getAgentConfig: () => Promise<ProvidersResult<AgentConfigInfo>>
  patchAgentConfig: (
    patch: AgentPatchPayload,
  ) => Promise<ProvidersResult<AgentConfigInfo>>
  patchProvider: (
    name: string,
    patch: ProviderPatchPayload,
  ) => Promise<ProvidersResult<{ providers: ProviderInfo[] }>>
  listEndpoints: (
    providerName: string,
  ) => Promise<ProvidersResult<{ endpoints: ProviderEndpointInfo[] }>>
  createEndpoint: (
    providerName: string,
    payload: EndpointCreatePayload,
  ) => Promise<ProvidersResult<ProviderEndpointInfo>>
  patchEndpoint: (
    providerName: string,
    endpointName: string,
    patch: EndpointPatchPayload,
  ) => Promise<ProvidersResult<ProviderEndpointInfo>>
  deleteEndpoint: (
    providerName: string,
    endpointName: string,
  ) => Promise<ProvidersResult<void>>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: object
    appBridge: AppBridgeAPI
    engineConfig: ConfigAPI
    config: ConfigAPI
    nanobotConfig: ConfigAPI
    appConfig: ConfigAPI
    appRuntime: AppRuntimeAPI
    harnessclaw: HarnessclawAPI
    skills: SkillsAPI
    db: DbAPI
    files: FilesAPI
    agentApi: AgentApiInterface
  }
}
