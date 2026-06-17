### 修复

- 埋点上报现在使用与服务端兼容的 HMAC 请求头签名，恢复生产埋点接口投递。
- 修复助手回复中的生成图片链接渲染问题：Markdown 图片现在会通过 HarnessClaw 的安全本地文件协议展示本地 `file://` 和绝对路径输出，不再显示为损坏图片。
- Browser Agent 会话现在运行在独立 helper 进程中并隔离 CDP target，避免命令误接管 HarnessClaw 主窗口或其他浏览器会话。
