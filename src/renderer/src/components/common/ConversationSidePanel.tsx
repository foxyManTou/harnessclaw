import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Sparkles, Loader2, ChevronDown, ChevronUp, ChevronRight, FileText, Terminal, Code, ExternalLink, Search, Folder, File, FolderOpen, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import iconSidebarOpen from '../../assets/icon-sidebar-open.svg'
import iconSidebarCollapse from '../../assets/icon-sidebar-collapse.svg'
import { resolveArtifactIcon } from '../../assets/artifact-icons'
import type { ArtifactRef } from '../pages/ChatPage'

const PANEL_WIDTH_EXPANDED = 280
const PANEL_WIDTH_COLLAPSED = 44

type PanelTab = 'logs' | 'artifacts'
/** 产物 tab 下的子模式：general=通用模式（产物列表），dev=开发模式（工作区文件树） */
type ArtifactMode = 'general' | 'dev'

/** 工作区文件树节点（镜像 preload 的 WorkspaceFileNode，组件内自洽不依赖 preload 类型） */
interface WorkspaceFileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  modifiedAt?: number
  children?: WorkspaceFileNode[]
}

/**
 * 日志时间线条目 — 统一表示工具调用和子 agent 活动。
 * v2: 改成工具调用时间线，普通对话也有日志（Read/Edit/Bash等）。
 * v3: 支持按消息分组的时间轴展示。
 */
export interface AgentLogEntry {
  id: string
  /** 时间戳，用于排序和显示相对时间 */
  timestamp: number
  /** 条目类型：tool=工具调用，agent=子agent活动 */
  type: 'tool' | 'agent'

  // ─── 工具调用字段（type='tool'时必填）───
  /** 工具名（Read / Edit / Bash / WebSearch ...） */
  toolName?: string
  /** 工具状态：running / success / failed / cancelled */
  toolStatus?: 'running' | 'success' | 'failed' | 'cancelled'
  /** 一句话描述（来自 intent 或 content 前50字） */
  description: string
  /** 耗时（毫秒） */
  durationMs?: number
  /** 错误类型（失败时） */
  errorType?: string
  /** 错误消息（开发者用，展开后显示） */
  errorMessage?: string
  /** 子 agent 名称（如果是子 agent 的工具调用） */
  subagentName?: string
  /** 工具调用的 callId，用于展开/折叠状态管理 */
  callId?: string
  /** 工具调用参数（展开后显示，JSON字符串） */
  toolInput?: string
  /** 工具调用输出（展开后显示） */
  toolOutput?: string
  /** 搜索结果链接（WebSearch 专用） */
  searchUrls?: Array<{ url: string; title?: string }>
  /** 搜索查询（WebSearch 专用） */
  searchQuery?: string
  /** 搜索结果数（WebSearch 专用） */
  searchResultCount?: number

  // ─── 子 agent 字段（type='agent'时必填，向后兼容旧逻辑）───
  /** Display name shown under the avatar (Emma / Lily / Mary …). */
  name?: string
  /** Resolved avatar image URL. */
  avatarSrc?: string
  /** Role label shown on the activity row (Leader / Browser Agent …). */
  role?: string
  /** Which leading icon to draw next to the role label. */
  roleIcon?: 'leader' | 'browser' | 'file' | 'generic'
  /** Optional orange count badge (event count, etc.). */
  badge?: string
  status?: 'running' | 'completed' | 'failed'
}

/** 消息分组的日志条目（v3 新增） */
export interface MessageGroupedLog {
  /** 消息 ID */
  messageId: string
  /** 消息时间戳 */
  timestamp: number
  /** 消息角色 (user / assistant) */
  role: 'user' | 'assistant'
  /** 消息内容摘要（前50字） */
  contentPreview?: string
  /** 该消息下的所有日志条目 */
  entries: AgentLogEntry[]
}

/** 兼容旧版 plan step 接口的简化日志条目（HEAD 行为）。 */
interface LegacyLogStep {
  id: string
  description?: string
  status?: 'pending' | 'dispatched' | 'running' | 'completed' | 'failed' | 'skipped'
  summary?: string
}

interface ConversationSidePanelProps {
  /** 新接口：完整工具调用 timeline。和 steps 二选一，优先级高于 steps。 */
  logEntries?: AgentLogEntry[]
  /** v3: 按消息分组的日志时间轴（优先级高于 logEntries） */
  messageGroupedLogs?: MessageGroupedLog[]
  /** 旧接口：plan steps（HEAD 行为）。当 logEntries 缺省时退回此渲染。 */
  steps?: LegacyLogStep[]
  /** 通用模式产物卡片列表：来自 agent 声明的产物 + meta.json outputs 兜底（ChatPage 合并后传入）。 */
  artifacts: ArtifactRef[]
  /** 通用模式点击产物 → 宿主打开预览（fetch + read 走 openArtifactPreview）。 */
  onSelectArtifact: (artifact: ArtifactRef) => void
  /** 通用模式点击「打开文件所在位置」→ 宿主在系统文件管理器中定位该产物文件。 */
  onRevealArtifact?: (artifact: ArtifactRef) => void
  /** 当前会话 ID — 开发模式据此读取工作区文件树（window.workspace.listSession） */
  sessionId?: string
  /** 开发模式点击文件 → 宿主打开文件预览（复用 FilePreviewDrawer） */
  onSelectWorkspaceFile?: (path: string, fileName: string) => void
}

const TAB_STORAGE_KEY = 'chat-side-panel-tab'

function readStoredTab(): PanelTab {
  try {
    const v = localStorage.getItem(TAB_STORAGE_KEY)
    return v === 'artifacts' ? 'artifacts' : 'logs'
  } catch {
    return 'logs'
  }
}

const ARTIFACT_MODE_STORAGE_KEY = 'chat-side-panel-artifact-mode'

function readStoredArtifactMode(): ArtifactMode {
  try {
    const v = localStorage.getItem(ARTIFACT_MODE_STORAGE_KEY)
    return v === 'dev' ? 'dev' : 'general'
  } catch {
    return 'general'
  }
}


// 兼容旧 plan-step 接口的状态点颜色 / 文本格式化（HEAD 行为）。
function legacyStatusDot(status?: LegacyLogStep['status']): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-500'
    case 'running':
    case 'dispatched':
      return 'bg-sky-500 animate-pulse'
    case 'failed':
      return 'bg-red-500'
    case 'skipped':
      return 'bg-muted-foreground/40'
    default:
      return 'bg-muted-foreground/30'
  }
}
function legacyStepLabel(step: LegacyLogStep, t: (k: string) => string): string {
  const desc = (step.description || '').trim()
  if (!desc) return t('chat.sidePanel.unnamedStep')
  if (step.status === 'completed') return t('chat.sidePanel.completedPrefix') + desc
  return desc
}

// 根据工具名返回对应图标（工具调用专用）
function getToolIcon(toolName: string, status?: AgentLogEntry['toolStatus']) {
  if (status === 'running') {
    return <Loader2 size={14} className="flex-shrink-0 animate-spin text-amber-500" aria-hidden="true" />
  }

  const name = toolName.toLowerCase()

  if (name.includes('read') || name.includes('file')) {
    return <FileText size={14} className="flex-shrink-0 text-sky-500" aria-hidden="true" />
  }
  if (name.includes('bash') || name.includes('shell') || name.includes('powershell')) {
    return <Terminal size={14} className="flex-shrink-0 text-green-500" aria-hidden="true" />
  }
  if (name.includes('search') || name.includes('web')) {
    return <Globe size={14} className="flex-shrink-0 text-blue-500" aria-hidden="true" />
  }
  if (name.includes('edit') || name.includes('write') || name.includes('code')) {
    return <Code size={14} className="flex-shrink-0 text-purple-500" aria-hidden="true" />
  }

  // 默认通用图标
  return <Sparkles size={14} className="flex-shrink-0 text-muted-foreground" aria-hidden="true" />
}

// 格式化相对时间（刚刚、2分钟前、1小时前）
function formatRelativeTime(timestamp: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const now = Date.now()
  const diff = now - timestamp

  if (diff < 5000) return t('chat.sidePanel.relativeTime.justNow')
  if (diff < 60000) return t('chat.sidePanel.relativeTime.secondsAgo', { count: Math.floor(diff / 1000) })
  if (diff < 3600000) return t('chat.sidePanel.relativeTime.minutesAgo', { count: Math.floor(diff / 60000) })
  if (diff < 86400000) return t('chat.sidePanel.relativeTime.hoursAgo', { count: Math.floor(diff / 3600000) })
  return t('chat.sidePanel.relativeTime.daysAgo', { count: Math.floor(diff / 86400000) })
}

// 格式化耗时（1.2s、350ms）
function formatDuration(ms?: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// 错误类型 → 人类可读文本。和 ChatPage 的 getToolErrorPresentation 保持
// 一致的取值集合（v2 §12 categorized failure types）。
const ERROR_TYPE_KEYS = new Set([
  'invalid_input', 'permission_denied', 'tool_timeout', 'user_aborted',
  'rate_limit', 'overloaded', 'model_error', 'contract_fail',
  'dependency_fail', 'internal',
])
function getErrorTypeLabel(errorType: string, t: (key: string) => string): string {
  if (ERROR_TYPE_KEYS.has(errorType)) return t(`chat.sidePanel.errorType.${errorType}`)
  return errorType
}

// 获取产物类型图标。链接类型用外链图标；文件类型优先用彩色 SVG（按扩展名/
// mimeType），未命中再回退到通用 FileText。
function getArtifactIcon(artifact: ArtifactRef) {
  const isLink = artifact.type === 'link' || artifact.uri?.startsWith('http')
  if (isLink) {
    return <ExternalLink size={20} className="flex-shrink-0 text-blue-500" aria-hidden="true" />
  }
  const iconSrc = resolveArtifactIcon({
    name: artifact.name,
    uri: artifact.uri,
    mimeType: artifact.mime_type,
  })
  if (iconSrc) {
    return <img src={iconSrc} alt="" className="h-5 w-[14px] flex-shrink-0 object-contain" aria-hidden="true" />
  }
  return <FileText size={20} className="flex-shrink-0 text-muted-foreground" aria-hidden="true" />
}

// 通过主进程 shell.openExternal 打开外部 URL。和 SettingsPage / ChatPage 的
// 处理方式保持一致,不依赖 BrowserWindow 的 setWindowOpenHandler 隐式行为。
function openExternalUrl(url: string) {
  const fn = window.appRuntime?.openExternal
  if (fn) {
    void fn(url)
  } else {
    // 兜底:开发环境或 preload 未注入时,走 window.open(setWindowOpenHandler 会拦截)
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}


export function ConversationSidePanel({ logEntries, messageGroupedLogs, steps, artifacts, onSelectArtifact, onRevealArtifact, sessionId, onSelectWorkspaceFile }: ConversationSidePanelProps) {
  const { t } = useTranslation()
  // 优先级：messageGroupedLogs > logEntries > steps
  const useGroupedLogs = !!messageGroupedLogs && messageGroupedLogs.length > 0
  const useLegacySteps = !useGroupedLogs && !logEntries && Array.isArray(steps)
  const effectiveLogEntries = logEntries ?? []
  const effectiveSteps = steps ?? []
  const effectiveGroupedLogs = messageGroupedLogs ?? []
  // Default closed every visit (tab choice is persisted, expanded state isn't).
  const [expanded, setExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState<PanelTab>(() => readStoredTab())
  // 产物 tab 下的子模式（通用/开发），持久化到 localStorage。
  const [artifactMode, setArtifactMode] = useState<ArtifactMode>(() => readStoredArtifactMode())
  // 展开状态：key = entry.id, value = true 表示展开
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({})
  // 消息分组展开状态：key = messageId, value = true 表示展开
  const [expandedMessages, setExpandedMessages] = useState<Record<string, boolean>>({})
  // logEntries 变化时(切会话/切对话),清理已经不在列表里的展开状态。
  useEffect(() => {
    if (useGroupedLogs) {
      setExpandedMessages((prev) => {
        const liveIds = new Set(effectiveGroupedLogs.map((g) => g.messageId))
        let changed = false
        const next: Record<string, boolean> = {}
        for (const key of Object.keys(prev)) {
          if (liveIds.has(key)) {
            next[key] = prev[key]
          } else {
            changed = true
          }
        }
        return changed ? next : prev
      })
    } else {
      setExpandedLogs((prev) => {
        const liveIds = new Set(effectiveLogEntries.map((e) => e.id))
        let changed = false
        const next: Record<string, boolean> = {}
        for (const key of Object.keys(prev)) {
          if (liveIds.has(key)) {
            next[key] = prev[key]
          } else {
            changed = true
          }
        }
        return changed ? next : prev
      })
    }
  }, [useGroupedLogs, effectiveLogEntries, effectiveGroupedLogs])
  // 相对时间需要随时间推移自动刷新("刚刚"→"1 分钟前")。仅在面板展开
  // 且当前在日志 tab 时启动 60s ticker,避免后台空转。
  const [, forceTick] = useState(0)
  useEffect(() => {
    if (!expanded || activeTab !== 'logs') return
    const id = window.setInterval(() => forceTick((n) => n + 1), 60_000)
    return () => window.clearInterval(id)
  }, [expanded, activeTab])

  useEffect(() => {
    try {
      localStorage.setItem(TAB_STORAGE_KEY, activeTab)
    } catch {
      // ignore — non-critical persistence
    }
  }, [activeTab])

  useEffect(() => {
    try {
      localStorage.setItem(ARTIFACT_MODE_STORAGE_KEY, artifactMode)
    } catch {
      // ignore — non-critical persistence
    }
  }, [artifactMode])

  const toggleExpanded = () => setExpanded((prev) => !prev)
  const toggleLogExpanded = (id: string) => {
    setExpandedLogs((prev) => ({ ...prev, [id]: !prev[id] }))
  }
  const toggleMessageExpanded = (messageId: string) => {
    setExpandedMessages((prev) => ({ ...prev, [messageId]: !prev[messageId] }))
  }

  return (
    <aside
      aria-label={t('chat.sidePanel.label')}
      style={{ width: expanded ? PANEL_WIDTH_EXPANDED : PANEL_WIDTH_COLLAPSED }}
      className="relative flex-shrink-0 flex flex-col select-none overflow-hidden transition-[width] duration-200"
    >
      {/* Header: collapse/expand toggle pinned left, tabs centered (when
          expanded). pt-[45px] + the 18px icon centered in the 36px button puts
          the icon 54px from the top boundary, per design spec. */}
      <div className="relative flex flex-shrink-0 items-center justify-center pl-2 pr-[26px] pt-[45px] pb-3">
        <button
          onClick={toggleExpanded}
          title={expanded ? t('chat.sidePanel.collapseAria') : t('chat.sidePanel.expandAria')}
          aria-label={expanded ? t('chat.sidePanel.collapseAria') : t('chat.sidePanel.expandAria')}
          aria-expanded={expanded}
          className={cn(
            'inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-accent',
            expanded && 'absolute left-2'
          )}
        >
          <img
            src={expanded ? iconSidebarCollapse : iconSidebarOpen}
            alt=""
            className="h-[18px] w-[18px]"
            aria-hidden="true"
          />
        </button>

        {expanded && (
          <div role="tablist" aria-label={t('chat.sidePanel.tabsAria')} className="flex items-center gap-1">
            <button
              role="tab"
              aria-selected={activeTab === 'logs'}
              onClick={() => setActiveTab('logs')}
              className={cn(
                'inline-flex h-8 w-12 items-center justify-center rounded-lg text-xs font-medium transition-colors',
                activeTab === 'logs'
                  ? 'bg-background text-foreground shadow-sm ring-1 ring-border/60'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t('chat.sidePanel.tabLogs')}
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'artifacts'}
              onClick={() => setActiveTab('artifacts')}
              className={cn(
                'inline-flex h-8 w-12 items-center justify-center rounded-lg text-xs font-medium transition-colors',
                activeTab === 'artifacts'
                  ? 'bg-background text-foreground shadow-sm ring-1 ring-border/60'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t('chat.sidePanel.tabArtifacts')}
            </button>
          </div>
        )}
      </div>

      {/* Body — only rendered while expanded; collapsed state is just the header button. */}
      {expanded && (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {activeTab === 'logs' ? (
            useGroupedLogs ? (
              effectiveGroupedLogs.length === 0 ? (
                <EmptyState
                  title={t('chat.sidePanel.noLogs')}
                  desc={t('chat.sidePanel.noLogsDesc')}
                />
              ) : (
                <ul className="space-y-3">
                  {effectiveGroupedLogs.map((group) => {
                    const messageExpanded = expandedMessages[group.messageId] !== false // 默认展开
                    const toolCount = group.entries.length
                    return (
                      <li key={group.messageId} className="rounded-lg border border-border bg-card/30">
                        {/* 消息头部 */}
                        <button
                          onClick={() => toggleMessageExpanded(group.messageId)}
                          className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left transition-colors hover:bg-accent/50"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "text-xs font-medium",
                                group.role === 'user' ? 'text-primary' : 'text-foreground'
                              )}>
                                {group.role === 'user' ? '用户' : 'AI'}
                              </span>
                              {toolCount > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  <Wrench size={10} />
                                  <span>{toolCount}</span>
                                </span>
                              )}
                            </div>
                            {group.contentPreview && (
                              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                {group.contentPreview}
                              </p>
                            )}
                          </div>
                          {messageExpanded ? <ChevronUp size={14} className="flex-shrink-0 text-muted-foreground" /> : <ChevronDown size={14} className="flex-shrink-0 text-muted-foreground" />}
                        </button>

                        {/* 展开的工具列表 */}
                        {messageExpanded && group.entries.length > 0 && (
                          <div className="border-t border-border px-2 py-2 space-y-1.5">
                            {group.entries.map((entry) => {
                              const isExpanded = expandedLogs[entry.id] || false
                              const hasDetails = !!(
                                entry.durationMs ||
                                entry.errorMessage ||
                                entry.searchUrls?.length ||
                                entry.searchQuery ||
                                entry.searchResultCount !== undefined
                              )

                              return (
                                <div key={entry.id} className="rounded border border-border/50 bg-background px-2 py-1.5">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5">
                                        {getToolIcon(entry.toolName || '', entry.toolStatus)}
                                        <span className="truncate text-[11px] font-medium text-foreground">
                                          {entry.toolName || 'Unknown'}
                                        </span>
                                        {entry.toolStatus === 'success' && (
                                          <span className="flex-shrink-0 text-[9px] text-green-600">✓</span>
                                        )}
                                        {entry.toolStatus === 'failed' && (
                                          <span className="flex-shrink-0 text-[9px] text-red-600">✗</span>
                                        )}
                                        {entry.toolStatus === 'running' && (
                                          <Loader2 size={9} className="flex-shrink-0 animate-spin text-amber-500" />
                                        )}
                                      </div>
                                      {entry.description && (
                                        <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground line-clamp-1">
                                          {entry.description}
                                        </p>
                                      )}
                                    </div>
                                    {hasDetails && (
                                      <button
                                        onClick={() => toggleLogExpanded(entry.id)}
                                        className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                                        aria-label={isExpanded ? t('chat.sidePanel.collapse') : t('chat.sidePanel.expand')}
                                      >
                                        {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                      </button>
                                    )}
                                  </div>

                                  {/* 展开内容 */}
                                  {isExpanded && hasDetails && (
                                    <div className="mt-1.5 space-y-1 border-t border-border/50 pt-1.5">
                                      {entry.durationMs !== undefined && (
                                        <div className="text-[10px] text-muted-foreground">
                                          <span className="font-medium">{t('chat.sidePanel.duration')}</span> {formatDuration(entry.durationMs)}
                                        </div>
                                      )}
                                      {entry.errorType && (
                                        <div className="rounded bg-red-50 px-1.5 py-1 text-[10px] text-red-700 dark:bg-red-950/30 dark:text-red-300">
                                          <span className="font-medium">{t('chat.sidePanel.error')}</span> {getErrorTypeLabel(entry.errorType, t)}
                                          {entry.errorMessage && (
                                            <div className="mt-0.5 text-[9px] opacity-80 [overflow-wrap:anywhere]">{entry.errorMessage}</div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )
            ) : useLegacySteps ? (
              effectiveSteps.length === 0 ? (
                <EmptyState
                  title={t('chat.sidePanel.noLogs')}
                  desc={t('chat.sidePanel.noLogsDesc')}
                />
              ) : (
                <ul className="space-y-3">
                  {effectiveSteps.map((step) => (
                    <li key={step.id} className="flex items-start gap-2">
                      <span className={cn('mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full', legacyStatusDot(step.status))} aria-hidden="true" />
                      <p className="text-xs leading-5 text-muted-foreground">{legacyStepLabel(step, t)}</p>
                    </li>
                  ))}
                </ul>
              )
            ) : (
            effectiveLogEntries.length === 0 ? (
              <EmptyState
                title={t('chat.sidePanel.noLogs')}
                desc={t('chat.sidePanel.noLogsDesc')}
              />
            ) : (
              <ul className="space-y-2">
                {effectiveLogEntries.map((entry) => {
                  const isExpanded = expandedLogs[entry.id] || false
                  const hasDetails = !!(
                    entry.durationMs ||
                    entry.errorMessage ||
                    entry.searchUrls?.length ||
                    entry.searchQuery ||
                    entry.searchResultCount !== undefined
                  )

                  return (
                    <li key={entry.id} className="rounded-lg border border-border bg-card/50 px-2.5 py-2">
                      {/* 头部：时间 + 图标 + 工具名 + 状态 + 展开按钮 */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {getToolIcon(entry.toolName || '', entry.toolStatus)}
                            <span className="truncate text-xs font-medium text-foreground">
                              {entry.toolName || 'Unknown'}
                            </span>
                            {entry.toolStatus === 'success' && (
                              <span className="flex-shrink-0 text-[10px] text-green-600">✓</span>
                            )}
                            {entry.toolStatus === 'failed' && (
                              <span className="flex-shrink-0 text-[10px] text-red-600">✗</span>
                            )}
                            {entry.toolStatus === 'running' && (
                              <Loader2 size={10} className="flex-shrink-0 animate-spin text-amber-500" />
                            )}
                          </div>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {formatRelativeTime(entry.timestamp, t)}
                            {entry.subagentName && ` · ${entry.subagentName}`}
                          </p>
                          {entry.description && (
                            <p className="mt-1 text-xs leading-5 text-muted-foreground line-clamp-2">
                              {entry.description}
                            </p>
                          )}
                        </div>
                        {hasDetails && (
                          <button
                            onClick={() => toggleLogExpanded(entry.id)}
                            className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                            aria-label={isExpanded ? t('chat.sidePanel.collapse') : t('chat.sidePanel.expand')}
                          >
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        )}
                      </div>

                      {/* 展开内容：耗时、错误、搜索结果 */}
                      {isExpanded && hasDetails && (
                        <div className="mt-2 space-y-2 border-t border-border pt-2">
                          {entry.durationMs !== undefined && (
                            <div className="text-[11px] text-muted-foreground">
                              <span className="font-medium">{t('chat.sidePanel.duration')}</span> {formatDuration(entry.durationMs)}
                            </div>
                          )}
                          {entry.errorType && (
                            <div className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:bg-red-950/30 dark:text-red-300">
                              <span className="font-medium">{t('chat.sidePanel.error')}</span> {getErrorTypeLabel(entry.errorType, t)}
                              {entry.errorMessage && (
                                <div className="mt-0.5 text-[10px] opacity-80 [overflow-wrap:anywhere]">{entry.errorMessage}</div>
                              )}
                            </div>
                          )}
                          {entry.searchQuery && (
                            <div className="text-[11px] text-muted-foreground">
                              <span className="font-medium">{t('chat.sidePanel.query')}</span> {entry.searchQuery}
                            </div>
                          )}
                          {entry.searchResultCount !== undefined && (
                            <div className="text-[11px] text-muted-foreground">
                              <span className="font-medium">{t('chat.sidePanel.resultCount')}</span> {entry.searchResultCount}
                            </div>
                          )}
                          {entry.searchUrls && entry.searchUrls.length > 0 && (
                            <div className="space-y-1">
                              <div className="text-[11px] font-medium text-muted-foreground">
                                {t('chat.sidePanel.links')}{entry.searchUrls.length > 5 ? t('chat.sidePanel.linksTruncated', { count: entry.searchUrls.length }) : ''}:
                              </div>
                              {entry.searchUrls.slice(0, 5).map((url) => (
                                <button
                                  key={url.url}
                                  type="button"
                                  onClick={() => openExternalUrl(url.url)}
                                  className="flex w-full items-center gap-1.5 rounded bg-accent px-2 py-1 text-left text-[11px] text-foreground hover:bg-accent/80 transition-colors"
                                  title={url.url}
                                >
                                  <ExternalLink size={10} className="flex-shrink-0" />
                                  <span className="truncate">{url.title || url.url}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )
            )
          ) : (
            // 产物 tab 内容
            <div>
              {/* 产物子模式切换 - 右上角 */}
              <div className="mb-3 flex justify-end">
                <div className="flex items-center gap-1 text-[11px]">
                  <button
                    onClick={() => setArtifactMode('general')}
                    className={cn(
                      'px-2 py-1 transition-colors',
                      artifactMode === 'general'
                        ? 'font-medium text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t('chat.sidePanel.artifactModeGeneral')}
                  </button>
                  <span className="text-muted-foreground/40">|</span>
                  <button
                    onClick={() => setArtifactMode('dev')}
                    className={cn(
                      'px-2 py-1 transition-colors',
                      artifactMode === 'dev'
                        ? 'font-medium text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t('chat.sidePanel.artifactModeDev')}
                  </button>
                </div>
              </div>

              {/* 产物内容 */}
              {artifactMode === 'general' ? (
                artifacts.length === 0 ? (
                  <EmptyState
                    title={t('chat.sidePanel.noArtifacts')}
                    desc={t('chat.sidePanel.noArtifactsDesc')}
                  />
                ) : (
                  <ul className="space-y-2">
                    {artifacts.map((artifact) => {
                      const title = artifact.name || artifact.artifact_id
                      const isLink = artifact.type === 'link' || artifact.uri?.startsWith('http')

                      return (
                        <li key={artifact.artifact_id}>
                          <div className="group flex w-full items-center gap-3 rounded-2xl border border-border bg-background px-3 py-2.5 text-left transition-colors hover:border-primary/60">
                            {/* 左侧图标 */}
                            {getArtifactIcon(artifact)}
                            {/* 中间文件名 */}
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-medium text-foreground">{title}</div>
                            </div>
                            {/* 右侧操作图标：预览 + 打开 */}
                            <div className="flex flex-shrink-0 items-center gap-0.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (isLink && artifact.uri) {
                                    openExternalUrl(artifact.uri)
                                  } else {
                                    onSelectArtifact(artifact)
                                  }
                                }}
                                title={isLink ? t('chat.sidePanel.artifactOpenExternal') : t('chat.sidePanel.artifactPreview')}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              >
                                {isLink ? <ExternalLink size={14} /> : <Search size={14} />}
                              </button>
                              {!isLink && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onRevealArtifact?.(artifact)
                                  }}
                                  title={t('chat.sidePanel.artifactOpen')}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                >
                                  <FolderOpen size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )
              ) : (
                <WorkspaceFileTreeView sessionId={sessionId} onSelectFile={onSelectWorkspaceFile} />
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

function EmptyState({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-2 py-8 text-center">
      <p className="text-xs font-medium text-foreground">{title}</p>
      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{desc}</p>
    </div>
  )
}

/**
 * 开发模式：会话工作区文件树（窄面板版）。
 * 读 `~/.harnessclaw/workspace/session/<sid>`，渲染完整文件树（含 deliverables/、tasks/ 等）；
 * 点文件交给宿主（ChatPage）走 FilePreviewDrawer 预览，不在 280px 面板内塞预览。
 */
function WorkspaceFileTreeView({
  sessionId,
  onSelectFile,
}: {
  sessionId?: string
  onSelectFile?: (path: string, fileName: string) => void
}) {
  const { t } = useTranslation()
  const [tree, setTree] = useState<WorkspaceFileNode[]>([])
  const [exists, setExists] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!sessionId) {
      setTree([])
      setExists(false)
      setError(null)
      return
    }
    if (typeof window === 'undefined' || !window.workspace || typeof window.workspace.listSession !== 'function') {
      setError('workspace api unavailable')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await window.workspace.listSession(sessionId)
      if (!res.ok) {
        setError(res.error || 'failed')
        setTree([])
        setExists(false)
        return
      }
      setTree(res.tree)
      setExists(res.exists)
    } catch (err) {
      setError(String((err as Error)?.message || err))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <div className="space-y-2">
      {loading ? (
        <div className="flex items-center justify-center px-2 py-8 text-[11px] text-muted-foreground">
          {t('chat.header.workspaceLoading')}
        </div>
      ) : error ? (
        <div className="flex items-center justify-center px-2 py-8 text-[11px] text-destructive">
          {error}
        </div>
      ) : !exists || tree.length === 0 ? (
        <EmptyState
          title={t('chat.header.workspaceEmpty')}
          desc={t('chat.sidePanel.noArtifactsDesc')}
        />
      ) : (
        <ul>
          {tree.map((node) => (
            <WorkspaceTreeRow
              key={node.path}
              node={node}
              depth={0}
              onSelectFile={(path, fileName) => onSelectFile?.(path, fileName)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** 文件树递归行：目录可展开/折叠，文件点击触发预览回调。 */
function WorkspaceTreeRow({
  node,
  depth,
  onSelectFile,
}: {
  node: WorkspaceFileNode
  depth: number
  onSelectFile: (path: string, fileName: string) => void
}) {
  const [expanded, setExpanded] = useState(depth === 0)
  const indent = { paddingLeft: `${4 + depth * 12}px` }

  if (node.type === 'dir') {
    const children = node.children || []
    return (
      <li>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-1 px-1 py-1 text-left text-xs text-foreground transition-colors hover:bg-accent rounded"
          style={indent}
        >
          {expanded ? (
            <ChevronDown size={11} className="shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight size={11} className="shrink-0 text-muted-foreground" />
          )}
          <Folder size={12} className="shrink-0 text-primary" />
          <span className="truncate font-medium">{node.name}</span>
        </button>
        {expanded && children.length > 0 && (
          <ul>
            {children.map((child) => (
              <WorkspaceTreeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                onSelectFile={onSelectFile}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelectFile(node.path, node.name)}
        className="flex w-full items-center gap-1 px-1 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground rounded"
        style={indent}
        title={node.path}
      >
        <span className="w-[11px] shrink-0" aria-hidden="true" />
        <File size={12} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
    </li>
  )
}
