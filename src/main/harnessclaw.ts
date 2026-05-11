import { WebSocket } from 'ws'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readEngineConfig } from './config'
import { sanitizeForLogging, writeAppLog } from './logging'

interface HarnessclawConfig {
  enabled: boolean
  host: string
  port: number
  path: string
  token: string
  userId: string
  toolTimeoutMs: number
  bashTimeoutMs: number
  webFetchTimeoutMs: number
  allowedTools: string[]
  deniedTools: string[]
}

interface ToolResultPayload {
  status: 'success' | 'error' | 'denied' | 'timeout' | 'cancelled'
  output?: string
  error?: {
    code: string
    message: string
  }
  metadata?: Record<string, unknown>
}

interface PendingPermissionRequest {
  sessionId: string
  toolName: string
  toolInput: string
  message: string
  isReadOnly: boolean
  options: Array<{ label: string; scope: 'once' | 'session'; allow: boolean }>
}

interface PendingAskQuestionRequest {
  sessionId: string
  optionLabels: string[]
  multi: boolean
}

interface PendingPlanReviewRequest {
  sessionId: string
  planId: string
}

// v2 protocol — per-session card forest. We track cards keyed by card_id and
// accumulate streaming channels (text / tool_input / thinking) per
// (channel, index). When a card closes we emit the appropriate v1-shaped
// compat event so the existing renderer code keeps working unchanged.
interface CardState {
  cardId: string
  parentCardId?: string
  cardKind: string
  agentId?: string
  payload: Record<string, unknown>
  hint?: Record<string, unknown>
  channels: Map<string, Map<number, string>>
  status?: string
  artifacts: Array<Record<string, unknown>>
  // Tool-card bookkeeping. `toolEmitted` tracks whether tool_call/tool_start
  // (or subagent_event tool_start) has been emitted yet. `localResultEmitted`
  // dedups the case where we run a client tool locally AND later receive
  // card.close from the server.
  toolEmitted?: boolean
  toolTarget?: string
  localResultEmitted?: boolean
  // Streamed-text bookkeeping — number of chars already pushed to the renderer
  // as text_delta / thinking compat events, per channel.
  emittedTextLength: number
  emittedThinkingLength: number
}

interface SessionForest {
  cards: Map<string, CardState>
  // agent_ids that were registered via card.add(agent). Used to decide whether
  // to emit main-flow compat events vs. subagent_event variants.
  subagentIds: Set<string>
  agentNames: Map<string, string>
  agentParents: Map<string, string>
  activeTraceId?: string
  lastSeq: number
  // request_id cursors so respond* helpers can map UI replies back to v2
  // prompt requests.
  permissionRequests: Map<string, PendingPermissionRequest>
  askRequests: Map<string, PendingAskQuestionRequest>
  planReviewRequests: Map<string, PendingPlanReviewRequest>
  // plan_id → request_id, so respondPlan(planId,...) can find the right req.
  planIdToRequestId: Map<string, string>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function asPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function parseDurationMs(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }
  if (typeof value !== 'string' || !value.trim()) return fallback

  const normalized = value.trim().toLowerCase()
  const match = normalized.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/)
  if (!match) return fallback

  const amount = Number(match[1])
  const unit = match[2]
  const multiplier = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000
  return Math.max(1, Math.round(amount * multiplier))
}

function makeEventId(prefix = 'evt_client'): string {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
}

function metricsToUsage(metrics: unknown):
  | { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  | undefined {
  if (!isPlainObject(metrics)) return undefined
  const tokensIn = typeof metrics.tokens_in === 'number' ? metrics.tokens_in : 0
  const tokensOut = typeof metrics.tokens_out === 'number' ? metrics.tokens_out : 0
  const cacheRead = typeof metrics.cache_read_tokens === 'number' ? metrics.cache_read_tokens : 0
  const cacheWrite = typeof metrics.cache_write_tokens === 'number' ? metrics.cache_write_tokens : 0
  if (tokensIn === 0 && tokensOut === 0 && cacheRead === 0 && cacheWrite === 0) return undefined
  return {
    prompt_tokens: tokensIn + cacheRead + cacheWrite,
    completion_tokens: tokensOut,
    total_tokens: tokensIn + tokensOut + cacheRead + cacheWrite,
  }
}

function trimOutput(output: string, maxLength = 200_000): { text: string; truncated: boolean } {
  if (output.length <= maxLength) {
    return { text: output, truncated: false }
  }
  return {
    text: `${output.slice(0, maxLength)}\n\n[truncated ${output.length - maxLength} chars]`,
    truncated: true,
  }
}

function combineOutput(stdout: string, stderr: string): string {
  if (stdout && stderr) return `${stdout}${stdout.endsWith('\n') ? '' : '\n'}${stderr}`
  return stdout || stderr
}

function logEngineFrame(direction: 'send' | 'recv', payload: unknown, extra?: Record<string, unknown>): void {
  writeAppLog('trace', 'harnessclaw-engine.frame', `${direction} frame`, {
    ...extra,
    payload: sanitizeForLogging(payload),
  })
}

function logSessionSummary(message: string, meta: Record<string, unknown>): void {
  writeAppLog('debug', 'harnessclaw-engine.session', message, meta)
}

function joinChannel(card: CardState, channel: string): string {
  const buf = card.channels.get(channel)
  if (!buf) return ''
  const indices = [...buf.keys()].sort((a, b) => a - b)
  return indices.map((idx) => buf.get(idx) || '').join('')
}

function appendChannelChunk(card: CardState, channel: string, index: number, chunk: string): void {
  let buf = card.channels.get(channel)
  if (!buf) {
    buf = new Map<number, string>()
    card.channels.set(channel, buf)
  }
  buf.set(index, (buf.get(index) || '') + chunk)
}

type HarnessclawStatus = 'disconnected' | 'connecting' | 'connected'

const HARNESSCLAW_WS_HOST = '0.0.0.0'
const HARNESSCLAW_WS_PORT = 8081
// v2 protocol endpoint (engine mounts v2 wire here).
const HARNESSCLAW_WS_PATH = '/v1/ws'

export class HarnessclawClient extends EventEmitter {
  private ws: WebSocket | null = null
  private status: HarnessclawStatus = 'disconnected'
  private clientId = ''
  private defaultSessionId = ''
  private subscriptions: string[] = []
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryCount = 0
  private maxRetries = 20
  private shouldReconnect = false
  private knownSessions = new Map<string, number>()
  // v0.3 (websocket protocol): when the server advertises capabilities.recovery
  // in `session.event(kind=opened)`, it persists unanswered prompts and will
  // replay them by the same `request_id` on reconnect. We therefore must NOT
  // synthesize cancellation events for in-flight askRequests on WS close —
  // the cards on the renderer should sit and wait for the replay so that the
  // user's reply can still land once the socket comes back.
  private recoveryCapability = false
  // Per-session v2 card-forest state. Each session gets its own forest so
  // multiple subscribed sessions don't collide.
  private forests = new Map<string, SessionForest>()
  private pendingSessionInitId = ''
  private sessionCreateInFlight = false
  private transportWaiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = []
  private sessionInitWaiters: Array<{ resolve: (sessionId: string) => void; reject: (error: Error) => void }> = []
  private pendingPongWaiters: Array<(ok: boolean) => void> = []
  // v0.3 §2.4.2 deferred prompt responses. When the user clicks "answer" on
  // a card that was restored from local UI state (typical after app restart
  // or WS bounce) before the server has finished replaying the matching
  // `prompt.user` frame, the corresponding request_id is not yet in any
  // forest and `this.ws` may not be open. Instead of dropping the reply with
  // "pending askRequest not found", we queue a thunk here and flush it as
  // soon as `handlePromptUser` registers that request_id (or — for plan
  // reviews — the matching plan_id). A 30s safety timer surfaces a hard
  // failure to the renderer if the replay never arrives so the UI doesn't
  // hang silently.
  private deferredAskResponses = new Map<string, { fire: () => boolean; timer: ReturnType<typeof setTimeout>; sessionId?: string }>()
  private deferredPlanResponses = new Map<string, { fire: () => Promise<boolean>; timer: ReturnType<typeof setTimeout>; sessionId: string }>()
  private static readonly DEFERRED_RESPONSE_TIMEOUT_MS = 30_000

  connect(): void {
    const wasReconnecting = this.shouldReconnect
    this.shouldReconnect = true
    if (!wasReconnecting) {
      this.retryCount = 0
    }
    this.attemptConnect()
  }

  private attemptConnect(force = false): void {
    if (!force && this.retryTimer) {
      return
    }

    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }

    if (!force && this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.terminate()
      this.ws = null
    }

    const cfg = this.readConfig()
    if (!cfg || !cfg.enabled) {
      this.setStatus('disconnected')
      this.rejectTransportWaiters(new Error('Harnessclaw websocket channel not found in config'))
      this.emitCompatEvent({ type: 'error', content: 'Harnessclaw websocket channel not found in config' })
      return
    }

    const url = new URL(`ws://${cfg.host}:${cfg.port}${cfg.path.startsWith('/') ? cfg.path : `/${cfg.path}`}`)

    writeAppLog('info', 'harnessclaw-engine.ws', 'Connecting websocket', {
      url: url.toString(),
      attempt: this.retryCount + 1,
    })
    this.setStatus('connecting')

    const headers: Record<string, string> = {}
    if (cfg.token) {
      headers.Authorization = `Bearer ${cfg.token}`
    }

    this.ws = new WebSocket(url, Object.keys(headers).length > 0 ? { headers } : undefined)

    this.ws.on('open', () => {
      writeAppLog('info', 'harnessclaw-engine.ws', 'WebSocket opened')
      this.retryCount = 0
      this.setStatus('connected')
      this.resolveTransportWaiters()
      if (this.pendingSessionInitId) {
        this.sendSessionCreate(this.pendingSessionInitId)
      }
    })

    this.ws.on('message', (data) => {
      try {
        const raw = data.toString()
        const msg = JSON.parse(raw) as Record<string, unknown>
        const envelope = isPlainObject(msg.envelope) ? msg.envelope : {}
        const sessionId = typeof envelope.session_id === 'string' && envelope.session_id
          ? envelope.session_id
          : (typeof msg.session_id === 'string' ? msg.session_id : this.defaultSessionId)
        logEngineFrame('recv', msg, {
          sessionId,
          type: typeof msg.type === 'string' ? msg.type : '',
        })
        this.handleMessage(msg)
      } catch (e) {
        writeAppLog('error', 'harnessclaw-engine.ws', 'Failed to parse websocket frame', {
          error: String(e),
        })
      }
    })

    this.ws.on('error', (err) => {
      writeAppLog('error', 'harnessclaw-engine.ws', 'WebSocket error', {
        error: err.message,
      })
    })

    this.ws.on('close', (code, reason) => {
      writeAppLog(code === 1000 ? 'info' : 'warn', 'harnessclaw-engine.ws', 'WebSocket closed', {
        code,
        reason: reason.toString(),
      })
      const reconnectSessionId = this.pendingSessionInitId || this.defaultSessionId
      this.ws = null
      // v0.3: when the server supports recovery, unanswered prompts will be
      // replayed (with the same request_id) after reconnect, so we keep the
      // renderer cards alive. When recovery is unavailable, the prompts are
      // genuinely lost — synthesize cancellations so cards don't hang.
      if (!this.recoveryCapability) {
        for (const [sid, forest] of this.forests.entries()) {
          for (const requestId of forest.askRequests.keys()) {
            writeAppLog('warn', 'harnessclaw-engine.askQuestion', 'Cancelling pending askRequest due to websocket close (no recovery capability)', {
              sessionId: sid,
              requestId,
            })
            this.emitCompatEvent({
              type: 'ask_user_question_result',
              session_id: sid,
              call_id: requestId,
              status: 'cancelled',
              output: '',
              error: { code: 'connection_lost', message: '连接已断开，该追问已失效，请发起新的会话。' },
            })
          }
        }
        this.forests.clear()
      } else {
        writeAppLog('info', 'harnessclaw-engine.session', 'WebSocket closed; preserving prompt request_id maps for v0.3 replay', {
          pendingForests: this.forests.size,
        })
        // Preserve `permissionRequests / askRequests / planReviewRequests /
        // planIdToRequestId` so user replies that arrive during the
        // reconnect window can still find their target. Reset transient
        // card-forest state — server replay will rebuild it via the same
        // request_id mappings (Map.set is idempotent on duplicate keys).
        for (const forest of this.forests.values()) {
          forest.cards.clear()
          forest.subagentIds.clear()
          forest.agentNames.clear()
          forest.agentParents.clear()
          forest.lastSeq = 0
          forest.activeTraceId = undefined
        }
      }
      this.clientId = ''
      this.defaultSessionId = ''
      this.subscriptions = []
      this.sessionCreateInFlight = false
      this.rejectTransportWaiters(new Error(`Harnessclaw websocket closed: ${code} ${reason.toString()}`))
      this.rejectSessionInitWaiters(new Error(`Harnessclaw websocket closed before session initialized: ${code} ${reason.toString()}`))
      this.resolvePendingPongs(false)
      this.setStatus('disconnected')
      this.pendingSessionInitId = this.shouldReconnect ? reconnectSessionId : ''
      this.scheduleRetry()
    })
  }

  private scheduleRetry(): void {
    if (!this.shouldReconnect) return
    if (this.retryCount >= this.maxRetries) {
      writeAppLog('warn', 'harnessclaw-engine.ws', 'Max retries reached, giving up')
      return
    }
    const delay = Math.min(1000 * Math.max(1, 2 ** Math.min(this.retryCount, 4)), 30_000)
    writeAppLog('info', 'harnessclaw-engine.ws', 'Scheduling reconnect', {
      delay,
      retryCount: this.retryCount,
    })
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.retryCount++
      this.attemptConnect(true)
    }, delay)
  }

  private resolveTransportWaiters(): void {
    const waiters = [...this.transportWaiters]
    this.transportWaiters = []
    waiters.forEach((waiter) => waiter.resolve())
  }

  private rejectTransportWaiters(error: Error): void {
    if (this.transportWaiters.length === 0) return
    const waiters = [...this.transportWaiters]
    this.transportWaiters = []
    waiters.forEach((waiter) => waiter.reject(error))
  }

  private resolveSessionInitWaiters(sessionId: string): void {
    const waiters = [...this.sessionInitWaiters]
    this.sessionInitWaiters = []
    waiters.forEach((waiter) => waiter.resolve(sessionId))
  }

  private rejectSessionInitWaiters(error: Error): void {
    if (this.sessionInitWaiters.length === 0) return
    const waiters = [...this.sessionInitWaiters]
    this.sessionInitWaiters = []
    waiters.forEach((waiter) => waiter.reject(error))
  }

  private resolvePendingPongs(ok: boolean): void {
    if (this.pendingPongWaiters.length === 0) return
    const waiters = [...this.pendingPongWaiters]
    this.pendingPongWaiters = []
    waiters.forEach((waiter) => waiter(ok))
  }

  private waitForTransport(timeoutMs = 8000): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve()
    }

    if (!this.shouldReconnect) {
      this.connect()
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject }
      this.transportWaiters.push(waiter)
      const timer = setTimeout(() => {
        const index = this.transportWaiters.indexOf(waiter)
        if (index >= 0) {
          this.transportWaiters.splice(index, 1)
        }
        reject(new Error('Harnessclaw websocket transport unavailable (timeout)'))
      }, timeoutMs)
      const wrappedResolve = waiter.resolve
      const wrappedReject = waiter.reject
      waiter.resolve = () => {
        clearTimeout(timer)
        wrappedResolve()
      }
      waiter.reject = (error: Error) => {
        clearTimeout(timer)
        wrappedReject(error)
      }
    })
  }

  private sendSessionCreate(sessionId?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.sessionCreateInFlight) return

    const cfg = this.readConfig()
    // v2 §9: { type:'session.create', session_id, capabilities? }
    const payload: Record<string, unknown> = {
      type: 'session.create',
      event_id: makeEventId(),
    }

    if (sessionId) {
      payload.session_id = sessionId
    }
    if (cfg?.userId) {
      payload.user_id = cfg.userId
    }

    this.sessionCreateInFlight = true
    logEngineFrame('send', payload, {
      sessionId,
      type: 'session.create',
    })
    this.ws.send(JSON.stringify(payload))
  }

  private async ensureSession(sessionId: string): Promise<string> {
    const trimmedSessionId = sessionId.trim()
    if (!trimmedSessionId) {
      throw new Error('No active Harnessclaw session')
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.defaultSessionId === trimmedSessionId) {
      return trimmedSessionId
    }

    if (this.pendingSessionInitId === trimmedSessionId && this.sessionInitWaiters.length > 0) {
      return new Promise((resolve, reject) => {
        this.sessionInitWaiters.push({ resolve, reject })
      })
    }

    this.pendingSessionInitId = trimmedSessionId

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.waitForTransport()
    } else if (this.defaultSessionId && this.defaultSessionId !== trimmedSessionId) {
      this.attemptConnect(true)
      await this.waitForTransport()
    } else {
      this.sendSessionCreate(trimmedSessionId)
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.defaultSessionId === trimmedSessionId) {
      this.sessionCreateInFlight = false
      this.pendingSessionInitId = ''
      return trimmedSessionId
    }

    return new Promise((resolve, reject) => {
      this.sessionInitWaiters.push({ resolve, reject })
    })
  }

  // ────────────────────────────────────────────────────────────────────
  //  v2 dispatcher
  // ────────────────────────────────────────────────────────────────────

  private getForest(sessionId: string): SessionForest {
    let forest = this.forests.get(sessionId)
    if (!forest) {
      forest = {
        cards: new Map(),
        subagentIds: new Set(),
        agentNames: new Map(),
        agentParents: new Map(),
        lastSeq: 0,
        permissionRequests: new Map(),
        askRequests: new Map(),
        planReviewRequests: new Map(),
        planIdToRequestId: new Map(),
      }
      this.forests.set(sessionId, forest)
    }
    return forest
  }

  // ─── v0.3 deferred response queue ────────────────────────────────────
  // See §2.4.2: when the server replays an unanswered prompt after
  // reconnect, the user may have already clicked the answer in a card
  // restored from local UI state. The reply IPC arrives before the replay
  // populates `forest.askRequests` / `forest.planIdToRequestId`, so the old
  // implementation dropped it with "pending askRequest not found". We now
  // queue the reply here and flush it the moment `handlePromptUser`
  // registers the matching request_id (or plan_id).

  private queueDeferredAskResponse(requestId: string, sessionId: string | undefined, fire: () => boolean): void {
    const existing = this.deferredAskResponses.get(requestId)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(() => {
      if (this.deferredAskResponses.delete(requestId)) {
        writeAppLog('warn', 'harnessclaw-engine.askQuestion', 'Deferred respondAskQuestion timed out before v0.3 replay arrived', {
          requestId,
          sessionId: sessionId || null,
          timeoutMs: HarnessclawClient.DEFERRED_RESPONSE_TIMEOUT_MS,
        })
        this.emitCompatEvent({
          type: 'ask_user_question_result',
          session_id: sessionId || this.defaultSessionId,
          call_id: requestId,
          status: 'cancelled',
          output: '',
          error: { code: 'recovery_timeout', message: '回答提交超时，对话可能已结束，请发起新的问题。' },
        })
      }
    }, HarnessclawClient.DEFERRED_RESPONSE_TIMEOUT_MS)
    this.deferredAskResponses.set(requestId, { fire, timer, sessionId })
  }

  private flushDeferredAskResponse(requestId: string): void {
    const entry = this.deferredAskResponses.get(requestId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.deferredAskResponses.delete(requestId)
    writeAppLog('info', 'harnessclaw-engine.askQuestion', 'Flushing deferred respondAskQuestion after prompt replay', {
      requestId,
      sessionId: entry.sessionId || null,
    })
    // Defer to next tick so handlePromptUser finishes registering state
    // (emitCompatEvent etc.) before we send the reply.
    setImmediate(() => entry.fire())
  }

  private queueDeferredPlanResponse(planId: string, sessionId: string, fire: () => Promise<boolean>): void {
    const existing = this.deferredPlanResponses.get(planId)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(() => {
      if (this.deferredPlanResponses.delete(planId)) {
        writeAppLog('warn', 'harnessclaw-engine.plan', 'Deferred respondPlan timed out before v0.3 replay arrived', {
          planId,
          sessionId,
          timeoutMs: HarnessclawClient.DEFERRED_RESPONSE_TIMEOUT_MS,
        })
        this.emitCompatEvent({
          type: 'error',
          session_id: sessionId,
          content: `Plan response submit timeout for plan_id=${planId}`,
        })
      }
    }, HarnessclawClient.DEFERRED_RESPONSE_TIMEOUT_MS)
    this.deferredPlanResponses.set(planId, { fire, timer, sessionId })
  }

  private flushDeferredPlanResponse(planId: string): void {
    const entry = this.deferredPlanResponses.get(planId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.deferredPlanResponses.delete(planId)
    writeAppLog('info', 'harnessclaw-engine.plan', 'Flushing deferred respondPlan after plan_review replay', {
      planId,
      sessionId: entry.sessionId,
    })
    setImmediate(() => {
      entry.fire().catch((error) => {
        writeAppLog('error', 'harnessclaw-engine.plan', 'Deferred respondPlan invocation rejected', {
          planId,
          error: String(error),
        })
      })
    })
  }

  private isWebSocketOpen(): boolean {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN)
  }

  private isSubagentContext(forest: SessionForest, agentId?: string): boolean {
    if (!agentId) return false
    if (agentId === 'main') return false
    return forest.subagentIds.has(agentId)
  }

  private resolveAgentInfo(forest: SessionForest, agentId?: string): { agentId: string; agentName: string; isSubagent: boolean } {
    const id = agentId || 'main'
    const isSubagent = this.isSubagentContext(forest, id)
    const name = forest.agentNames.get(id) || (isSubagent ? 'subagent' : '')
    return { agentId: id, agentName: name, isSubagent }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    const type = typeof msg.type === 'string' ? msg.type : ''
    if (!type) return

    const envelope = isPlainObject(msg.envelope) ? msg.envelope : {}
    const sessionId = typeof envelope.session_id === 'string' && envelope.session_id
      ? envelope.session_id
      : (typeof msg.session_id === 'string' ? msg.session_id : this.defaultSessionId)
    const traceId = typeof envelope.trace_id === 'string' ? envelope.trace_id : ''
    const cardId = typeof envelope.card_id === 'string' ? envelope.card_id : ''
    const parentCardId = typeof envelope.parent_card_id === 'string' ? envelope.parent_card_id : undefined
    const cardKind = typeof envelope.card_kind === 'string' ? envelope.card_kind : ''
    const agentId = typeof envelope.agent_id === 'string' ? envelope.agent_id : undefined
    const seq = typeof envelope.seq === 'number' ? envelope.seq : 0
    const hint = isPlainObject(msg.hint) ? msg.hint : undefined
    const metrics = isPlainObject(msg.metrics) ? msg.metrics : undefined
    const payload = isPlainObject(msg.payload) ? msg.payload : {}

    const forest = sessionId ? this.getForest(sessionId) : undefined
    if (forest) {
      if (seq > forest.lastSeq) forest.lastSeq = seq
      if (traceId) forest.activeTraceId = traceId
    }

    switch (type) {
      case 'session.event':
        this.handleSessionEvent(sessionId, payload, msg)
        return

      case 'prompt.user':
        this.handlePromptUser(sessionId, agentId, payload)
        return

      case 'prompt.reply':
        // v2 §7.2 — server echo of the user's decision. The renderer dismisses
        // its modal optimistically when it sends the response, so we only log
        // here for diagnostics.
        writeAppLog('debug', 'harnessclaw-engine.session', 'prompt.reply', {
          sessionId,
          payload: sanitizeForLogging(payload),
        })
        return
    }

    if (!forest || !cardId || !cardKind) return

    switch (type) {
      case 'card.add':
        this.handleCardAdd(sessionId, forest, { cardId, parentCardId, cardKind, agentId, traceId, payload, hint })
        return
      case 'card.set':
        this.handleCardSet(sessionId, forest, { cardId, cardKind, agentId, traceId, payload })
        return
      case 'card.append':
        this.handleCardAppend(sessionId, forest, { cardId, cardKind, agentId, traceId, payload })
        return
      case 'card.tick':
        this.handleCardTick(sessionId, forest, { cardId, cardKind, agentId, traceId, payload })
        return
      case 'card.close':
        this.handleCardClose(sessionId, forest, { cardId, cardKind, agentId, traceId, payload, metrics, hint })
        return
      default:
        // Unknown type — forward as raw event for diagnostics.
        this.emit('event', msg)
    }
  }

  // ─── session.event ───────────────────────────────────────────────────
  private handleSessionEvent(sessionId: string, payload: Record<string, unknown>, msg: Record<string, unknown>): void {
    const kind = typeof payload.kind === 'string' ? payload.kind : ''
    const inner = isPlainObject(payload.inner) ? payload.inner : {}

    switch (kind) {
      case 'opened': {
        const sid = sessionId || this.pendingSessionInitId || ''
        if (sid) {
          this.defaultSessionId = sid
          this.knownSessions.set(sid, Date.now())
        }
        this.pendingSessionInitId = ''
        this.sessionCreateInFlight = false
        this.clientId = sid ? `session:${sid}` : ''
        this.subscriptions = sid ? [sid] : []
        this.resolveSessionInitWaiters(sid)

        const capabilities = isPlainObject(inner.capabilities) ? inner.capabilities : {}
        this.recoveryCapability = capabilities.recovery === true
        writeAppLog('info', 'harnessclaw-engine.session', 'Session opened', {
          sessionId: sid,
          recoveryCapability: this.recoveryCapability,
        })
        this.emitCompatEvent({
          type: 'session_created',
          session_id: sid,
          client_id: this.clientId,
          protocol_version: typeof inner.protocol_version === 'string' ? inner.protocol_version : '2.0',
          capabilities,
          session: { session_id: sid, capabilities },
        })
        // Legacy shim — older renderer code hooks "connected".
        this.emitCompatEvent({
          type: 'connected',
          session_id: sid,
          client_id: this.clientId,
        })
        this.emitSessions()
        return
      }

      case 'updated': {
        this.emitCompatEvent({
          type: 'session_updated',
          session_id: sessionId,
          payload: inner,
        })
        return
      }

      case 'pong': {
        const waiter = this.pendingPongWaiters.shift()
        if (waiter) waiter(true)
        this.emitCompatEvent({ type: 'pong' })
        return
      }

      case 'resumed': {
        this.emitCompatEvent({
          type: 'session_resumed',
          session_id: sessionId,
          trace_id: typeof inner.trace_id === 'string' ? inner.trace_id : '',
          from_seq: typeof inner.from_seq === 'number' ? inner.from_seq : 0,
          to_seq: typeof inner.to_seq === 'number' ? inner.to_seq : 0,
        })
        return
      }

      case 'resume_failed': {
        this.emitCompatEvent({
          type: 'session_resume_failed',
          session_id: sessionId,
          trace_id: typeof inner.trace_id === 'string' ? inner.trace_id : '',
          reason: typeof inner.reason === 'string' ? inner.reason : '',
        })
        return
      }

      case 'error': {
        const error = isPlainObject(inner.error) ? inner.error : inner
        const content = typeof error.message === 'string'
          ? error.message
          : typeof error.user_message === 'string' ? error.user_message : 'Unknown websocket error'
        writeAppLog('error', 'harnessclaw-engine.session', 'Session error frame received', {
          sessionId,
          message: content,
          error: sanitizeForLogging(error),
        })
        if (this.pendingSessionInitId) {
          this.pendingSessionInitId = ''
          this.sessionCreateInFlight = false
          this.rejectSessionInitWaiters(new Error(content))
        }
        this.emitCompatEvent({
          type: 'error',
          session_id: sessionId,
          content,
          error,
          payload: inner,
        })
        return
      }

      default:
        writeAppLog('debug', 'harnessclaw-engine.session', 'Unknown session.event kind', {
          sessionId,
          kind,
          payload: sanitizeForLogging(msg),
        })
    }
  }

  // ─── prompt.user ─────────────────────────────────────────────────────
  private handlePromptUser(sessionId: string, _agentId: string | undefined, payload: Record<string, unknown>): void {
    if (!sessionId) return
    const forest = this.getForest(sessionId)
    const requestId = typeof payload.request_id === 'string' ? payload.request_id : ''
    const kind = typeof payload.kind === 'string' ? payload.kind : ''
    const inner = isPlainObject(payload.inner) ? payload.inner : {}
    const timeoutMs = typeof payload.timeout_ms === 'number' ? payload.timeout_ms : 0

    if (!requestId || !kind) return

    switch (kind) {
      case 'permission': {
        const toolName = typeof inner.tool_name === 'string' ? inner.tool_name : ''
        const toolInput = typeof inner.tool_input === 'string'
          ? inner.tool_input
          : isPlainObject(inner.tool_input) || Array.isArray(inner.tool_input)
            ? JSON.stringify(inner.tool_input)
            : ''
        const message = typeof inner.message === 'string' ? inner.message : ''
        const isReadOnly = inner.is_read_only === true
        const rawOptions = Array.isArray(inner.options) ? inner.options : []
        const options = rawOptions.flatMap((option) => {
          if (!isPlainObject(option)) return []
          const label = typeof option.label === 'string' ? option.label : ''
          if (!label) return []
          const scope: 'once' | 'session' = option.scope === 'session' ? 'session' : 'once'
          const allow = option.allow === true
          return [{ label, scope, allow }]
        })

        forest.permissionRequests.set(requestId, {
          sessionId,
          toolName,
          toolInput,
          message,
          isReadOnly,
          options,
        })

        this.emitCompatEvent({
          type: 'permission_request',
          session_id: sessionId,
          request_id: requestId,
          name: toolName,
          tool_input: toolInput,
          content: message,
          is_read_only: isReadOnly,
          options,
          timeout_ms: timeoutMs,
        })
        return
      }

      case 'question': {
        const question = typeof inner.question === 'string' ? inner.question : ''
        const rawOptions = Array.isArray(inner.options) ? inner.options : []
        const options = rawOptions.flatMap((option) => {
          if (!isPlainObject(option)) return []
          const label = typeof option.label === 'string' ? option.label : ''
          if (!label) return []
          const description = typeof option.description === 'string' ? option.description : undefined
          return [description ? { label, description } : { label }]
        })
        const multi = inner.multi === true
        const allowCustom = inner.allow_custom !== false

        forest.askRequests.set(requestId, {
          sessionId,
          optionLabels: options.map((opt) => opt.label),
          multi,
        })

        // v0.3 §2.4.2 — if the user already clicked answer before the
        // replay arrived (typical after app restart), flush the queued
        // reply now that the request_id is registered.
        this.flushDeferredAskResponse(requestId)

        this.emitCompatEvent({
          type: 'ask_user_question',
          session_id: sessionId,
          request_id: requestId,
          // The renderer keys ask-question state by call_id; use request_id as
          // the call_id so subsequent respondAskQuestion(toolUseId,...) round-
          // trips correctly.
          call_id: requestId,
          tool_name: 'AskUserQuestion',
          question,
          options,
          multi,
          allow_custom: allowCustom,
          timeout_ms: timeoutMs,
        })
        return
      }

      case 'plan_review': {
        const planId = typeof inner.plan_id === 'string' ? inner.plan_id : ''
        const goal = typeof inner.goal === 'string' ? inner.goal : ''
        const rationale = typeof inner.rationale === 'string' ? inner.rationale : ''
        const rawSteps = Array.isArray(inner.steps) ? inner.steps : []
        const steps = rawSteps.flatMap((step) => {
          if (!isPlainObject(step)) return []
          const id = typeof step.id === 'string' ? step.id : (typeof step.step_id === 'string' ? step.step_id : '')
          if (!id) return []
          return [{
            id,
            subagent_type: typeof step.subagent_type === 'string' ? step.subagent_type : undefined,
            description: typeof step.description === 'string' ? step.description : undefined,
            prompt: typeof step.prompt === 'string' ? step.prompt : undefined,
            depends_on: Array.isArray(step.depends_on)
              ? step.depends_on.filter((d): d is string => typeof d === 'string')
              : undefined,
          }]
        })
        const availableSubagents = asStringArray(inner.available_subagents)

        forest.planReviewRequests.set(requestId, { sessionId, planId })
        if (planId) forest.planIdToRequestId.set(planId, requestId)

        // v0.3 §2.4.2 — flush any queued plan response that arrived before
        // this replay re-registered the plan_id ↔ request_id mapping.
        if (planId) this.flushDeferredPlanResponse(planId)

        this.emitCompatEvent({
          type: 'plan_proposed',
          session_id: sessionId,
          request_id: requestId,
          plan_id: planId,
          agent_id: typeof inner.agent_id === 'string' ? inner.agent_id : '',
          goal,
          rationale,
          steps,
          available_subagents: availableSubagents,
          rejection_reason: typeof inner.rejection_reason === 'string' ? inner.rejection_reason : '',
          timeout_ms: timeoutMs,
        })
        return
      }

      default:
        writeAppLog('debug', 'harnessclaw-engine.session', 'Unknown prompt.user kind', {
          sessionId,
          kind,
        })
    }
  }

  // ─── card.add ────────────────────────────────────────────────────────
  private handleCardAdd(
    sessionId: string,
    forest: SessionForest,
    args: {
      cardId: string
      parentCardId?: string
      cardKind: string
      agentId?: string
      traceId: string
      payload: Record<string, unknown>
      hint?: Record<string, unknown>
    },
  ): void {
    const card: CardState = {
      cardId: args.cardId,
      parentCardId: args.parentCardId,
      cardKind: args.cardKind,
      agentId: args.agentId,
      payload: { ...args.payload },
      hint: args.hint,
      channels: new Map(),
      artifacts: [],
      emittedTextLength: 0,
      emittedThinkingLength: 0,
    }
    forest.cards.set(args.cardId, card)

    switch (args.cardKind) {
      case 'turn': {
        this.emitCompatEvent({
          type: 'turn_start',
          session_id: sessionId,
          request_id: args.traceId,
          message: { id: args.cardId, role: 'assistant' },
        })
        return
      }

      case 'message': {
        // Sub-agent message cards carry sub-agent text — historically the
        // server didn't stream those (renderer comment in ChatPage.tsx
        // around line 3189 documents the v1.10+ contract). We keep that
        // behaviour: skip turn_start so we don't kick the renderer into a
        // fresh assistant message for a subagent's internal thinking.
        const info = this.resolveAgentInfo(forest, args.agentId)
        if (info.isSubagent) return
        // We don't emit a turn_start per message — the turn card already
        // emitted it. message cards just exist to anchor channels.
        return
      }

      case 'tool': {
        const toolName = typeof args.payload.name === 'string' ? args.payload.name : ''
        const target = typeof args.payload.target === 'string' ? args.payload.target : 'server'
        const intent = typeof args.payload.intent === 'string' ? args.payload.intent : ''
        const input = isPlainObject(args.payload.input) ? args.payload.input : {}
        card.toolTarget = target

        this.emitToolStart(sessionId, forest, card, toolName, target, intent, input, args.traceId)

        if (target === 'client') {
          // v2 client tools: execute locally and send tool.result back.
          void this.executeToolCall(sessionId, args.cardId, toolName, input, this.resolveAgentInfo(forest, args.agentId).isSubagent, card)
        }
        return
      }

      case 'agent': {
        // Register the agent_id (== card_id per v2 §14.3) as a sub-agent.
        forest.subagentIds.add(args.cardId)
        const name = typeof args.payload.name === 'string' ? args.payload.name : 'subagent'
        forest.agentNames.set(args.cardId, name)
        const parentAgentId = typeof args.payload.parent_agent_id === 'string'
          ? args.payload.parent_agent_id
          : 'main'
        forest.agentParents.set(args.cardId, parentAgentId)

        this.emitCompatEvent({
          type: 'subagent_start',
          session_id: sessionId,
          agent_id: args.cardId,
          agent_name: name,
          description: typeof args.payload.description === 'string' ? args.payload.description : '',
          task: typeof args.payload.task_prompt === 'string' ? args.payload.task_prompt : '',
          agent_type: typeof args.payload.agent_type === 'string' ? args.payload.agent_type : 'sync',
          parent_agent_id: parentAgentId,
        })
        return
      }

      case 'plan': {
        const planId = typeof args.payload.plan_id === 'string' ? args.payload.plan_id : args.cardId
        const rawSteps = Array.isArray(args.payload.steps) ? args.payload.steps : []
        const tasks = rawSteps.flatMap((step) => {
          if (!isPlainObject(step)) return []
          const stepId = typeof step.step_id === 'string'
            ? step.step_id
            : (typeof step.id === 'string' ? step.id : '')
          if (!stepId) return []
          return [{
            task_id: stepId,
            subagent_type: typeof step.subagent_type === 'string' ? step.subagent_type : undefined,
            user_facing_title: typeof step.user_facing_title === 'string' ? step.user_facing_title : undefined,
            user_facing_summary: typeof step.user_facing_summary === 'string' ? step.user_facing_summary : undefined,
            depends_on: Array.isArray(step.depends_on)
              ? step.depends_on.filter((d): d is string => typeof d === 'string')
              : undefined,
          }]
        })
        this.emitCompatEvent({
          type: 'plan_created',
          session_id: sessionId,
          plan_id: planId,
          agent_id: args.agentId || '',
          goal: typeof args.payload.goal === 'string' ? args.payload.goal : '',
          strategy: typeof args.payload.strategy === 'string' ? args.payload.strategy : '',
          status: 'created',
          tasks,
          display: {},
        })
        return
      }

      case 'step': {
        const stepId = typeof args.payload.step_id === 'string' ? args.payload.step_id : args.cardId
        this.emitCompatEvent({
          type: 'step_dispatched',
          session_id: sessionId,
          agent_id: args.agentId || '',
          step_id: stepId,
          subagent_type: typeof args.payload.subagent_type === 'string' ? args.payload.subagent_type : undefined,
          input_summary: typeof args.payload.input_summary === 'string' ? args.payload.input_summary : undefined,
          attempts: typeof args.payload.attempts === 'number' ? args.payload.attempts : undefined,
        })
        return
      }

      case 'artifact': {
        // Accumulate ArtifactRef on the parent card so it can ride along with
        // tool_end / subagent_end metadata.
        const artifactRef = {
          artifact_id: typeof args.payload.artifact_id === 'string' ? args.payload.artifact_id : args.cardId,
          name: typeof args.payload.name === 'string' ? args.payload.name : '',
          type: typeof args.payload.type === 'string' ? args.payload.type : '',
          mime_type: typeof args.payload.mime_type === 'string' ? args.payload.mime_type : undefined,
          size_bytes: typeof args.payload.size_bytes === 'number' ? args.payload.size_bytes : undefined,
          description: typeof args.payload.description === 'string' ? args.payload.description : undefined,
          role: typeof args.payload.role === 'string' ? args.payload.role : undefined,
        }
        if (args.parentCardId) {
          const parent = forest.cards.get(args.parentCardId)
          if (parent) parent.artifacts.push(artifactRef)
        }
        return
      }

      case 'thinking':
      case 'memory_op':
      case 'budget':
      case 'todo':
      case 'team':
        // No clean v1 compat-event mapping. Silently drop; renderer ignores
        // unknown types via its default case. Documented in summary.
        return
    }
  }

  private emitToolStart(
    sessionId: string,
    forest: SessionForest,
    card: CardState,
    toolName: string,
    _target: string,
    intent: string,
    input: Record<string, unknown>,
    traceId: string,
  ): void {
    if (card.toolEmitted) return
    card.toolEmitted = true

    const info = this.resolveAgentInfo(forest, card.agentId)
    if (info.isSubagent) {
      this.emitCompatEvent({
        type: 'subagent_event',
        session_id: sessionId,
        agent_id: info.agentId,
        agent_name: info.agentName,
        payload: {
          event_type: 'tool_start',
          tool_use_id: card.cardId,
          tool_name: toolName,
          input,
          intent,
        },
      })
      return
    }

    this.emitCompatEvent({
      type: 'tool_call',
      session_id: sessionId,
      request_id: traceId,
      name: toolName,
      tool_name: toolName,
      arguments: input,
      input,
      call_id: card.cardId,
      tool_use_id: card.cardId,
      intent: intent || undefined,
    })
  }

  // ─── card.set ────────────────────────────────────────────────────────
  private handleCardSet(
    sessionId: string,
    forest: SessionForest,
    args: {
      cardId: string
      cardKind: string
      agentId?: string
      traceId: string
      payload: Record<string, unknown>
    },
  ): void {
    const card = forest.cards.get(args.cardId)
    if (card) {
      card.payload = { ...card.payload, ...args.payload }
    }

    switch (args.cardKind) {
      case 'plan': {
        const planId = card && typeof card.payload.plan_id === 'string' ? card.payload.plan_id : args.cardId
        const rawSteps = card && Array.isArray(card.payload.steps) ? card.payload.steps : (Array.isArray(args.payload.steps) ? args.payload.steps : [])
        const tasks = rawSteps.flatMap((step) => {
          if (!isPlainObject(step)) return []
          const stepId = typeof step.step_id === 'string'
            ? step.step_id
            : (typeof step.id === 'string' ? step.id : '')
          if (!stepId) return []
          return [{
            task_id: stepId,
            subagent_type: typeof step.subagent_type === 'string' ? step.subagent_type : undefined,
            user_facing_title: typeof step.user_facing_title === 'string' ? step.user_facing_title : undefined,
            depends_on: Array.isArray(step.depends_on)
              ? step.depends_on.filter((d): d is string => typeof d === 'string')
              : undefined,
          }]
        })
        this.emitCompatEvent({
          type: 'plan_updated',
          session_id: sessionId,
          plan_id: planId,
          agent_id: args.agentId || '',
          goal: card && typeof card.payload.goal === 'string' ? card.payload.goal : '',
          strategy: card && typeof card.payload.strategy === 'string' ? card.payload.strategy : '',
          status: typeof args.payload.status === 'string' ? args.payload.status : '',
          tasks,
          display: {},
        })
        return
      }

      case 'step': {
        const stepId = card && typeof card.payload.step_id === 'string' ? card.payload.step_id : args.cardId
        const status = typeof args.payload.status === 'string' ? args.payload.status : ''
        if (status === 'running') {
          this.emitCompatEvent({
            type: 'step_started',
            session_id: sessionId,
            agent_id: args.agentId || '',
            step_id: stepId,
            subagent_type: card && typeof card.payload.subagent_type === 'string'
              ? card.payload.subagent_type
              : (typeof args.payload.subagent_type === 'string' ? args.payload.subagent_type : undefined),
          })
        }
        return
      }
    }
  }

  // ─── card.append ─────────────────────────────────────────────────────
  private handleCardAppend(
    sessionId: string,
    forest: SessionForest,
    args: {
      cardId: string
      cardKind: string
      agentId?: string
      traceId: string
      payload: Record<string, unknown>
    },
  ): void {
    const card = forest.cards.get(args.cardId)
    if (!card) return

    const channel = typeof args.payload.channel === 'string' ? args.payload.channel : ''
    const index = typeof args.payload.index === 'number' ? args.payload.index : 0
    const chunk = typeof args.payload.chunk === 'string' ? args.payload.chunk : ''
    const partialJson = typeof args.payload.partial_json === 'string' ? args.payload.partial_json : ''
    const text = chunk || partialJson
    if (!channel || !text) return

    appendChannelChunk(card, channel, index, text)

    const info = this.resolveAgentInfo(forest, args.agentId)
    // v1.10+ contract: sub-agent text is NOT streamed to the user. Skip
    // emission for sub-agent-context message channels — accumulate-only.
    if (info.isSubagent) return

    if (channel === 'text') {
      this.emitCompatEvent({
        type: 'text_delta',
        session_id: sessionId,
        request_id: args.traceId,
        content: chunk,
      })
      const accumulated = joinChannel(card, 'text')
      card.emittedTextLength = accumulated.length
      return
    }

    if (channel === 'thinking') {
      const accumulated = joinChannel(card, 'thinking')
      card.emittedThinkingLength = accumulated.length
      this.emitCompatEvent({
        type: 'thinking',
        session_id: sessionId,
        request_id: args.traceId,
        content: accumulated,
      })
      return
    }

    // channel === 'tool_input' — buffered only; the matching card.add(tool)
    // already carries the parsed input. No compat event for input_json_delta
    // (renderer doesn't consume it).
  }

  // ─── card.tick ───────────────────────────────────────────────────────
  private handleCardTick(
    sessionId: string,
    forest: SessionForest,
    args: {
      cardId: string
      cardKind: string
      agentId?: string
      traceId: string
      payload: Record<string, unknown>
    },
  ): void {
    const kind = typeof args.payload.kind === 'string' ? args.payload.kind : ''
    const inner = isPlainObject(args.payload.inner) ? args.payload.inner : {}

    switch (kind) {
      case 'intent': {
        const intent = typeof inner.intent === 'string' ? inner.intent : ''
        if (!intent) return
        const info = this.resolveAgentInfo(forest, args.agentId)
        const card = forest.cards.get(args.cardId)
        // v2 §11: card.tick(kind=intent) lives on a tool card; the tool's
        // card_id IS the tool_use_id the renderer cares about for shimmer
        // attribution.
        const toolUseId = card && card.cardKind === 'tool' ? card.cardId : args.cardId

        this.emitCompatEvent({
          type: 'agent_intent',
          session_id: sessionId,
          agent_id: info.agentId,
          agent_name: info.agentName,
          tool_use_id: toolUseId,
          tool_name: card && typeof card.payload.name === 'string' ? card.payload.name : '',
          intent,
          from_subagent: info.isSubagent,
        })
        return
      }

      // progress / heartbeat / note / escalation — renderer doesn't currently
      // surface these. Keep them as a no-op so they don't pollute logs.
      default:
        return
    }
  }

  // Container-type cards may receive a synthetic card.close{status:"failed",
  // error.type:"orphan_timeout"} from the server's watchdog while their
  // sub-tree (sub-agent, step, tool) is still actively running — this has
  // been observed for Specialists/Task tool cards and the plan/step/agent
  // cards beneath them. The server is fixing the root cause (P0+P1), but
  // we keep a defense-in-depth filter here so any future regression where a
  // container card receives a fake orphan_timeout close while it still has
  // live children won't surface to the user as a misleading "failed" state.
  private isFalseOrphanClose(
    forest: SessionForest,
    cardId: string,
    cardKind: string,
    status: string,
    errorInfo: Record<string, unknown> | undefined,
  ): boolean {
    if (status !== 'failed' && status !== 'error') return false
    const errorType = errorInfo && typeof errorInfo.type === 'string' ? errorInfo.type : ''
    if (errorType !== 'orphan_timeout') return false
    // Only protect container-type cards that legitimately wrap a sub-tree.
    if (cardKind !== 'tool' && cardKind !== 'agent' && cardKind !== 'plan' && cardKind !== 'step') {
      return false
    }
    // Walk the card forest looking for any descendant that has not yet been
    // closed (status unset). Direct + transitive check via BFS.
    const queue: string[] = [cardId]
    const seen = new Set<string>(queue)
    while (queue.length > 0) {
      const current = queue.shift() as string
      for (const candidate of forest.cards.values()) {
        if (candidate.parentCardId !== current) continue
        if (seen.has(candidate.cardId)) continue
        seen.add(candidate.cardId)
        if (!candidate.status) return true
        queue.push(candidate.cardId)
      }
    }
    return false
  }

  // ─── card.close ──────────────────────────────────────────────────────
  private handleCardClose(
    sessionId: string,
    forest: SessionForest,
    args: {
      cardId: string
      cardKind: string
      agentId?: string
      traceId: string
      payload: Record<string, unknown>
      metrics?: Record<string, unknown>
      hint?: Record<string, unknown>
    },
  ): void {
    const card = forest.cards.get(args.cardId)
    const status = typeof args.payload.status === 'string' ? args.payload.status : 'ok'
    const inner = isPlainObject(args.payload.inner) ? args.payload.inner : {}
    const errorInfo = isPlainObject(args.payload.error) ? args.payload.error : undefined

    // Defense-in-depth: suppress synthetic orphan_timeout failures emitted
    // while the card still has live children. Don't update card.status, don't
    // emit any compat event — a real terminal close (if any) will arrive
    // later and be processed normally.
    if (this.isFalseOrphanClose(forest, args.cardId, args.cardKind, status, errorInfo)) {
      writeAppLog('warn', 'harnessclaw-engine.session', 'Suppressed false orphan_timeout card.close (children still open)', {
        sessionId,
        cardId: args.cardId,
        cardKind: args.cardKind,
        traceId: args.traceId,
      })
      return
    }

    if (card) {
      card.status = status
      // Merge inner into the cached payload, but never let a server-sent empty
      // string overwrite an existing non-empty value (e.g. orphan_timeout / late
      // close frames frequently arrive with inner.step_id="" which would wipe
      // out the original step_id from card.add and cause downstream events to
      // be dropped). Non-string fields fall through to a plain overwrite.
      const mergedPayload: Record<string, unknown> = { ...card.payload }
      for (const [key, value] of Object.entries(inner)) {
        if (typeof value === 'string' && value === '' && typeof mergedPayload[key] === 'string' && mergedPayload[key] !== '') {
          continue
        }
        mergedPayload[key] = value
      }
      card.payload = mergedPayload
    }

    switch (args.cardKind) {
      case 'turn': {
        const usage = metricsToUsage(args.metrics)
        const durationMs = args.metrics && typeof args.metrics.duration_ms === 'number' ? args.metrics.duration_ms : undefined
        if (status === 'cancelled' || status === 'aborted') {
          this.emitCompatEvent({
            type: 'stopped',
            session_id: sessionId,
            request_id: args.traceId,
            usage,
          })
        } else if (status === 'failed' || status === 'error') {
          writeAppLog('warn', 'harnessclaw-engine.session', 'Turn finished with exception', {
            sessionId,
            traceId: args.traceId,
            status,
            durationMs,
            usage,
          })
          this.emitCompatEvent({
            type: 'response_end',
            session_id: sessionId,
            request_id: args.traceId,
            usage,
            status,
            duration_ms: durationMs,
            error: errorInfo,
          })
        } else {
          logSessionSummary('Turn completed', {
            sessionId,
            traceId: args.traceId,
            status,
            durationMs,
            usage,
          })
          this.emitCompatEvent({
            type: 'response_end',
            session_id: sessionId,
            request_id: args.traceId,
            usage,
            status,
            duration_ms: durationMs,
          })
        }
        if (sessionId) this.knownSessions.set(sessionId, Date.now())
        this.emitSessions()
        return
      }

      case 'message': {
        // No compat event — renderer treats text streaming as continuous and
        // expects response_end (turn close) to clear isStreaming.
        return
      }

      case 'tool': {
        const info = this.resolveAgentInfo(forest, args.agentId)
        // If we already emitted the tool_result locally during executeToolCall
        // (client tool path), suppress this echo so the renderer doesn't get
        // a duplicate ToolActivity entry.
        if (card && card.localResultEmitted) {
          return
        }

        const toolName = card && typeof card.payload.name === 'string'
          ? card.payload.name
          : (typeof inner.name === 'string' ? inner.name : '')
        const output = typeof inner.output === 'string'
          ? inner.output
          : typeof args.payload.output === 'string' ? args.payload.output : ''
        const errMsg = errorInfo && typeof errorInfo.user_message === 'string'
          ? errorInfo.user_message
          : (errorInfo && typeof errorInfo.message === 'string' ? errorInfo.message : '')
        const content = output || errMsg || ''
        const isError = status === 'failed' || status === 'cancelled' || !!errorInfo
        const renderHint = typeof inner.render_hint === 'string'
          ? inner.render_hint
          : (typeof args.payload.render_hint === 'string' ? args.payload.render_hint : (args.hint && typeof args.hint.render_hint === 'string' ? args.hint.render_hint : undefined))
        const language = typeof inner.language === 'string' ? inner.language : undefined
        const filePath = typeof inner.file_path === 'string' ? inner.file_path : undefined
        const durationMs = args.metrics && typeof args.metrics.duration_ms === 'number' ? args.metrics.duration_ms : undefined
        const innerArtifacts = Array.isArray(inner.artifacts) ? inner.artifacts : []
        const aggregated = card ? card.artifacts.concat(innerArtifacts) : innerArtifacts
        const baseMetadata = isPlainObject(inner.metadata)
          ? { ...inner.metadata }
          : {}
        const metadata = aggregated.length > 0
          ? { ...baseMetadata, artifacts: aggregated }
          : baseMetadata

        if (info.isSubagent) {
          this.emitCompatEvent({
            type: 'subagent_event',
            session_id: sessionId,
            agent_id: info.agentId,
            agent_name: info.agentName,
            payload: {
              event_type: 'tool_end',
              tool_use_id: args.cardId,
              tool_name: toolName,
              output: content,
              content,
              is_error: isError,
              status,
              duration_ms: durationMs,
              render_hint: renderHint,
              language,
              file_path: filePath,
              artifacts: aggregated,
              metadata,
            },
          })
          return
        }

        this.emitCompatEvent({
          type: 'tool_result',
          session_id: sessionId,
          request_id: args.traceId,
          name: toolName,
          tool_name: toolName,
          content,
          output: content,
          call_id: args.cardId,
          tool_use_id: args.cardId,
          is_error: isError,
          status,
          duration_ms: durationMs,
          render_hint: renderHint,
          language,
          file_path: filePath,
          metadata,
          error: errorInfo,
        })
        return
      }

      case 'agent': {
        const usage = metricsToUsage(args.metrics)
        const numTurns = typeof inner.num_turns === 'number'
          ? inner.num_turns
          : (typeof args.payload.num_turns === 'number' ? args.payload.num_turns : undefined)
        const durationMs = args.metrics && typeof args.metrics.duration_ms === 'number' ? args.metrics.duration_ms : undefined
        const deniedTools = asStringArray(inner.denied_tools).length > 0
          ? asStringArray(inner.denied_tools)
          : asStringArray(args.payload.denied_tools)
        const innerArtifacts = Array.isArray(inner.artifacts) ? inner.artifacts : []
        const aggregated = card ? card.artifacts.concat(innerArtifacts) : innerArtifacts
        const agentName = forest.agentNames.get(args.cardId)
          || (card && typeof card.payload.name === 'string' ? card.payload.name : 'subagent')

        let mappedStatus: string
        if (status === 'ok') mappedStatus = 'completed'
        else if (status === 'failed') mappedStatus = 'error'
        else if (status === 'cancelled') mappedStatus = 'aborted'
        else if (status === 'skipped') mappedStatus = 'completed'
        else mappedStatus = status

        this.emitCompatEvent({
          type: 'subagent_end',
          session_id: sessionId,
          agent_id: args.cardId,
          agent_name: agentName,
          status: mappedStatus,
          duration_ms: durationMs,
          num_turns: numTurns,
          usage,
          denied_tools: deniedTools,
          artifacts: aggregated,
          error: errorInfo,
        })
        return
      }

      case 'plan': {
        const planId = card && typeof card.payload.plan_id === 'string' ? card.payload.plan_id : args.cardId
        if (status === 'ok') {
          this.emitCompatEvent({
            type: 'plan_completed',
            session_id: sessionId,
            agent_id: args.agentId || '',
            plan_id: planId,
            status,
          })
        } else {
          this.emitCompatEvent({
            type: 'plan_failed',
            session_id: sessionId,
            agent_id: args.agentId || '',
            plan_id: planId,
            status,
            error: errorInfo,
          })
        }
        return
      }

      case 'step': {
        const stepId = card && typeof card.payload.step_id === 'string' ? card.payload.step_id : args.cardId
        const subagentType = card && typeof card.payload.subagent_type === 'string' ? card.payload.subagent_type : undefined
        if (status === 'ok') {
          this.emitCompatEvent({
            type: 'step_completed',
            session_id: sessionId,
            agent_id: args.agentId || '',
            step_id: stepId,
            subagent_type: subagentType,
            output_summary: typeof inner.output_summary === 'string' ? inner.output_summary : undefined,
            deliverables: Array.isArray(inner.deliverables) ? inner.deliverables : undefined,
            attempts: typeof inner.attempts === 'number' ? inner.attempts : undefined,
          })
        } else if (status === 'skipped') {
          this.emitCompatEvent({
            type: 'step_skipped',
            session_id: sessionId,
            agent_id: args.agentId || '',
            step_id: stepId,
            subagent_type: subagentType,
            reason: typeof inner.reason === 'string'
              ? inner.reason
              : (errorInfo && typeof errorInfo.message === 'string' ? errorInfo.message : undefined),
          })
        } else {
          this.emitCompatEvent({
            type: 'step_failed',
            session_id: sessionId,
            agent_id: args.agentId || '',
            step_id: stepId,
            subagent_type: subagentType,
            error: errorInfo,
            attempts: typeof inner.attempts === 'number' ? inner.attempts : undefined,
          })
        }
        return
      }

      case 'artifact':
      case 'thinking':
      case 'memory_op':
      case 'budget':
      case 'todo':
      case 'team':
        // No compat-event mapping. Documented in summary.
        return
    }
  }

  private emitCompatEvent(event: Record<string, unknown>): void {
    this.emit('event', event)
  }

  private emitSessions(): void {
    const sessions = [...this.knownSessions.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([key, updatedAt]) => ({ key, updated_at: updatedAt }))
    this.emitCompatEvent({ type: 'sessions', sessions })
  }

  // ────────────────────────────────────────────────────────────────────
  //  Outbound senders
  // ────────────────────────────────────────────────────────────────────

  async send(content: string, sessionId?: string, options?: { coordinatorMode?: 'react' | 'plan'; planConfirmation?: 'auto' | 'required' }): Promise<boolean> {
    const resolvedSessionId = sessionId || this.defaultSessionId
    if (!resolvedSessionId) {
      this.emitCompatEvent({ type: 'error', content: 'No active Harnessclaw session' })
      return false
    }

    try {
      await this.ensureSession(resolvedSessionId)
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        throw new Error('Harnessclaw websocket is not open')
      }

      // v2 §9.1: content is now an ARRAY of typed parts.
      const payload: Record<string, unknown> = {
        type: 'user.message',
        event_id: makeEventId(),
        session_id: resolvedSessionId,
        content: [{ type: 'text', text: content }],
      }
      if (options?.coordinatorMode === 'plan' || options?.coordinatorMode === 'react') {
        payload.coordinator_mode = options.coordinatorMode
      }
      if (options?.planConfirmation === 'required') {
        payload.plan_confirmation = 'required'
      }
      logEngineFrame('send', payload, {
        sessionId: resolvedSessionId,
        type: 'user.message',
      })
      this.ws.send(JSON.stringify(payload))
      this.knownSessions.set(resolvedSessionId, Date.now())
      return true
    } catch (error) {
      this.emitCompatEvent({
        type: 'error',
        session_id: resolvedSessionId,
        content: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  // v2 §7.3 plan_review response. Translates the legacy (planId, approved,
  // sessionId, options{steps,reason}) signature into prompt.user_response.
  async respondPlan(
    planId: string,
    approved: boolean,
    sessionId?: string,
    options?: { steps?: Array<Record<string, unknown>>; reason?: string },
  ): Promise<boolean> {
    const resolvedSessionId = sessionId || this.defaultSessionId
    if (!resolvedSessionId || !planId) return false
    try {
      await this.ensureSession(resolvedSessionId)
      const forest = this.getForest(resolvedSessionId)
      const requestId = forest.planIdToRequestId.get(planId)

      // v0.3 §2.4.2 recovery — same race as respondAskQuestion. After app
      // restart the user can click "开始执行 / 拒绝" before the server has
      // replayed prompt.user(plan_review). Defer instead of throwing so
      // handlePromptUser can flush it once the plan_id ↔ request_id
      // mapping is rebuilt.
      const ws = this.ws
      if (!ws || ws.readyState !== WebSocket.OPEN || !requestId) {
        writeAppLog('info', 'harnessclaw-engine.plan', 'Deferring respondPlan until v0.3 replay arrives', {
          planId,
          sessionId: resolvedSessionId,
          wsOpen: this.isWebSocketOpen(),
          requestIdFound: Boolean(requestId),
        })
        this.queueDeferredPlanResponse(
          planId,
          resolvedSessionId,
          () => this.respondPlan(planId, approved, sessionId, options),
        )
        return true
      }

      const responsePayload: Record<string, unknown> = {
        approved,
      }
      if (approved && options?.steps && options.steps.length > 0) {
        responsePayload.updated_steps = options.steps
      }
      if (options?.reason) {
        responsePayload.reason = options.reason
      }

      const frame: Record<string, unknown> = {
        type: 'prompt.user_response',
        event_id: makeEventId(),
        session_id: resolvedSessionId,
        request_id: requestId,
        decision: approved ? 'approved' : 'denied',
        payload: responsePayload,
      }
      logEngineFrame('send', frame, {
        sessionId: resolvedSessionId,
        type: 'prompt.user_response',
        kind: 'plan_review',
        planId,
      })
      ws.send(JSON.stringify(frame))

      forest.planIdToRequestId.delete(planId)
      forest.planReviewRequests.delete(requestId)
      return true
    } catch (error) {
      this.emitCompatEvent({
        type: 'error',
        session_id: resolvedSessionId,
        content: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  command(cmd: string, sessionId?: string): void {
    if (cmd.trim() !== '/new') {
      this.emitCompatEvent({ type: 'error', session_id: sessionId, content: `Unsupported command: ${cmd}` })
      return
    }

    if (sessionId) {
      this.knownSessions.set(sessionId, Date.now())
      this.emitSessions()
      this.emitCompatEvent({ type: 'subscribed', session_id: sessionId, subscriptions: [sessionId] })
    }
  }

  async stop(sessionId?: string): Promise<boolean> {
    const resolvedSessionId = sessionId || this.defaultSessionId
    if (!resolvedSessionId) return false

    try {
      await this.ensureSession(resolvedSessionId)
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        throw new Error('Harnessclaw websocket is not open')
      }
      const forest = this.getForest(resolvedSessionId)
      // v2 §9: session.interrupt — server expects a trace_id (the active turn).
      const payload: Record<string, unknown> = {
        type: 'session.interrupt',
        event_id: makeEventId(),
        session_id: resolvedSessionId,
      }
      if (forest.activeTraceId) payload.trace_id = forest.activeTraceId
      logEngineFrame('send', payload, {
        sessionId: resolvedSessionId,
        type: 'session.interrupt',
      })
      this.ws.send(JSON.stringify(payload))
      return true
    } catch (error) {
      this.emitCompatEvent({
        type: 'error',
        session_id: resolvedSessionId,
        content: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  subscribe(sessionId: string): void {
    this.subscriptions = sessionId ? [sessionId] : []
    this.emitCompatEvent({ type: 'subscribed', session_id: sessionId, subscriptions: [sessionId] })
  }

  unsubscribe(sessionId: string): void {
    if (!this.subscriptions.includes(sessionId)) return
    this.subscriptions = this.subscriptions.filter((value) => value !== sessionId)
    this.emitCompatEvent({ type: 'unsubscribed', session_id: sessionId, subscriptions: [...this.subscriptions] })
  }

  listSessions(): void {
    this.emitSessions()
  }

  async probe(timeoutMs = 3000): Promise<boolean> {
    try {
      await this.waitForTransport()
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return false
      }

      return await new Promise<boolean>((resolve) => {
        let settled = false
        const waiter = (ok: boolean): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(ok)
        }
        const timer = setTimeout(() => {
          const index = this.pendingPongWaiters.indexOf(waiter)
          if (index >= 0) {
            this.pendingPongWaiters.splice(index, 1)
          }
          waiter(false)
        }, timeoutMs)

        this.pendingPongWaiters.push(waiter)
        const payload = { type: 'ping', event_id: makeEventId() }
        logEngineFrame('send', payload, { type: 'ping' })
        this.ws?.send(JSON.stringify(payload), (error) => {
          if (!error) return
          const index = this.pendingPongWaiters.indexOf(waiter)
          if (index >= 0) {
            this.pendingPongWaiters.splice(index, 1)
          }
          waiter(false)
        })
      })
    } catch {
      return false
    }
  }

  disconnect(): void {
    this.shouldReconnect = false
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.forests.clear()
    this.pendingSessionInitId = ''
    this.sessionCreateInFlight = false
    this.rejectTransportWaiters(new Error('Harnessclaw websocket disconnected by client'))
    this.rejectSessionInitWaiters(new Error('Harnessclaw session initialization cancelled by client'))
    this.resolvePendingPongs(false)
    this.ws?.close()
    this.ws = null
    this.clientId = ''
    this.defaultSessionId = ''
    this.subscriptions = []
    this.setStatus('disconnected')
  }

  // session.resume — used after reconnect to request gap-fill from the server.
  async resume(sessionId?: string, traceId?: string, lastSeq?: number): Promise<boolean> {
    const resolvedSessionId = sessionId || this.defaultSessionId
    if (!resolvedSessionId) return false
    try {
      await this.ensureSession(resolvedSessionId)
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
      const forest = this.getForest(resolvedSessionId)
      const tid = traceId || forest.activeTraceId
      if (!tid) return false
      const payload: Record<string, unknown> = {
        type: 'session.resume',
        event_id: makeEventId(),
        session_id: resolvedSessionId,
        trace_id: tid,
        last_seq: typeof lastSeq === 'number' ? lastSeq : forest.lastSeq,
      }
      logEngineFrame('send', payload, { sessionId: resolvedSessionId, type: 'session.resume' })
      this.ws.send(JSON.stringify(payload))
      return true
    } catch {
      return false
    }
  }

  getStatus(): { status: HarnessclawStatus; clientId: string; sessionId: string; subscriptions: string[] } {
    return {
      status: this.status,
      clientId: this.clientId,
      sessionId: this.defaultSessionId,
      subscriptions: this.subscriptions,
    }
  }

  private setStatus(status: HarnessclawStatus): void {
    this.status = status
    this.emit('statusChange', status)
  }

  respondPermission(
    requestId: string,
    approved: boolean,
    scope: 'once' | 'session' = 'once',
    message?: string,
  ): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false

    let pending: PendingPermissionRequest | undefined
    let owningSessionId = ''
    for (const [sid, forest] of this.forests.entries()) {
      const candidate = forest.permissionRequests.get(requestId)
      if (candidate) {
        pending = candidate
        owningSessionId = sid
        break
      }
    }
    if (!pending || !owningSessionId) return false

    // v2 §7.3 — prompt.user_response with kind=permission inferred from
    // request_id. payload carries the approval/scope decision.
    const responsePayload: Record<string, unknown> = {
      approved,
      scope,
    }
    if (message) responsePayload.message = message

    const frame: Record<string, unknown> = {
      type: 'prompt.user_response',
      event_id: makeEventId(),
      session_id: pending.sessionId,
      request_id: requestId,
      decision: approved ? 'approved' : 'denied',
      payload: responsePayload,
    }

    logEngineFrame('send', frame, {
      sessionId: pending.sessionId,
      type: 'prompt.user_response',
      kind: 'permission',
    })
    this.ws.send(JSON.stringify(frame))
    this.forests.get(owningSessionId)?.permissionRequests.delete(requestId)

    this.emitCompatEvent({
      type: 'permission_result',
      session_id: pending.sessionId,
      request_id: requestId,
      name: pending.toolName,
      tool_input: pending.toolInput,
      is_read_only: pending.isReadOnly,
      options: pending.options,
      approved,
      scope,
      content: approved ? 'User approved permission request' : (message || 'User denied permission request'),
    })

    return true
  }

  respondAskQuestion(
    toolUseId: string,
    status: 'success' | 'cancelled',
    output?: string,
    errorMessage?: string,
  ): boolean {
    // The renderer treats request_id as call_id for ask-question rounds.
    const requestId = toolUseId

    let pending: PendingAskQuestionRequest | undefined
    let owningSessionId = ''
    for (const [sid, forest] of this.forests.entries()) {
      const candidate = forest.askRequests.get(requestId)
      if (candidate) {
        pending = candidate
        owningSessionId = sid
        break
      }
    }

    // v0.3 §2.4.2 recovery — when WS is mid-reconnect or the server hasn't
    // replayed prompt.user(question) yet, the request_id may not be in any
    // forest. Instead of dropping the user's reply, queue it and let
    // handlePromptUser flush it once the replay registers the same id.
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN || !pending || !owningSessionId) {
      const knownRequestIds: string[] = []
      for (const [, forest] of this.forests.entries()) {
        for (const id of forest.askRequests.keys()) knownRequestIds.push(id)
      }
      writeAppLog('info', 'harnessclaw-engine.askQuestion', 'Deferring respondAskQuestion until v0.3 replay arrives', {
        toolUseId,
        wsOpen: this.isWebSocketOpen(),
        pendingFound: Boolean(pending),
        forestCount: this.forests.size,
        knownRequestIds,
      })
      this.queueDeferredAskResponse(
        requestId,
        pending?.sessionId,
        () => this.respondAskQuestion(toolUseId, status, output, errorMessage),
      )
      return true
    }

    let responsePayload: Record<string, unknown>
    let decision: 'approved' | 'denied'
    if (status === 'success') {
      // The renderer emits a newline-joined string of (selected option labels)
      // + (optional custom text). Reverse-engineer it back into the v2
      // {selected_options, custom_text} shape using the option labels we
      // captured when the prompt arrived.
      const lines = (output || '').split('\n').map((line) => line.trim()).filter((line) => line)
      const labelSet = new Set(pending.optionLabels)
      const selectedOptions: string[] = []
      const customParts: string[] = []
      for (const line of lines) {
        if (labelSet.has(line)) selectedOptions.push(line)
        else customParts.push(line)
      }
      responsePayload = {
        selected_options: selectedOptions,
        custom_text: customParts.join('\n'),
      }
      decision = 'approved'
    } else {
      responsePayload = {
        selected_options: [],
        custom_text: '',
        cancellation_reason: errorMessage || 'User dismissed the question dialog',
      }
      decision = 'denied'
    }

    const frame: Record<string, unknown> = {
      type: 'prompt.user_response',
      event_id: makeEventId(),
      session_id: pending.sessionId,
      request_id: requestId,
      decision,
      payload: responsePayload,
    }
    logEngineFrame('send', frame, {
      sessionId: pending.sessionId,
      type: 'prompt.user_response',
      kind: 'question',
    })
    ws.send(JSON.stringify(frame))
    this.forests.get(owningSessionId)?.askRequests.delete(requestId)

    this.emitCompatEvent({
      type: 'ask_user_question_result',
      session_id: pending.sessionId,
      call_id: requestId,
      status,
      output: status === 'success' ? (output || '') : '',
      error: status === 'cancelled'
        ? { code: 'user_cancelled', message: errorMessage || 'User dismissed the question dialog' }
        : undefined,
    })

    return true
  }

  private sendToolResult(sessionId: string, toolUseId: string, payload: ToolResultPayload): void {
    // v2 §9: tool.result with tool_use_id, status, output|error, metadata.
    const message: Record<string, unknown> = {
      type: 'tool.result',
      event_id: makeEventId(),
      session_id: sessionId,
      tool_use_id: toolUseId,
      status: payload.status,
    }
    if (payload.status === 'success') {
      message.output = payload.output || ''
    } else {
      message.error = payload.error
    }
    if (payload.metadata) {
      message.metadata = payload.metadata
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      logEngineFrame('send', message, {
        sessionId,
        type: 'tool.result',
        toolUseId,
        status: payload.status,
      })
      this.ws.send(JSON.stringify(message))
    }
  }

  private async executeToolCall(
    sessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>,
    isSubagent: boolean,
    card: CardState,
  ): Promise<void> {
    const cfg = this.readConfig()
    if (!cfg) return

    const loweredToolName = toolName.trim().toLowerCase()
    if (cfg.deniedTools.includes(loweredToolName)) {
      const deniedPayload: ToolResultPayload = {
        status: 'denied',
        error: {
          code: 'permission_denied',
          message: `Tool "${toolName}" is denied by local policy`,
        },
      }
      this.emitLocalToolResult(sessionId, toolUseId, toolName, deniedPayload, isSubagent, card)
      this.sendToolResult(sessionId, toolUseId, deniedPayload)
      return
    }

    if (cfg.allowedTools.length > 0 && !cfg.allowedTools.includes(loweredToolName)) {
      const deniedPayload: ToolResultPayload = {
        status: 'denied',
        error: {
          code: 'permission_denied',
          message: `Tool "${toolName}" is not in allowed_tools`,
        },
      }
      this.emitLocalToolResult(sessionId, toolUseId, toolName, deniedPayload, isSubagent, card)
      this.sendToolResult(sessionId, toolUseId, deniedPayload)
      return
    }

    let result: ToolResultPayload
    try {
      switch (loweredToolName) {
        case 'bash':
          result = await this.runBashTool(input, Math.min(cfg.bashTimeoutMs, cfg.toolTimeoutMs))
          break
        case 'file_read':
          result = await this.runFileReadTool(input)
          break
        case 'file_write':
          result = await this.runFileWriteTool(input)
          break
        case 'file_edit':
          result = await this.runFileEditTool(input)
          break
        case 'glob':
          result = await this.runGlobTool(input)
          break
        case 'grep':
          result = await this.runGrepTool(input, Math.min(asPositiveNumber(30_000, 30_000), cfg.toolTimeoutMs))
          break
        case 'web_fetch':
          result = await this.runWebFetchTool(input, Math.min(cfg.webFetchTimeoutMs, cfg.toolTimeoutMs))
          break
        default:
          result = {
            status: 'error',
            error: {
              code: 'unsupported_tool',
              message: `Unsupported local tool: ${toolName}`,
            },
          }
      }
    } catch (err) {
      result = {
        status: 'error',
        error: {
          code: 'tool_execution_failed',
          message: String(err),
        },
      }
    }

    this.emitLocalToolResult(sessionId, toolUseId, toolName, result, isSubagent, card)
    this.sendToolResult(sessionId, toolUseId, result)
  }

  private emitLocalToolResult(
    sessionId: string,
    toolUseId: string,
    toolName: string,
    result: ToolResultPayload,
    isSubagent: boolean,
    card: CardState,
  ): void {
    card.localResultEmitted = true
    const isError = result.status !== 'success'
    const content = result.status === 'success'
      ? (result.output || '')
      : (result.error?.message || 'Tool execution failed')

    if (isSubagent) {
      this.emitCompatEvent({
        type: 'subagent_event',
        session_id: sessionId,
        agent_id: card.agentId || '',
        agent_name: '',
        payload: {
          event_type: 'tool_end',
          tool_use_id: toolUseId,
          tool_name: toolName,
          output: content,
          content,
          is_error: isError,
          status: result.status,
          metadata: result.metadata,
        },
      })
      return
    }

    this.emitCompatEvent({
      type: 'tool_result',
      session_id: sessionId,
      name: toolName,
      tool_name: toolName,
      call_id: toolUseId,
      tool_use_id: toolUseId,
      is_error: isError,
      content,
      output: content,
      status: result.status,
      metadata: result.metadata,
    })
  }

  private async runBashTool(input: Record<string, unknown>, timeoutMs: number): Promise<ToolResultPayload> {
    const command = typeof input.command === 'string' ? input.command.trim() : ''
    if (!command) {
      return {
        status: 'error',
        error: {
          code: 'invalid_tool_input',
          message: 'bash tool requires a non-empty command',
        },
      }
    }

    if (/(^|\s)(rm\s+-rf\s+\/|mkfs|shutdown|reboot)(\s|$)/i.test(command)) {
      return {
        status: 'denied',
        error: {
          code: 'permission_denied',
          message: `Dangerous bash command blocked by local policy: ${command}`,
        },
      }
    }

    return new Promise((resolvePromise) => {
      const startedAt = Date.now()
      const child = spawn(process.env.SHELL || 'zsh', ['-lc', command], {
        cwd: process.cwd(),
        env: { ...process.env, HOME: homedir() },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''
      let settled = false

      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        child.kill('SIGTERM')
        resolvePromise({
          status: 'timeout',
          error: {
            code: 'execution_timeout',
            message: `Command timed out after ${timeoutMs}ms`,
          },
          metadata: {
            duration_ms: Date.now() - startedAt,
          },
        })
      }, timeoutMs)

      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk)
      })
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk)
      })

      child.on('error', (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolvePromise({
          status: 'error',
          error: {
            code: 'spawn_failed',
            message: String(err),
          },
          metadata: {
            duration_ms: Date.now() - startedAt,
          },
        })
      })

      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)

        const combined = combineOutput(stdout, stderr)
        const trimmed = trimOutput(combined)
        const metadata = {
          exit_code: code ?? null,
          duration_ms: Date.now() - startedAt,
          truncated: trimmed.truncated,
        }

        if (code === 0) {
          resolvePromise({
            status: 'success',
            output: trimmed.text,
            metadata,
          })
          return
        }

        resolvePromise({
          status: 'error',
          error: {
            code: 'command_failed',
            message: trimmed.text || `Command exited with code ${code ?? 'unknown'}`,
          },
          metadata,
        })
      })
    })
  }

  private async runFileReadTool(input: Record<string, unknown>): Promise<ToolResultPayload> {
    const path = typeof input.path === 'string' ? input.path : ''
    if (!path) {
      return {
        status: 'error',
        error: { code: 'invalid_tool_input', message: 'file_read requires path' },
      }
    }

    const absolutePath = resolve(path)
    const content = readFileSync(absolutePath, 'utf-8')
    const limit = typeof input.limit === 'number' && input.limit > 0 ? input.limit : undefined
    const trimmed = trimOutput(limit ? content.slice(0, limit) : content, limit || 200_000)
    return {
      status: 'success',
      output: trimmed.text,
      metadata: {
        path: absolutePath,
        truncated: trimmed.truncated || (typeof limit === 'number' && content.length > limit),
      },
    }
  }

  private async runFileWriteTool(input: Record<string, unknown>): Promise<ToolResultPayload> {
    const path = typeof input.path === 'string' ? input.path : ''
    const content = typeof input.content === 'string' ? input.content : ''
    if (!path) {
      return {
        status: 'error',
        error: { code: 'invalid_tool_input', message: 'file_write requires path' },
      }
    }

    const absolutePath = resolve(path)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, content, 'utf-8')
    return {
      status: 'success',
      output: content,
      metadata: {
        path: absolutePath,
        bytes: Buffer.byteLength(content, 'utf-8'),
      },
    }
  }

  private async runFileEditTool(input: Record<string, unknown>): Promise<ToolResultPayload> {
    const path = typeof input.path === 'string' ? input.path : ''
    const oldString = typeof input.old_string === 'string' ? input.old_string : typeof input.search === 'string' ? input.search : ''
    const newString = typeof input.new_string === 'string' ? input.new_string : typeof input.replace === 'string' ? input.replace : ''
    const replaceAll = input.replace_all === true
    if (!path || !oldString) {
      return {
        status: 'error',
        error: { code: 'invalid_tool_input', message: 'file_edit requires path and old_string/search' },
      }
    }

    const absolutePath = resolve(path)
    const original = readFileSync(absolutePath, 'utf-8')
    if (!original.includes(oldString)) {
      return {
        status: 'error',
        error: { code: 'match_not_found', message: 'Target text not found in file' },
      }
    }

    const next = replaceAll ? original.split(oldString).join(newString) : original.replace(oldString, newString)
    writeFileSync(absolutePath, next, 'utf-8')
    return {
      status: 'success',
      output: next,
      metadata: {
        path: absolutePath,
        replace_all: replaceAll,
      },
    }
  }

  private async runGlobTool(input: Record<string, unknown>): Promise<ToolResultPayload> {
    const pattern = typeof input.pattern === 'string' ? input.pattern : ''
    const basePath = typeof input.path === 'string' ? input.path : process.cwd()
    if (!pattern) {
      return {
        status: 'error',
        error: { code: 'invalid_tool_input', message: 'glob requires pattern' },
      }
    }

    const command = `rg --files ${this.escapeShellArg(resolve(basePath))} -g ${this.escapeShellArg(pattern)}`
    return this.runBashTool({ command }, 15_000)
  }

  private async runGrepTool(input: Record<string, unknown>, timeoutMs: number): Promise<ToolResultPayload> {
    const pattern = typeof input.pattern === 'string' ? input.pattern : ''
    const path = typeof input.path === 'string' ? input.path : process.cwd()
    if (!pattern) {
      return {
        status: 'error',
        error: { code: 'invalid_tool_input', message: 'grep requires pattern' },
      }
    }

    const glob = typeof input.glob === 'string' ? input.glob : ''
    const commandParts = [
      'rg',
      '-n',
      this.escapeShellArg(pattern),
      this.escapeShellArg(resolve(path)),
    ]
    if (glob) {
      commandParts.push('-g', this.escapeShellArg(glob))
    }
    return this.runBashTool({ command: commandParts.join(' ') }, timeoutMs)
  }

  private async runWebFetchTool(input: Record<string, unknown>, timeoutMs: number): Promise<ToolResultPayload> {
    const url = typeof input.url === 'string' ? input.url : ''
    if (!url) {
      return {
        status: 'error',
        error: { code: 'invalid_tool_input', message: 'web_fetch requires url' },
      }
    }

    const startedAt = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, { signal: controller.signal })
      const text = await response.text()
      const trimmed = trimOutput(text, 120_000)
      return {
        status: response.ok ? 'success' : 'error',
        output: response.ok ? trimmed.text : undefined,
        error: response.ok ? undefined : {
          code: 'http_error',
          message: `${response.status} ${response.statusText}\n${trimmed.text}`,
        },
        metadata: {
          status_code: response.status,
          duration_ms: Date.now() - startedAt,
          truncated: trimmed.truncated,
        },
      }
    } catch (err) {
      return {
        status: err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'error',
        error: {
          code: err instanceof Error && err.name === 'AbortError' ? 'execution_timeout' : 'fetch_failed',
          message: String(err),
        },
        metadata: {
          duration_ms: Date.now() - startedAt,
        },
      }
    } finally {
      clearTimeout(timer)
    }
  }

  private escapeShellArg(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`
  }

  private readConfig(): HarnessclawConfig | null {
    try {
      const raw = readEngineConfig({})

      const channels = isPlainObject(raw.channels) ? raw.channels : {}
      const websocket = isPlainObject(channels.websocket)
        ? channels.websocket
        : isPlainObject(channels.harnessclaw)
          ? channels.harnessclaw
          : {}
      const permission = isPlainObject(raw.permission) ? raw.permission : {}
      const tools = isPlainObject(raw.tools) ? raw.tools : {}
      const engine = isPlainObject(raw.engine) ? raw.engine : {}
      const bash = isPlainObject(tools.bash) ? tools.bash : {}
      const webFetch = isPlainObject(tools.web_fetch) ? tools.web_fetch : {}

      return {
        enabled: typeof websocket.enabled === 'boolean' ? websocket.enabled : true,
        host: HARNESSCLAW_WS_HOST,
        port: HARNESSCLAW_WS_PORT,
        path: HARNESSCLAW_WS_PATH,
        token: typeof websocket.token === 'string'
          ? websocket.token
          : typeof raw.token === 'string'
            ? raw.token
            : '',
        userId: typeof websocket.user_id === 'string'
          ? websocket.user_id
          : typeof websocket.userId === 'string'
            ? websocket.userId
            : '',
        toolTimeoutMs: parseDurationMs(engine.tool_timeout, 120_000),
        bashTimeoutMs: parseDurationMs(bash.timeout, 60_000),
        webFetchTimeoutMs: parseDurationMs(webFetch.timeout, 30_000),
        allowedTools: asStringArray(permission.allowed_tools).map((value) => value.toLowerCase()),
        deniedTools: asStringArray(permission.denied_tools).map((value) => value.toLowerCase()),
      }
    } catch {
      return null
    }
  }
}

export const harnessclawClient = new HarnessclawClient()
