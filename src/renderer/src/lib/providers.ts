// Shared provider config primitives — used by Settings > Models AND
// the first-run WelcomeModal so both write the same shape under
// `appConfig.modelProviders.<key>` and resolve engine `type` the
// same way.

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ProviderModelEntry {
  id: string
  name?: string
  group?: string
  tags?: string[]
  // Whether this model is enabled for the provider. Multi-select: any
  // number of models can be enabled at once. The engine still receives
  // a single "active" model (`ProviderConfig.model`) — typically the
  // first enabled entry — but the renderer keeps the full enabled set
  // so users can pick from a subset.
  enabled?: boolean
  // Per-million-token pricing the user has configured for this model.
  currency?: string
  inputPrice?: number
  outputPrice?: number
}

export interface ProviderConfig {
  apiKey: string
  apiBase: string | null
  model: string | null
  models: ProviderModelEntry[]
  protocol: 'openai' | 'anthropic'
  // Engine-side `type` for `POST/PATCH /providers`. Independent from
  // `protocol` (which is renderer-only and only meaningful for
  // `custom`). Defaults to PROVIDER_ENGINE_TYPES[key]; the user can
  // override per-provider via the API-地址 row dropdown. See engine
  // docs (`type` enum: openai | anthropic | gemini).
  engineType?: 'openai' | 'anthropic' | 'gemini'
  extraHeaders: Record<string, string> | null
  raw: Record<string, unknown>
  enabled?: boolean
}

// Managed provider keys MUST match the `provider` field returned by the
// Model Registry API (see harnessclaw-engine/docs/api/models-registry-api.md
// and internal/provider/registry/default-manifest.yaml).
export type ManagedProviderKey =
  | 'xunfei'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'deepseek'
  | 'zhipu'
  | 'moonshot'
  | 'minimax'
  | 'custom'

export type ProtocolProviderKey = 'anthropic' | 'openai'

// ─── Constants ─────────────────────────────────────────────────────────────

export const MANAGED_PROVIDER_KEYS: ManagedProviderKey[] = [
  'xunfei',
  'anthropic',
  'openai',
  'google',
  'deepseek',
  'zhipu',
  'moonshot',
  'minimax',
  'custom',
]

export const PROVIDER_DISPLAY_NAMES: Record<ManagedProviderKey, string> = {
  xunfei: '科大讯飞 Spark',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  deepseek: 'DeepSeek',
  zhipu: '智谱 GLM',
  moonshot: 'Kimi',
  minimax: 'MiniMax',
  custom: 'Custom',
}

export const PROVIDER_DEFAULT_BASES: Record<ManagedProviderKey, string> = {
  xunfei: 'https://spark-api-open.xf-yun.com/agent/v1',
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  google: 'https://generativelanguage.googleapis.com',
  deepseek: 'https://api.deepseek.com',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  moonshot: 'https://api.moonshot.cn',
  minimax: 'https://api.minimax.chat',
  custom: '',
}

// Engine `type` to send to `POST/PATCH /providers`. See
// harnessclaw-engine/docs/api/providers-management-api.md (`type` enum:
// openai / anthropic / gemini).
//
// OpenAI-compatible vendors (DeepSeek, Kimi=moonshot, GLM=zhipu, MiniMax,
// 讯飞=xunfei) all use `openai` and only differ by `base_url`. Google goes
// to `gemini` — NOT `google`. `custom` is resolved at call time from the
// user-selected protocol (openai | anthropic).
export const PROVIDER_ENGINE_TYPES: Record<
  Exclude<ManagedProviderKey, 'custom'>,
  'openai' | 'anthropic' | 'gemini'
> = {
  xunfei: 'openai',
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'gemini',
  deepseek: 'openai',
  zhipu: 'openai',
  moonshot: 'openai',
  minimax: 'openai',
}

export const ENGINE_TYPE_OPTIONS: ReadonlyArray<'openai' | 'anthropic' | 'gemini'> = [
  'openai',
  'anthropic',
  'gemini',
]

// ─── Helpers ───────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function isManagedProviderKey(value: string): value is ManagedProviderKey {
  return MANAGED_PROVIDER_KEYS.includes(value as ManagedProviderKey)
}

// Resolve the effective engine type for a provider:
//   1. explicit cfg.engineType override (user toggled the badge)
//   2. cfg.protocol when key === 'custom' (the legacy "OpenAI 协议 /
//      Anthropic 协议" selector)
//   3. the PROVIDER_ENGINE_TYPES default for that vendor
//   4. fallback 'openai'
export function getEffectiveEngineType(
  key: ManagedProviderKey,
  cfg: ProviderConfig,
): 'openai' | 'anthropic' | 'gemini' {
  if (cfg.engineType) return cfg.engineType
  if (key === 'custom') return cfg.protocol
  return PROVIDER_ENGINE_TYPES[key] ?? 'openai'
}

export function createEmptyProviderConfig(key: ManagedProviderKey): ProviderConfig {
  return {
    apiKey: '',
    apiBase: PROVIDER_DEFAULT_BASES[key] || null,
    model: null,
    models: [],
    protocol: key === 'anthropic' ? 'anthropic' : 'openai',
    extraHeaders: null,
    raw: {},
  }
}

export function buildAppProviderRaw(next: ProviderConfig): Record<string, unknown> {
  const apiKey = next.apiKey.trim()
  const apiBase = next.apiBase?.trim() || ''
  const model = next.model?.trim() || ''

  return {
    apiKey,
    apiBase,
    model,
    models: next.models,
    protocol: next.protocol,
    ...(next.engineType ? { engineType: next.engineType } : {}),
    extraHeaders: next.extraHeaders ?? null,
    enabled: next.enabled === true,
  }
}

// Determine the engine-level protocol slot a managed provider maps onto.
// - `anthropic` uses the Anthropic Messages protocol.
// - `custom` uses whatever protocol the user toggled.
// - Everyone else (openai, deepseek, zhipu, moonshot, minimax, google) is
//   OpenAI-compatible from the engine's perspective.
export function resolveProviderProtocol(
  key: ManagedProviderKey,
  providers: Record<ManagedProviderKey, ProviderConfig>,
): ProtocolProviderKey {
  if (key === 'anthropic') return 'anthropic'
  if (key === 'custom') return providers.custom.protocol
  return 'openai'
}

export function buildAppModelConfig(
  previous: Record<string, unknown>,
  providers: Record<ManagedProviderKey, ProviderConfig>,
  defaultProvider: ManagedProviderKey,
): Record<string, unknown> {
  const agents = asRecord(previous.agents)
  const defaults = asRecord(agents.defaults)
  const modelProviders = asRecord(previous.modelProviders)
  const resolvedDefaultProvider = resolveProviderProtocol(defaultProvider, providers)
  const activeProvider = providers[defaultProvider]
  const modelId = activeProvider.model?.trim() || ''

  const persistedProviders = MANAGED_PROVIDER_KEYS.reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = buildAppProviderRaw(providers[key])
    return acc
  }, {})

  return {
    ...previous,
    modelProviders: {
      ...modelProviders,
      ...persistedProviders,
      defaultSelection: defaultProvider,
    },
    agents: {
      ...agents,
      defaults: {
        ...defaults,
        provider: resolvedDefaultProvider,
        model: modelId ? `${resolvedDefaultProvider}/${modelId}` : null,
      },
    },
  }
}
