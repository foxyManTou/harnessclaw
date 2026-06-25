import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, Code2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * HtmlArtifactView —— HTML 产物的双视图展示组件。
 *
 * 两种模式，头部 tab 切换，默认「渲染」：
 *   - 渲染：把 HTML 源码塞进 <iframe srcdoc>，在 sandbox 隔离上下文里
 *     渲染，自带的 <style>/<script> 正常生效且不污染 app。sandbox 只开
 *     allow-scripts（产物常含图表/交互），不开 allow-same-origin —— 这样
 *     脚本能跑，但拿不到父页面 DOM / cookie / IPC，避免越权。
 *   - 源码：带行号的 <pre>，复用文件预览里的源码样式。
 *
 * 三处文件预览（产物面板 / 抽屉 / 弹窗）统一调这个组件。
 */
export function HtmlArtifactView({
  content,
  className,
}: {
  content: string
  className?: string
}): JSX.Element {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'render' | 'source'>('render')

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      {/* 头部：渲染 / 源码 切换 */}
      <div className="flex flex-shrink-0 items-center gap-1 border-b border-border bg-muted/30 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setMode('render')}
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
            mode === 'render'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Eye size={12} />
          {t('chat.file.viewRender')}
        </button>
        <button
          type="button"
          onClick={() => setMode('source')}
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
            mode === 'source'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Code2 size={12} />
          {t('chat.file.viewSource')}
        </button>
      </div>

      {/* 主体 */}
      {mode === 'render' ? (
        <iframe
          title={t('chat.file.viewRender')}
          srcDoc={content}
          sandbox="allow-scripts"
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-background p-4 font-mono text-[12px] leading-6 text-foreground">
          {content.split('\n').map((line, i) => (
            <div key={i} className="flex">
              <span className="mr-4 inline-block w-8 flex-shrink-0 select-none text-right text-muted-foreground/50">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">{line || ' '}</span>
            </div>
          ))}
        </pre>
      )}
    </div>
  )
}
