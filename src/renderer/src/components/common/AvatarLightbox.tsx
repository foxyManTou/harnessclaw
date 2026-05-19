import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'

interface AvatarLightboxProps {
  /** Image source for both the trigger and the enlarged preview. */
  src: string
  /** Accessible alt/label for the image. */
  alt: string
  /** Classes applied to the trigger element wrapping the <img>. */
  triggerClassName?: string
  /** Classes applied to the trigger <img>. Caller is responsible for sizing/shape. */
  imgClassName?: string
  /**
   * When true, the trigger renders as a <span role="button"> instead of a <button>.
   * Use this when the avatar is rendered inside another <button> to avoid invalid nesting.
   */
  nested?: boolean
}

/**
 * Avatar that opens a fullscreen lightbox preview when clicked.
 * Shared by the sidebar logo and chat agent avatars so behavior stays in sync.
 */
export function AvatarLightbox({
  src,
  alt,
  triggerClassName,
  imgClassName,
  nested = false,
}: AvatarLightboxProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const handleOpen = (event: ReactMouseEvent | ReactKeyboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setOpen(true)
  }

  const triggerCls = cn(
    'cursor-pointer border-0 bg-transparent p-0 transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
    triggerClassName,
  )

  const image = (
    <img
      src={src}
      alt={alt}
      className={cn('object-cover', imgClassName)}
    />
  )

  return (
    <>
      {nested ? (
        <span
          role="button"
          tabIndex={0}
          aria-label={t('ui.viewAvatar', { name: alt })}
          onClick={handleOpen}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              handleOpen(event)
            }
          }}
          className={triggerCls}
        >
          {image}
        </span>
      ) : (
        <button
          type="button"
          aria-label={t('ui.viewAvatar', { name: alt })}
          onClick={handleOpen}
          className={triggerCls}
        >
          {image}
        </button>
      )}

      {open && createPortal(
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <img
            src={src}
            alt={alt}
            className="max-h-[40vh] max-w-[40vw] object-contain"
            onClick={(event) => event.stopPropagation()}
          />
        </div>,
        document.body,
      )}
    </>
  )
}
