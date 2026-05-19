import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Check, ChevronLeft, ChevronRight, Languages, Loader2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  MANAGED_PROVIDER_KEYS,
  PROVIDER_DEFAULT_BASES,
  PROVIDER_DISPLAY_NAMES,
  buildAppModelConfig,
  createEmptyProviderConfig,
  getEffectiveEngineType,
  type ManagedProviderKey,
  type ProtocolProviderKey,
  type ProviderConfig,
} from '@/lib/providers'
import emmaAvatar from '../assets/sidebar-logo.png'

type ProfileKey = 'A' | 'B' | 'C'
type StartupOverlayState = 'checking' | 'setup' | 'hidden'
type StageKey = 'emma' | 'engine' | 'connection' | 'profile'

interface SetupDraft {
  engineMode: ManagedProviderKey | null
  apiBase: string
  apiKey: string
  modelId: string
  // Only meaningful when engineMode === 'custom' (mirrors Settings'
  // protocol toggle inside the custom-provider editor).
  protocol: ProtocolProviderKey
  profile: ProfileKey | null
}

type ConfigRecord = Record<string, unknown>

const WORKSPACE_ROOT = '~/.harnessclaw/workspace'
const FIRST_RUN_DONE_STORAGE_KEY = 'harnessclaw-first-run-complete'

const emmaPrompts = (t: any): Array<{ category: string; prompt: string }> => [
  // 研发
  { category: t('welcome.prompts.categories.dev'), prompt: t('welcome.prompts.items.dev1') },
  { category: t('welcome.prompts.categories.dev'), prompt: t('welcome.prompts.items.dev2') },
  { category: t('welcome.prompts.categories.dev'), prompt: t('welcome.prompts.items.dev3') },
  { category: t('welcome.prompts.categories.dev'), prompt: t('welcome.prompts.items.dev4') },
  // 研究
  { category: t('welcome.prompts.categories.research'), prompt: t('welcome.prompts.items.res1') },
  { category: t('welcome.prompts.categories.research'), prompt: t('welcome.prompts.items.res2') },
  { category: t('welcome.prompts.categories.research'), prompt: t('welcome.prompts.items.res3') },
  { category: t('welcome.prompts.categories.research'), prompt: t('welcome.prompts.items.res4') },
  // 写作
  { category: t('welcome.prompts.categories.writing'), prompt: t('welcome.prompts.items.wri1') },
  { category: t('welcome.prompts.categories.writing'), prompt: t('welcome.prompts.items.wri2') },
  { category: t('welcome.prompts.categories.writing'), prompt: t('welcome.prompts.items.wri3') },
  { category: t('welcome.prompts.categories.writing'), prompt: t('welcome.prompts.items.wri4') },
  // 数据
  { category: t('welcome.prompts.categories.data'), prompt: t('welcome.prompts.items.dat1') },
  { category: t('welcome.prompts.categories.data'), prompt: t('welcome.prompts.items.dat2') },
  { category: t('welcome.prompts.categories.data'), prompt: t('welcome.prompts.items.dat3') },
  { category: t('welcome.prompts.categories.data'), prompt: t('welcome.prompts.items.dat4') },
  // 生活
  { category: t('welcome.prompts.categories.life'), prompt: t('welcome.prompts.items.lif1') },
  { category: t('welcome.prompts.categories.life'), prompt: t('welcome.prompts.items.lif2') },
  { category: t('welcome.prompts.categories.life'), prompt: t('welcome.prompts.items.lif3') },
  { category: t('welcome.prompts.categories.life'), prompt: t('welcome.prompts.items.lif4') },
  // 日常
  { category: t('welcome.prompts.categories.daily'), prompt: t('welcome.prompts.items.dai1') },
  { category: t('welcome.prompts.categories.daily'), prompt: t('welcome.prompts.items.dai2') },
  { category: t('welcome.prompts.categories.daily'), prompt: t('welcome.prompts.items.dai3') },
  { category: t('welcome.prompts.categories.daily'), prompt: t('welcome.prompts.items.dai4') },
]

function asRecord(value: unknown): ConfigRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ConfigRecord)
    : {}
}

function getDefaultApiBase(key: ManagedProviderKey | null): string {
  if (!key) return ''
  return PROVIDER_DEFAULT_BASES[key] || ''
}

function getProfilePreset(profile: ProfileKey | null): {
  workspace: string
  maxToolIterations: number
  reasoningEffort: 'medium' | 'high'
} {
  if (profile === 'A') {
    return { workspace: `${WORKSPACE_ROOT}/engineering`, maxToolIterations: 60, reasoningEffort: 'high' }
  }
  if (profile === 'B') {
    return { workspace: `${WORKSPACE_ROOT}/research`, maxToolIterations: 36, reasoningEffort: 'medium' }
  }
  return { workspace: `${WORKSPACE_ROOT}/operations`, maxToolIterations: 24, reasoningEffort: 'medium' }
}

// Build a complete providers map seeded with empty configs, then
// stamp the user's chosen provider with the welcome-flow inputs. The
// shape matches what `Settings > Models` persists, so the entry
// surfaces in Settings immediately after onboarding.
function buildWelcomeProviders(
  draft: SetupDraft,
): Record<ManagedProviderKey, ProviderConfig> {
  const providers = MANAGED_PROVIDER_KEYS.reduce((acc, key) => {
    acc[key] = createEmptyProviderConfig(key)
    return acc
  }, {} as Record<ManagedProviderKey, ProviderConfig>)

  const key = draft.engineMode
  if (!key) return providers

  const apiBase = draft.apiBase.trim() || getDefaultApiBase(key)
  const apiKey = draft.apiKey.trim()
  const modelId = draft.modelId.trim()

  providers[key] = {
    ...providers[key],
    apiKey,
    apiBase: apiBase || providers[key].apiBase,
    model: modelId || null,
    protocol: key === 'anthropic' ? 'anthropic' : key === 'custom' ? draft.protocol : 'openai',
    enabled: true,
  }
  return providers
}

// YAML keywords that would force the serializer to quote a plain
// string key (YAML 1.1 booleans + null tokens). Numeric / hex / inf /
// nan are caught by the regex below.
const YAML_RESERVED_KEYWORDS = new Set([
  'true', 'false', 'yes', 'no', 'on', 'off', 'y', 'n', 'null', '~',
])

// Build a YAML-safe endpoint identifier. The engine round-trips
// endpoint names through YAML; any name that parses as a number,
// boolean, null, or contains special chars will be wrapped in quotes
// (e.g. `"1":`). To keep the engine yaml visually clean — and to
// match the unquoted style of providers configured via Settings >
// Models (e.g. `xopglm51:`) — we prepend the provider key when the
// raw modelId would trigger quoting. Plain identifier-shaped model
// names pass through unchanged.
//
// We deliberately do NOT validate or reject numeric inputs in the
// UI; user-typed model ids stay verbatim in the `model` field. Only
// the endpoint *key* (which is renderer-controlled) gets normalized.
function safeEndpointName(key: ManagedProviderKey, modelId: string): string {
  const ok = /^[A-Za-z_][A-Za-z0-9_.\-]*$/.test(modelId)
    && !YAML_RESERVED_KEYWORDS.has(modelId.toLowerCase())
  return ok ? modelId : `${key}-${modelId}`
}

// Best-effort engine-side provider + endpoint registration.
//
// Mirrors the `schedulePatchProviderCredentials` / `ensureProviderExists`
// / `hotCreateEndpoint` flow in SettingsPage:
//   1. PATCH /providers/{key} (api_key/base_url). On 404/update_failed,
//      fall back to POST /providers to create it.
//   2. POST /providers/{key}/endpoints with `{name=<yaml-safe>, model=
//      modelId, disabled:false}`. On "already exists" 400, PATCH
//      disabled=false to make sure the endpoint isn't paused.
//   3. PUT /agent — append `${key}:${endpointName}` to the fallback
//      chain so the dispatcher actually routes to the new endpoint.
//
// We swallow 404 (API not mounted because chain<2 entries) and status 0
// (network) silently — the engine picks the values up from app-config
// on next start.
async function registerEngineProvider(
  key: ManagedProviderKey,
  cfg: ProviderConfig,
): Promise<void> {
  const baseUrl = cfg.apiBase?.trim() || PROVIDER_DEFAULT_BASES[key] || ''
  const apiKey = cfg.apiKey.trim()
  const modelId = cfg.model?.trim() || ''
  if (!apiKey && !baseUrl) return

  try {
    // ── 1. Ensure provider exists on the engine ────────────────────
    let providerReady = false
    const patchRes = await window.agentApi.patchProvider(key, {
      api_key: apiKey,
      base_url: baseUrl,
    })
    if (patchRes.ok) {
      providerReady = true
    } else if (patchRes.status === 404 || patchRes.status === 0) {
      return
    } else {
      const engineType = getEffectiveEngineType(key, cfg)
      const createRes = await window.agentApi.createProvider({
        name: key,
        type: engineType,
        ...(baseUrl ? { base_url: baseUrl } : {}),
        ...(apiKey ? { api_key: apiKey } : {}),
      })
      if (createRes.ok) {
        providerReady = true
      } else if (createRes.status === 404 || createRes.status === 0) {
        return
      } else if (createRes.status === 400 && /exist/i.test(createRes.message || '')) {
        // "already exists" race — retry PATCH and treat as ready.
        await window.agentApi.patchProvider(key, {
          api_key: apiKey,
          base_url: baseUrl,
        })
        providerReady = true
      }
    }
    if (!providerReady || !modelId) return

    // ── 2. Register the model as an endpoint under that provider ───
    // Endpoint NAME is the YAML-safe identifier; MODEL is the raw
    // user input. They're identical for well-shaped ids (matching
    // SettingsPage's `xopglm51` pattern) and differ only when the
    // user-typed model is YAML-ambiguous (e.g. pure digits).
    const endpointName = safeEndpointName(key, modelId)
    const epRes = await window.agentApi.createEndpoint(key, {
      name: endpointName,
      model: modelId,
      disabled: false,
    })
    let endpointReady = epRes.ok
    if (!epRes.ok) {
      if (epRes.status === 404 || epRes.status === 0) return
      // Probably "already exists" — verify via GET, then unpause it.
      const list = await window.agentApi.listEndpoints(key)
      if (list.ok && list.data.endpoints.some((e) => e.name === endpointName)) {
        endpointReady = true
        await window.agentApi.patchEndpoint(key, endpointName, { disabled: false })
      } else {
        return
      }
    }
    if (!endpointReady) return

    // ── 3. Append to fallback chain so the dispatcher routes here ──
    const chain = await window.agentApi.getFallbackChain()
    if (!chain.ok) return
    const chainRef = `${key}:${endpointName}`
    const legacyRef = `${key}.${endpointName}`
    if (chain.data.chain.includes(chainRef) || chain.data.chain.includes(legacyRef)) return
    await window.agentApi.updateFallbackChain([...chain.data.chain, chainRef])
  } catch {
    // Best-effort — swallow.
  }
}

function buildAppConfig(previous: ConfigRecord, draft: SetupDraft): ConfigRecord {
  if (!draft.engineMode) return previous
  const providers = buildWelcomeProviders(draft)
  const base = buildAppModelConfig(previous, providers, draft.engineMode)

  // buildAppModelConfig already filled modelProviders + agents.defaults
  // (provider + model). Layer onboarding metadata + profile preset on
  // top so the wizard's choices stick.
  const baseAgents = asRecord(base.agents)
  const baseDefaults = asRecord(baseAgents.defaults)
  const onboarding = asRecord(previous.onboarding)
  const profilePreset = getProfilePreset(draft.profile)

  return {
    ...base,
    agents: {
      ...baseAgents,
      defaults: {
        ...baseDefaults,
        workspace: profilePreset.workspace,
        maxToolIterations: profilePreset.maxToolIterations,
        reasoningEffort: profilePreset.reasoningEffort,
      },
    },
    onboarding: {
      ...onboarding,
      version: 1,
      completedAt: new Date().toISOString(),
      engineMode: draft.engineMode,
      profile: draft.profile,
    },
  }
}

export function WelcomeModal() {
  const { t, i18n } = useTranslation()

  const toggleLanguage = async () => {
    const next = i18n.language.startsWith('zh') ? 'en' : 'zh'
    await i18n.changeLanguage(next)
    try {
      const cfg = await window.appConfig.read()
      const ui = asRecord((cfg as ConfigRecord | undefined)?.ui)
      await window.appConfig.save({ ...(cfg as ConfigRecord), ui: { ...ui, language: next } })
    } catch {
      // ignore — language change still takes effect for the current session
    }
  }

  // Full managed provider list — mirrors `Settings > Models` so the
  // welcome flow can configure any vendor the user normally would.
  // Detail strings live under `welcome.engineOptions.<key>Detail` in
  // both locale files.
  const ENGINE_DETAIL_KEYS: Record<ManagedProviderKey, string> = useMemo(() => ({
    xunfei: 'welcome.engineOptions.xunfeiDetail',
    anthropic: 'welcome.engineOptions.anthropicDetail',
    openai: 'welcome.engineOptions.openaiDetail',
    google: 'welcome.engineOptions.googleDetail',
    deepseek: 'welcome.engineOptions.deepseekDetail',
    zhipu: 'welcome.engineOptions.zhipuDetail',
    moonshot: 'welcome.engineOptions.moonshotDetail',
    minimax: 'welcome.engineOptions.minimaxDetail',
    custom: 'welcome.engineOptions.customDetail',
  }), [])

  const engineOptions: Array<{
    key: ManagedProviderKey
    title: string
    detail: string
  }> = useMemo(() => MANAGED_PROVIDER_KEYS.map((key) => ({
    key,
    title: PROVIDER_DISPLAY_NAMES[key],
    detail: t(ENGINE_DETAIL_KEYS[key]),
  })), [t, ENGINE_DETAIL_KEYS])

  const profileOptions: Array<{
    key: ProfileKey
    title: string
    detail: string
  }> = useMemo(() => [
    {
      key: 'A',
      title: t('welcome.profileOptions.devTitle'),
      detail: t('welcome.profileOptions.devDetail'),
    },
    {
      key: 'B',
      title: t('welcome.profileOptions.researchTitle'),
      detail: t('welcome.profileOptions.researchDetail'),
    },
    {
      key: 'C',
      title: t('welcome.profileOptions.opsTitle'),
      detail: t('welcome.profileOptions.opsDetail'),
    },
  ], [t])

  const stages: Array<{ key: StageKey; title: string; subtitle: string }> = useMemo(() => [
    { key: 'emma', title: t('welcome.stages.emma'), subtitle: t('welcome.stages.emmaSubtitle') },
    { key: 'engine', title: t('welcome.stages.engine'), subtitle: t('welcome.stages.engineSubtitle') },
    { key: 'connection', title: t('welcome.stages.connection'), subtitle: '' },
    { key: 'profile', title: t('welcome.stages.profile'), subtitle: '' },
  ], [t])

  const [overlayState, setOverlayState] = useState<StartupOverlayState>(() => {
    if (typeof window === 'undefined') return 'checking'
    return window.localStorage.getItem(FIRST_RUN_DONE_STORAGE_KEY) === 'true' ? 'hidden' : 'checking'
  })
  const [stageIndex, setStageIndex] = useState(0)
  const [draft, setDraft] = useState<SetupDraft>({
    engineMode: null,
    apiBase: '',
    apiKey: '',
    modelId: '',
    protocol: 'openai',
    profile: null,
  })
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [username] = useState<string>(() => {
    try {
      return window.appBridge?.getUsername?.() || ''
    } catch {
      return ''
    }
  })

  useEffect(() => {
    let cancelled = false

    const runStartupGate = async () => {
      const isFirst = await window.appBridge.isFirstLaunch()
      if (cancelled) return

      if (isFirst) {
        window.localStorage.removeItem(FIRST_RUN_DONE_STORAGE_KEY)
        setOverlayState('setup')
        return
      }

      window.localStorage.setItem(FIRST_RUN_DONE_STORAGE_KEY, 'true')
      setOverlayState('hidden')
    }

    void runStartupGate()
    return () => {
      cancelled = true
    }
  }, [])

  const stageDone = useMemo(() => ({
    emma: true,
    engine: Boolean(draft.engineMode),
    connection: Boolean(draft.apiKey.trim() && draft.modelId.trim()),
    profile: Boolean(draft.profile),
  }), [draft])

  const allStagesDone = stageDone.engine && stageDone.connection && stageDone.profile
  const currentStage = stages[stageIndex]
  const currentStageDone = stageDone[currentStage.key]
  const isLastStage = stageIndex === stages.length - 1

  const goToStage = (index: number) => {
    if (index < 0 || index >= stages.length) return
    // Allow jumping to a stage if all earlier stages are done
    for (let i = 0; i < index; i++) {
      if (!stageDone[stages[i].key]) return
    }
    setErrorMessage(null)
    setStageIndex(index)
  }

  const handleNext = () => {
    if (!currentStageDone) return
    if (!isLastStage) {
      setErrorMessage(null)
      setStageIndex((i) => i + 1)
    }
  }

  const handleBack = () => {
    if (stageIndex === 0) return
    setErrorMessage(null)
    setStageIndex((i) => i - 1)
  }

  const handleFinish = async () => {
    if (!allStagesDone || submitting || !draft.engineMode) return
    setSubmitting(true)
    setErrorMessage(null)
    try {
      const finalDraft: SetupDraft = {
        ...draft,
        apiBase: draft.apiBase.trim() || getDefaultApiBase(draft.engineMode),
        apiKey: draft.apiKey.trim(),
        modelId: draft.modelId.trim(),
      }
      const currentAppConfig = asRecord(await window.appConfig.read())
      // Persist the welcome-flow inputs into appConfig using the same
      // shape Settings > Models reads, so the configured provider
      // surfaces immediately after onboarding. Engine YAML is owned
      // by the Providers Management API and not touched here.
      const appResult = await window.appConfig.save(buildAppConfig(currentAppConfig, finalDraft))
      if (!appResult.ok) {
        throw new Error(appResult.error || t('welcome.saveError'))
      }

      // Best-effort engine-side registration via Providers Management API.
      // Silently skipped when API isn't mounted (chain<2) or unreachable.
      // resolveProviderProtocol/buildAppModelConfig already wrote the
      // correct agents.defaults.{provider,model} (anthropic / openai /
      // custom-via-protocol); registerEngineProvider just mirrors the
      // credentials onto the engine's in-memory provider table.
      const providers = buildWelcomeProviders(finalDraft)
      void registerEngineProvider(finalDraft.engineMode, providers[finalDraft.engineMode])

      const launched = await window.appBridge.markLaunched()
      if (launched.ok) {
        window.localStorage.setItem(FIRST_RUN_DONE_STORAGE_KEY, 'true')
      }
      setOverlayState('hidden')
    } catch (error) {
      setErrorMessage(String((error as Error)?.message || error))
      setSubmitting(false)
    }
  }

  if (overlayState !== 'setup') return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-run-title"
    >
      <div className="relative flex h-[540px] max-h-[calc(100vh-3rem)] w-[874px] max-w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b border-border/70 px-7 pb-4 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <Sparkles size={16} />
            </div>
            <h2 id="first-run-title" className="text-base font-semibold leading-tight text-foreground">
              {username ? `${username}，` : ''}{t('welcome.greeting')}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void toggleLanguage()}
              title={i18n.language.startsWith('zh') ? t('sidebar.switchToEnglish') : t('sidebar.switchToChinese')}
              aria-label={i18n.language.startsWith('zh') ? t('sidebar.switchToEnglish') : t('sidebar.switchToChinese')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Languages size={15} aria-hidden="true" />
            </button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {stageIndex + 1} / {stages.length}
            </span>
          </div>
        </header>

        <Stepper stages={stages} stageIndex={stageIndex} stageDone={stageDone} onJump={goToStage} />

        <div className="min-h-0 flex-1 overflow-hidden px-7 py-6">
          {/* Engine stage gets a wider column so more provider cards
              are visible at once in the slider — the other stages
              stay at the original 540px reading width. */}
          <div
            className={cn(
              'mx-auto w-full',
              currentStage.key === 'engine' ? 'max-w-[780px]' : 'max-w-[540px]'
            )}
          >
          {currentStage.key !== 'emma' && currentStage.key !== 'engine' && (
            <div className="mb-5">
              <h3 className="text-sm font-semibold text-foreground">{currentStage.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{currentStage.subtitle}</p>
            </div>
          )}

          {currentStage.key === 'emma' && (
            <div className="flex flex-col items-center text-center">
              <img
                src={emmaAvatar}
                alt="Emma"
                className="h-16 w-16 rounded-2xl object-cover shadow-sm"
              />
              <h3 className="mt-5 text-[2.6rem] font-semibold leading-none tracking-tight text-foreground">
                emma
              </h3>

              <TypedQuotes prompts={emmaPrompts(t)} />
            </div>
          )}

          {currentStage.key === 'engine' && (
            <EngineSlider
              options={engineOptions}
              selected={draft.engineMode}
              onSelect={(key) => setDraft((d) => ({ ...d, engineMode: key }))}
            />
          )}

          {currentStage.key === 'connection' && (
            <div className="grid gap-3.5">
              {draft.engineMode === 'custom' && (
                <div>
                  <div className="mb-1.5 flex items-center gap-1 text-xs font-medium text-foreground">
                    <span>{t('welcome.protocolLabel')}</span>
                  </div>
                  <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5">
                    {(['openai', 'anthropic'] as ProtocolProviderKey[]).map((p) => {
                      const active = draft.protocol === p
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setDraft((d) => ({ ...d, protocol: p }))}
                          className={cn(
                            'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                            active
                              ? 'bg-card text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {p === 'openai' ? 'OpenAI' : 'Anthropic'}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              <FormField
                label="API Base URL"
                value={draft.apiBase}
                placeholder={getDefaultApiBase(draft.engineMode)}
                onChange={(v) => setDraft((d) => ({ ...d, apiBase: v }))}
              />
              <FormField
                label="API Key"
                value={draft.apiKey}
                placeholder="sk-..."
                type="password"
                required
                onChange={(v) => setDraft((d) => ({ ...d, apiKey: v }))}
              />
              <FormField
                label="Model ID"
                hint={t('welcome.modelIdHint')}
                value={draft.modelId}
                placeholder="model-id"
                required
                onChange={(v) => setDraft((d) => ({ ...d, modelId: v }))}
              />
            </div>
          )}

          {currentStage.key === 'profile' && (
            <div className="grid grid-cols-3 gap-3">
              {profileOptions.map((option) => {
                const selected = draft.profile === option.key
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, profile: option.key }))}
                    className={cn(
                      'group relative flex h-full flex-col items-start gap-2 rounded-2xl border px-4 py-4 text-left transition-all',
                      selected
                        ? 'border-primary/70 bg-primary/8 shadow-sm ring-1 ring-primary/30'
                        : 'border-border bg-background hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/30 hover:shadow-sm'
                    )}
                  >
                    <span
                      className={cn(
                        'absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border transition-colors',
                        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background opacity-0 group-hover:opacity-100'
                      )}
                      aria-hidden="true"
                    >
                      {selected && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span
                      className={cn(
                        'rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors',
                        selected
                          ? 'border-primary/40 bg-primary/15 text-primary'
                          : 'border-border bg-muted/60 text-muted-foreground'
                      )}
                    >
                      {option.key}
                    </span>
                    <div className="mt-1 text-sm font-semibold leading-tight text-foreground">
                      {option.title}
                    </div>
                    <div className="text-[11px] leading-5 text-muted-foreground">
                      {option.detail}
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {errorMessage && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
              {errorMessage}
            </div>
          )}
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-border/70 bg-muted/20 px-7 py-4">
          {stageIndex === 0 ? (
            <span aria-hidden="true" />
          ) : (
            <button
              type="button"
              onClick={handleBack}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={14} />
              {t('welcome.back')}
            </button>
          )}

          {isLastStage ? (
            <button
              type="button"
              onClick={handleFinish}
              disabled={!allStagesDone || submitting}
              className="group inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-[13px] font-medium tracking-wide text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-sm"
            >
              {submitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>{t('welcome.submitting')}</span>
                </>
              ) : (
                <>
                  <span>{t('welcome.finish')}</span>
                  <ArrowRight
                    size={14}
                    className="transition-transform duration-300 group-hover:translate-x-0.5 group-disabled:translate-x-0"
                  />
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleNext}
              disabled={!currentStageDone}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('welcome.next')}
              <ArrowRight size={14} />
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

// Horizontal-scrolling engine picker. With 9 managed providers the old
// vertical list was too long for the wizard's max-w-[540px] column, so
// we surface them as a snap-scroll carousel with prev/next chevrons.
// Selection is decoupled from the visible "active" card so users can
// preview without committing.
function EngineSlider({
  options,
  selected,
  onSelect,
}: {
  options: Array<{ key: ManagedProviderKey; title: string; detail: string }>
  selected: ManagedProviderKey | null
  onSelect: (key: ManagedProviderKey) => void
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [activeIndex, setActiveIndex] = useState<number>(() => {
    const idx = selected ? options.findIndex((o) => o.key === selected) : -1
    return idx >= 0 ? idx : 0
  })

  // Keep activeIndex aligned with external selection changes (e.g. Back
  // returning to this stage with engineMode already set).
  useEffect(() => {
    if (!selected) return
    const idx = options.findIndex((o) => o.key === selected)
    if (idx >= 0) setActiveIndex(idx)
  }, [selected, options])

  // Scroll the active card into view whenever activeIndex changes.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const card = scroller.children[activeIndex] as HTMLElement | undefined
    if (!card) return
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [activeIndex])

  const goPrev = () => setActiveIndex((i) => Math.max(0, i - 1))
  const goNext = () => setActiveIndex((i) => Math.min(options.length - 1, i + 1))

  return (
    <div className="relative">
      <button
        type="button"
        onClick={goPrev}
        disabled={activeIndex === 0}
        aria-label="previous"
        className={cn(
          'absolute left-[-12px] top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground',
          activeIndex === 0 && 'cursor-not-allowed opacity-40 hover:bg-card hover:text-muted-foreground'
        )}
      >
        <ChevronLeft size={16} />
      </button>
      <button
        type="button"
        onClick={goNext}
        disabled={activeIndex === options.length - 1}
        aria-label="next"
        className={cn(
          'absolute right-[-12px] top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground',
          activeIndex === options.length - 1
            && 'cursor-not-allowed opacity-40 hover:bg-card hover:text-muted-foreground'
        )}
      >
        <ChevronRight size={16} />
      </button>

      <div
        ref={scrollerRef}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-6 pb-3 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {options.map((option, index) => {
          const isSelected = selected === option.key
          const isActive = index === activeIndex
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                setActiveIndex(index)
                onSelect(option.key)
              }}
              className={cn(
                'group relative flex w-[240px] shrink-0 snap-center flex-col gap-3 rounded-xl border px-5 py-4 pr-10 text-left transition-all',
                isSelected
                  ? 'border-primary/60 bg-primary/8 ring-1 ring-primary/30'
                  : isActive
                    ? 'border-border bg-background shadow-sm'
                    : 'border-border/70 bg-background/60 opacity-70 hover:opacity-100'
              )}
            >
              {/* Check indicator sits in the top-right corner so it
                  never crowds the provider title at narrow widths. */}
              <span
                className={cn(
                  'absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border transition-colors',
                  isSelected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background opacity-0 group-hover:opacity-100'
                )}
                aria-hidden="true"
              >
                {isSelected && <Check size={12} strokeWidth={3} />}
              </span>
              <div className="text-sm font-medium text-foreground">{option.title}</div>
              <div className="text-xs leading-5 text-muted-foreground line-clamp-3">
                {option.detail}
              </div>
            </button>
          )
        })}
      </div>

      <div className="mt-2 flex justify-center gap-1">
        {options.map((option, index) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setActiveIndex(index)}
            aria-label={option.title}
            className={cn(
              'h-1.5 rounded-full transition-all',
              index === activeIndex ? 'w-5 bg-primary/70' : 'w-1.5 bg-border hover:bg-muted-foreground/40'
            )}
          />
        ))}
      </div>
    </div>
  )
}

function Stepper({
  stages,
  stageIndex,
  stageDone,
  onJump,
}: {
  stages: Array<{ key: StageKey; title: string; subtitle: string }>
  stageIndex: number
  stageDone: Record<StageKey, boolean>
  onJump: (index: number) => void
}) {
  // Count consecutive completed stages from the left to determine progress line width.
  let consecutiveDone = 0
  for (let i = 0; i < stages.length; i++) {
    if (stageDone[stages[i].key]) consecutiveDone += 1
    else break
  }
  const progressFraction = stages.length > 1
    ? Math.min(1, Math.max(0, (consecutiveDone - 1) / (stages.length - 1)))
    : 0

  return (
    <div className="px-7 pb-3 pt-4">
      <div className="relative mx-auto w-full max-w-[540px]">
        {/* background line */}
        <div className="absolute left-[14px] right-[14px] top-[13px] h-px bg-border" aria-hidden="true" />
        {/* progress line */}
        <div
          className="absolute left-[14px] top-[13px] h-px bg-primary/60 transition-[width] duration-300"
          style={{ width: `calc((100% - 28px) * ${progressFraction})` }}
          aria-hidden="true"
        />

        <div className="relative flex justify-between">
          {stages.map((stage, index) => {
            const active = index === stageIndex
            const done = stageDone[stage.key]
            const reachable = index === 0 || stages.slice(0, index).every((s) => stageDone[s.key])
            return (
              <button
                key={stage.key}
                type="button"
                onClick={() => onJump(index)}
                disabled={!reachable}
                className={cn(
                  'flex flex-col items-center gap-2',
                  reachable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
                )}
                aria-label={stage.title}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors',
                    done
                      ? 'border-primary bg-primary text-primary-foreground'
                      : active
                        ? 'border-primary bg-card text-primary'
                        : 'border-border bg-card text-muted-foreground',
                    reachable && !active && !done && 'hover:border-primary/60'
                  )}
                >
                  {done ? <Check size={13} strokeWidth={3} /> : index + 1}
                </span>
                <span
                  className={cn(
                    'whitespace-nowrap text-[11px] font-medium leading-4',
                    active ? 'text-foreground' : done ? 'text-foreground/75' : 'text-muted-foreground'
                  )}
                >
                  {stage.title}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function TypedQuotes({ prompts }: { prompts: Array<{ category: string; prompt: string }> }) {
  // Shuffle once on mount so each session sees a different ordering, then loop.
  const shuffled = useMemo(() => {
    const arr = prompts.slice()
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = arr[i]
      arr[i] = arr[j]
      arr[j] = tmp
    }
    return arr
  }, [prompts])

  const [index, setIndex] = useState(0)
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<'typing' | 'holding' | 'erasing'>('typing')
  const timerRef = useRef<number | null>(null)

  const current = shuffled[index] ?? shuffled[0]

  useEffect(() => {
    const full = current.prompt
    if (timerRef.current) window.clearTimeout(timerRef.current)

    if (phase === 'typing') {
      if (text.length < full.length) {
        timerRef.current = window.setTimeout(() => setText(full.slice(0, text.length + 1)), 42)
      } else {
        timerRef.current = window.setTimeout(() => setPhase('holding'), 1400)
      }
    } else if (phase === 'holding') {
      timerRef.current = window.setTimeout(() => setPhase('erasing'), 900)
    } else {
      if (text.length > 0) {
        timerRef.current = window.setTimeout(() => setText(full.slice(0, text.length - 1)), 22)
      } else {
        timerRef.current = window.setTimeout(() => {
          setIndex((i) => (i + 1) % shuffled.length)
          setPhase('typing')
        }, 220)
      }
    }

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [text, phase, current.prompt, shuffled.length])

  return (
    <div className="mt-8 w-full">
      <div className="mx-auto min-h-[120px] max-w-[520px] rounded-2xl border border-border bg-background/60 px-5 py-5 text-left">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {current.category}
        </div>
        <div className="text-[15px] leading-7 text-foreground/90">
          <span className="text-muted-foreground/60">“</span>
          <span>{text}</span>
          <span
            className="ml-[2px] inline-block h-[1.05em] w-[2px] translate-y-[3px] animate-pulse bg-foreground/70"
            aria-hidden="true"
          />
          {text === current.prompt && phase !== 'erasing' && (
            <span className="text-muted-foreground/60">”</span>
          )}
        </div>
      </div>
      <div className="mt-3 flex justify-center text-[10px] tabular-nums text-muted-foreground/70">
        {index + 1} / {shuffled.length}
      </div>
    </div>
  )
}

function FormField({
  label,
  hint,
  value,
  placeholder,
  onChange,
  type = 'text',
  required,
}: {
  label: string
  hint?: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
  type?: 'text' | 'password'
  required?: boolean
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center gap-1 text-xs font-medium text-foreground">
        <span>{label}</span>
        {required && <span className="text-red-500">*</span>}
      </div>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
      />
      {hint && <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{hint}</p>}
    </label>
  )
}


