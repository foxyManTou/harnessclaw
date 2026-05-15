import http from 'node:http'
import { writeAppLog } from './logging'

const DEFAULT_PORT = 8090
const API_PREFIX = '/console/v1'
// Session Metrics API uses a different prefix on the same host:port. See
// harnessclaw-engine/docs/api/session-metrics-api.md — responses are
// **not** wrapped in {code, data}, the body is the raw SessionStats
// object, so it bypasses the `request()` helper below.
const METRICS_PREFIX = '/api/v1/sessions'

let currentPort = DEFAULT_PORT

export function setConsolePort(port: number): void {
  currentPort = port > 0 && port <= 65535 ? port : DEFAULT_PORT
}

export function getConsolePort(): number {
  return currentPort
}

interface ConsoleResponse<T = unknown> {
  code: string
  data?: T
  total?: number
  message?: string
}

interface AgentDefinition {
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

function request<T = unknown>(method: string, path: string, body?: unknown): Promise<ConsoleResponse<T>> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_PREFIX}${path}`, `http://localhost:${currentPort}`)
    const payload = body ? JSON.stringify(body) : undefined

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          Accept: 'application/json',
        },
        timeout: 10000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8')
          if (res.statusCode === 204) {
            resolve({ code: 'OK' })
            return
          }
          try {
            resolve(JSON.parse(raw) as ConsoleResponse<T>)
          } catch {
            reject(new Error(`Invalid JSON response: ${raw.slice(0, 200)}`))
          }
        })
      },
    )

    req.on('error', (err) => reject(err))
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Console API request timeout'))
    })

    if (payload) req.write(payload)
    req.end()
  })
}

export async function probeConsole(port?: number): Promise<{ ok: boolean; error?: string }> {
  const targetPort = port != null && port > 0 ? port : currentPort
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: targetPort,
        path: `${API_PREFIX}/agents?limit=1`,
        method: 'GET',
        headers: { Accept: 'application/json' },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
            resolve({ ok: true })
          } else {
            resolve({ ok: false, error: `HTTP ${res.statusCode}` })
          }
        })
      },
    )
    req.on('error', (err) => resolve({ ok: false, error: err.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, error: '连接超时' })
    })
    req.end()
  })
}

export async function listAgents(params?: {
  agent_type?: string
  source?: string
  limit?: number
  offset?: number
}): Promise<ConsoleResponse<AgentDefinition[]>> {
  const query = new URLSearchParams()
  if (params?.agent_type) query.set('agent_type', params.agent_type)
  if (params?.source) query.set('source', params.source)
  if (params?.limit != null) query.set('limit', String(params.limit))
  if (params?.offset != null) query.set('offset', String(params.offset))
  const qs = query.toString()
  return request<AgentDefinition[]>('GET', `/agents${qs ? `?${qs}` : ''}`)
}

export async function getAgent(name: string): Promise<ConsoleResponse<AgentDefinition>> {
  return request<AgentDefinition>('GET', `/agents/${encodeURIComponent(name)}`)
}

export async function createAgent(agent: Omit<AgentDefinition, 'source'>): Promise<ConsoleResponse<AgentDefinition>> {
  return request<AgentDefinition>('POST', '/agents', agent)
}

export async function updateAgent(name: string, fields: Partial<Omit<AgentDefinition, 'name' | 'source'>>): Promise<ConsoleResponse<AgentDefinition>> {
  return request<AgentDefinition>('PUT', `/agents/${encodeURIComponent(name)}`, fields)
}

export async function deleteAgent(name: string): Promise<ConsoleResponse> {
  return request('DELETE', `/agents/${encodeURIComponent(name)}`)
}

// ─── Model Registry API ─────────────────────────────────────────────────
// See harnessclaw-engine/docs/api/models-registry-api.md.
//
// GET /api/v1/models — list every model known to the engine, with
// provider/family/supports/limits metadata. Responses are wrapped in
// `{ data: [...] }`. Auth: not required (Console port only).

const MODELS_PREFIX = '/api/v1/models'

export interface RegistryModelSupports {
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

export interface RegistryModelLimits {
  context_window?: number
  max_input_tokens?: number
  max_output_tokens?: number
  max_reasoning_tokens?: number | null
}

export interface RegistryModelDefaults {
  temperature?: number
  top_p?: number
  max_output_tokens_default?: number
  [key: string]: unknown
}

export interface RegistryModel {
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

export type RegistryModelsResult =
  | { ok: true; data: RegistryModel[] }
  | { ok: false; status: number; error: string; message?: string }

// ─── Providers Management API ───────────────────────────────────────────
// See harnessclaw-engine/docs/api/providers-management-api.md.
//
// Two-level data model: `providers` (credentials) → `endpoints` (per-model
// bindings). Chain entries use canonical `provider:endpoint` refs
// (2026-05-14+) so endpoint names can contain `.` (e.g. `gpt-5.5`).
// Server still accepts legacy `provider.endpoint` on input for
// back-compat; all yaml / API responses emit `:`.
//
// 2026-05-14 structure rewrite v2: top-level `agent` block replaces
// `llm.fallback_chain`. Routing is now `[primary, ...fallback_chain]`
// (primary always at index 0). `/api/v1/fallback-chain` is gone and
// replaced by `GET|PATCH /api/v1/agent`. Management API is **always**
// mounted regardless of chain length (was previously gated on ≥2).
//
// | Method | Path                                              | Use                  |
// |--------|---------------------------------------------------|----------------------|
// | GET    | /api/v1/providers                                 | list (nested)        |
// | POST   | /api/v1/providers                                 | create provider      |
// | PATCH  | /api/v1/providers/{p}                             | credentials/disabled |
// | GET    | /api/v1/providers/{p}/endpoints                   | list endpoints       |
// | POST   | /api/v1/providers/{p}/endpoints                   | create endpoint      |
// | PATCH  | /api/v1/providers/{p}/endpoints/{e}               | edit endpoint        |
// | DELETE | /api/v1/providers/{p}/endpoints/{e}               | delete endpoint      |
// | GET    | /api/v1/agent                                     | primary + chain      |
// | PATCH  | /api/v1/agent                                     | partial agent update |
//
// All responses wrap data as `{ code, data }`.
const API_V1_PREFIX = '/api/v1'

// Engine `type` enum. See harnessclaw-engine/docs/api/providers-management-api.md
// 2026-05-14 added `gemini`. OpenAI-compatible vendors (DeepSeek, Kimi, GLM,
// MiniMax, 讯飞, 通义) all use `openai` and differ only by `base_url`.
export type ProviderType = 'openai' | 'anthropic' | 'gemini'

export interface ProviderEndpointInfo {
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

export interface ProviderInfo {
  name: string
  type: ProviderType
  base_url: string
  api_key: string
  // Engine 2026-05-14+: true = whole provider paused, dispatcher
  // skips every endpoint under it regardless of per-endpoint state.
  disabled?: boolean
  endpoints: ProviderEndpointInfo[]
}

export interface ProviderChainEntry {
  index: number
  name: string
  provider: string
  endpoint: string
  state: 'healthy' | 'tripped' | 'ready_to_probe'
  // Engine 2026-05-14+: entries returned by GET /agent carry a
  // `disabled` flag (effective = provider.disabled OR endpoint.disabled).
  // Orthogonal to `state` — disabled+any-state means dispatcher skips it.
  disabled?: boolean
  tripped_until?: string
  cooldown_seconds: number
  consecutive_failures: number
}

// Renderer-facing flat chain shape. Kept stable across engine API
// rewrites: when the engine moved from `/fallback-chain` (flat) to
// `/agent` (primary + fallback_chain), `getFallbackChain` /
// `updateFallbackChain` continue to expose a single flat array by
// concatenating `[primary, ...fallback_chain]` so the renderer's
// drag-to-reorder UI doesn't need to know about the primary slot.
export interface ProviderChain {
  chain: string[]
  entries: ProviderChainEntry[]
}

// Engine 2026-05-14+ /api/v1/agent payload. `primary` is the head of
// the effective chain (index 0). `fallback_chain` is everything after.
// `entries[]` covers `[primary, ...fallback_chain]` in order. The
// tuning fields are agent-level defaults (PATCH /agent rebuilds
// adapters to bake them in; see API doc "调用参数生效规则").
export interface AgentConfig {
  primary: string
  fallback_chain: string[]
  max_tokens?: number
  temperature?: number
  context_window?: number
  entries: ProviderChainEntry[]
}

export interface AgentPatch {
  primary?: string
  fallback_chain?: string[]
  max_tokens?: number
  temperature?: number
  context_window?: number
}

// POST /providers — create a brand-new provider entry. The renderer falls
// back to this when the user picks a vendor whose key isn't in the
// engine's `llm.providers.*` map yet (DeepSeek / Kimi / GLM / Google /
// MiniMax / 讯飞 etc.). Constraints (engine side):
//   - `name` non-empty, must NOT contain `:` or `.`
//   - `type` ∈ {openai, anthropic, gemini}
//   - `base_url` / `api_key` optional but recommended (without api_key
//     the provider's endpoints will fail at call time).
export interface ProviderCreatePayload {
  name: string
  type: ProviderType
  base_url?: string
  api_key?: string
  // Optional: create the provider already paused.
  disabled?: boolean
}

// PATCH /providers/{p} — credentials AND/OR `disabled` flag (engine
// 2026-05-14+). When `disabled` flips, dispatcher rebuilds and every
// chain entry under this provider has its effective routing toggled
// in one shot — no adapter rebuild, no chain churn.
export interface ProviderPatch {
  type?: ProviderType
  api_key?: string
  base_url?: string
  disabled?: boolean
}

// POST /providers/{p}/endpoints — create a new endpoint.
export interface EndpointCreatePayload {
  name: string
  model: string
  max_tokens?: number
  temperature?: number
  enable_thinking?: boolean | null
  // Optional: create the endpoint already paused. Defaults to false on
  // the engine side. See engine docs 2026-05-14 entry.
  disabled?: boolean
}

// PATCH /providers/{p}/endpoints/{e} — update endpoint fields.
export interface EndpointPatch {
  model?: string
  max_tokens?: number
  temperature?: number
  enable_thinking?: boolean | null
  // Engine 2026-05-14+: PATCH disabled=true now **auto-removes** the
  // endpoint's entry from the agent fallback_chain (the doc treats
  // disable as the user's explicit "don't route to this" intent).
  // Re-enabling (disabled=false) does NOT auto-restore the chain
  // unless the chain is currently empty, in which case the engine
  // auto-promotes the re-enabled endpoint to primary (2026-05-15).
  // Callers that want it back in the chain at a specific position
  // must PATCH /agent themselves.
  disabled?: boolean
}

export type ProvidersResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; message?: string }

// `void` data for endpoints that return no body (DELETE).
function providersRequest<T>(
  method: 'GET' | 'PUT' | 'PATCH' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ProvidersResult<T>> {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : undefined
    const fullPath = `${API_V1_PREFIX}${path}`
    const url = `http://localhost:${currentPort}${fullPath}`
    // Debug logging — surface the full URL, method, and request body
    // so users can copy-paste the call into curl / Postman for
    // backend debugging. See `app-runtime:openLogsDirectory` to
    // browse the file.
    writeAppLog('info', 'providers.api.request', `${method} ${url}`, {
      method,
      url,
      body: body ?? null,
    })
    const req = http.request(
      {
        hostname: 'localhost',
        port: currentPort,
        path: fullPath,
        method,
        headers: {
          Accept: 'application/json',
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
        timeout: 8000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8')
          const status = res.statusCode || 0
          // DELETE often returns 200 with `{code:"OK"}` and no data.
          if (!raw && (status === 200 || status === 204)) {
            writeAppLog('info', 'providers.api.response', `${method} ${url} → ${status}`, {
              method,
              url,
              status,
              body: null,
            })
            resolve({ ok: true, data: undefined as unknown as T })
            return
          }
          try {
            const parsed = JSON.parse(raw) as { code?: string; data?: T; message?: string }
            if (status >= 200 && status < 300 && parsed.code === 'OK') {
              writeAppLog('info', 'providers.api.response', `${method} ${url} → ${status} OK`, {
                method,
                url,
                status,
                code: parsed.code,
              })
              resolve({ ok: true, data: (parsed.data ?? (undefined as unknown as T)) })
              return
            }
            writeAppLog('warn', 'providers.api.response', `${method} ${url} → ${status} ${parsed.code || ''}`, {
              method,
              url,
              status,
              code: parsed.code,
              message: parsed.message,
              raw: raw.slice(0, 500),
            })
            resolve({
              ok: false,
              status,
              error: parsed.code || `http_${status}`,
              message: parsed.message,
            })
          } catch {
            writeAppLog('warn', 'providers.api.response', `${method} ${url} → ${status} (malformed JSON)`, {
              method,
              url,
              status,
              raw: raw.slice(0, 500),
            })
            resolve({ ok: false, status, error: `http_${status}`, message: raw.slice(0, 200) })
          }
        })
      },
    )
    req.on('error', (err) => {
      writeAppLog('warn', 'providers.api.error', `${method} ${url} network error`, {
        method,
        url,
        error: err.message,
      })
      resolve({ ok: false, status: 0, error: 'network_error', message: err.message })
    })
    req.on('timeout', () => {
      req.destroy()
      writeAppLog('warn', 'providers.api.error', `${method} ${url} timeout`, { method, url })
      resolve({ ok: false, status: 0, error: 'timeout' })
    })
    if (payload) req.write(payload)
    req.end()
  })
}

// Engine 2026-05-14+: GET /providers also returns `config_source`
// (absolute path of the yaml viper actually loaded). Useful for the
// UI to surface "writing back to: …" so the user can verify before
// mutating. Kept optional because older engines omit it.
export function listProviders(): Promise<
  ProvidersResult<{ providers: ProviderInfo[]; config_source?: string }>
> {
  return providersRequest<{ providers: ProviderInfo[]; config_source?: string }>(
    'GET',
    '/providers',
  )
}

export function createProvider(
  payload: ProviderCreatePayload,
): Promise<ProvidersResult<{ providers: ProviderInfo[] }>> {
  return providersRequest<{ providers: ProviderInfo[] }>('POST', '/providers', payload)
}

export function patchProvider(
  name: string,
  patch: ProviderPatch,
): Promise<ProvidersResult<{ providers: ProviderInfo[] }>> {
  return providersRequest<{ providers: ProviderInfo[] }>(
    'PATCH',
    `/providers/${encodeURIComponent(name)}`,
    patch,
  )
}

export function listEndpoints(
  providerName: string,
): Promise<ProvidersResult<{ endpoints: ProviderEndpointInfo[] }>> {
  return providersRequest<{ endpoints: ProviderEndpointInfo[] }>(
    'GET',
    `/providers/${encodeURIComponent(providerName)}/endpoints`,
  )
}

export function createEndpoint(
  providerName: string,
  payload: EndpointCreatePayload,
): Promise<ProvidersResult<ProviderEndpointInfo>> {
  return providersRequest<ProviderEndpointInfo>(
    'POST',
    `/providers/${encodeURIComponent(providerName)}/endpoints`,
    payload,
  )
}

export function patchEndpoint(
  providerName: string,
  endpointName: string,
  patch: EndpointPatch,
): Promise<ProvidersResult<ProviderEndpointInfo>> {
  return providersRequest<ProviderEndpointInfo>(
    'PATCH',
    `/providers/${encodeURIComponent(providerName)}/endpoints/${encodeURIComponent(endpointName)}`,
    patch,
  )
}

export function deleteEndpoint(
  providerName: string,
  endpointName: string,
): Promise<ProvidersResult<void>> {
  return providersRequest<void>(
    'DELETE',
    `/providers/${encodeURIComponent(providerName)}/endpoints/${encodeURIComponent(endpointName)}`,
  )
}

// Engine 2026-05-14+ /api/v1/agent — full agent block. Use when the
// renderer needs primary/fallback split or tuning fields. For the
// drag-to-reorder flat chain UI, prefer the back-compat wrappers
// below. (Named `getAgentConfig` instead of `getAgent` to avoid
// colliding with the Console agents-CRUD `getAgent(name)` at the
// top of this file — these are two unrelated APIs that happen to
// share a noun.)
export function getAgentConfig(): Promise<ProvidersResult<AgentConfig>> {
  return providersRequest<AgentConfig>('GET', '/agent')
}

export function patchAgentConfig(patch: AgentPatch): Promise<ProvidersResult<AgentConfig>> {
  return providersRequest<AgentConfig>('PATCH', '/agent', patch)
}

// Flatten the agent payload into the legacy `{chain, entries}` shape
// the renderer's drag-list still consumes. `entries[]` already covers
// `[primary, ...fallback_chain]` in order, so chain is reconstructable
// without remapping indices. Primary may be empty (degraded mode) —
// in that case the chain is just the fallback (typically also empty).
function flattenAgent(agent: AgentConfig): ProviderChain {
  const fallback = Array.isArray(agent.fallback_chain) ? agent.fallback_chain : []
  const chain = agent.primary ? [agent.primary, ...fallback] : fallback.slice()
  const entries = Array.isArray(agent.entries) ? agent.entries : []
  return { chain, entries }
}

// Back-compat wrapper: the engine no longer has `/fallback-chain`, but
// the renderer's UI still thinks in terms of a flat chain (primary
// implicit at index 0). This adapts GET /agent → flat shape so the
// existing renderer code keeps working.
export async function getFallbackChain(): Promise<ProvidersResult<ProviderChain>> {
  const res = await getAgentConfig()
  if (!res.ok) return res
  return { ok: true, data: flattenAgent(res.data) }
}

// Reverse adapter: split a flat chain into `{primary, fallback_chain}`
// and PATCH /agent. Empty chain → degraded mode (primary='' + empty
// fallback). Per the engine doc, omitting a field means "leave
// unchanged" so we must pass both fields explicitly to fully replace
// the routing.
export async function updateFallbackChain(
  chain: string[],
): Promise<ProvidersResult<ProviderChain>> {
  const primary = chain.length > 0 ? chain[0] : ''
  const fallback = chain.length > 1 ? chain.slice(1) : []
  const res = await patchAgentConfig({ primary, fallback_chain: fallback })
  if (!res.ok) return res
  return { ok: true, data: flattenAgent(res.data) }
}

export function listRegistryModels(): Promise<RegistryModelsResult> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: currentPort,
        path: MODELS_PREFIX,
        method: 'GET',
        headers: { Accept: 'application/json' },
        timeout: 8000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8')
          const status = res.statusCode || 0
          if (status === 200) {
            try {
              const body = JSON.parse(raw) as { data?: RegistryModel[] }
              if (Array.isArray(body?.data)) {
                resolve({ ok: true, data: body.data })
              } else {
                resolve({ ok: false, status, error: 'internal', message: 'missing data field' })
              }
            } catch {
              resolve({ ok: false, status, error: 'internal', message: 'malformed JSON' })
            }
            return
          }
          try {
            const body = JSON.parse(raw) as { error?: string; message?: string }
            resolve({
              ok: false,
              status,
              error: body.error || `http_${status}`,
              message: body.message,
            })
          } catch {
            resolve({ ok: false, status, error: `http_${status}`, message: raw.slice(0, 200) })
          }
        })
      },
    )
    req.on('error', (err) => resolve({ ok: false, status: 0, error: 'network_error', message: err.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, status: 0, error: 'timeout' })
    })
    req.end()
  })
}

export interface SessionMetricsContextWindow {
  used: number
  limit: number
  history: number
  tool_results: number
  system_prompt: number
}

export interface SessionMetricsPerModel {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  thinking_tokens: number
  llm_calls: number
}

export interface SessionMetricsSubAgent {
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

export interface SessionMetricsStats {
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

export type SessionMetricsResult =
  | { ok: true; data: SessionMetricsStats }
  | { ok: false; status: number; error: string; message?: string }

/**
 * GET /api/v1/sessions/{session_id}/metrics on the Console port.
 *
 * Returns `{ ok: true, data }` on 200 OK. Otherwise resolves with
 * `{ ok: false, status, error }` — the API doc enumerates
 * `bad_request` / `session_not_found` / `method_not_allowed` /
 * `internal`. `session_not_found` is the common case for sessions
 * that haven't recorded a single LLM call yet (which means the
 * engine never created a Tracker for them). Callers should treat
 * `session_not_found` as "no data yet", not as a hard error.
 */
export function getSessionMetrics(sessionId: string): Promise<SessionMetricsResult> {
  return new Promise((resolve) => {
    if (!sessionId || sessionId.includes('/')) {
      resolve({ ok: false, status: 400, error: 'bad_request', message: 'invalid session_id' })
      return
    }
    const path = `${METRICS_PREFIX}/${encodeURIComponent(sessionId)}/metrics`
    const req = http.request(
      {
        hostname: 'localhost',
        port: currentPort,
        path,
        method: 'GET',
        headers: { Accept: 'application/json' },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8')
          const status = res.statusCode || 0
          if (status === 200) {
            try {
              const data = JSON.parse(raw) as SessionMetricsStats
              resolve({ ok: true, data })
            } catch {
              resolve({ ok: false, status, error: 'internal', message: 'malformed JSON' })
            }
            return
          }
          try {
            const body = JSON.parse(raw) as { error?: string; message?: string }
            resolve({
              ok: false,
              status,
              error: body.error || `http_${status}`,
              message: body.message,
            })
          } catch {
            resolve({ ok: false, status, error: `http_${status}`, message: raw.slice(0, 200) })
          }
        })
      },
    )
    req.on('error', (err) => resolve({ ok: false, status: 0, error: 'network_error', message: err.message }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, status: 0, error: 'timeout' })
    })
    req.end()
  })
}
