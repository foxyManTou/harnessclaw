import { createPortal } from 'react-dom'
import { AlertTriangle, Info, AlertCircle, CheckCircle2 } from 'lucide-react'

/**
 * Framework-level system notification modal (v0.6.0 §10.9 — card_kind=system).
 *
 * The protocol carries notices such as "搜索能力不可用" / "密钥即将过期" /
 * "能力降级". Per product requirement, the user MUST manually acknowledge
 * the notice — there is no auto-dismiss, no backdrop-click-to-close, and
 * no Escape-to-close. The only way out is the "我已知晓" button.
 *
 * Multiple notices queue up; this component renders the head of the queue.
 * Dedup is enforced upstream by `card_id` so we just trust the queue order.
 *
 * Visual variant is driven by `icon` (mapped from `hint.icon` server-side):
 *   - warning  → amber, AlertTriangle
 *   - error    → red,   AlertCircle
 *   - success  → green, CheckCircle2
 *   - info / * → blue,  Info
 */
export interface SystemNotice {
  /** Stable id (= card_id from the server) used for queue dedup. */
  id: string
  /**
   * v0.6.1 §10.9 — stable machine-readable classification (snake_case),
   * e.g. `search_capability_gap`. Use this — NOT `title` / `summary` — as
   * the business-logic key (deeplink, telemetry, conditional rendering).
   * Empty / unknown topics still render as a generic system card per the
   * forward-compat clause.
   */
  topic?: string
  title: string
  summary: string
  /** Optional "next steps" hint, often a YAML/config snippet or doc link. */
  actionHint?: string
  /** From hint.icon — drives the variant. */
  icon?: string
  /** envelope.severity — info | warn | error. */
  severity?: string
}

/**
 * Known topics (v0.6.1 §10.9 table). Adding a new topic here is optional —
 * unknown topics still render correctly via the fallback path; this map is
 * only consulted for business-logic-aware affordances (currently: a
 * "去设置" CTA for the search-config gap).
 */
const KNOWN_TOPICS: Record<string, { label: string; deeplink?: string }> = {
  search_capability_gap: { label: '搜索能力', deeplink: 'settings:search' },
}

const VARIANT_BY_ICON: Record<
  string,
  {
    iconWrap: string
    Icon: typeof Info
    title: string
    border: string
    button: string
  }
> = {
  warning: {
    iconWrap: 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300',
    Icon: AlertTriangle,
    title: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-200/80 dark:border-amber-900/40',
    button:
      'bg-amber-500 text-white hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500',
  },
  error: {
    iconWrap: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300',
    Icon: AlertCircle,
    title: 'text-red-700 dark:text-red-300',
    border: 'border-red-200/80 dark:border-red-900/40',
    button:
      'bg-red-500 text-white hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-500',
  },
  success: {
    iconWrap: 'bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-300',
    Icon: CheckCircle2,
    title: 'text-green-700 dark:text-green-300',
    border: 'border-green-200/80 dark:border-green-900/40',
    button:
      'bg-green-500 text-white hover:bg-green-600 dark:bg-green-600 dark:hover:bg-green-500',
  },
  info: {
    iconWrap: 'bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300',
    Icon: Info,
    title: 'text-sky-700 dark:text-sky-300',
    border: 'border-sky-200/80 dark:border-sky-900/40',
    button:
      'bg-sky-500 text-white hover:bg-sky-600 dark:bg-sky-600 dark:hover:bg-sky-500',
  },
}

function pickVariant(icon?: string, severity?: string) {
  if (icon && VARIANT_BY_ICON[icon]) return VARIANT_BY_ICON[icon]
  if (severity === 'error') return VARIANT_BY_ICON.error
  if (severity === 'warn') return VARIANT_BY_ICON.warning
  return VARIANT_BY_ICON.info
}

export function SystemNoticeModal({
  notice,
  queueDepth,
  onAcknowledge,
  onNavigateDeeplink,
}: {
  notice: SystemNotice | null
  /** Number of notices behind this one in the queue, for "还有 N 条" hint. */
  queueDepth: number
  onAcknowledge: (id: string) => void
  /**
   * Optional handler invoked when the user clicks the topic-specific CTA
   * (e.g. "去设置" for `search_capability_gap`). Receives the deeplink key
   * from the topic table. If omitted, no CTA button is shown.
   */
  onNavigateDeeplink?: (deeplink: string, notice: SystemNotice) => void
}) {
  if (!notice) return null

  const variant = pickVariant(notice.icon, notice.severity)
  const { Icon } = variant
  const known = notice.topic ? KNOWN_TOPICS[notice.topic] : undefined
  const canDeeplink = !!known?.deeplink && !!onNavigateDeeplink

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-[6px]"
      // Intentionally NO onPointerDown close — the user must click 我已知晓.
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`system-notice-title-${notice.id}`}
    >
      <div
        className={`w-full max-w-md rounded-2xl border ${variant.border} bg-card p-5 shadow-[0_24px_80px_rgba(15,23,42,0.32)]`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl ${variant.iconWrap}`}
          >
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                id={`system-notice-title-${notice.id}`}
                className={`text-base font-semibold ${variant.title}`}
              >
                {notice.title}
              </h3>
              {notice.topic && (
                // Topic badge — surfaces the stable machine-readable category
                // (v0.6.1 §10.9). For known topics we show a friendly label;
                // unknown ones fall back to the raw topic so QA / logs can
                // still trace it.
                <span
                  className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground"
                  title={notice.topic}
                >
                  {known?.label ?? notice.topic}
                </span>
              )}
            </div>
            {notice.summary && (
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                {notice.summary}
              </p>
            )}
            {notice.actionHint && (
              <div className="mt-3 rounded-xl border border-border bg-muted/40 p-3">
                <p className="text-xs font-medium text-muted-foreground">下一步</p>
                <pre className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-foreground">
                  {notice.actionHint}
                </pre>
              </div>
            )}
          </div>
        </div>
        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">
            {queueDepth > 0 ? `还有 ${queueDepth} 条系统提示` : '请确认后继续'}
          </p>
          <div className="flex items-center gap-2">
            {canDeeplink && (
              <button
                type="button"
                onClick={() => {
                  onNavigateDeeplink!(known!.deeplink!, notice)
                  onAcknowledge(notice.id)
                }}
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                去设置
              </button>
            )}
            <button
              type="button"
              onClick={() => onAcknowledge(notice.id)}
              autoFocus
              className={`inline-flex min-h-10 items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition-opacity ${variant.button}`}
            >
              我已知晓
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
