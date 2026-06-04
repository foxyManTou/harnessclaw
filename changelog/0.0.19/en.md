### Changed

- Release packaging now consumes the engine-owned runtime bundle instead of downloading the engine and Browser Agent binaries separately. Local packaging must point at an explicit engine checkout via `HARNESSCLAW_ENGINE_SOURCE_DIR` or `--engine-source-dir`, so developer directory layouts are no longer guessed.
- Browser Agent skill files are no longer bundled from the desktop app; the engine now owns the embedded Browser Agent skill, references, and templates.

### Fixed

- Packaged apps now include the engine runtime bundle with the pinned `agent-browser` sidecar for the target platform before Electron Builder runs, keeping local packaging and GitHub Actions on the same runtime handoff.
