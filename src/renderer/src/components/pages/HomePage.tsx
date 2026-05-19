import { useEffect, useRef, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { Paperclip, Send, ListChecks } from 'lucide-react'
import { useHarnessclawStatus } from '../../hooks/useHarnessclawStatus'
import { cn } from '../../lib/utils'
import {
  AttachmentPreviewPanel,
  type LocalAttachmentItem,
} from '../attachments/AttachmentPreviewPanel'
import {
  buildSkillComposerPayload,
  SkillComposerInput,
  type SelectedSkillChip,
} from '../common/SkillComposerInput'
import { PastedBlocksBar, usePastedBlocks } from '../common/PastedBlocksBar'
import { FilePreviewModal } from '../attachments/FilePreviewModal'
import type { FilePreviewData } from './ChatPage'

type AttachmentItem = LocalAttachmentItem

export function HomePage() {
  const { t } = useTranslation()
  const location = useLocation()
  const [input, setInput] = useState('')

  const statusMeta = useMemo(() => ({
    connected: {
      label: t('home.status.connected'),
      description: t('home.status.connectedDesc'),
    },
    connecting: {
      label: t('home.status.connecting'),
      description: t('home.status.connectingDesc'),
    },
    disconnected: {
      label: t('home.status.disconnected'),
      description: t('home.status.disconnectedDesc'),
    },
  }), [t])

  const [selectedSkills, setSelectedSkills] = useState<SelectedSkillChip[]>([])
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  // v1.14: opt-in Plan mode pin for the upcoming turn. When false the engine
  // picks ReAct/Plan automatically via its ModeSelector heuristic.
  const [planMode, setPlanMode] = useState(false)
  // 附件预览抽屉的 state。点击 AttachmentPreviewPanel 里的卡片会先调
  // window.files.read 把内容/二进制标记拿回来，然后塞进 filePreview，
  // FilePreviewDrawer 接到非 null 值即显示。
  const [filePreview, setFilePreview] = useState<FilePreviewData | null>(null)
  const pasted = usePastedBlocks()
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const navigate = useNavigate()
  const maxLength = 2000
  const harnessclawStatus = useHarnessclawStatus()
  const shortcutHint = t('home.shortcutHint')
  const currentStatus = statusMeta[harnessclawStatus]

  useEffect(() => {
    const preventWindowDrop = (event: DragEvent) => {
      event.preventDefault()
    }

    window.addEventListener('dragover', preventWindowDrop)
    window.addEventListener('drop', preventWindowDrop)

    return () => {
      window.removeEventListener('dragover', preventWindowDrop)
      window.removeEventListener('drop', preventWindowDrop)
    }
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (location.state?.focusComposer !== true) return
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [location.key, location.state])

  const appendAttachments = (items: AttachmentItem[]) => {
    if (!items.length) return

    setAttachments((prev) => {
      const byId = new Map(prev.map((item) => [item.id, item]))
      for (const item of items) {
        byId.set(item.path, { ...item, id: item.path })
      }
      return [...byId.values()]
    })
  }

  const handleSend = () => {
    const payload = buildSkillComposerPayload(input, selectedSkills)
    if (!payload && attachments.length === 0 && pasted.blocks.length === 0) return
    const pastedSuffix = pasted.buildPastedSuffix()
    const fullMessage = [payload, pastedSuffix].filter(Boolean).join('\n\n')
    navigate('/chat', {
      state: {
        initialMessage: fullMessage,
        initialAttachments: attachments,
        // v1.14: only forward when explicitly enabled, so the engine keeps
        // its automatic ModeSelector heuristic in the default case.
        coordinatorMode: planMode ? 'plan' : undefined,
        // v1.15: opting into Plan mode also implies the user wants to
        // review the draft step DAG before execution. This couples the two
        // toggles so the user only has to flip one switch.
        planConfirmation: planMode ? 'required' : undefined,
      },
    })
    setInput('')
    setSelectedSkills([])
    setAttachments([])
    pasted.clearBlocks()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handlePickFiles = async () => {
    if (harnessclawStatus !== 'connected') return

    const picked = await window.files.pick()
    if (!picked.length) return
    appendAttachments(picked.map((item) => ({ ...item, id: item.path })))
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (harnessclawStatus !== 'connected') return
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setIsDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    if (harnessclawStatus !== 'connected') return
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const droppedPaths = Array.from(e.dataTransfer.files)
      .map((file) => (file as File & { path?: string }).path || '')
      .filter(Boolean)

    if (!droppedPaths.length) return
    const resolved = await window.files.resolve(droppedPaths)
    appendAttachments(resolved.map((item) => ({ ...item, id: item.path })))
  }

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id))
  }

  return (
    <div className="flex min-h-full justify-center px-6 pb-10 pt-[clamp(3rem,9vh,6rem)]">
      <div className="w-full max-w-[760px]">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                harnessclawStatus === 'connected'
                  ? 'bg-status-connected'
                  : harnessclawStatus === 'connecting'
                    ? 'bg-amber-500 animate-pulse'
                    : 'bg-status-disconnected'
              )}
            />
            <span>HarnessClaw {currentStatus.label}</span>
          </div>

          <h1 className="font-pixel-arcade text-[clamp(2.6rem,7vw,4.25rem)] leading-none text-foreground">
            HarnessClaw
          </h1>

          <p className="max-w-[520px] text-sm leading-6 text-muted-foreground">
            {currentStatus.description}
          </p>
        </div>

        <div
          className={cn(
            'relative overflow-hidden rounded-[28px] border bg-card transition-[border-color,box-shadow,transform] duration-200',
            'focus-within:border-primary focus-within:shadow-[0_18px_54px_rgba(15,23,42,0.08)]',
            isDragOver
              ? 'border-primary shadow-[0_20px_60px_rgba(37,99,235,0.12)]'
              : 'border-border shadow-[0_12px_40px_rgba(15,23,42,0.04)]'
          )}
          onDragOver={handleDragOver}
          onDragEnter={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-card text-sm text-primary">
              {t('home.dropToFiles')}
            </div>
          )}

          <div className="p-5 sm:p-6">
            {pasted.blocks.length > 0 && (
              <div className="mb-3">
                <PastedBlocksBar
                  blocks={pasted.blocks}
                  onRemove={pasted.removeBlock}
                  onUpdate={pasted.updateBlock}
                />
              </div>
            )}
            <SkillComposerInput
              textareaRef={inputRef}
              value={input}
              onChange={setInput}
              selectedSkills={selectedSkills}
              onSelectedSkillsChange={setSelectedSkills}
              onKeyDown={handleKeyDown}
              onPaste={pasted.handlePaste}
              placeholder={t('home.inputPlaceholder')}
              maxLength={maxLength}
              className="min-h-[56px] max-h-[112px] leading-7"
              rows={3}
            />

            <AttachmentPreviewPanel
              attachments={attachments}
              onRemove={handleRemoveAttachment}
              // 点击附件即开预览。预读走主进程的 files:read：图片/音频/视频
              // 不依赖 content；docx/pdf/xlsx/pptx 走富预览；纯文本/Markdown
              // 直接拿到字符串；其它二进制保留占位 + 导出原文件。
              onPreview={async (attachment) => {
                try {
                  const result = await window.files.read(attachment.path)
                  setFilePreview({
                    path: result?.path || attachment.path,
                    fileName: attachment.name || attachment.path.split(/[\\/]/).pop() || attachment.path,
                    operation: 'read_file',
                    content: result?.ok && typeof result.content === 'string' ? result.content : '',
                    isBinary: result?.ok ? Boolean(result.isBinary) : false,
                    previewKind:
                      result?.ok && (result.previewKind === 'html' || result.previewKind === 'text')
                        ? result.previewKind
                        : undefined,
                  })
                } catch (err) {
                  console.error('Failed to preview attachment:', err)
                  setFilePreview({
                    path: attachment.path,
                    fileName: attachment.name || attachment.path,
                    operation: 'read_file',
                    content: '',
                  })
                }
              }}
            />

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handlePickFiles}
                  disabled={harnessclawStatus !== 'connected'}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
                  title={t('home.addFiles')}
                >
                  <Paperclip size={12} />
                  <span>{t('home.addFiles')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPlanMode((v) => !v)}
                  aria-pressed={planMode}
                  title={planMode ? t('home.planModeEnabled') : t('home.planModeDisabled')}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs transition-colors',
                    planMode
                      ? 'border-primary bg-primary/10 text-primary hover:bg-primary/15'
                      : 'border-border text-muted-foreground hover:border-primary hover:text-foreground'
                  )}
                >
                  <ListChecks size={12} />
                  <span>{t('home.planMode')}</span>
                </button>
                <span className="text-xs text-muted-foreground">
                  {t('home.shortcutHint')}
                </span>
              </div>

              <div className="flex items-center gap-2.5">
                {input.length > 0 && (
                  <span className="text-xs text-muted-foreground">{input.length}/{maxLength}</span>
                )}
                <button
                  onClick={handleSend}
                  disabled={!buildSkillComposerPayload(input, selectedSkills) && attachments.length === 0 && pasted.blocks.length === 0}
                  className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-primary dark:text-primary-foreground"
                >
                  <span>{t('home.send')}</span>
                  <Send size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 附件预览弹窗。首页是轻量入口，不再使用与对话页相同的右侧抽屉，
          改用 FilePreviewModal —— 居中 modal、点击遮罩或 Esc 关闭。
          内部 createPortal 到 body，不受当前容器 overflow / transform
          影响。 */}
      <FilePreviewModal preview={filePreview} onClose={() => setFilePreview(null)} />
    </div>
  )
}
