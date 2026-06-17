### Added

- Agent image generation now has a dedicated model selector backed by provider state.
- Generated image tool results now render as preview cards in chat.
- Image-capable provider entries now show backend-resolved target URLs on the image capability badge.

### Fixed

- Packaged Browser Agent is enabled by default for new and upgraded desktop configs.
- Local dev startup now rebuilds Electron native dependencies when needed and clears stale engine port listeners before spawning the bundled engine.

