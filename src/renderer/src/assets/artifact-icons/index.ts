// 产物文件类型图标映射。按文件扩展名 → 彩色 SVG。
// SVG 经 Vite 处理后是 URL 字符串，直接用 <img src> 渲染。
import htmlIcon from './html.svg'
import mdIcon from './md.svg'
import docIcon from './doc.svg'
import txtIcon from './txt.svg'
import xslIcon from './xsl.svg'
import pptIcon from './ppt.svg'
import zipIcon from './zip.svg'
import rarIcon from './rar.svg'
import exeIcon from './exe.svg'
import mp3Icon from './mp3.svg'
import mp4Icon from './mp4.svg'
import pngIcon from './png.svg'
import jpgIcon from './jpg.svg'

// 扩展名 → icon。同义扩展名（jpeg→jpg、htm→html、markdown→md 等）归一到已有图标。
const ICON_BY_EXT: Record<string, string> = {
  // 网页
  html: htmlIcon,
  htm: htmlIcon,
  // 文档
  md: mdIcon,
  markdown: mdIcon,
  doc: docIcon,
  docx: docIcon,
  txt: txtIcon,
  log: txtIcon,
  xsl: xslIcon,
  xls: xslIcon,
  xlsx: xslIcon,
  csv: xslIcon,
  ppt: pptIcon,
  pptx: pptIcon,
  // 文件
  zip: zipIcon,
  rar: rarIcon,
  '7z': zipIcon,
  gz: zipIcon,
  tar: zipIcon,
  exe: exeIcon,
  // 多模态
  mp3: mp3Icon,
  wav: mp3Icon,
  m4a: mp3Icon,
  mp4: mp4Icon,
  mov: mp4Icon,
  webm: mp4Icon,
  avi: mp4Icon,
  png: pngIcon,
  webp: pngIcon,
  gif: pngIcon,
  jpg: jpgIcon,
  jpeg: jpgIcon,
}

/** 从文件名/路径/URI 中取小写扩展名（不含点）。取不到返回空串。 */
export function getExtension(nameOrPath: string): string {
  if (!nameOrPath) return ''
  // 去掉 query/hash，避免 http 链接的 ?a=1 干扰
  const clean = nameOrPath.split(/[?#]/)[0]
  const base = clean.split(/[/\\]/).pop() || ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

/**
 * 是否为已知产物类型（扩展名命中图标映射）。通用模式据此从工作区文件树中
 * 筛出可展示的产物，与图标映射 ICON_BY_EXT 同源，避免白名单漂移。
 */
export function isKnownArtifactExt(nameOrPath: string): boolean {
  const ext = getExtension(nameOrPath)
  return !!ext && ext in ICON_BY_EXT
}

/**
 * 解析产物图标 URL。优先按扩展名，其次按 mimeType 兜底（image/* → png 图标）。
 * 命中返回 SVG URL，未命中返回 null（调用方回退到通用图标）。
 */
export function resolveArtifactIcon(opts: { name?: string; uri?: string; mimeType?: string }): string | null {
  const ext = getExtension(opts.name || '') || getExtension(opts.uri || '')
  if (ext && ICON_BY_EXT[ext]) return ICON_BY_EXT[ext]
  const mime = opts.mimeType || ''
  if (mime.startsWith('image/')) return pngIcon
  if (mime.startsWith('audio/')) return mp3Icon
  if (mime.startsWith('video/')) return mp4Icon
  if (mime === 'text/html') return htmlIcon
  if (mime === 'text/markdown') return mdIcon
  if (mime.startsWith('text/')) return txtIcon
  return null
}
