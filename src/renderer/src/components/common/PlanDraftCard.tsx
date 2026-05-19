import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  RefreshCw,
  Trash2,
  Plus,
  GripVertical,
} from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * v1.15+ plan-confirmation review card.
 *
 * Renders the `plan.proposed` draft so the user can edit / reorder / approve
 * the step DAG before the engine starts executing it. Approval flows back
 * through `window.harnessclaw.respondPlan` (`plan.response` on the wire).
 *
 * Server-side validation (cycle / forward-only depends_on / unique ids /
 * `subagent_type ∈ available_subagents` when set) is authoritative; this
 * card intentionally doesn't try to mirror it locally — invalid plans are
 * bounced back as a rejection by the engine.
 *
 * v1.16: per-step `subagent_type` is optional and the standard front-end
 * does **not** render it (server-side `SubagentResolver` decides at dispatch
 * time). `availableSubagents` is therefore not surfaced either; it's only
 * kept on the type so an advanced/debug UI could expose a picker later.
 */

export interface PlanDraftStep {
  id: string
  /** v1.16+ optional L3 sub-agent type. Standard frontend leaves it unset. */
  subagent_type?: string
  description?: string
  prompt?: string
  depends_on?: string[]
}

export interface PlanDraftValue {
  planId: string
  agentId?: string
  goal: string
  rationale?: string
  steps: PlanDraftStep[]
  /** v1.16+ available L3 sub-agent types; standard UI doesn't display them. */
  availableSubagents: string[]
}

interface PlanDraftCardProps {
  plan: PlanDraftValue
  /** Disabled state once the user has confirmed and we're waiting on engine. */
  isConfirmed?: boolean
  onConfirm?: (steps: PlanDraftStep[]) => void
  onCancel?: () => void
  onRegenerate?: () => void
}

export function PlanDraftCard({
  plan,
  isConfirmed = false,
  onConfirm,
  onCancel,
  onRegenerate,
}: PlanDraftCardProps) {
  const { t } = useTranslation()
  const [steps, setSteps] = useState<PlanDraftStep[]>(plan.steps)
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  // Re-sync local state when a fresh plan.proposed arrives (e.g. after the
  // user clicks 重新生成 / Regenerate and the engine returns a new draft).
  useEffect(() => {
    setSteps(plan.steps)
  }, [plan.steps, plan.planId])

  const readonly = isConfirmed

  const updateStepField = <K extends keyof PlanDraftStep>(
    id: string,
    field: K,
    value: PlanDraftStep[K],
  ) => {
    if (readonly) return
    setSteps((curr) => curr.map((s) => (s.id === id ? { ...s, [field]: value } : s)))
  }

  const removeStep = (id: string) => {
    if (readonly) return
    setSteps((curr) => curr.filter((s) => s.id !== id))
  }

  const addStep = () => {
    if (readonly) return
    // v1.16: leave `subagent_type` unset; the server resolves the L3 at
    // dispatch time via `SubagentResolver`.
    setSteps((curr) => [
      ...curr,
      {
        id: `s${curr.length + 1}_${Date.now().toString(36)}`,
        description: t('plan.draft.newStep'),
      },
    ])
  }

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    if (readonly) return
    setDraggedIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
  }

  // `dragOverIdx` is a *gap* position in the range 0..steps.length, NOT an
  // item index. `0` = before the first item, `steps.length` = after the last
  // item. Using gap positions lets the user drag any row to truly become the
  // last row by hovering over the lower half of the last item (which would
  // otherwise be impossible if we only tracked "insert before item i").
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    if (readonly) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const isAfter = e.clientY - rect.top > rect.height / 2
    const target = isAfter ? idx + 1 : idx
    if (dragOverIdx !== target) setDragOverIdx(target)
  }

  // Only clear dragOverIdx when the cursor truly leaves the entire list,
  // not when it crosses between sibling items / inner children. Without this
  // guard, native HTML5 DnD fires `dragleave` on the parent every time the
  // cursor enters a child node, causing the indicator to flicker on/off.
  const handleListDragLeave = (e: React.DragEvent) => {
    if (readonly) return
    const related = e.relatedTarget as Node | null
    if (!related || !(e.currentTarget as Node).contains(related)) {
      setDragOverIdx(null)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const target = dragOverIdx
    if (readonly || draggedIdx === null || target === null) {
      setDraggedIdx(null)
      setDragOverIdx(null)
      return
    }
    // Dropping at own position or immediately after own position is a no-op
    // (both refer to "stay where you are").
    if (target === draggedIdx || target === draggedIdx + 1) {
      setDraggedIdx(null)
      setDragOverIdx(null)
      return
    }
    setSteps((curr) => {
      const next = [...curr]
      const [removed] = next.splice(draggedIdx, 1)
      // Removing an earlier element shifts every later gap down by one.
      const insertAt = draggedIdx < target ? target - 1 : target
      next.splice(insertAt, 0, removed)
      return next
    })
    setDraggedIdx(null)
    setDragOverIdx(null)
  }

  const handleDragEnd = () => {
    setDraggedIdx(null)
    setDragOverIdx(null)
  }

  return (
    <div
      className={cn(
        'mt-2 w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-xl transition-all duration-300',
        readonly && 'opacity-95',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-4">
        <div className="flex flex-col gap-0.5">
          <span className="whitespace-nowrap text-[10px] font-black uppercase tracking-[0.1em] text-muted-foreground">
            {t('plan.draft.title')}
          </span>
        </div>
        {plan.rationale && (
          <span className="ml-3 truncate text-[11px] text-muted-foreground" title={plan.rationale}>
            {plan.rationale}
          </span>
        )}
      </div>

      {/* Goal — single line with ellipsis; full text on hover via title attr.
          Long task goals would otherwise wrap to 3+ lines and dominate the
          card, pushing the steps below the fold. */}
      {plan.goal && (
        <div className="flex items-center gap-2 border-b border-border bg-background px-5 py-2.5 text-[12px] text-muted-foreground">
          <span className="shrink-0 font-medium text-foreground">{t('plan.draft.goalLabel')}</span>
          <span className="truncate" title={plan.goal}>{plan.goal}</span>
        </div>
      )}

      {/* Steps */}
      <div className="space-y-1 p-3" onDragLeave={handleListDragLeave}>
        {steps.length === 0 && (
          <div className="px-2.5 py-4 text-center text-[12px] text-muted-foreground">
            {t('plan.draft.noSteps')}
          </div>
        )}
        {steps.map((step, idx) => (
          <div
            key={step.id}
            className="relative flex flex-col"
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={handleDrop}
          >
            {/* Top insertion indicator (gap === idx). Absolutely positioned
                in the gap above the item so toggling visibility never shifts
                layout — which would otherwise feed back into the cursor
                crossing item boundaries and produce flicker. */}
            <div
              aria-hidden
              className={cn(
                'pointer-events-none absolute inset-x-8 -top-1 h-0.5 rounded-full bg-primary transition-opacity duration-150',
                dragOverIdx === idx
                  && draggedIdx !== null
                  && draggedIdx !== idx
                  && draggedIdx + 1 !== idx
                  ? 'opacity-100'
                  : 'opacity-0',
              )}
            />
            {/* Bottom indicator on the last row (gap === steps.length) so
                "drop after the last row" is reachable / visible. */}
            {idx === steps.length - 1 && (
              <div
                aria-hidden
                className={cn(
                  'pointer-events-none absolute inset-x-8 -bottom-1 h-0.5 rounded-full bg-primary transition-opacity duration-150',
                  dragOverIdx === steps.length
                    && draggedIdx !== null
                    && draggedIdx !== idx
                    ? 'opacity-100'
                    : 'opacity-0',
                )}
              />
            )}
            <div
              draggable={!readonly}
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragEnd={handleDragEnd}
              className={cn(
                'group relative flex items-start gap-3 rounded-xl border border-transparent p-2.5 transition-colors duration-150',
                !readonly && 'hover:bg-muted/50',
                draggedIdx === idx && 'border-dashed border-primary/40 opacity-30',
                dragOverIdx === idx && draggedIdx !== idx && 'border-primary/30 bg-primary/5',
              )}
            >
              {!readonly && (
                <span className="mt-0.5 cursor-grab p-0.5 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground active:cursor-grabbing">
                  <GripVertical size={14} />
                </span>
              )}
              <span
                className={cn(
                  'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded font-mono text-[11px] font-bold',
                  readonly ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
                )}
              >
                {idx + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <input
                  value={step.description || ''}
                  readOnly={readonly}
                  placeholder={t('plan.draft.stepPlaceholder')}
                  onChange={(e) => updateStepField(step.id, 'description', e.target.value)}
                  className={cn(
                    'w-full bg-transparent px-1 text-[13.5px] font-medium outline-none transition-colors',
                    readonly
                      ? 'pointer-events-none select-none text-muted-foreground'
                      : 'text-foreground placeholder:text-muted-foreground/60 focus:text-primary',
                  )}
                />
                {/* Dependencies are derived implicitly from the step order
                    (each step depends on the previous one). We rebuild the
                    chain at confirm-time, so there's nothing to render here. */}
              </div>
              {!readonly && (
                <button
                  onClick={() => removeStep(step.id)}
                  className="opacity-0 transition-all hover:text-red-500 group-hover:opacity-100"
                  aria-label={t('plan.draft.deleteStepAria')}
                >
                  <Trash2 size={14} className="text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Footer toolbar */}
      {!readonly && (onRegenerate || true) && (
        <div className="flex items-center justify-between border-t border-border bg-background px-5 pb-3 pt-3">
          <button
            type="button"
            onClick={addStep}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold text-primary transition-all hover:bg-primary/10 active:scale-95"
          >
            <Plus size={14} strokeWidth={2.5} /> {t('plan.draft.addStep')}
          </button>
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              className="group inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold text-muted-foreground transition-all hover:bg-muted hover:text-primary"
            >
              <RefreshCw
                size={14}
                strokeWidth={2}
                className="transition-transform duration-700 group-hover:rotate-180"
              />
              {t('plan.draft.regenerate')}
            </button>
          )}
        </div>
      )}

      {/* Confirm / Cancel */}
      {!readonly && (onConfirm || onCancel) && (
        <div className="flex items-center justify-end gap-3 border-t border-border bg-muted/40 px-5 py-4">
          {onCancel && (
            <button
              onClick={onCancel}
              className="rounded-xl bg-transparent px-5 py-2.5 text-[13px] font-bold text-muted-foreground transition-all hover:bg-muted"
            >
              {t('plan.draft.reject')}
            </button>
          )}
          {onConfirm && (
            <button
              onClick={() => {
                // Rebuild a strictly sequential dependency chain from the
                // current step order so the user doesn't have to manage
                // depends_on by hand. After drag-reorder the new array
                // index N depends on the step at index N-1; the first step
                // has no deps. The server still validates "forward-only
                // depends_on" at the wire layer, so this keeps every plan
                // we submit trivially valid.
                const sequential = steps.map((step, idx) => ({
                  ...step,
                  depends_on: idx === 0 ? [] : [steps[idx - 1].id],
                }))
                onConfirm(sequential)
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-foreground px-6 py-2.5 text-[13px] font-bold text-background shadow-lg transition-all hover:opacity-90 active:scale-[0.98] dark:bg-primary dark:text-primary-foreground"
            >
              {t('plan.draft.execute')} <ArrowRight size={16} strokeWidth={2.5} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
