### 新增

- 全应用英文本地化：所有界面字符串均同时配套 `en` 与 `zh-CN` 文案,支持运行时切换语言并持久化到 `appConfig.ui.language`（首次启动时的切换按钮已从侧边栏迁移到欢迎弹窗顶栏)。
- 首次安装的内置示例项目使用英文文案,用户在首次启动选择中文时再切回中文版本。
- WelcomeModal 首次启动向导和 `设置 > 模型配置` 完全对齐:推理引擎选择支持全部托管 provider(xunfei、anthropic、openai、google、deepseek、zhipu、moonshot、minimax、custom),不再只提供 OpenAI / Anthropic 两项。选择 `custom` 时,连接配置阶段会额外出现协议选择器(OpenAI / Anthropic)。
- 推理引擎选择改为横向滑动卡片,带前后 chevron 按钮与底部指示点,9 个 provider 在向导列宽内可以舒适浏览。
- 欢迎向导完成时,所选 provider 会以和 Settings 完全一致的 schema 写入 `appConfig.modelProviders.<key>`(apiKey / apiBase / model / protocol / extraHeaders / enabled),完成首启后进入 `设置 > 模型配置` 立即就能看到。
- 欢迎向导保存的同时,通过 Providers Management API 即时在引擎侧注册:先 PATCH/POST `/providers/{key}`,再 POST 一条 endpoint,然后把 `{key}:{endpointName}` 追加到 fallback chain,使 dispatcher 立即路由、无需重启。整个流程是 best-effort,API 未挂载时静默跳过。
- 新增 Launcher 页面(Alfred 风格悬浮输入):通过全局快捷键唤出,把输入的 prompt 直接发送到主窗口的新会话。

### 修复

- 修复因之前 rebase 误删导致的 `react-i18next` / `i18next` / `i18next-browser-languagedetector` 运行依赖缺失:i18n 初始化时不再崩溃。
- 补齐 en.json 与 zh-CN.json 两边共 110+ 缺失的本地化 key:`models.apiKeyLabel`、`models.apiBaseLabel`、`models.hotReloadLabels.*`,以及完整的 `plan.*` / `stats.*` / `updates.*` / `storage.export.*` 等命名空间。中文模式下 `设置 > 模型配置` 页面之前出现的 `models.apiKeyLabel` 这类原始 key 现已全部解析为正常文案。
- 欢迎向导写入的 endpoint 名称改为 YAML 安全的标识符:当用户输入的 model id 是纯数字 / 布尔 / null 关键字时(如 `"1"`),endpoint 名称会自动前缀 provider key(如 `minimax-1`),生成的 YAML 不再加引号;`model` 字段仍按用户原始输入保存。

### 变更

- 抽取了所有 provider 相关常量与持久化辅助函数(`MANAGED_PROVIDER_KEYS`、`PROVIDER_DEFAULT_BASES`、`getEffectiveEngineType`、`buildAppModelConfig`、`createEmptyProviderConfig`、`resolveProviderProtocol`…)到独立模块 `src/renderer/src/lib/providers.ts`。Settings 与 WelcomeModal 从同一处导入,避免再次出现重复定义。
- 首次启动向导不再通过 `engineConfig.save` 写入 `engine.llm.providers`。引擎 YAML 由 Providers Management API 独占,渲染端只写应用级配置。
- 侧边栏的语言切换按钮已移除,首启用户改由欢迎弹窗顶栏的切换按钮控制语言。
- 欢迎向导「选择推理引擎」阶段不再渲染阶段标题与副标题,滑动选择器直接顶到顶部;卡片整体放宽,勾选指示器移到右上角避免与标题挤在一起。
