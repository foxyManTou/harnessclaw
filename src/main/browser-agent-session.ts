import { randomUUID } from 'node:crypto'

export const DEFAULT_BROWSER_AGENT_CDP_PORT = 9222

const SESSION_MARKER_PREFIX = 'about:blank#harnessclaw-browser-session='
const DEFAULT_PARTITION = 'persist:browser-agent-default'

type MaybePromise<T> = T | Promise<T>

export interface BrowserAgentWindowOptions {
  width: number
  height: number
  show: boolean
  title: string
  autoHideMenuBar: boolean
  webPreferences: {
    contextIsolation: boolean
    sandbox: boolean
    nodeIntegration: boolean
    partition: string
  }
}

export interface BrowserAgentWindowLike {
  id: number
  loadURL(url: string): MaybePromise<void>
  show(): void
  focus?(): void
  destroy(): void
  isDestroyed(): boolean
  once?(event: 'closed', listener: () => void): void
}

export interface BrowserAgentSessionInfo {
  session_id: string
  window_id: string
  cdp_endpoint: string
  partition: string
  visible: boolean
}

export interface BrowserAgentCloseResult {
  closed: boolean
  session_id: string
  window_id: string
}

export interface BrowserAgentAskHumanResult {
  status: 'shown'
  session_id: string
  window_id: string
  message: string
}

export interface BrowserAgentSessionManagerLike {
  createSession(input: Record<string, unknown>): Promise<BrowserAgentSessionInfo>
  closeSession(input: Record<string, unknown>): BrowserAgentCloseResult
  askHuman(input: Record<string, unknown>): BrowserAgentAskHumanResult
  closeAll(): void
}

export type BrowserAgentWindowFactory = (options: BrowserAgentWindowOptions) => BrowserAgentWindowLike
export type BrowserAgentCDPEndpointResolver = (
  markerURL: string,
  window?: BrowserAgentWindowLike,
) => Promise<string>

interface BrowserAgentSessionRecord extends BrowserAgentSessionInfo {
  window: BrowserAgentWindowLike
}

interface BrowserAgentSessionManagerOptions {
  createWindow: BrowserAgentWindowFactory
  resolveCDPEndpoint: BrowserAgentCDPEndpointResolver
  createSessionID?: () => string
}

interface FetchResponseLike {
  ok: boolean
  status?: number
  json(): Promise<unknown>
}

type FetchLike = (url: string) => Promise<FetchResponseLike>

interface ResolverOptions {
  retries?: number
  delayMs?: number
}

export class BrowserAgentSessionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BrowserAgentSessionError'
    this.code = code
  }
}

export class BrowserAgentSessionManager implements BrowserAgentSessionManagerLike {
  private readonly createWindow: BrowserAgentWindowFactory
  private readonly resolveCDPEndpoint: BrowserAgentCDPEndpointResolver
  private readonly createSessionID: () => string
  private readonly sessionsByID = new Map<string, BrowserAgentSessionRecord>()
  private readonly sessionsByWindowID = new Map<string, string>()

  constructor(options: BrowserAgentSessionManagerOptions) {
    this.createWindow = options.createWindow
    this.resolveCDPEndpoint = options.resolveCDPEndpoint
    this.createSessionID = options.createSessionID || defaultSessionID
  }

  async createSession(input: Record<string, unknown>): Promise<BrowserAgentSessionInfo> {
    const sessionID = this.normalizeSessionID(input.session_id)
    const startURL = optionalString(input.start_url)
    const visibility = input.visibility === 'hidden' ? 'hidden' : 'visible'
    const partition = this.resolvePartition(input)
    if (startURL) {
      validateHTTPURL(startURL, 'start_url')
    }
    if (this.sessionsByID.has(sessionID)) {
      throw new BrowserAgentSessionError('duplicate_session', `Browser session already exists: ${sessionID}`)
    }

    const markerURL = sessionMarkerURL(sessionID)
    const win = this.createWindow({
      width: 1280,
      height: 900,
      show: visibility === 'visible',
      title: 'HarnessClaw Browser Agent',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        partition,
      },
    })
    win.once?.('closed', () => this.forgetSession(sessionID))

    try {
      await win.loadURL(markerURL)
      const cdpEndpoint = await this.resolveCDPEndpoint(markerURL, win)
      if (visibility === 'visible') {
        win.show()
        win.focus?.()
      }

      const record: BrowserAgentSessionRecord = {
        session_id: sessionID,
        window_id: String(win.id),
        cdp_endpoint: cdpEndpoint,
        partition,
        visible: visibility === 'visible',
        window: win,
      }
      this.sessionsByID.set(sessionID, record)
      this.sessionsByWindowID.set(record.window_id, sessionID)

      return publicSessionInfo(record)
    } catch (err) {
      if (!win.isDestroyed()) {
        win.destroy()
      }
      throw err
    }
  }

  closeSession(input: Record<string, unknown>): BrowserAgentCloseResult {
    const record = this.requireSession(input)
    this.forgetSession(record.session_id)
    if (!record.window.isDestroyed()) {
      record.window.destroy()
    }
    return {
      closed: true,
      session_id: record.session_id,
      window_id: record.window_id,
    }
  }

  askHuman(input: Record<string, unknown>): BrowserAgentAskHumanResult {
    const record = this.requireSession(input)
    const message = optionalString(input.message)
    if (!message) {
      throw new BrowserAgentSessionError('invalid_input', 'message is required')
    }
    if (!record.window.isDestroyed()) {
      record.window.show()
      record.window.focus?.()
    }
    return {
      status: 'shown',
      session_id: record.session_id,
      window_id: record.window_id,
      message,
    }
  }

  closeAll(): void {
    for (const record of [...this.sessionsByID.values()]) {
      this.forgetSession(record.session_id)
      if (!record.window.isDestroyed()) {
        record.window.destroy()
      }
    }
  }

  getSession(sessionID: string): BrowserAgentSessionInfo | undefined {
    const record = this.sessionsByID.get(sessionID)
    return record ? publicSessionInfo(record) : undefined
  }

  private requireSession(input: Record<string, unknown>): BrowserAgentSessionRecord {
    const sessionID = optionalString(input.session_id)
    const windowID = optionalString(input.window_id)
    const resolvedSessionID = sessionID || (windowID ? this.sessionsByWindowID.get(windowID) : undefined)
    if (!resolvedSessionID) {
      throw new BrowserAgentSessionError('session_not_found', 'session_id is required')
    }
    const record = this.sessionsByID.get(resolvedSessionID)
    if (!record) {
      throw new BrowserAgentSessionError('session_not_found', `Browser session not found: ${resolvedSessionID}`)
    }
    return record
  }

  private normalizeSessionID(raw: unknown): string {
    const requested = optionalString(raw)
    return requested || this.createSessionID()
  }

  private resolvePartition(input: Record<string, unknown>): string {
    const explicitPartition = optionalString(input.partition)
    if (explicitPartition) {
      return explicitPartition
    }
    const taskID = optionalString(input.task_id)
    if (!taskID) {
      return DEFAULT_PARTITION
    }
    return `persist:browser-agent-${partitionSlug(taskID)}`
  }

  private forgetSession(sessionID: string): void {
    const record = this.sessionsByID.get(sessionID)
    if (!record) {
      return
    }
    this.sessionsByID.delete(sessionID)
    this.sessionsByWindowID.delete(record.window_id)
  }
}

export function createRemoteDebuggingTargetResolver(
  port = DEFAULT_BROWSER_AGENT_CDP_PORT,
  fetchImpl: FetchLike = defaultFetch,
  options: ResolverOptions = {},
): BrowserAgentCDPEndpointResolver {
  const retries = options.retries ?? 20
  const delayMs = options.delayMs ?? 100
  return async (markerURL: string): Promise<string> => {
    let lastError: unknown
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        const res = await fetchImpl(`http://127.0.0.1:${port}/json/list`)
        if (!res.ok) {
          throw new BrowserAgentSessionError('cdp_list_failed', `CDP target list failed with HTTP ${res.status || 0}`)
        }
        const targets = await res.json()
        const endpoint = findMatchingTargetEndpoint(targets, markerURL)
        if (endpoint) {
          return endpoint
        }
        lastError = new BrowserAgentSessionError('cdp_target_not_found', 'Browser CDP target is not ready yet')
      } catch (err) {
        lastError = err
      }
      if (attempt < retries - 1) {
        await delay(delayMs)
      }
    }
    if (lastError instanceof BrowserAgentSessionError) {
      throw lastError
    }
    throw new BrowserAgentSessionError('cdp_target_not_found', String(lastError || 'Browser CDP target not found'))
  }
}

export const createRemoteDebuggingEndpointResolver = createRemoteDebuggingTargetResolver

function defaultSessionID(): string {
  return `browser_${randomUUID().slice(0, 8)}`
}

function sessionMarkerURL(sessionID: string): string {
  return `${SESSION_MARKER_PREFIX}${encodeURIComponent(sessionID)}`
}

function publicSessionInfo(record: BrowserAgentSessionRecord): BrowserAgentSessionInfo {
  return {
    session_id: record.session_id,
    window_id: record.window_id,
    cdp_endpoint: record.cdp_endpoint,
    partition: record.partition,
    visible: record.visible,
  }
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function partitionSlug(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'default'
}

function validateHTTPURL(raw: string, field: string): void {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch (err) {
    throw new BrowserAgentSessionError('invalid_input', `${field}: ${String(err)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BrowserAgentSessionError('invalid_input', `${field} scheme must be http or https`)
  }
  if (!parsed.host) {
    throw new BrowserAgentSessionError('invalid_input', `${field} host is required`)
  }
}

function findMatchingTargetEndpoint(targets: unknown, markerURL: string): string {
  if (!Array.isArray(targets)) {
    return ''
  }
  for (const target of targets) {
    if (!target || typeof target !== 'object') {
      continue
    }
    const entry = target as Record<string, unknown>
    const targetURL = typeof entry.url === 'string' ? entry.url : ''
    const endpoint = typeof entry.webSocketDebuggerUrl === 'string' ? entry.webSocketDebuggerUrl : ''
    if (endpoint && targetURL === markerURL) {
      return endpoint
    }
  }
  return ''
}

async function defaultFetch(url: string): Promise<FetchResponseLike> {
  if (typeof fetch !== 'function') {
    throw new BrowserAgentSessionError('cdp_fetch_unavailable', 'fetch is unavailable in this runtime')
  }
  return fetch(url)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}
