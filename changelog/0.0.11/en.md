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
