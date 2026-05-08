# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, with versions tracked in the repository and published to GitHub Releases.

## [0.0.13] - 2026-05-08

### Added

- File preview drawer now ships with a collapsible artifact list. When the active session has more than one output artifact, a handle on the drawer's left edge expands a panel that slides in from the drawer toward the left, letting users hop between files without closing the preview. The list never compresses the preview area; collapsing hides it behind the drawer.

### Changed

- Log timestamps are now written in the system's local timezone (e.g. `2026-05-08T11:23:45.678+08:00`) instead of UTC, matching the daily log file naming and what users actually see on the wall clock.

### Fixed

- AskUserQuestion / plan_review replies no longer drop with "pending askRequest not found" when the user clicks an answer right after restarting the app or while the websocket is mid-reconnect. Replies are now queued on the main side and flushed as soon as the server replays the prompt with the same `request_id`, per protocol §2.4.2 (v0.3 recovery). A 30s safety timer surfaces a hard error if the replay never arrives.
- The bottom-right "stop" pill in the chat composer no longer shows while a `prompt.user` (AskUserQuestion / permission / plan_review) is open and unanswered, removing the false "Agent 正在跑" signal in a state where the engine is actually parked waiting for input. Detection is scoped to the currently streaming assistant message so stale orphan prompts from earlier turns don't permanently suppress the indicator.
- The top-right plan status button no longer disappears mid-execution. `response_end` now keeps a confirmed plan draft alive when its `planStatus` is still `created` / `running`, so the button tracks live `step.*` events through plan completion. If the renderer somehow loses the draft (app restart, premature `response_end`, missed `plan_proposed/created`), the next `step.*` event synthesizes a minimal confirmed draft from the event's `plan_id` so the button can resurrect itself instead of dropping events silently.

## [0.0.12] - 2026-05-07

### Added

- Plan mode: a new "Plan 模式" toggle on the home composer pins the upcoming turn to the Plan coordinator and asks for explicit user confirmation. The proposed step DAG renders as an inline review card that supports edit, reorder, delete, and approve before execution starts.
- After approval, the inline plan card collapses into a compact status button at the top-right of the chat area. Clicking it opens a popover with live per-step status (pending / dispatched / running / completed / failed / skipped) and short summaries, driven by the engine's plan.* and step.* events.
- Generated text artifacts in chat now show a Download button that saves the content to a user-chosen location via a native save dialog.
- Settings → Logs adds a raw timeline view that loads the entire log buffer (no 500-line cap), sorts ascending by time, and auto-scrolls to the latest entry.

### Changed

- The chat client now speaks the engine's v2 wire protocol over the new /v1/ws endpoint, organized around a per-session card forest (text / tool_input / thinking channels). Existing chat behavior is preserved through compatibility events.
- When the engine advertises the recovery capability, in-flight ask / permission / plan prompts now survive a websocket reconnect: the server replays them by request_id and the renderer keeps the corresponding cards alive instead of cancelling them.

### Fixed

- Plain external links in chat (anchors without target=_blank, e.g. artifact preview links) no longer replace the React shell with the external page; they are now opened in the system browser via shell.openExternal.
- The file path chip in chat keeps a readable contrast in dark / stderr-style code blocks instead of collapsing to white-on-white.

## [0.0.11] - 2026-05-05

### Added

- Added an agent.intent progress line on tool cards: a flowing-light shimmer renders the current intent (e.g. "Searching vLLM papers") while the tool runs, fading to plain muted text once it finishes.
- Added the AskUserQuestion interactive tool: agents can now ask the user a question in-conversation with single-select, multi-select, custom-answer, and cancel options.
- Tool results now carry ArtifactRef metadata so produced artifacts can be tracked and opened in later views.
- Avatars are now clickable for a lightbox preview: the sidebar logo and chat avatars share a single AvatarLightbox component.

### Changed

- Aligned tool-card header heights: search-result / duration / completed badges and the expand button now share a single baseline.
- ChatPage stays mounted across route changes; leaving and returning no longer drops WebSocket listeners or streaming state.
- The sidebar light/dark toggle and the Settings theme picker now share the same `appConfig.ui.theme`, keeping both surfaces in sync.

### Fixed

- The websocket transport waiter now times out after 8 seconds when the backend is unreachable, so send/stop calls no longer hang the renderer in a "thinking" state.
- Tool-card icons and badge rows no longer drift apart from `items-start` top-alignment.

## [0.0.10] - 2026-04-27

### Added

- Added a Project Workspace page that lists sessions per project and supports batch management and cross-session actions.
- Added a first-run setup wizard with a golden-ratio modal split into four stages — "Meet Emma", "Choose engine", "Connect", and "Pick profile" — featuring typed-quotes prompts and a username-aware greeting.
- Added an Agent Team page that lets you create, edit, and delete agents, compose sub-agent teams, and persist them through the new console-api bindings.
- Added file-path linkification in chat: absolute paths inside messages now render as clickable file chips and open in the existing preview drawer.
- Added pasted-block handling in the composer: long pasted snippets fold into expandable code blocks while still being sent as the original text.
- Added a DangerConfirmMenu with two-step confirmation for destructive actions such as deleting projects or sessions.

### Changed

- Replaced the placeholder sub-agent avatars with the new Emma team illustrations (analyst / developer / writer / researcher / lifestyle) and resolve them by agent name.
- Refreshed the Sidebar, Sessions, Settings, and Home surfaces and replaced the full set of application icon assets.
- Streamlined the first-launch experience by removing the previous CRT-style boot animation and splash, taking users straight into the simplified wizard.

### Fixed

- Fixed assorted styling and click issues in session action menus and project cards near viewport edges.

## [0.0.9] - 2026-04-22

### Added

- Added bulk selection for the Conversations page, including batch copy, batch delete, and `Esc` to leave selection mode.
- Added iFly Search and Tavily Search settings, including engine template defaults and direct configuration fields in Settings.

### Changed

- Changed the Home composer shortcut so `Enter` sends and `Shift + Enter` inserts a newline.
- Changed the chat workspace to show richer agent activity, including better tool output rendering, subagent status persistence, and improved file preview interactions.

### Fixed

- Fixed conversation list bottom spacing and overflow so the last rows no longer get cramped against the window edge.
- Fixed session action menus in conversation surfaces so they stay visible and clickable near the viewport edge.

## [0.0.8] - 2026-04-18

### Added

- Added slash-triggered skill picking in the composer, including inline skill chips, description tooltips, and keyboard shortcuts for skill selection.
- Added a global search overlay between Home and Skills with quick actions, recent chat lookup, and keyboard-driven navigation.

### Changed

- Changed recent chat search results to use a fixed eight-slot shortcut window so visible items can be browsed and opened with stable `Win/Cmd + number` shortcuts.
- Changed selected skill chips to support keyboard focus movement, delayed descriptions, and direct deletion without leaving the composer.

### Fixed

- Fixed Home navigation from global search so creating a new session always restores focus to the main composer input.

## [0.0.7] - 2026-04-17

### Fixed

- Fixed macOS notarization failure when using Apple ID credentials by requiring `APPLE_TEAM_ID` before attempting notarization, instead of passing an empty `teamId` to `@electron/notarize`.

## [0.0.6] - 2026-04-17

### Changed

- Changed the macOS release workflow to require notarization credentials for tagged releases instead of silently publishing unsigned-notarization artifacts.
- Changed notarization setup to use a validated `notarytool` keychain profile so Apple credential failures surface as actionable CI errors.

### Fixed

- Fixed the macOS release pipeline so packaged apps are validated for notarization before upload, reducing Gatekeeper warnings after direct DMG installs.
- Fixed Apple API key handling in CI by rejecting malformed `.p8` secrets, including escaped newline formatting that previously caused opaque `notarytool` failures.
- Fixed mac build configuration to recognize both direct API-key credentials and stored keychain profiles when enabling notarization.

## [0.0.5] - 2026-04-16

### Added

- Added integrated model provider settings for OpenAI, Anthropic, and protocol-compatible custom endpoints, with synchronized app and engine configuration updates.
- Added dedicated Projects and Team entry pages, plus a conversation list page with session rename and delete actions.
- Added structured in-chat error cards so model and runtime failures are easier to read and persist across reloads.

### Changed

- Redesigned sidebar navigation to group Home and Skills separately from Conversations, Projects, and Team, and added a live-updating Recent section.
- Changed recent conversations and session lists to support inline management, background refresh, collapsible recent history, and non-blocking floating action menus.
- Simplified the chat workspace so conversation routing comes from the global sidebar and the composer stays compact without extra separators.
- Updated chat metadata timing so timestamps appear only after a response finishes, with error states aligned to the normal assistant message flow.
- Refined settings forms for provider credentials, gateway protocol mapping, toast feedback, and engine restart behavior after model configuration changes.

### Fixed

- Fixed canonical engine YAML writes so provider settings no longer append invalid or duplicate fields.
- Fixed runtime restart handling after model config changes to ensure HarnessClaw reconnects with the updated engine settings.
- Fixed conversation switching and session hydration issues that could leave chat history blank after navigation.
- Fixed recent-session and session-list menus so actions stay clickable without being clipped by their containers.
- Fixed persistence for structured runtime errors so reloading a session still shows the latest failure details.

## [0.0.4] - 2026-04-15

### Added

- Added advanced proxy settings for skill repositories, allowing repository discovery and downloads to use a dedicated proxy endpoint.
- Added release note extraction tooling so GitHub Release bodies can be generated from localized changelog sources.

### Changed

- Changed the skill market to always show enabled repositories immediately after configuration, even before any skill has been discovered.
- Changed skill discovery refresh to run in the background so the market page remains interactive during repository sync.
- Changed discovery feedback to use in-app toast notifications for completion and failure states.
- Simplified skill repository proxy configuration to protocol, host, and port only.

### Fixed

- Fixed native dependency rebuild guidance for `better-sqlite3` in Electron environments.
- Fixed desktop packaging metadata to consistently use `HarnessClaw` as the product name.

## [0.0.3] - 2026-04-14

### Added

- Initial desktop release with chat, sessions, skills, settings, and packaged updater support.
