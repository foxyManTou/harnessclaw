### Added

- Session workspace drawer in the chat top bar: lists everything under `~/.harnessclaw/workspace/session/<sid>` as a collapsible file tree, with an inline preview pane on the right that handles text, code, images, audio, video, and the existing rich previews for docx / xlsx / pptx / pdf.
- "Open in file manager" button in the workspace drawer header reveals the session's working directory in Finder / Explorer (creates it on demand if the agent hasn't written anything yet).
- Plan tool now appears as a regular tool activity card under its coordinating sub-agent, with a synthetic `tool_start` / `tool_end` pair so the panel reports start, step count, and completion status.
- Tool call cards now surface the tool input content as soon as a phase update arrives, matching how it already showed up for completed calls.

### Fixed

- Removed the leading `+` from the home composer placeholder so it reads as a sentence again.
- TeamPage no longer white-screens when opening the SOP wizard or the agent dialog: the label maps and SOP step arrays declared inside `TeamPage` are now passed to the sibling `AgentDialog` / `SopWizardView` components instead of being referenced through a closure that didn't exist.
- Fixed a build failure caused by a stray UTF-16 / null-byte-corrupted trailing comment in `src/main/index.ts`.

### Changed

- Persistent session IDs are stored as bare UUIDs instead of the `harnessclaw:session:<uuid>` form. The workspace directory and IPC handlers stay tolerant of the legacy prefix so older sessions still resolve correctly.
