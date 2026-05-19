import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { FileText } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { localFileUrl } from '../../lib/utils'
import type { FilePreviewData } from '../pages/ChatPage'

/**
 * FilePreviewModal —— 居中弹窗版的附件预览。
 *
 * 与 FilePreviewDrawer 的区别：
 * - 视觉形态：居中 modal（最宽 720px，限制最大高），而不是右侧抽屉
 * - 适用场景：HomePage 这种没有持续会话上下文、只是点开看一眼的轻量入口
 * - 渲染分支与抽屉对齐：图片 / 音频 / 视频 / 富预览 HTML / 富预览 text /
 *   Markdown / 纯文本 / 二进制占位
 * - 无顶部工具条：仅展示内容本身，点击遮罩或按 Esc 关闭
 *
 * 不渲染时（`preview === null`）整组返回 null。
 */
export function FilePreviewModal({
  preview,
  onClose,
}: {
  preview: FilePreviewData | null
  onClose: () => void
}): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null)

  // Esc 关闭。
  useEffect(() => {
    if (!preview) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [preview, onClose])

  if (!preview) return null

  const ext = preview.fileName.includes('.') ? preview.fileName.split('.').pop()!.toLowerCase() : ''
  const isImage = /^(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/.test(ext)
  const isAudio = /^(mp3|wav|m4a|aac|flac|ogg)$/.test(ext)
  const isVideo = /^(mp4|mov|avi|mkv|webm)$/.test(ext)
  const isMarkdown = ext === 'md' || ext === 'mdx'

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-4 py-8"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label={preview.fileName || '文件预览'}
    >
      {/* 背景遮罩：点击关闭。 */}
      <div
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* 居中卡片。宽度自适应到 720px，最高占视口 85%，溢出滚动。 */}
      <div
        ref={dialogRef}
        className="relative z-10 flex max-h-[85vh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        {/* 主体内容。按扩展名优先渲染媒体；再走富预览；最后落到文本/占位。 */}
        <div className="min-h-0 flex-1 overflow-auto bg-background/60 p-5">
          {isImage ? (
            <div className="flex h-full items-center justify-center">
              <img
                src={localFileUrl(preview.path)}
                alt={preview.fileName}
                className="max-h-[70vh] max-w-full rounded-lg object-contain"
              />
            </div>
          ) : isAudio ? (
            <div className="flex h-full items-center justify-center">
              <audio src={localFileUrl(preview.path)} controls className="w-full max-w-xl" />
            </div>
          ) : isVideo ? (
            <div className="flex h-full items-center justify-center">
              <video src={localFileUrl(preview.path)} controls className="max-h-[70vh] max-w-full rounded-lg" />
            </div>
          ) : !preview.content ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
              <div>
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent">
                  <FileText size={18} className="text-primary" />
                </div>
                {preview.isBinary ? (
                  <p className="text-sm font-medium text-foreground">二进制文件，无法直接预览</p>
                ) : (
                  <>
                    <p className="text-sm font-medium text-foreground">没有可展示的文件内容</p>
                    <p className="mt-1 text-xs text-muted-foreground">这个文件没有可预览的文本。</p>
                  </>
                )}
              </div>
            </div>
          ) : preview.previewKind === 'html' ? (
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div
                className="prose max-w-none break-words text-foreground prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-a:text-primary prose-blockquote:border-l-border prose-blockquote:text-muted-foreground prose-hr:my-4 prose-hr:border-border/70 prose-table:border prose-table:border-border prose-th:border prose-th:border-border prose-th:bg-muted prose-th:px-2 prose-th:py-1 prose-td:border prose-td:border-border prose-td:px-2 prose-td:py-1 prose-img:rounded-lg dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: preview.content }}
              />
            </div>
          ) : preview.previewKind === 'text' ? (
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-7 text-foreground">
                {preview.content}
              </pre>
            </div>
          ) : isMarkdown ? (
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="prose max-w-none break-words text-foreground prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-a:text-primary prose-blockquote:border-l-border prose-blockquote:text-muted-foreground prose-hr:my-4 prose-hr:border-border/70 prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:text-foreground prose-code:break-all prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:text-foreground prose-img:rounded-lg dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.content}</ReactMarkdown>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card shadow-sm">
              <pre className="overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-6 text-foreground">
                {preview.content.split('\n').map((line, i) => (
                  <div key={i} className="flex">
                    <span className="mr-4 inline-block w-8 flex-shrink-0 select-none text-right text-muted-foreground/50">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">{line || ' '}</span>
                  </div>
                ))}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
