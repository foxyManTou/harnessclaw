import {
  Archive,
  File,
  FileCode2,
  FileText,
  Image,
  Music4,
  Video,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export interface LocalAttachmentItem {
  id: string
  name: string
  path: string
  url: string
  size: number
  extension: string
  kind: 'image' | 'video' | 'audio' | 'archive' | 'code' | 'document' | 'data' | 'other'
}

interface AttachmentPreviewPanelProps {
  attachments: LocalAttachmentItem[]
  onRemove?: (id: string) => void
  removable?: boolean
  /**
   * 点击附件卡片时触发。提供后整张卡片变成可点击区域（仍保留右上角
   * 删除按钮的 stopPropagation 不会触发预览）。常见用法：把附件交给
   * FilePreviewDrawer 打开预览。未提供时卡片是纯展示元素。
   */
  onPreview?: (attachment: LocalAttachmentItem) => void
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function getAttachmentIcon(kind: LocalAttachmentItem['kind']) {
  switch (kind) {
    case 'image':
      return Image
    case 'video':
      return Video
    case 'audio':
      return Music4
    case 'archive':
      return Archive
    case 'code':
      return FileCode2
    case 'document':
    case 'data':
      return FileText
    default:
      return File
  }
}

function getTypeLabel(item: LocalAttachmentItem): string {
  const ext = item.extension ? item.extension.toUpperCase() : ''
  if (ext) return ext

  switch (item.kind) {
    case 'image':
      return 'IMAGE'
    case 'video':
      return 'VIDEO'
    case 'audio':
      return 'AUDIO'
    case 'archive':
      return 'ARCHIVE'
    case 'code':
      return 'CODE'
    case 'document':
      return 'DOC'
    case 'data':
      return 'DATA'
    default:
      return 'FILE'
  }
}

export function AttachmentPreviewPanel({
  attachments,
  onRemove,
  removable = true,
  onPreview,
}: AttachmentPreviewPanelProps) {
  const { t } = useTranslation()
  if (attachments.length === 0) return null

  return (
    <div className="mt-3 overflow-x-auto overflow-y-hidden pb-1">
      <div className="flex min-w-max flex-nowrap gap-2">
        {attachments.map((attachment) => {
          const Icon = getAttachmentIcon(attachment.kind)
          const clickable = Boolean(onPreview)

          return (
            <div
              key={attachment.id}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? () => onPreview?.(attachment) : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      // 跟原生 <button> 一致：Enter / 空格触发预览。
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onPreview?.(attachment)
                      }
                    }
                  : undefined
              }
              className={cn(
                'group relative flex h-[52px] w-56 max-w-[calc(100vw-8rem)] flex-shrink-0 items-center gap-2 rounded-xl border border-border bg-muted/35 px-2.5 py-2 text-left transition-colors',
                clickable && 'cursor-pointer hover:border-primary hover:bg-muted/60 focus:outline-none focus-visible:outline-none',
              )}
              title={attachment.path}
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground">
                <Icon size={16} />
              </div>

              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-foreground">{attachment.name}</div>
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span>{getTypeLabel(attachment)}</span>
                  <span>·</span>
                  <span>{formatSize(attachment.size)}</span>
                </div>
              </div>

              {onRemove && (
                <button
                  type="button"
                  // stopPropagation：删除按钮不应触发外层卡片的预览点击。
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(attachment.id)
                  }}
                  disabled={!removable}
                  aria-label={t('attachments.removeAria', { name: attachment.name })}
                  className={cn(
                    'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors',
                    removable ? 'hover:bg-background hover:text-foreground' : 'cursor-not-allowed opacity-40'
                  )}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
