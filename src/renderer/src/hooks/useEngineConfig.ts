import { useState, useEffect, useRef, useCallback } from 'react'

type ConfigBridge = {
  read: () => Promise<Record<string, unknown>>
  save: (data: unknown) => Promise<{ ok: boolean; error?: string }>
}

// Window-level event name used to broadcast config changes between mounted
// `useJsonConfig` instances. ChatPage is mounted permanently (only hidden via
// CSS when navigating to /settings), so without this broadcast it would never
// observe edits made by SettingsPage. The event detail carries the bridge
// identity so each hook can ignore unrelated saves (e.g., engine vs app).
const CONFIG_CHANGED_EVENT = 'json-config-changed'

interface ConfigChangedDetail {
  bridgeKey: string
  config: Record<string, unknown>
}

function useJsonConfig(bridge: ConfigBridge, bridgeKey: string) {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const configRef = useRef<Record<string, unknown> | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const data = await bridge.read()
        setConfig(data)
        configRef.current = data
      } catch {
        setConfig({})
        configRef.current = {}
      } finally {
        setLoading(false)
      }
    })()
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  // Listen for broadcast updates so concurrently-mounted consumers (e.g.,
  // ChatPage's `useAppConfig` while SettingsPage edits the same file) stay in
  // sync without remounting.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ConfigChangedDetail>).detail
      if (!detail || detail.bridgeKey !== bridgeKey) return
      configRef.current = detail.config
      setConfig(detail.config)
    }
    window.addEventListener(CONFIG_CHANGED_EVENT, handler)
    return () => window.removeEventListener(CONFIG_CHANGED_EVENT, handler)
  }, [bridgeKey])

  const updateConfig = useCallback((patch: Record<string, unknown>) => {
    setConfig((prev) => {
      const updated = { ...prev, ...patch }
      configRef.current = updated
      // Notify other hook instances immediately so dependent UI (e.g., the
      // ChatPage link click handler) reflects the new value without waiting
      // for the debounced disk write to complete.
      window.dispatchEvent(
        new CustomEvent<ConfigChangedDetail>(CONFIG_CHANGED_EVENT, {
          detail: { bridgeKey, config: updated },
        }),
      )
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(async () => {
        await bridge.save(configRef.current)
      }, 500)
      return updated
    })
  }, [bridge, bridgeKey])

  return { config, loading, updateConfig }
}

export function useEngineConfig() {
  return useJsonConfig(window.engineConfig, 'engineConfig')
}

// Backward-compatible alias for older imports.
export function useNanobotConfig() {
  return useEngineConfig()
}

export function useAppConfig() {
  return useJsonConfig(window.appConfig, 'appConfig')
}
