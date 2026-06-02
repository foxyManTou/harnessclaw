Place bundled native binaries in this directory.

Native binaries are not stored in git. The VS Code preparation task and release workflow must
place `harnessclaw-engine-*` and `agent-browser-*` binaries in this directory before packaging.

Recommended naming:

- `myservice-darwin-arm64`
- `myservice-darwin-x64`
- `myservice-linux-x64`
- `myservice-windows-x64.exe`

Runtime lookup rules:

1. Main process first looks for `<baseName>-<platform>-<arch>[.exe]`
2. If not found, it falls back to `<baseName>[.exe]`

Examples:

- `resolveBundledBinaryPath('myservice')`
- `resolveBundledBinaryPath('nanobot')`

Browser Agent note:

- `agent-browser-*` is resolved by `harnessclaw-engine` directly from this directory.
- It does not use PATH or the JavaScript shim at runtime.
- The `agent-browser` release version is pinned by
  `resources/skills/agent-browser/VERSION` so the bundled skill and native CLI
  move together. Set `AGENT_BROWSER_VERSION` only for an intentional upgrade
  or emergency override.
- Release packaging downloads only the target platform asset:
  - macOS arm64: `agent-browser-darwin-arm64`
  - macOS x64: `agent-browser-darwin-x64`
  - Windows x64: `agent-browser-win32-x64.exe`
  - Linux x64/arm64, if enabled later: `agent-browser-linux-x64` / `agent-browser-linux-arm64`

Notes:

- Keep these binaries outside `asar`; they should live under `resources/bin/`
- Ensure macOS/Linux binaries have executable permission before packaging
- The release workflow fetches the latest `harnessclaw-engine` and `agent-browser`
  assets automatically for the target platform/architecture
