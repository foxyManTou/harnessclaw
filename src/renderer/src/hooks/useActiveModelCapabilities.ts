import { useEffect, useState } from 'react'

/**
 * useActiveModelCapabilities — read-only view of the active engine
 * model's capability matrix, used by the multimodal pre-send gate
 * in ChatPage.
 *
 * Engine 2026-05-19+: backed by a single endpoint
 *   GET /api/v1/agent/capabilities
 * which already merges manifest baseline + endpoint.model_type
 * overrides server-side. The renderer no longer normalises model keys
 * across /agent (provider:endpoint) and /models (provider/model_id),
 * and the gate stays in lock-step with whatever the router consults
 * before dispatching.
 *
 * Returns `loading: true` until the call resolves; `error` is set on
 * failure (network or non-200). `supports.vision === true` is the
 * canonical signal for the pre-send image gate.
 */

export interface ActiveModelCapabilities {
  modelKey: string // "anthropic:claude-opus-4-7" or "" when no primary
  supports: {
    vision: boolean
    pdfInput: boolean
    audioInput: boolean
    videoInput: boolean
    reasoning: boolean
    webSearch: boolean
    functionCalling: boolean
  }
  capabilities: string[] // derived ["multimodal","tools","reasoning","search"]
  loading: boolean
  error?: string
}

const EMPTY_SUPPORTS: ActiveModelCapabilities['supports'] = {
  vision: false,
  pdfInput: false,
  audioInput: false,
  videoInput: false,
  reasoning: false,
  webSearch: false,
  functionCalling: false,
}

const INITIAL: ActiveModelCapabilities = {
  modelKey: '',
  supports: EMPTY_SUPPORTS,
  capabilities: [],
  loading: true,
}

export function useActiveModelCapabilities(): ActiveModelCapabilities {
  const [state, setState] = useState<ActiveModelCapabilities>(INITIAL)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await window.agentApi.getAgentCapabilities()
        if (cancelled) return
        if (!r.ok) {
          setState({ ...INITIAL, loading: false, error: r.message || r.error })
          return
        }
        setState({
          modelKey: r.data.model_key,
          supports: {
            vision: !!r.data.supports?.vision,
            pdfInput: !!r.data.supports?.pdf_input,
            audioInput: !!r.data.supports?.audio_input,
            videoInput: !!r.data.supports?.video_input,
            reasoning: !!r.data.supports?.reasoning,
            webSearch: !!r.data.supports?.web_search,
            functionCalling: !!r.data.supports?.function_calling,
          },
          capabilities: r.data.capabilities ?? [],
          loading: false,
        })
      } catch (err) {
        if (!cancelled) {
          setState({ ...INITIAL, loading: false, error: String(err) })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return state
}
