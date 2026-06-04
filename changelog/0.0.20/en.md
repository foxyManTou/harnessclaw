### Fixed

- Packaged Browser Agent now always launches the `agent-browser` binary bundled with the desktop app. Stale local engine configs that point to a bare `agent-browser` command no longer override the packaged runtime.
- Bundled runtime lookup now requires exact platform filenames, preventing legacy fallback paths from hiding missing release assets.

### Changed

- This release replaces the withdrawn `0.0.19` desktop release.
