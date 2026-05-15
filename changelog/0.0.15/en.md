### Added

- Agent default settings now talk directly to the engine `/api/v1/agent` endpoint (2026-05-14+): a dedicated dropdown reads / writes `agent.primary`, fallback routing is gated by a toggle that reveals a drag-to-reorder list, and the agent-level tuning fields (Max Tokens / Context Window / Temperature) are hot-applied through PATCH with no restart required.
- New "Answer Style" temperature control with four presets (Precise / Balanced / Flexible / Creative). The slider stays freely adjustable across the canonical [0, 1] range; the preset description card gently fades in while you adjust and fades back out 3 seconds after it stabilizes.
- Chat top-right "Stats" panel showing context-window utilization (segmented by input / cache / output / thinking tokens), token + latency cards and a per-subagent contribution breakdown, with manual refresh.
- Global keyboard shortcuts: ⌘N / Ctrl+N opens a fresh session in the home composer; ⌘, / Ctrl+, opens Settings. The bindings respect text inputs so typing a comma inside the composer is never hijacked.
- Sidebar gains a draggable resize handle on its right edge — width is clamped to 220–440px and persisted to localStorage. Collapsing returns to the icon-only rail.
- Engine wire protocol bumped to v2: top-level bare `ping`/`pong` keep-alive frames and structured ErrorInfo (categorized `error.type`, `user_message`, `retryable`, `retry_after_ms`, and a reserved `recovery` field) so failed tool calls can be classified as timeout / rate-limit / permission-denied / model-error etc. in the renderer.
- File / web preview drawers slide in from the right with a smooth animation; the primary Provider field pulses with a soft amber ring when an external event focuses it.

### Fixed

- Connection badge no longer flickers between "connected" and "disconnected" after a single missed pong. The probe loop now requires two consecutive failures before downgrading the badge, and authoritative status events from the main process win over speculative probe results.
- Engine / app config edits made in Settings now propagate immediately to the permanently-mounted ChatPage hook without bouncing through the home page.
- WebSocket teardown no longer crashes the main process when the engine drops mid-handshake — `terminate()` is now guarded by a no-op error listener and a try/catch that logs to `service.log`.
- Tool-call statuses `cancelled` / `skipped` render in neutral gray instead of the red error treatment, leaving the red color reserved for true `failed` outcomes.

### Changed

- The Stats panel intentionally hides every monetary number (trigger badge total, "Total cost" card, per-row USD) to reduce cost anxiety. "Total cost" is replaced with "Total tokens", and the per-agent column is now labeled "Contribution share". Pricing still drives the share-bar weighting internally, but no dollar amount is surfaced to the user.
- Primary Provider dropdown filters out endpoints whose owning provider is disabled (those can never route), and option labels are shortened to the canonical `provider:endpoint` ref — the parenthesized model id is gone.
- The Primary Provider row sprouts a small "Jump to settings" icon button (external-link glyph) that hops straight to the Models section so you can edit endpoint / max_tokens fields without manual navigation.
- CSP `img-src` is relaxed to allow favicons from Google / gstatic / DuckDuckGo so the web preview drawer can render site icons.
- File-path autolinking now requires a well-known filesystem root (`/Users`, `/home`, `/var`, `/tmp`, `/opt`, …) or a Windows drive prefix. Generic slash-separated labels like `/CRM/Jira` or `/Marketing/Q3` are no longer rendered as clickable paths.
