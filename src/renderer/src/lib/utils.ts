import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 把磁盘上的绝对路径转成自定义协议 `local-file://` 的 URL，<img> /
 * <audio> / <video> 之类标签直接当 src 使用。
 *
 * 为什么不用 file://：在 Electron 默认 webSecurity=true + contextIsolation
 * 下，渲染端从 http://localhost（dev）或 app://（prod）页面引用 file:// 资源
 * 会触发跨源拦截，图片加载不出来。`local-file` scheme 在主进程
 * (`protocol.handle`) 里桥接到磁盘读取，规避了浏览器层的限制。
 *
 * 为什么用占位 host `local`：`local-file` 是以 `standard: true` 注册的，
 * Chromium URL 解析按 "special URL" 规则走，empty host 不被允许，会把
 * pathname 的第一段提升为 host 并做小写化（例如
 * `local-file:///Users/...` 被规范化为 `local-file://users/...`，主进程
 * 拿到的 pathname 就少了 `Users` 一段，文件读不到，最终回到渲染端是
 * `ERR_UNEXPECTED`）。固定加一个占位 host 让 Chromium 不再 shift 路径。
 *
 * 路径需要做 URL 编码以保留空格、中文等特殊字符；Windows 盘符（C:\...）
 * 转换为 `/C:/...` 形式，与主进程解析逻辑保持对称。
 */
export function localFileUrl(absolutePath: string): string {
  if (!absolutePath) return ''
  let p = absolutePath.replace(/\\/g, '/')
  if (!p.startsWith('/')) p = `/${p}`
  return `local-file://local${encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F')}`
}
