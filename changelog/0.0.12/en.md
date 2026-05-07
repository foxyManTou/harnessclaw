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
