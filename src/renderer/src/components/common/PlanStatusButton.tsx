import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ListChecks,
  X,
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  MinusCircle,
  Clock,
} from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * Collapsed plan view shown after the user approves a plan (v1.15+).
 *
 * Renders a small icon button pinned to the top-right of the chat area.
 * Clicking it opens a popover with the plan's live execution status.
 *
 * v1.16: status / summary fields are populated from the new
 * `step.dispatched/started/completed/failed/skipped/progress` and
 * `plan.completed/failed` emit events (§6.13/§6.16). The button face shows
 * an at-a-glance "running 1/3" or "✓ 3/3 完成" summary so the user knows
 * the plan's pulse without having to open the popover.
 */

export type PlanStepStatus =
  | 'pending'
  | 'dispatched'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'

export type PlanRunStatus = 'created' | 'running' | 'completed' | 'failed'

export interface PlanStatusStep {
  id: string
  description?: string
  subagent_type?: string
  depends_on?: string[]
  status?: PlanStepStatus
  summary?: string
}

export interface PlanStatusButtonValue {
  planId: string
  goal: string
  rationale?: string
  steps: PlanStatusStep[]
  planStatus?: PlanRunStatus
}

interface PlanStatusButtonProps {
  plan: PlanStatusButtonValue
  className?: string
}

interface StepBadge {
  icon: JSX.Element
  ringClass: string
  labelClass: string
}

function getStepBadge(status: PlanStepStatus | undefined): StepBadge {
  switch (status) {
    case 'running':
      return {
        icon: <Loader2 size={12} strokeWidth={2.4} className="animate-spin" />,
        ringClass: 'border-primary/50 bg-primary/10 text-primary',
        labelClass: 'text-primary',
      }
    case 'dispatched':
      return {
        icon: <Clock size={12} strokeWidth={2.2} />,
        ringClass: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
        labelClass: 'text-amber-600 dark:text-amber-400',
      }
    case 'completed':
      return {
        icon: <CheckCircle2 size={12} strokeWidth={2.4} />,
        ringClass: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        labelClass: 'text-emerald-600 dark:text-emerald-400',
      }
    case 'failed':
      return {
        icon: <XCircle size={12} strokeWidth={2.4} />,
        ringClass: 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400',
        labelClass: 'text-red-600 dark:text-red-400',
      }
    case 'skipped':
      return {
        icon: <MinusCircle size={12} strokeWidth={2.2} />,
        ringClass: 'border-border bg-muted text-muted-foreground',
        labelClass: 'text-muted-foreground line-through',
      }
    case 'pending':
    default:
      return {
        icon: <Circle size={12} strokeWidth={2} />,
        ringClass: 'border-border bg-card text-muted-foreground/70',
        labelClass: 'text-foreground',
      }
  }
}

function statusLabel(t: any, status: PlanStepStatus | undefined): string {
  switch (status) {
    case 'running': return t('plan.status.running')
    case 'dispatched': return t('plan.status.dispatched')
    case 'completed': return t('plan.status.completed')
    case 'failed': return t('plan.status.failed')
    case 'skipped': return t('plan.status.skipped')
    case 'pending':
    default: return t('plan.status.pending')
  }
}

export function PlanStatusButton({ plan, className }: PlanStatusButtonProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape so the popover doesn't trap interaction.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const counts = useMemo(() => {
    const total = plan.steps.length
    let completed = 0
    let running = 0
    let failed = 0
    let skipped = 0
    for (const s of plan.steps) {
      if (s.status === 'completed') completed++
      else if (s.status === 'running' || s.status === 'dispatched') running++
      else if (s.status === 'failed') failed++
      else if (s.status === 'skipped') skipped++
    }
    return { total, completed, running, failed, skipped }
  }, [plan.steps])

  const planTerminal = plan.planStatus === 'completed' || plan.planStatus === 'failed'
  const buttonAccent = plan.planStatus === 'failed'
    ? 'border-red-500/40 text-red-600 dark:text-red-400 hover:border-red-500/60'
    : plan.planStatus === 'completed'
      ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:border-emerald-500/60'
      : counts.running > 0
        ? 'border-primary/40 text-primary hover:border-primary/60'
        : 'text-foreground hover:border-primary/40 hover:text-primary'

  const buttonIcon = counts.running > 0 && !planTerminal
    ? <Loader2 size={14} strokeWidth={2.2} className="animate-spin text-primary" />
    : plan.planStatus === 'completed'
      ? <CheckCircle2 size={14} strokeWidth={2.4} className="text-emerald-500" />
      : plan.planStatus === 'failed'
        ? <XCircle size={14} strokeWidth={2.4} className="text-red-500" />
        : <ListChecks size={14} strokeWidth={2.2} className="text-primary" />

  const summaryLine = (() => {
    if (plan.planStatus === 'completed') {
      return t('plan.summary.completed', { completed: counts.completed, total: counts.total })
    }
    if (plan.planStatus === 'failed') {
      return t('plan.summary.failed', { failed: counts.failed, skipped: counts.skipped })
    }
    if (counts.running > 0) {
      return t('plan.summary.running', { completed: counts.completed, total: counts.total })
    }
    if (counts.completed > 0) {
      return t('plan.summary.progress', { completed: counts.completed, total: counts.total })
    }
    return t('plan.summary.waiting', { total: counts.total })
  })()

  return (
    <div ref={containerRef} className={cn('pointer-events-auto relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t('plan.buttonLabel')}
        className={cn(
          'group inline-flex items-center gap-1.5 rounded-full border bg-card/95 px-3 py-1.5 text-[12px] font-medium shadow-sm backdrop-blur-sm transition-colors',
          buttonAccent,
          open && 'bg-card',
        )}
      >
        {buttonIcon}
        <span>{t('plan.buttonLabel')}</span>
        <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground">
          {counts.completed}/{counts.total}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('plan.dialogTitle')}
          className="absolute right-0 top-[calc(100%+8px)] z-30 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-2 border-b border-border bg-muted/40 px-4 py-3">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.1em] text-muted-foreground">
                {t('plan.taskPlan')} · {plan.planStatus === 'completed' ? t('plan.status.completed') : plan.planStatus === 'failed' ? t('plan.status.failed') : t('plan.status.running')}
              </div>
              <div className="mt-0.5 truncate text-[13px] font-semibold text-foreground" title={plan.goal}>
                {plan.goal || t('plan.dialogTitle')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('plan.close')}
              className="-mr-1 -mt-1 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X size={14} />
            </button>
          </div>

          {plan.rationale && (
            <div className="border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
              {plan.rationale}
            </div>
          )}

          {/* Steps */}
          <div className="max-h-[60vh] overflow-y-auto px-3 py-2">
            {plan.steps.length === 0 ? (
              <div className="px-2 py-4 text-center text-[12px] text-muted-foreground">
                {t('plan.noSteps')}
              </div>
            ) : (
              <ol className="space-y-1">
                {plan.steps.map((step, idx) => {
                  const badge = getStepBadge(step.status)
                  return (
                    <li
                      key={step.id}
                      className={cn(
                        'flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors',
                        step.status === 'running'
                          ? 'bg-primary/5'
                          : step.status === 'failed'
                            ? 'bg-red-500/5'
                            : 'hover:bg-muted/40',
                      )}
                    >
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold text-muted-foreground">
                        {idx + 1}
                      </span>
                      <span
                        className={cn(
                          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                          badge.ringClass,
                        )}
                      >
                        {badge.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className={cn('truncate text-[12.5px] font-medium', badge.labelClass)} title={step.description || step.id}>
                          {step.description || step.id}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span>{statusLabel(t, step.status)}</span>
                          {step.subagent_type && (
                            <>
                              <span>·</span>
                              <span className="rounded bg-muted px-1 py-px font-mono text-[9.5px] uppercase tracking-wide">
                                {step.subagent_type}
                              </span>
                            </>
                          )}
                          {step.depends_on && step.depends_on.length > 0 && (
                            <>
                              <span>·</span>
                              <span>{t('plan.dependsOn', { deps: step.depends_on.join(', ') })}</span>
                            </>
                          )}
                        </div>
                        {step.summary && (
                          <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                            {step.summary}
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>

          <div className="flex items-center gap-1.5 border-t border-border bg-muted/30 px-4 py-2 text-[10px] text-muted-foreground">
            {plan.planStatus === 'failed'
              ? <XCircle size={11} className="text-red-500" />
              : plan.planStatus === 'completed'
                ? <CheckCircle2 size={11} className="text-emerald-500" />
                : <Loader2 size={11} className="animate-spin text-primary" />}
            <span>{summaryLine}</span>
          </div>
        </div>
      )}
    </div>
  )
}
