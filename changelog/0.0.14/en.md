### Added

- New X·LAB entry in the left sidebar (flask icon, placed between Home and Skills) that hosts staging experiments without interfering with existing pages.
- "Continue / Retry / Cancel" decision gate now appears whenever a step's retry budget or the plan's re-plan budget is exhausted (v0.5.0 §7.1/§7.3). The engine no longer silently gives up — users explicitly tell the system how to proceed and can attach a free-text note; the reply is written back through `prompt.user_response`.
- Scheduler retry notes (e.g. "Retrying (3/3, 1.5s) — network_error") are surfaced to the renderer as `engine_note` events and rendered as a transient banner above the composer, making automatic recovery visible instead of opaque.
- Settings page now carries a dedicated "Software" section. The log level (which controls the minimum severity written to disk) moved out of the Logs viewer and lives here; the Logs page only filters what's currently displayed, removing the false impression that tweaking the dropdown rewrites on-disk logs.

### Fixed

- Container-style tool cards (Specialists / Task) are no longer reported as failed when the server watchdog emits a synthetic `orphan_timeout` close while their sub-tree (sub-agent, plan, steps) is still actively running. The client now drops the close whenever the forest still has open descendants — paired with the server-side P0/P1 root-cause fix, and retained as defense-in-depth against future regressions.
- Late `card.close` frames carrying empty-string fields like `inner.step_id=""` no longer overwrite the card's existing non-empty values. The previous behaviour silently dropped subsequent `engine_note` / `step.*` events because they could no longer resolve their owning step.
- Plan draft step reordering now uses gap-based drop targets: hovering the upper half of an item inserts before it, the lower half inserts after it, so any row can finally be dragged to become the last row. Dragging across child nodes no longer makes the drop indicator flicker.

### Changed

- Refreshed defaults in `harnessclaw-engine.yaml`: `channels.websocket.client_tools` now defaults to `false` (server-runs-tools mode, the right setting for the Web UI), `tavily_search` defaults to disabled, `llm.api_timeout` relaxed to `900s` with a new `first_byte_timeout: 120s` watchdog, a Console Management API section was added, and the deprecated `session.storage` field removed. Inline comments now document the meaning of each tunable.
- `ping` / `pong` heartbeat frames are no longer written to the engine frame trace log on either direction. service.log stays quiet during idle periods; functional frames (`card.add` / `card.close` / `card.tick`, `user.message`, etc.) are still logged in full.
