### Added

- Full English localization across the app — every visible string now has both `en` and `zh-CN` translations, with a runtime language toggle (sidebar previously, now relocated to the WelcomeModal header during onboarding) that persists to `appConfig.ui.language`.
- Default seeded projects ship in English on a fresh install and switch to Chinese only when the user picks `zh` during onboarding.
- WelcomeModal first-run wizard now mirrors `Settings > Models` exactly: the engine picker offers the full managed provider list (xunfei, anthropic, openai, google, deepseek, zhipu, moonshot, minimax, custom) instead of just OpenAI/Anthropic. When the user picks `custom`, a protocol selector (OpenAI / Anthropic) appears alongside the API base / key / model inputs.
- The engine picker is now a horizontal snap-scroll carousel with prev/next chevrons and a dot indicator, so all nine providers fit comfortably inside the wizard column.
- The welcome flow now writes the chosen provider to `appConfig.modelProviders.<key>` in the same shape Settings reads — so the provider, API key, base URL and model surface immediately in Settings > Models after onboarding.
- After the welcome wizard saves, the engine is also registered on the fly via the Providers Management API: PATCH/POST `/providers/{key}`, then POST a single endpoint and append `{key}:{endpointName}` to the fallback chain so the dispatcher routes immediately without a restart. The whole sequence is best-effort and silently skips when the API isn't mounted yet.
- Launcher page (Alfred-style floating prompt) added: opens via the global hotkey, forwards the typed prompt straight into a new session on the main window.

### Fixed

- Restored the `react-i18next` / `i18next` / `i18next-browser-languagedetector` runtime dependencies that were dropped during an earlier rebase — the app no longer crashes at boot when i18n initialises.
- Backfilled 110+ missing locale keys (`models.apiKeyLabel`, `models.apiBaseLabel`, `models.hotReloadLabels.*`, the entire `plan.*`, `stats.*`, `updates.*`, `storage.export.*` namespaces, etc.) in both `en.json` and `zh-CN.json`. Previously the Settings > Models page rendered raw keys like `models.apiKeyLabel` in Chinese mode.
- Engine endpoints created via the welcome flow now use a YAML-safe identifier: when a user-typed model id would parse as a number / boolean / null (e.g. `"1"`), the endpoint name is prefixed with the provider key (`minimax-1`) so the generated YAML doesn't wrap the key in quotes. The `model` field still stores the raw user input verbatim.

### Changed

- The provider-related constants and persistence helpers (`MANAGED_PROVIDER_KEYS`, `PROVIDER_DEFAULT_BASES`, `getEffectiveEngineType`, `buildAppModelConfig`, `createEmptyProviderConfig`, `resolveProviderProtocol`, …) moved out of `SettingsPage.tsx` into a shared `src/renderer/src/lib/providers.ts` module. Both Settings and the WelcomeModal import from the same source of truth.
- The first-run modal no longer writes to `engine.llm.providers` via `engineConfig.save`. Engine YAML is now exclusively owned by the Providers Management API; the renderer only writes app-level config.
- Sidebar's language switcher was removed — the welcome modal toggle replaces it for first-run users.
- Welcome stage 1 "Select Inference Engine" no longer renders the stage title / subtitle so the slider sits flush to the top, and the cards have wider padding with the check indicator floated into the top-right corner.
