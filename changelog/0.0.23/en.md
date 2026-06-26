### Added

- Deliverable file paths in the chat page now render as inline file chips you can click to open.
- HTML deliverables can be previewed as live, interactive pages via iframe.
- General mode gained deliverable display, with matching sidebar and input-box UI polish.
- Restored the x-Lab navigation entry in the sidebar.
- Workspace file count auto-refreshes while a conversation turn is running.
- Added a conversation side panel and a homepage question icon, refining the chat sidebar and homepage layout.
- The Agent Team tab now shows a preview banner and clarifies the scope of custom agents.

### Changed

- Restored the "rename conversation" action in the chat page's top three-dot menu.
- Polished the chat page title and dialog styling.
- Generated images in the tool-result grid now preserve their original aspect ratio.
- The homepage "24h Online" status badge was replaced with a designed icon.
- Onboarding task-profile is now optional and more discoverable, with an explicit 中文 / English picker in the header.
- The release workflow now uses the latest engine runtime for all releases (including beta), removing strict version matching.

### Fixed

- Telemetry uploads now use server-compatible HMAC-signed headers, fixing 401/404 and restoring production delivery.
- Generated image links in assistant replies now render local `file://` and absolute-path outputs through the safe local file protocol instead of broken previews.
- Browser Agent sessions run in a dedicated helper process with isolated CDP targets, preventing takeover of the main window or other browser sessions.
- Removed the blue focus border on the chat input box to match the homepage style.
- Fixed secretary avatar / name / logo getting scrambled after switching pages in the log panel.
- Hardened the installed-skill loader and clarified invocation.
- Skip engine sync when toggling a model on a disabled provider.
- Fixed dependabot security advisories.
