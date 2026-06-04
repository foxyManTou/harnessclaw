Place bundled native binaries in this directory.

Native binaries are not stored in git. Local preparation and release workflows
place the engine runtime bundle contents in this directory before packaging.

Recommended naming:

- `myservice-darwin-arm64`
- `myservice-darwin-x64`
- `myservice-linux-x64`
- `myservice-windows-x64.exe`

Runtime lookup rules:

1. Main process looks for the exact `<baseName>-<platform>-<arch>[.exe]`
   filename for bundled engine binaries.
2. Browser Agent uses its upstream platform token for Windows:
   `agent-browser-win32-x64.exe`.
3. Missing bundled runtime files are treated as packaging errors; runtime lookup
   does not scan this directory for legacy names.

Examples:

- `resolveBundledBinaryPath('myservice')`
- `resolveBundledBinaryPath('nanobot')`

Browser Agent note:

- The desktop app resolves the packaged `agent-browser-*` file here and injects
  its absolute path through `CLAUDE_TOOLS_BROWSER_AGENT_BINARY_PATH` before
  starting `harnessclaw-engine`.
- It does not use PATH or the JavaScript shim at runtime.
- `harnessclaw-runtime-manifest.json` may be generated here to cache the prepared
  runtime version; it is produced by the engine runtime preparation script.
- The `agent-browser` release version is pinned by the engine runtime definition
  in `harnessclaw-engine/runtime/agent-browser/VERSION`. Electron consumes the
  published engine runtime bundle instead of downloading `agent-browser`
  independently.
- Local source packaging requires `HARNESSCLAW_ENGINE_SOURCE_DIR` or
  `--engine-source-dir`; the frontend does not guess a sibling engine checkout.
- Release packaging downloads one target platform runtime bundle containing:
  - macOS arm64: `agent-browser-darwin-arm64`
  - macOS x64: `agent-browser-darwin-x64`
  - Windows x64: `agent-browser-win32-x64.exe`
  - Linux x64/arm64, if enabled later: `agent-browser-linux-x64` / `agent-browser-linux-arm64`

Notes:

- Keep these binaries outside `asar`; they should live under `resources/bin/`
- Ensure macOS/Linux binaries have executable permission before packaging
- The release workflow fetches the latest `harnessclaw-engine-runtime-*` bundle
  automatically for the target platform/architecture
