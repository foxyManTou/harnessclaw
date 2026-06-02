### Added

- Model entries now carry an optional group tag (free-form display label). The welcome wizard exposes a Group input on the connection stage; the value is persisted to the engine via the endpoint API so it survives restarts and is visible across clients pointing at the same engine. The Settings model list reconciles the local group with the engine on load — engine wins when set, otherwise the local value is silently backfilled to the engine.
- Settings > Models now lists image-generation-only providers for GPT Image and Doubao Seedream, tags image-capable models with an Image Gen chip, and keeps those endpoints out of Agent LLM routing/fallback selection.

### Fixed

- Browser Agent windows now keep their own active CDP targets when popup windows are created, preventing simultaneous browser tasks from drifting onto the wrong window.
- Release packaging now downloads the pinned target platform `agent-browser` binary instead of reusing the developer machine's local binary.
