import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  MessageCircle,
  Search,
  Code2,
  Globe,
  Bot,
  X,
  RefreshCw,
} from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * Session-level usage / cost statistics button.
 *
 * Renders a small icon pill in the top-right of the chat area (matching
 * the `PlanStatusButton` layout). Click → popover showing:
 *
 *   • 上下文窗口 utilisation bar (used / cap · remaining %)
 *   • 4 high-level stat cards (总花费 / 输入 token / 输出 token / 平均延迟)
 *   • 子 agent 分解 table (per-agent input / output tokens + cost share bar)
 *
 * Backend wiring is in progress — for now the component renders the
 * static mock values from `DEFAULT_STATS` so we can iterate on visual
 * design. Once the engine exposes the matching metrics endpoint the
 * caller can pass real numbers through the `stats` prop and everything
 * inside this component continues to work unchanged.
 */

export type SessionStatsAgentKind =
  | 'orchestrator'
  | 'retriever'
  | 'code_analyzer'
  | 'web_browser'
  | 'generic'

export interface SessionStatsAgentRow {
  /** Stable identifier — used as React key. */
  id: string
  /** Display name shown in the first column (e.g. `orchestrator`). */
  name: string
  /** Visual hint — picks the row's icon + accent color. Falls back to `generic`. */
  kind?: SessionStatsAgentKind
  /** Optional small badge after the name (e.g. `主` for the orchestrator). */
  badge?: string
  inputTokens: number
  outputTokens: number
  /** Total cost in USD attributable to this agent. */
  costUsd: number
}

/**
 * Breakdown of the tokens that fill the context window.
 *
 * NOTE on the input/cache relationship: per OpenAI / DeepSeek /
 * Anthropic protocols, `inputTokens` is the *full* prompt size and
 * already INCLUDES `cacheTokens` as a subset (cached_read_tokens is
 * "of these prompt_tokens, X were cache hits"). The legend below the
 * bar surfaces this overlap as "输入 (含缓存)" so users don't read it
 * as additive.
 *
 * For the stacked bar we visualise non-overlapping segments — the
 * non-cached portion of input + cache + output + thinking — so the
 * widths physically sum to 100%.
 */
export interface SessionStatsContextBreakdown {
  /** Full prompt size — already includes `cacheTokens`. */
  inputTokens: number
  outputTokens: number
  /** Sum of cache_read + cache_write. Subset of `inputTokens`. */
  cacheTokens: number
  thinkingTokens: number
}

export interface SessionStatsValue {
  /** Context window used / cap, in tokens. */
  contextUsed: number
  contextLimit: number
  /** Per-bucket decomposition of `contextUsed`. Optional — when absent the
   *  panel falls back to a single solid utilisation bar. */
  contextBreakdown?: SessionStatsContextBreakdown

  /** Aggregate cost in USD across the session. */
  totalCostUsd: number
  /** Cost saved by prompt-caching, in USD. Optional — hidden when zero / undefined. */
  cachedSavingsUsd?: number

  /** Total input tokens across all agents. */
  inputTokens: number
  /** Cache-hit ratio (0..1) for input tokens. Hidden when undefined. */
  cacheHitRatio?: number

  /** Total output tokens across all agents. */
  outputTokens: number
  /** Of the output, how many were "thinking" tokens (extended-thinking). Optional. */
  thinkingTokens?: number

  /** Average end-to-end latency per turn, in milliseconds. */
  avgLatencyMs: number
  /** Average time-to-first-token, in milliseconds. Optional. */
  firstTokenLatencyMs?: number

  /** Per sub-agent breakdown. Sorted by costUsd desc in the table. */
  agents: SessionStatsAgentRow[]
}

interface SessionStatsButtonProps {
  /**
   * Active session id. When provided, the component polls the engine's
   * Session Metrics API (`GET /api/v1/sessions/{id}/metrics`, proxied
   * through main IPC) and renders live data. When omitted, the
   * component falls back to the static mock palette so the visual
   * design is still inspectable for new sessions with no LLM activity.
   */
  sessionId?: string
  /**
   * Override the polled value (or supply it from outside). Takes
   * precedence over the internal fetch loop. Useful for tests and
   * for callers that already manage their own metrics state.
   */
  stats?: SessionStatsValue
  className?: string
}

// USD pricing table per million tokens. Sourced from public Anthropic
// + OpenAI pricing pages as of 2026-05. Mirrors the example block in
// harnessclaw-engine/docs/api/session-metrics-api.md (which explicitly
// pushes cost calculation to the client). Models not listed here are
// silently skipped during cost aggregation — better than guessing.
const MODEL_PRICING: Record<string, { input: number; output: number; cache_read: number; cache_write: number; thinking: number }> = {
  // Anthropic Claude family
  'claude-opus-4-7':         { input: 15.0, output: 75.0, cache_read: 1.5,  cache_write: 18.75, thinking: 75.0 },
  'claude-opus-4-5':         { input: 15.0, output: 75.0, cache_read: 1.5,  cache_write: 18.75, thinking: 75.0 },
  'claude-sonnet-4-6':       { input: 3.0,  output: 15.0, cache_read: 0.3,  cache_write: 3.75,  thinking: 15.0 },
  'claude-sonnet-4-5':       { input: 3.0,  output: 15.0, cache_read: 0.3,  cache_write: 3.75,  thinking: 15.0 },
  'claude-haiku-4-5':        { input: 1.0,  output: 5.0,  cache_read: 0.1,  cache_write: 1.25,  thinking: 5.0  },
  'claude-3-5-sonnet':       { input: 3.0,  output: 15.0, cache_read: 0.3,  cache_write: 3.75,  thinking: 15.0 },
  'claude-3-5-haiku':        { input: 0.8,  output: 4.0,  cache_read: 0.08, cache_write: 1.0,   thinking: 4.0  },
  // OpenAI GPT family — coarse approximation; reasoning tokens get the
  // same rate as output per the OpenAI billing model.
  'gpt-5':                   { input: 5.0,  output: 15.0, cache_read: 0.5,  cache_write: 5.0,   thinking: 15.0 },
  'gpt-4.1':                 { input: 2.0,  output: 8.0,  cache_read: 0.2,  cache_write: 2.0,   thinking: 8.0  },
  'gpt-4o':                  { input: 2.5,  output: 10.0, cache_read: 0.25, cache_write: 2.5,   thinking: 10.0 },
}

function lookupPricing(model: string) {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model]
  // Loose match — strip provider prefixes and date suffixes so e.g.
  // "anthropic/claude-sonnet-4-6-20260301" still maps to the right
  // row in the table. We try progressively shorter prefixes.
  const lowered = model.toLowerCase()
  for (const key of Object.keys(MODEL_PRICING)) {
    if (lowered.includes(key)) return MODEL_PRICING[key]
  }
  return undefined
}

/**
 * Aggregate USD cost across all per-model entries. Returns `undefined`
 * when there's no recognized model at all (so callers can show "—"
 * rather than a misleading $0.00).
 */
function computeTotalCost(perModel: SessionMetricsPerModel[]): number | undefined {
  let total = 0
  let matched = 0
  for (const m of perModel) {
    const p = lookupPricing(m.model)
    if (!p) continue
    matched++
    total += (
      m.input_tokens * p.input +
      m.output_tokens * p.output +
      m.cache_read_tokens * p.cache_read +
      m.cache_write_tokens * p.cache_write +
      m.thinking_tokens * p.thinking
    ) / 1_000_000
  }
  return matched > 0 ? total : undefined
}

/**
 * USD saved by the prompt cache: difference between charging cache_read
 * tokens at the full input rate vs. the cache_read rate. Matches the
 * `cacheSavedUSD` snippet in the Session Metrics API doc.
 */
function computeCacheSavings(perModel: SessionMetricsPerModel[]): number {
  let saved = 0
  for (const m of perModel) {
    const p = lookupPricing(m.model)
    if (!p) continue
    saved += m.cache_read_tokens * (p.input - p.cache_read) / 1_000_000
  }
  return saved
}

/**
 * Heuristically pick a presentation `kind` for a sub-agent so the
 * dashboard's icon + accent color matches the agent's role even when
 * the engine returns a free-form `agent_type` string.
 */
function classifyAgentKind(agentType: string, agentId: string): SessionStatsAgentKind {
  const key = `${agentType} ${agentId}`.toLowerCase()
  if (/main|orchestr|emma|root|primary/.test(key)) return 'orchestrator'
  if (/research|retriev|search|index/.test(key)) return 'retriever'
  if (/code|dev|engin|analyz|review/.test(key)) return 'code_analyzer'
  if (/web|browser|fetch|crawl|tavily/.test(key)) return 'web_browser'
  return 'generic'
}

/**
 * Engine `SessionMetricsStats` → component `SessionStatsValue`.
 *
 * Cost numbers come from the client-side pricing table since the
 * engine deliberately doesn't return USD (see Session Metrics API
 * §"客户端使用指南"). Sub-agent rows are de-duplicated by `agent_id`
 * (multiple runs of the same agent are aggregated rather than rendered
 * as separate rows) and sorted by total tokens descending.
 */
function mapMetricsToValue(metrics: SessionMetricsStats): SessionStatsValue {
  const totalCost = computeTotalCost(metrics.per_model) ?? 0
  const cacheSavings = computeCacheSavings(metrics.per_model)

  // Aggregate sub-agent runs by agent_id so a single "researcher"
  // doesn't appear three times when the engine spawns it across
  // multiple turns.
  const subAgentAccum = new Map<string, {
    id: string
    name: string
    agent_type: string
    kind: SessionStatsAgentKind
    model: string
    inputTokens: number
    outputTokens: number
    cacheRead: number
    cacheWrite: number
    thinking: number
    totalTokens: number
  }>()
  for (const sub of metrics.subagents) {
    const key = sub.agent_id || sub.agent_run_id
    const existing = subAgentAccum.get(key)
    if (existing) {
      existing.inputTokens += sub.input_tokens
      existing.outputTokens += sub.output_tokens
      existing.cacheRead += sub.cache_read_tokens
      existing.cacheWrite += sub.cache_write_tokens
      existing.thinking += sub.thinking_tokens
      existing.totalTokens += sub.total_tokens
    } else {
      subAgentAccum.set(key, {
        id: key,
        name: sub.agent_type || sub.agent_id || 'subagent',
        agent_type: sub.agent_type,
        kind: classifyAgentKind(sub.agent_type, sub.agent_id),
        model: sub.model,
        inputTokens: sub.input_tokens,
        outputTokens: sub.output_tokens,
        cacheRead: sub.cache_read_tokens,
        cacheWrite: sub.cache_write_tokens,
        thinking: sub.thinking_tokens,
        totalTokens: sub.total_tokens,
      })
    }
  }

  // Per-agent cost = (agg input × p.input + agg output × p.output + ...)
  // Use the agent's reported `model`; fall back to a generic rate when
  // missing so the row still shows something instead of $0.
  const agents: SessionStatsAgentRow[] = []
  for (const a of subAgentAccum.values()) {
    const p = lookupPricing(a.model)
    const cost = p
      ? (a.inputTokens * p.input + a.outputTokens * p.output + a.cacheRead * p.cache_read + a.cacheWrite * p.cache_write + a.thinking * p.thinking) / 1_000_000
      : 0
    agents.push({
      id: a.id,
      name: a.name,
      kind: a.kind,
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
      costUsd: cost,
    })
  }
  agents.sort((a, b) => b.costUsd - a.costUsd || b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens))

  // Add an implicit "emma (主)" row representing the residual
  // = top-level metrics minus the sum of all sub-agents. This gives
  // the user a single-glance view of where tokens actually went,
  // matching the design reference's "emma 主" line.
  const subInputTotal = agents.reduce((s, r) => s + r.inputTokens, 0)
  const subOutputTotal = agents.reduce((s, r) => s + r.outputTokens, 0)
  const orchestratorInput = Math.max(0, metrics.input_tokens - subInputTotal)
  const orchestratorOutput = Math.max(0, metrics.output_tokens - subOutputTotal)
  if (orchestratorInput > 0 || orchestratorOutput > 0 || agents.length === 0) {
    const subCostTotal = agents.reduce((s, r) => s + r.costUsd, 0)
    const orchestratorCost = Math.max(0, totalCost - subCostTotal)
    agents.unshift({
      id: '__emma__',
      name: 'emma',
      kind: 'orchestrator',
      badge: '主',
      inputTokens: orchestratorInput,
      outputTokens: orchestratorOutput,
      costUsd: orchestratorCost,
    })
  }

  // ────────────────────────────────────────────────────────────────
  // IMPORTANT: per OpenAI / DeepSeek / Anthropic protocols the
  // server-side `input_tokens` is the *full* prompt size and already
  // includes `cache_read_tokens` and `cache_write_tokens` as subsets
  // (cached_read_tokens is "of these prompt_tokens, X were cache
  // hits"). The breakdown therefore reports `inputTokens` as the FULL
  // amount and `cacheTokens` as the subset — the legend renders this
  // as "输入 (含缓存 X)" so users don't mentally add them.
  //
  // The context-window "used" total must match what the breakdown
  // sums to, otherwise the top-right counter and the bar disagree.
  // We use cumulative tokens (input + output + thinking) so the bar
  // tells the same story as the StatCard row underneath. `input_tokens`
  // already includes cache, so it isn't double-added.
  // ────────────────────────────────────────────────────────────────
  const cacheTokens = Math.max(0, metrics.cache_read_tokens + metrics.cache_write_tokens)
  const fullInput = Math.max(0, metrics.input_tokens)
  const outputTok = Math.max(0, metrics.output_tokens)
  const thinkingTok = Math.max(0, metrics.thinking_tokens)
  const cumulativeUsed = fullInput + outputTok + thinkingTok
  // Prefer the engine-reported limit; fall back to a generous default
  // if the engine hasn't pinned the model yet.
  const limit = metrics.context_window?.limit ?? 200_000

  return {
    contextUsed: cumulativeUsed,
    contextLimit: limit,
    contextBreakdown: {
      inputTokens: fullInput,
      outputTokens: outputTok,
      cacheTokens,
      thinkingTokens: thinkingTok,
    },
    totalCostUsd: totalCost,
    cachedSavingsUsd: cacheSavings > 0.01 ? cacheSavings : undefined,
    inputTokens: fullInput,
    // The server reports `cache_hit_rate` averaged across calls, which
    // doesn't match the user-visible "缓存 / 输入" ratio they see in
    // the breakdown above. Compute it locally so the StatCard sub-text
    // matches: cacheHitRatio = cacheTokens / inputTokens.
    cacheHitRatio: fullInput > 0 ? cacheTokens / fullInput : undefined,
    outputTokens: outputTok,
    thinkingTokens: thinkingTok > 0 ? thinkingTok : undefined,
    avgLatencyMs: metrics.latency_ms_avg,
    firstTokenLatencyMs: undefined, // engine doesn't expose TTFT yet
    agents,
  }
}

// Zero-data placeholder used when an active session has no metrics
// yet (e.g. brand-new session that hasn't called any LLM). Keeps the
// panel layout stable so the empty state is just a row of zeros plus
// a discreet "暂无统计数据" hint.
const EMPTY_STATS: SessionStatsValue = {
  contextUsed: 0,
  contextLimit: 200_000,
  totalCostUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  avgLatencyMs: 0,
  agents: [],
}

// Static mock data lifted directly from the design reference. Used
// only when the caller passes neither a `sessionId` nor an explicit
// `stats` prop (e.g. Storybook / standalone preview).
const DEFAULT_STATS: SessionStatsValue = {
  contextUsed: 142_318,
  contextLimit: 200_000,
  contextBreakdown: {
    inputTokens: 111_218, // includes the 48_818 cacheTokens below
    outputTokens: 22_900,
    cacheTokens: 48_818,
    thinkingTokens: 8_200,
  },
  totalCostUsd: 2.47,
  cachedSavingsUsd: 0.83,
  inputTokens: 418_902,
  cacheHitRatio: 0.67,
  outputTokens: 31_654,
  thinkingTokens: 8_200,
  avgLatencyMs: 2_400,
  firstTokenLatencyMs: 700,
  agents: [
    { id: 'emma',         name: 'emma',         kind: 'orchestrator', badge: '主', inputTokens: 186_420, outputTokens: 14_802, costUsd: 1.12 },
    { id: 'retriever',    name: 'retriever',    kind: 'retriever',                inputTokens: 112_304, outputTokens: 6_218,  costUsd: 0.61 },
    { id: 'code_analyzer',name: 'code_analyzer',kind: 'code_analyzer',            inputTokens: 82_156,  outputTokens: 7_394,  costUsd: 0.48 },
    { id: 'web_browser',  name: 'web_browser',  kind: 'web_browser',              inputTokens: 38_022,  outputTokens: 3_240,  costUsd: 0.26 },
  ],
}

// Brand colors for the agent-share progress bars. The same colors are
// used in the context-utilization stacked bar at the top of the panel,
// so the visual mapping (blue=orchestrator, green=retriever, etc.)
// stays consistent across the two views.
const AGENT_COLOR: Record<SessionStatsAgentKind, { dot: string; bar: string; iconWrap: string; icon: string }> = {
  orchestrator:  { dot: 'bg-blue-500',   bar: 'bg-blue-500',   iconWrap: 'bg-blue-50 dark:bg-blue-950/40',    icon: 'text-blue-600 dark:text-blue-400' },
  retriever:     { dot: 'bg-emerald-500',bar: 'bg-emerald-500',iconWrap: 'bg-emerald-50 dark:bg-emerald-950/40',icon: 'text-emerald-600 dark:text-emerald-400' },
  code_analyzer: { dot: 'bg-violet-500', bar: 'bg-violet-500', iconWrap: 'bg-violet-50 dark:bg-violet-950/40',icon: 'text-violet-600 dark:text-violet-400' },
  web_browser:   { dot: 'bg-amber-600',  bar: 'bg-amber-600',  iconWrap: 'bg-amber-50 dark:bg-amber-950/40',  icon: 'text-amber-700 dark:text-amber-400' },
  generic:       { dot: 'bg-slate-400',  bar: 'bg-slate-400',  iconWrap: 'bg-slate-100 dark:bg-slate-800',    icon: 'text-slate-500 dark:text-slate-300' },
}

function resolveAgentColor(kind?: SessionStatsAgentKind) {
  return AGENT_COLOR[kind || 'generic'] || AGENT_COLOR.generic
}

function AgentRowIcon({ kind }: { kind?: SessionStatsAgentKind }) {
  const c = resolveAgentColor(kind)
  const inner = (() => {
    switch (kind) {
      case 'orchestrator':  return <MessageCircle size={12} />
      case 'retriever':     return <Search size={12} />
      case 'code_analyzer': return <Code2 size={12} />
      case 'web_browser':   return <Globe size={12} />
      default:              return <Bot size={12} />
    }
  })()
  return (
    <span className={cn('inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md', c.iconWrap, c.icon)}>
      {inner}
    </span>
  )
}

function formatCompactTokens(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function formatCost(value: number): string {
  if (!Number.isFinite(value)) return '$0.00'
  return `$${value.toFixed(2)}`
}

function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function clampPercent(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0
  return Math.max(0, Math.min(100, (numerator / denominator) * 100))
}

export function SessionStatsButton({ sessionId, stats: overrideStats, className }: SessionStatsButtonProps) {
  const [open, setOpen] = useState(false)
  const [polled, setPolled] = useState<SessionStatsValue | undefined>(undefined)
  const [fetchState, setFetchState] = useState<'idle' | 'loading' | 'error' | 'no_data'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)
  // Cross-link hover state between the stacked bar and its legend so
  // hovering one highlights the corresponding member of the other.
  // Backed by a 100ms hover-intent debounce so brief mouse passes
  // don't flicker the active highlight + tooltip.
  const [activeBucket, setActiveBucketRaw] = useState<ContextBucketId | null>(null)
  // Cursor position (viewport coords) used to render a floating
  // tooltip next to the pointer rather than as an inline panel.
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null)
  const bucketHoverTimerRef = useRef<number | null>(null)
  const pendingBucketRef = useRef<ContextBucketId | null>(null)
  const setActiveBucket = useCallback((next: ContextBucketId | null) => {
    pendingBucketRef.current = next
    if (bucketHoverTimerRef.current !== null) {
      window.clearTimeout(bucketHoverTimerRef.current)
      bucketHoverTimerRef.current = null
    }
    if (next === null) {
      // Clear instantly so the user gets immediate feedback that the
      // pointer left the highlight zone.
      setActiveBucketRaw(null)
      setHoverPos(null)
      return
    }
    bucketHoverTimerRef.current = window.setTimeout(() => {
      setActiveBucketRaw(pendingBucketRef.current)
      bucketHoverTimerRef.current = null
    }, 100)
  }, [])
  useEffect(() => () => {
    if (bucketHoverTimerRef.current !== null) window.clearTimeout(bucketHoverTimerRef.current)
  }, [])
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Used to ignore stale fetch responses after the sessionId changes
  // or the component unmounts.
  const fetchTokenRef = useRef(0)

  // Click-outside / Escape-to-close behaviour mirrors PlanStatusButton.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current) return
      if (event.target instanceof Node && containerRef.current.contains(event.target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  /**
   * Fetch the latest metrics from the engine. Resilient to:
   *   • engine unreachable / Console disabled — surfaces "engine 不可达"
   *   • session_not_found (HTTP 404) — surfaces "暂无统计数据" (a freshly
   *     created session with zero LLM calls is the common case)
   *   • malformed JSON / 5xx — surfaces a generic error
   *
   * We poll on a 5s interval while the popover is open and once on
   * open. Background polling (popover closed) is avoided so we don't
   * stress the engine for every session in the sidebar.
   */
  const fetchMetrics = useCallback(async () => {
    if (!sessionId) return
    const token = ++fetchTokenRef.current
    setFetchState('loading')
    try {
      const result = await window.agentApi.getSessionMetrics(sessionId)
      if (token !== fetchTokenRef.current) return // stale response
      if (result.ok) {
        setPolled(mapMetricsToValue(result.data))
        setFetchState('idle')
        setErrorMessage(undefined)
      } else if (result.error === 'session_not_found') {
        // Treat as "no data yet" rather than an error — the engine
        // hasn't recorded a single LLM call for this session yet.
        setPolled(undefined)
        setFetchState('no_data')
        setErrorMessage(undefined)
      } else {
        setFetchState('error')
        setErrorMessage(result.message || result.error)
      }
    } catch (error) {
      if (token !== fetchTokenRef.current) return
      setFetchState('error')
      setErrorMessage(String(error))
    }
  }, [sessionId])

  // Reset state when the session changes, then trigger an initial
  // fetch in the background so the button face shows real cost even
  // before the popover is opened.
  useEffect(() => {
    setPolled(undefined)
    setFetchState('idle')
    setErrorMessage(undefined)
    fetchTokenRef.current++
    if (!sessionId) return
    void fetchMetrics()
  }, [sessionId, fetchMetrics])

  // Active polling while the popover is open. The API doc recommends
  // 2-5s intervals — we pick 5s as a conservative default since the
  // engine's own debounce is 1s, so faster polling wouldn't yield
  // finer-grained data anyway.
  useEffect(() => {
    if (!open || !sessionId) return
    void fetchMetrics()
    const timer = window.setInterval(() => {
      void fetchMetrics()
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [open, sessionId, fetchMetrics])

  // Resolution order: explicit `stats` prop > polled value > mock.
  // The mock keeps the visual design inspectable for sessions with
  // no LLM activity, but only when there's no active sessionId at
  // all. With a sessionId set, we show real data or an empty-state
  // panel instead of misleading mock numbers.
  const stats: SessionStatsValue = overrideStats
    || polled
    || (sessionId ? EMPTY_STATS : DEFAULT_STATS)

  const totalCost = Math.max(0.0001, stats.totalCostUsd)
  // Pre-compute per-row cost percentages so the bar widths inside the
  // table sum to 100% and the cell labels match the rendered bar.
  const rows = useMemo(() => {
    return [...stats.agents]
      .sort((a, b) => b.costUsd - a.costUsd)
      .map((row) => ({
        ...row,
        share: clampPercent(row.costUsd, totalCost),
      }))
  }, [stats.agents, totalCost])

  const contextUsedPct = clampPercent(stats.contextUsed, stats.contextLimit)
  const contextRemainingPct = Math.max(0, 100 - contextUsedPct)

  const cacheHitLabel = typeof stats.cacheHitRatio === 'number'
    ? `缓存命中 ${Math.round(stats.cacheHitRatio * 100)}%`
    : undefined
  const thinkingLabel = typeof stats.thinkingTokens === 'number' && stats.thinkingTokens > 0
    ? `含思考 ${formatCompactTokens(stats.thinkingTokens)}`
    : undefined
  const firstTokenLabel = typeof stats.firstTokenLatencyMs === 'number'
    ? `首 token ${formatLatency(stats.firstTokenLatencyMs)}`
    : undefined
  const savingsLabel = typeof stats.cachedSavingsUsd === 'number' && stats.cachedSavingsUsd > 0
    ? `缓存省 ${formatCost(stats.cachedSavingsUsd)}`
    : undefined

  return (
    <div ref={containerRef} className={cn('pointer-events-auto relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="查看会话统计"
        className={cn(
          'group inline-flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 py-1.5 text-[12px] font-medium text-foreground shadow-sm backdrop-blur-sm transition-colors hover:border-primary/40 hover:text-primary',
          open && 'border-primary/40 bg-card text-primary',
        )}
      >
        <BarChart3 size={14} strokeWidth={2.2} className="text-primary" />
        <span>统计</span>
        {/*
          The trigger badge used to show `formatCost(totalCostUsd)`.
          Per UX guidance we now suppress monetary numbers from the
          chat header to avoid anxiety; the panel itself still shows
          token usage, latency, etc.
        */}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="会话统计"
          className="absolute right-0 top-[calc(100%+8px)] z-30 w-[min(42rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
        >
          {/* Refresh + close buttons — float over the panel header.
              Refresh is hidden when no sessionId is bound (mock /
              external-stats mode). The refresh icon spins while a
              fetch is in flight. */}
          <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
            {sessionId && !overrideStats && (
              <button
                type="button"
                onClick={() => void fetchMetrics()}
                aria-label="刷新统计"
                disabled={fetchState === 'loading'}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw size={13} className={cn(fetchState === 'loading' && 'animate-spin')} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="关闭"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X size={14} />
            </button>
          </div>

          {/* Status banner — surfaces non-recoverable fetch issues
              and the "暂无统计数据" empty state without blocking the
              underlying layout. The button-face still works (showing
              the most recent successful poll) when transient errors
              occur. */}
          {sessionId && !overrideStats && (fetchState === 'error' || fetchState === 'no_data') && (
            <div className={cn(
              'border-b px-5 py-2 text-[11px]',
              fetchState === 'error'
                ? 'border-amber-200/70 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300'
                : 'border-border bg-muted/40 text-muted-foreground',
            )}>
              {fetchState === 'error'
                ? <>无法获取统计数据：{errorMessage || '请稍后重试'}</>
                : <>暂无统计数据 — 当前会话还未产生 LLM 调用</>}
            </div>
          )}

          <div className="space-y-5 px-5 py-5">
            {/* ── Context window utilization ─────────────────────────── */}
            <section>
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-[13px] font-semibold text-foreground">上下文窗口</div>
                <div className="text-[12px] text-muted-foreground">
                  <span className="font-semibold text-foreground">{stats.contextUsed.toLocaleString('en-US')}</span>
                  <span className="mx-1 text-muted-foreground/80">/</span>
                  <span>{stats.contextLimit.toLocaleString('en-US')}</span>
                  <span className="mx-1 text-muted-foreground/60">·</span>
                  <span>剩余 </span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">{contextRemainingPct.toFixed(1)}%</span>
                </div>
              </div>
              {/* Stacked utilization bar — segments are colored by
                  token type (input / cache / output / thinking) so the
                  user can read off the dominant cost driver at a glance.
                  Hovering a bar segment or legend chip highlights its
                  counterpart so the visual mapping is unambiguous. */}
              <ContextBreakdownBar
                breakdown={stats.contextBreakdown}
                usedPct={contextUsedPct}
                activeBucket={activeBucket}
                onHoverBucket={setActiveBucket}
                onHoverPos={setHoverPos}
              />
              {stats.contextBreakdown && (
                <ul className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
                  {CONTEXT_BUCKETS.map((bucket) => {
                    const value = bucket.selector(stats.contextBreakdown!)
                    if (!value || value <= 0) return null
                    const isActive = activeBucket === bucket.id
                    return (
                      <li
                        key={bucket.id}
                        onMouseEnter={(e) => {
                          setActiveBucket(bucket.id)
                          setHoverPos({ x: e.clientX, y: e.clientY })
                        }}
                        onMouseMove={(e) => setHoverPos({ x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setActiveBucket(null)}
                        className={cn(
                          'inline-flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors',
                          isActive && 'bg-muted/70',
                        )}
                      >
                        <span
                          className={cn(
                            'h-2 w-2 rounded-sm transition-transform duration-200',
                            bucket.color,
                            isActive && 'scale-125',
                          )}
                        />
                        <span className="text-muted-foreground">{bucket.label}</span>
                        <span className="font-mono tabular-nums text-foreground">
                          {formatCompactTokens(value)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {/* ── 4-up stat cards ─────────────────────────────────────── */}
            {/* "总花费" intentionally replaced with a non-monetary
                summary (total tokens) so the user isn't nudged toward
                cost-watching anxiety. Per-model pricing is still used
                internally to weight the agent share bar — it just
                isn't surfaced as a dollar amount anywhere. */}
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label="总 token"
                value={(stats.inputTokens + stats.outputTokens).toLocaleString('en-US')}
              />
              <StatCard label="输入 token" value={stats.inputTokens.toLocaleString('en-US')} sub={cacheHitLabel} />
              <StatCard label="输出 token" value={stats.outputTokens.toLocaleString('en-US')} sub={thinkingLabel} />
              <StatCard label="平均延迟" value={formatLatency(stats.avgLatencyMs)} sub={firstTokenLabel} />
            </section>

            {/* ── 子 agent 分解 ───────────────────────────────────────── */}
            <section>
              <div className="mb-2 text-[13px] font-semibold text-foreground">子 agent 分解</div>
              <div className="overflow-hidden rounded-xl border border-border bg-background">
                {/* Column headers. Share column is cost-weighted under
                    the hood but labeled "贡献占比" so the user reads
                    it as a relative contribution rather than money. */}
                <div className="grid grid-cols-[1.5fr,0.8fr,0.8fr,1.6fr] items-center gap-3 border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-medium text-muted-foreground">
                  <div>Agent</div>
                  <div className="text-right">输入</div>
                  <div className="text-right">输出</div>
                  <div>贡献占比</div>
                </div>
                <ul className="divide-y divide-border">
                  {rows.map((row) => {
                    const c = resolveAgentColor(row.kind)
                    return (
                      <li
                        key={row.id}
                        className="grid grid-cols-[1.5fr,0.8fr,0.8fr,1.6fr] items-center gap-3 px-3 py-2.5 text-[12px] text-foreground"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <AgentRowIcon kind={row.kind} />
                          <span className="truncate font-medium" title={row.name}>{row.name}</span>
                          {row.badge && (
                            <span className="inline-flex h-4 flex-shrink-0 items-center rounded-sm bg-muted px-1 text-[10px] font-medium text-muted-foreground">
                              {row.badge}
                            </span>
                          )}
                        </div>
                        <div className="text-right font-mono tabular-nums text-foreground">
                          {row.inputTokens.toLocaleString('en-US')}
                        </div>
                        <div className="text-right font-mono tabular-nums text-foreground">
                          {row.outputTokens.toLocaleString('en-US')}
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Dollar amount removed: bar + % is enough
                              to communicate per-agent contribution
                              without surfacing per-row USD. */}
                          <div className="relative flex-1">
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                              <span
                                className={cn('block h-full rounded-full', c.bar)}
                                style={{ width: `${row.share}%` }}
                              />
                            </div>
                          </div>
                          <span className="w-9 text-right text-[10px] font-medium text-muted-foreground tabular-nums">
                            {Math.round(row.share)}%
                          </span>
                        </div>
                      </li>
                    )
                  })}
                  {rows.length === 0 && (
                    <li className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                      暂无子 agent 数据
                    </li>
                  )}
                </ul>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* Floating tooltip rendered at cursor position. Lives outside
          the dialog body so it can spill over edges without being
          clipped by the popover's overflow-hidden mask. */}
      <ContextBucketFloatingTooltip
        breakdown={stats.contextBreakdown}
        activeBucket={open ? activeBucket : null}
        position={hoverPos}
      />
    </div>
  )
}

/**
 * Visual bucket descriptor for the context-window breakdown.
 *
 * `id` keys the React node + cross-references between the bar segment
 * and the legend chip so hovering one highlights the other. `selector`
 * derives the numeric value from a `SessionStatsContextBreakdown` so
 * we can compose buckets (e.g. the visible "输入(非缓存)" segment is
 * inputTokens − cacheTokens) without leaking that math into the
 * render path.
 */
type ContextBucketId = 'input' | 'cache' | 'output' | 'thinking'

interface ContextBucket {
  id: ContextBucketId
  label: string
  color: string
  /** Tailwind class for a soft hover-glow ring. */
  ring: string
  selector: (b: SessionStatsContextBreakdown) => number
  /** Optional supplementary fact rendered in the tooltip. */
  hint?: (b: SessionStatsContextBreakdown) => string | undefined
}

const CONTEXT_BUCKETS: ContextBucket[] = [
  {
    id: 'input',
    label: '输入',
    color: 'bg-sky-500',
    ring: 'ring-sky-400/40',
    // The legend reports the *full* input. The bar segment uses the
    // non-cached portion (computed in the bar) so segments stay
    // non-overlapping; see comment on SessionStatsContextBreakdown.
    selector: (b) => b.inputTokens,
    hint: (b) => (b.cacheTokens > 0 ? `含缓存 ${formatCompactTokens(b.cacheTokens)}` : undefined),
  },
  {
    id: 'cache',
    label: '缓存',
    color: 'bg-violet-500',
    ring: 'ring-violet-400/40',
    selector: (b) => b.cacheTokens,
    hint: (b) =>
      b.inputTokens > 0 ? `占输入 ${((b.cacheTokens / b.inputTokens) * 100).toFixed(1)}%` : undefined,
  },
  {
    id: 'output',
    label: '输出',
    color: 'bg-emerald-500',
    ring: 'ring-emerald-400/40',
    selector: (b) => b.outputTokens,
  },
  {
    id: 'thinking',
    label: '思考',
    color: 'bg-amber-500',
    ring: 'ring-amber-400/40',
    selector: (b) => b.thinkingTokens,
  },
]

/** Same bucket order, but for the stacked bar's visible (non-overlapping)
 *  segments. The visible "input" portion subtracts cache so widths sum. */
function getVisibleBarSegments(b: SessionStatsContextBreakdown): Array<{
  id: ContextBucketId
  value: number
  color: string
}> {
  const cache = Math.max(0, b.cacheTokens)
  const nonCachedInput = Math.max(0, b.inputTokens - cache)
  return [
    { id: 'input',    value: nonCachedInput,        color: 'bg-sky-500' },
    { id: 'cache',    value: cache,                  color: 'bg-violet-500' },
    { id: 'output',   value: Math.max(0, b.outputTokens),   color: 'bg-emerald-500' },
    { id: 'thinking', value: Math.max(0, b.thinkingTokens), color: 'bg-amber-500' },
  ]
}

function ContextBreakdownBar({
  breakdown,
  usedPct,
  activeBucket,
  onHoverBucket,
  onHoverPos,
}: {
  breakdown?: SessionStatsContextBreakdown
  usedPct: number
  activeBucket: ContextBucketId | null
  onHoverBucket: (id: ContextBucketId | null) => void
  onHoverPos: (pos: { x: number; y: number } | null) => void
}) {
  // When the engine hasn't yet reported a breakdown, render a single
  // solid bar so the panel doesn't collapse.
  if (!breakdown) {
    return (
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full bg-sky-500 transition-[width] duration-300"
          style={{ width: `${usedPct}%` }}
        />
      </div>
    )
  }

  const segments = getVisibleBarSegments(breakdown)
  // Sum the visible segment values and scale them so they collectively
  // occupy `usedPct` of the full bar. Using the segment sum (not the
  // raw `used`) as the denominator keeps widths aligned even when the
  // engine's "used" snapshot disagrees with our cumulative total.
  const sum = segments.reduce((s, b) => s + b.value, 0)
  const denom = sum > 0 ? sum : 1

  return (
    // Outer wrapper is taller than the bar so the scaled-up segment
    // doesn't get clipped by `overflow-hidden`. The visual bar lives
    // inside; rounded-full on the inner mask preserves the pill shape.
    <div className="relative mt-2 py-[3px]">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {segments.map((seg) => {
          if (seg.value <= 0) return null
          const widthPct = (seg.value / denom) * usedPct
          if (widthPct <= 0) return null
          const isActive = activeBucket === seg.id
          return (
            <span
              key={seg.id}
              className={cn(
                'h-full transition-transform duration-200 ease-out origin-center',
                seg.color,
                isActive && 'scale-y-[1.6]',
              )}
              style={{ width: `${widthPct}%` }}
              onMouseEnter={(e) => {
                onHoverBucket(seg.id)
                onHoverPos({ x: e.clientX, y: e.clientY })
              }}
              onMouseMove={(e) => onHoverPos({ x: e.clientX, y: e.clientY })}
              onMouseLeave={() => onHoverBucket(null)}
            />
          )
        })}
      </div>
    </div>
  )
}

/**
 * Floating tooltip pinned next to the cursor. `position-fixed` so it
 * spills over the popover's clipped edges; `pointer-events-none` so
 * it doesn't intercept the very hover that drives it.
 *
 * A small (12px) lateral offset keeps the tooltip from sitting under
 * the pointer; near the right edge of the viewport we flip to the
 * left side so the box never clips off-screen.
 */
function ContextBucketFloatingTooltip({
  breakdown,
  activeBucket,
  position,
}: {
  breakdown?: SessionStatsContextBreakdown
  activeBucket: ContextBucketId | null
  position: { x: number; y: number } | null
}) {
  if (!breakdown || !activeBucket || !position) return null
  const bucket = CONTEXT_BUCKETS.find((b) => b.id === activeBucket)
  if (!bucket) return null
  const value = bucket.selector(breakdown)

  // Flip the tooltip to the left of the cursor when too close to the
  // right edge. 220px is a safe upper bound for the box width.
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1024
  const flipLeft = position.x + 220 > viewportW
  const left = flipLeft ? position.x - 12 : position.x + 12
  const transform = flipLeft ? 'translate(-100%, -50%)' : 'translate(0, -50%)'

  return (
    <div
      role="tooltip"
      aria-live="polite"
      className="pointer-events-none fixed z-50 rounded-md border border-border bg-popover px-2.5 py-1 text-[11px] shadow-lg"
      style={{
        left: `${left}px`,
        top: `${position.y}px`,
        transform,
      }}
    >
      <div className="flex items-center gap-2">
        <span className={cn('h-2 w-2 rounded-sm', bucket.color)} />
        <span className="font-semibold text-foreground">{bucket.label}</span>
        <span className="font-mono tabular-nums text-foreground">
          {value.toLocaleString('en-US')}
        </span>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  sub,
  subTone,
}: {
  label: string
  value: string
  sub?: string
  subTone?: 'positive' | 'neutral'
}) {
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2.5">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[20px] font-bold leading-tight tracking-tight text-foreground">{value}</div>
      {sub && (
        <div className={cn(
          'mt-1 text-[10px]',
          subTone === 'positive'
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-muted-foreground',
        )}>
          {subTone === 'positive' && <span className="mr-0.5">↓</span>}
          {sub}
        </div>
      )}
    </div>
  )
}
