import { useEffect, useRef, useState } from 'react'
import sidebarLogo from '../../assets/sidebar-logo.png'

/**
 * Alfred-style quick launcher window.
 *
 * Rendered as the entire renderer when the URL hash is `#/launcher`.
 * The main process opens a small frameless BrowserWindow at this hash
 * and toggles it via the global `Alt+Space` hotkey. Submitting the
 * input sends the prompt to main, which hides this window, focuses
 * the main app, and forwards the prompt to the main renderer's
 * `<App />` to land in `/chat` with the message pre-filled.
 *
 * Interaction rules:
 *   • Enter         → submit
 *   • Escape        → hide (handled in main via `launcherApi.hide`)
 *   • Blur          → main auto-hides the window (handled in main)
 *   • Window shown  → input auto-focuses + clears (via `onReset`)
 */
export function LauncherPage(): JSX.Element {
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Re-show pings from main — clear the previous prompt and re-focus
  // the input so the user can immediately start typing.
  useEffect(() => {
    const unsubscribe = window.launcherApi.onReset(() => {
      setValue('')
      setSubmitting(false)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    })
    return unsubscribe
  }, [])

  // First-mount focus (cold start of the launcher window).
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = async () => {
    const text = value.trim()
    if (!text || submitting) return
    setSubmitting(true)
    try {
      await window.launcherApi.submit(text)
    } finally {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      void handleSubmit()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      void window.launcherApi.hide()
    }
  }

  return (
    <div
      className="
        flex h-screen w-screen items-center gap-2.5
        bg-white px-3
        dark:bg-[#1c1c1f]
      "
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <img
        src={sidebarLogo}
        alt="HarnessClaw"
        className="h-12 w-12 shrink-0 object-contain"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      />
      <div
        className="
          flex flex-1 items-center rounded-[14px]
          border border-border bg-card/70 px-4
          focus-within:border-primary
          dark:bg-black/30
        "
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="问点什么…  按 Enter 进入对话"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          disabled={submitting}
          className="
            h-16 w-full bg-transparent text-[18px] leading-8
            text-foreground placeholder:text-muted-foreground/70
            outline-none focus:outline-none disabled:opacity-60
          "
        />
      </div>
    </div>
  )
}
