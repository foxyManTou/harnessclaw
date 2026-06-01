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
    preload?: string
    contextIsolation: boolean
    sandbox: boolean
    nodeIntegration: boolean
    partition?: string
  }
}

export interface BrowserAgentWebContentsLike {
  loadURL(url: string): MaybePromise<void>
  getURL?(): string
  getTitle?(): string
  canGoBack?(): boolean
  canGoForward?(): boolean
  goBack?(): void
  goForward?(): void
  reload?(): void
  focus?(): void
  on?(event: string, listener: (...args: unknown[]) => void): unknown
  setWindowOpenHandler?(handler: (details: { url: string }) => { action: 'deny' | 'allow' }): void
  send?(channel: string, payload: unknown): void
}

export interface BrowserAgentWindowLike {
  id: number
  loadURL(url: string): MaybePromise<void>
  show(): void
  hide?(): void
  isVisible?(): boolean
  focus?(): void
  destroy(): void
  isDestroyed(): boolean
  getContentBounds?(): { width: number; height: number }
  on?(event: string, listener: (...args: unknown[]) => void): unknown
  once?(event: 'closed', listener: () => void): void
  webContents?: BrowserAgentWebContentsLike
}

export interface BrowserAgentTabInfo {
  tab_id: string
  title: string
  url: string
  cdp_endpoint: string
  active: boolean
}

export interface BrowserAgentSessionInfo {
  session_id: string
  window_id: string
  cdp_endpoint: string
  partition: string
  visible: boolean
  last_used_turn_id?: string
  active_tab: BrowserAgentTabInfo
  tabs: BrowserAgentTabInfo[]
  closed?: boolean
  human_takeover?: {
    request_id: string
    message: string
  }
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
  request_id?: string
}

export interface BrowserAgentSessionManagerLike {
  createSession(input: Record<string, unknown>): Promise<BrowserAgentSessionInfo>
  closeSession(input: Record<string, unknown>): BrowserAgentCloseResult
  askHuman(input: Record<string, unknown>): BrowserAgentAskHumanResult
  getSessionState(input: Record<string, unknown>): BrowserAgentSessionInfo
  listSessions(): BrowserAgentSessionInfo[]
  setVisibility(input: Record<string, unknown>): BrowserAgentSessionInfo
  hideSession(input: Record<string, unknown>): BrowserAgentSessionInfo
  hideSessionsForTurn(turnID: string): void
  finishHumanTakeover(requestID: string, status: 'success' | 'cancelled'): void
  closeAll(): void
}

export type BrowserAgentWindowFactory = (options: BrowserAgentWindowOptions) => BrowserAgentWindowLike
export type BrowserAgentCDPEndpointResolver = (
  markerURL: string,
  window?: BrowserAgentWindowLike,
) => Promise<string>

interface BrowserAgentTabRecord {
  tab_id: string
  title: string
  url: string
  marker_url: string
  cdp_endpoint: string
  webContents: BrowserAgentWebContentsLike
}

interface BrowserAgentSessionRecord {
  session_id: string
  window_id: string
  partition: string
  visible: boolean
  last_used_turn_id?: string
  window: BrowserAgentWindowLike
  tabs: BrowserAgentTabRecord[]
  active_tab_id: string
  human_takeover?: {
    request_id: string
    message: string
  }
}

interface BrowserAgentSessionManagerOptions {
  createWindow: BrowserAgentWindowFactory
  resolveCDPEndpoint: BrowserAgentCDPEndpointResolver
  createSessionID?: () => string
  onSessionChanged?: (session: BrowserAgentSessionInfo) => void
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
  private readonly onSessionChanged?: (session: BrowserAgentSessionInfo) => void
  private readonly sessionsByID = new Map<string, BrowserAgentSessionRecord>()
  private readonly sessionsByWindowID = new Map<string, string>()

  constructor(options: BrowserAgentSessionManagerOptions) {
    this.createWindow = options.createWindow
    this.resolveCDPEndpoint = options.resolveCDPEndpoint
    this.createSessionID = options.createSessionID || defaultSessionID
    this.onSessionChanged = options.onSessionChanged
  }

  async createSession(input: Record<string, unknown>): Promise<BrowserAgentSessionInfo> {
    const sessionID = this.normalizeSessionID(input.session_id)
    const startURL = optionalString(input.start_url)
    const visibility = input.visibility === 'hidden' ? 'hidden' : 'visible'
    const partition = this.resolvePartition()
    const lastUsedTurnID = optionalString(input.last_used_turn_id) || optionalString(input.turn_id)
    if (startURL) {
      validateHTTPURL(startURL, 'start_url')
    }
    if (this.sessionsByID.has(sessionID)) {
      throw new BrowserAgentSessionError('duplicate_session', `Browser session already exists: ${sessionID}`)
    }

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
    win.on?.('close', () => this.handleWindowClosed(sessionID))
    win.once?.('closed', () => this.handleWindowClosed(sessionID))

    const record: BrowserAgentSessionRecord = {
      session_id: sessionID,
      window_id: String(win.id),
      partition,
      visible: visibility === 'visible',
      last_used_turn_id: lastUsedTurnID || undefined,
      window: win,
      tabs: [],
      active_tab_id: '',
    }

    try {
      const tab = await this.createWindowTab(record, startURL)
      record.tabs.push(tab)
      record.active_tab_id = tab.tab_id

      this.sessionsByID.set(sessionID, record)
      this.sessionsByWindowID.set(record.window_id, sessionID)
      if (visibility === 'visible') {
        this.showRecord(record)
      }
      this.publish(record)
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
    const closedInfo: BrowserAgentSessionInfo = { ...publicSessionInfo(record), visible: false, closed: true }
    this.onSessionChanged?.(closedInfo)
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
    this.markUsed(record, input)
    const requestID = optionalString(input.request_id)
    if (requestID) {
      record.human_takeover = { request_id: requestID, message }
    }
    this.showRecord(record)
    this.publish(record)
    return {
      status: 'shown',
      session_id: record.session_id,
      window_id: record.window_id,
      message,
      request_id: requestID || undefined,
    }
  }

  getSessionState(input: Record<string, unknown>): BrowserAgentSessionInfo {
    const record = this.requireSession(input)
    this.markUsed(record, input)
    this.refreshTabState(record)
    this.publish(record)
    return publicSessionInfo(record)
  }

  listSessions(): BrowserAgentSessionInfo[] {
    return [...this.sessionsByID.values()].map((record) => publicSessionInfo(record))
  }

  getSession(sessionID: string): BrowserAgentSessionInfo | undefined {
    const record = this.sessionsByID.get(sessionID)
    return record ? publicSessionInfo(record) : undefined
  }

  setVisibility(input: Record<string, unknown>): BrowserAgentSessionInfo {
    const record = this.requireSession(input)
    const visible = input.visible === true || input.visibility === 'visible'
    if (visible) {
      this.showRecord(record)
    } else {
      this.hideRecord(record)
    }
    this.publish(record)
    return publicSessionInfo(record)
  }

  hideSession(input: Record<string, unknown>): BrowserAgentSessionInfo {
    return this.setVisibility({ ...input, visible: false })
  }

  hideSessionsForTurn(turnID: string): void {
    const normalized = turnID.trim()
    if (!normalized) return
    for (const record of this.sessionsByID.values()) {
      if (record.last_used_turn_id === normalized) {
        this.hideRecord(record)
        this.publish(record)
      }
    }
  }

  async navigate(input: Record<string, unknown>): Promise<BrowserAgentSessionInfo> {
    const record = this.requireSession(input)
    const url = optionalString(input.url)
    if (!url) throw new BrowserAgentSessionError('invalid_input', 'url is required')
    validateHTTPURL(url, 'url')
    const tab = this.activeTab(record)
    await this.loadTabURL(tab, url)
    this.publish(record)
    return publicSessionInfo(record)
  }

  goBack(input: Record<string, unknown>): BrowserAgentSessionInfo {
    const tab = this.activeTab(this.requireSession(input))
    tab.webContents.goBack?.()
    return this.getSessionState(input)
  }

  goForward(input: Record<string, unknown>): BrowserAgentSessionInfo {
    const tab = this.activeTab(this.requireSession(input))
    tab.webContents.goForward?.()
    return this.getSessionState(input)
  }

  reload(input: Record<string, unknown>): BrowserAgentSessionInfo {
    const tab = this.activeTab(this.requireSession(input))
    tab.webContents.reload?.()
    return this.getSessionState(input)
  }

  finishHumanTakeover(requestID: string, status: 'success' | 'cancelled'): void {
    for (const record of this.sessionsByID.values()) {
      if (record.human_takeover?.request_id === requestID) {
        record.human_takeover = undefined
        if (status === 'success') {
          this.showRecord(record)
        }
        this.publish(record)
        return
      }
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

  private async createWindowTab(record: BrowserAgentSessionRecord, url?: string): Promise<BrowserAgentTabRecord> {
    if (!record.window.webContents) {
      throw new BrowserAgentSessionError('window_not_ready', 'Browser window has no webContents')
    }
    const markerURL = sessionMarkerURL(record.session_id)
    const tabID = `tab_${record.session_id}`
    const publishIfRegistered = (): void => {
      if (!record.tabs.some((candidate) => candidate.tab_id === tabID)) return
      this.publish(record)
    }
    record.window.webContents.on?.('page-title-updated', publishIfRegistered)
    record.window.webContents.on?.('did-navigate', publishIfRegistered)
    await record.window.loadURL(markerURL)
    const cdpEndpoint = await this.resolveCDPEndpoint(markerURL, record.window)
    const tab: BrowserAgentTabRecord = {
      tab_id: tabID,
      title: 'New Tab',
      url: markerURL,
      marker_url: markerURL,
      cdp_endpoint: cdpEndpoint,
      webContents: record.window.webContents,
    }
    if (url) {
      await this.loadTabURL(tab, url)
    }
    return tab
  }

  private async loadTabURL(tab: BrowserAgentTabRecord, url: string): Promise<void> {
    await tab.webContents.loadURL(url)
    tab.url = url
    tab.title = titleFromURL(url)
  }

  private refreshTabState(record: BrowserAgentSessionRecord): void {
    for (const tab of record.tabs) {
      const url = tab.webContents.getURL?.()
      const title = tab.webContents.getTitle?.()
      if (url) tab.url = url
      if (title) tab.title = title
    }
  }

  private activeTab(record: BrowserAgentSessionRecord): BrowserAgentTabRecord {
    const tab = record.tabs.find((candidate) => candidate.tab_id === record.active_tab_id) || record.tabs[0]
    if (!tab) {
      throw new BrowserAgentSessionError('session_not_ready', `Browser session has no tabs: ${record.session_id}`)
    }
    return tab
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

  private resolvePartition(): string {
    return DEFAULT_PARTITION
  }

  private markUsed(record: BrowserAgentSessionRecord, input: Record<string, unknown>): void {
    const turnID = optionalString(input.last_used_turn_id) || optionalString(input.turn_id)
    if (turnID) {
      record.last_used_turn_id = turnID
    }
  }

  private showRecord(record: BrowserAgentSessionRecord): void {
    if (!record.window.isDestroyed()) {
      record.window.show()
      record.window.focus?.()
      record.visible = true
    }
  }

  private hideRecord(record: BrowserAgentSessionRecord): void {
    if (!record.window.isDestroyed()) {
      record.window.hide?.()
      record.visible = false
    }
  }

  private publish(record: BrowserAgentSessionRecord): void {
    if (record.tabs.length === 0) return
    this.refreshTabState(record)
    const info = publicSessionInfo(record)
    this.onSessionChanged?.(info)
  }

  private handleWindowClosed(sessionID: string): void {
    const record = this.sessionsByID.get(sessionID)
    if (!record) return
    if (record.tabs.length > 0) {
      record.visible = false
      this.onSessionChanged?.({ ...publicSessionInfo(record), visible: false, closed: true })
    }
    this.forgetSession(sessionID)
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
  const active = record.tabs.find((tab) => tab.tab_id === record.active_tab_id) || record.tabs[0]
  const activeInfo = publicTabInfo(record, active)
  return {
    session_id: record.session_id,
    window_id: record.window_id,
    cdp_endpoint: activeInfo.cdp_endpoint,
    partition: record.partition,
    visible: record.visible,
    last_used_turn_id: record.last_used_turn_id,
    active_tab: activeInfo,
    tabs: record.tabs.map((tab) => publicTabInfo(record, tab)),
    human_takeover: record.human_takeover,
  }
}

function publicTabInfo(record: BrowserAgentSessionRecord, tab: BrowserAgentTabRecord): BrowserAgentTabInfo {
  return {
    tab_id: tab.tab_id,
    title: tab.title || titleFromURL(tab.url),
    url: tab.url,
    cdp_endpoint: tab.cdp_endpoint,
    active: tab.tab_id === record.active_tab_id,
  }
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

function titleFromURL(raw: string): string {
  try {
    const parsed = new URL(raw)
    return parsed.hostname || 'New Tab'
  } catch {
    return raw.startsWith('about:') ? 'New Tab' : raw
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
  return new Promise((resolve) => setTimeout(resolve, ms))
}
