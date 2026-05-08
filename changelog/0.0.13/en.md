### Added

- File preview drawer now ships with a collapsible artifact list. When the active session has more than one output artifact, a handle on the drawer's left edge expands a panel that slides in from the drawer toward the left, letting users hop between files without closing the preview. The list never compresses the preview area; collapsing hides it behind the drawer.

### Changed

- Log timestamps are now written in the system's local timezone (e.g. `2026-05-08T11:23:45.678+08:00`) instead of UTC, matching the daily log file naming and what users actually see on the wall clock.

### Fixed

- AskUserQuestion / plan_review replies no longer drop with "pending askRequest not found" when the user clicks an answer right after restarting the app or while the websocket is mid-reconnect. Replies are now queued on the main side and flushed as soon as the server replays the prompt with the same `request_id`, per protocol §2.4.2 (v0.3 recovery). A 30s safety timer surfaces a hard error if the replay never arrives.
- The bottom-right "stop" pill in the chat composer no longer shows while a `prompt.user` (AskUserQuestion / permission / plan_review) is open and unanswered, removing the false "Agent 正在跑" signal in a state where the engine is actually parked waiting for input. Detection is scoped to the currently streaming assistant message so stale orphan prompts from earlier turns don't permanently suppress the indicator.
- The top-right plan status button no longer disappears mid-execution. `response_end` now keeps a confirmed plan draft alive when its `planStatus` is still `created` / `running`, so the button tracks live `step.*` events through plan completion. If the renderer somehow loses the draft (app restart, premature `response_end`, missed `plan_proposed/created`), the next `step.*` event synthesizes a minimal confirmed draft from the event's `plan_id` so the button can resurrect itself instead of dropping events silently.
