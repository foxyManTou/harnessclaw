### 新增

- Agent 默认设置全面对接引擎 `/api/v1/agent`（2026-05-14+）：主 Provider 通过单独的下拉直接读写 `agent.primary`，Provider 负载兜底改为开关，开启后可在 fallback 列表里拖拽排序 / 增删；Agent 调用参数 (Max Tokens / Context Window / Temperature) 走 PATCH 即时热更，无需重启。
- 全新「回答风格」温度滑动条：四档预设（精准 / 平衡 / 灵活 / 创意）配独立卡片说明，拖动滑块即可在精准与创意之间无级调节；卡片在调整时温柔淡入、停下 3 秒后淡出，避免界面长期占用空间。
- 对话页右上角新增「统计」面板：上下文窗口使用率（按 input / cache / output / thinking 分段）、token 与延迟汇总、子 agent 贡献占比一目了然，支持轮询刷新。
- 全局快捷键：⌘N / Ctrl+N 跳到首页新会话输入框，⌘, / Ctrl+, 打开设置；编辑器内输入逗号不会被吞掉。
- 侧边栏右边缘新增拖拽手柄，可在 220–440px 之间调节宽度并记忆到本地；调宽时不掉帧，调窄时回到折叠态。
- 引擎 wire 协议升级到 v2：支持顶层 bare `ping`/`pong` 心跳帧、结构化 ErrorInfo（含 error.type 分类、user_message、retryable、retry_after_ms 与未来扩展用的 recovery 字段），工具失败 UI 可据此区分超时 / 限流 / 拒绝执行 / 模型错误等不同形态。
- 文件预览 / 网页预览抽屉新增「从右滑入」动画，主 Provider 字段在被外部状态触发时会有一次柔和的琥珀色脉冲提示。

### 修复

- 连接状态徽标不再因单次心跳超时就掉到「未连接」：现在要求连续两次 probe 失败才下沉，主进程权威事件优先级高于探针猜测，彻底治好首页徽标闪烁。
- 设置页改动引擎 / 应用配置后，常驻挂载的 ChatPage 立即同步新值，不需要切回首页再切回去重新加载。
- 引擎在握手未完成时被掐断不再触发主进程 uncaughtException 崩溃：WebSocket terminate 现在带有错误吞咽和日志，主进程优雅清理。
- 工具调用的 `cancelled` / `skipped` 状态从红色错误样式改为中性灰色，与真正失败的 `failed` 区分。

### 变更

- 「统计」面板隐藏所有金额信息（触发徽标的总花费、4-up 卡片中的「总花费」、子 agent 行的美元数）以降低成本焦虑；总花费卡换成「总 token」，子 agent 列改名「贡献占比」。内部仍按价格加权计算占比，但不再向用户展示具体金额。
- 主 Provider 下拉自动过滤掉被 disable 的整厂商下的 endpoint，避免选到一个永远不会路由的项；选项标签简化为 `provider:endpoint`，括号里的 model id 不再重复出现。
- 主 Provider 行左侧新增「跳转设置」按钮（外链图标），一键跳到「模型配置」分区编辑 endpoint / max_tokens 等底层字段。
- CSP `img-src` 放开 Google / gstatic / DuckDuckGo 的图标域名，让网页预览抽屉的 favicon 能正常显示。
- 文件路径自动链接收紧匹配规则：只对常见文件系统根（`/Users`、`/home`、`/var`、`/tmp`、`/opt` 等）和 Windows 盘符路径生效，`/CRM/Jira`、`/Marketing/Q3` 这类业务面包屑不再被误判成可点击的路径。
