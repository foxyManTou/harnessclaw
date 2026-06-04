### 变更

- Release 打包现在消费 engine 发布的运行时包，不再分别下载 engine 与 Browser Agent 二进制。本地打包必须通过 `HARNESSCLAW_ENGINE_SOURCE_DIR` 或 `--engine-source-dir` 显式指定 engine checkout，不再猜测开发者目录结构。
- Browser Agent 的 skill 文件不再由桌面端随包携带；engine 现在负责内嵌 Browser Agent skill、references 与 templates。

### 修复

- Electron Builder 运行前会先准备目标平台的 engine runtime bundle，并带上锁定版本的 `agent-browser` sidecar，使本地打包与 GitHub Actions 使用同一套运行时交接逻辑。
