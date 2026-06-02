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

Notes:

- Keep these binaries outside `asar`; they should live under `resources/bin/`
- Ensure macOS/Linux binaries have executable permission before packaging
- The release workflow currently fetches the latest `harnessclaw-engine` asset automatically
