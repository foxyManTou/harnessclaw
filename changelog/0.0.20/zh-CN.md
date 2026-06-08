### 修复

- 打包版 Browser Agent 现在始终启动桌面应用内置的 `agent-browser` 二进制。旧的本地 engine 配置即使指向裸 `agent-browser` 命令，也不会再覆盖打包运行时。
- 内置运行时查找现在要求精确的平台文件名，避免旧 fallback 路径掩盖 release asset 缺失问题。
- 现有桌面端配置现在会一次性迁移并启用 Browser Agent，升级安装后无需手动配置工具即可使用内置 sidecar。

### 变更

- 本版本替代已撤回的 `0.0.19` 桌面端 release。
