import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { FileText, X, Clipboard } from 'lucide-react'

export interface PastedBlock {
  id: string
  content: string
  lines: number
  ts: number
}

interface PastedBlocksBarProps {
  blocks: PastedBlock[]
  onRemove: (id: string) => void
  onUpdate?: (id: string, content: string) => void
  removable?: boolean
}

export function usePastedBlocks() {
  const [blocks, setBlocks] = useState<PastedBlock[]>([])
  const [preview, setPreview] = useState<{ content: string; lines: number } | null>(null)

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData?.getData('text/plain') || ''
    const lineCount = text.split('\n').length
    if (lineCount >= 3) {
      e.preventDefault()
      setBlocks((prev) => [
        ...prev,
        { id: `paste-${Date.now()}-${prev.length}`, content: text, lines: lineCount, ts: Date.now() },
      ])
    }
  }, [])

  const removeBlock = useCallback((id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id))
  }, [])

  const updateBlock = useCallback((id: string, content: string) => {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, content, lines: content.split('\n').length } : b
      )
    )
  }, [])

  const clearBlocks = useCallback(() => setBlocks([]), [])

  const buildPastedSuffix = useCallback(() => {
    if (blocks.length === 0) return ''
    return blocks.map((b) => b.content).join('\n\n')
  }, [blocks])

  return {
    blocks,
    setBlocks,
    preview,
    setPreview,
    handlePaste,
    removeBlock,
    updateBlock,
    clearBlocks,
    buildPastedSuffix,
  }
}

export function PastedBlocksBar({ blocks, onRemove, onUpdate, removable = true }: PastedBlocksBarProps) {
  const { t } = useTranslation()
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const gutterRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const previewBlock = useMemo(
    () => (previewId ? blocks.find((b) => b.id === previewId) ?? null : null),
    [previewId, blocks]
  )

  const editable = Boolean(onUpdate)

  const closePreview = useCallback(() => {
    setPreviewId(null)
  }, [])

  useEffect(() => {
    if (!previewBlock) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePreview()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [previewBlock, closePreview])

  const openPreview = (block: PastedBlock) => {
    setPreviewId(block.id)
    setDraft(block.content)
  }

  const handleChange = (next: string) => {
    setDraft(next)
    if (previewBlock && onUpdate) {
      onUpdate(previewBlock.id, next)
    }
  }

  const syncScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = e.currentTarget.scrollTop
    }
  }

  const draftLines = useMemo(() => draft.split('\n').length, [draft])

  if (blocks.length === 0) return null

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {blocks.map((block) => (
          <div
            key={block.id}
            className="group flex h-10 items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 pl-2.5 pr-1.5 transition-colors hover:border-primary/35 hover:bg-primary/8 dark:border-primary/15 dark:bg-primary/10"
          >
            <button
              type="button"
              onClick={() => openPreview(block)}
              className="flex min-w-0 items-center gap-1.5"
            >
              <Clipboard size={13} className="flex-shrink-0 text-primary/70" />
              <span className="text-xs font-medium text-foreground">{t('pasted.label')}</span>
              <span className="text-[11px] text-muted-foreground">{t('pasted.lines', { count: block.lines })}</span>
            </button>
            {removable && (
              <button
                type="button"
                onClick={() => onRemove(block.id)}
                aria-label={t('pasted.removeAria')}
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-primary/10 hover:text-foreground"
              >
                <X size={11} />
              </button>
            )}
          </div>
        ))}
      </div>

      {previewBlock && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="absolute inset-0 bg-slate-950/25 backdrop-blur-[2px]" onClick={closePreview} />
          <div className="relative mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-primary" />
                <span className="text-sm font-semibold text-foreground">{t('pasted.previewTitle')}</span>
                <span className="rounded-full border border-border bg-accent/70 px-2 py-0.5 text-[10px] text-muted-foreground">
                  {t('pasted.lines', { count: draftLines })}
                </span>
              </div>
              <button
                onClick={closePreview}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-muted"
                aria-label={t('pasted.closeAria')}
              >
                <X size={14} className="text-muted-foreground" />
              </button>
            </div>
            <div className="relative flex flex-1 min-h-[260px] overflow-hidden">
              <div
                ref={gutterRef}
                aria-hidden="true"
                className="select-none overflow-hidden border-r border-border/60 bg-muted/30 py-4 pl-3 pr-2 font-mono text-[12px] leading-6 text-muted-foreground/60"
              >
                {Array.from({ length: draftLines }, (_, i) => (
                  <div key={i} className="text-right tabular-nums">
                    {i + 1}
                  </div>
                ))}
              </div>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => handleChange(e.target.value)}
                onScroll={syncScroll}
                readOnly={!editable}
                spellCheck={false}
                wrap="off"
                className="block flex-1 resize-none border-0 bg-transparent p-4 pl-3 font-mono text-[12px] leading-6 text-foreground outline-none focus:ring-0"
                autoFocus
              />
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
