import { createPortal } from 'react-dom'
import { Trash2 } from 'lucide-react'

/**
 * Centered modal that asks the user to confirm deleting a session. Used by
 * both the chat title dropdown and the sidebar recent-conversation menu so
 * the destructive flow stays visually identical across surfaces.
 *
 * The backdrop combines a dark overlay with a frosted-blur layer (matching
 * the Skill repository window) to draw focus to the dialog. The button
 * convention follows `DangerConfirmMenu` / project deletion: the red
 * `bg-destructive` face sits on the cancel button so the safer action is
 * visually anchored, while confirm uses a neutral card style.
 */
export function ConfirmDeleteSessionDialog({
  open,
  title,
  description,
  onCancel,
  onConfirm,
}: {
  open: boolean
  /** Session title used to build the default single-session description. */
  title?: string
  /**
   * Explicit description text. When provided it overrides the auto-built
   * "「{title}」的所有消息..." line — used by callers that need different
   * wording such as batch-delete ("所选的 N 条对话…").
   */
  description?: string
  onCancel: () => void
  onConfirm: () => void
}) {
  if (!open) return null

  const descriptionText = description ?? `「${title ?? ''}」的所有消息与历史将被永久删除，且无法恢复。`

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-[6px]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-border/80 bg-card p-5 shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-500 dark:bg-red-950/40 dark:text-red-300">
            <Trash2 size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-foreground">确认删除对话？</h3>
            <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
              {descriptionText}
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            删除
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
