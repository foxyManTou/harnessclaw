import { Fragment, createElement, useMemo, type ReactNode } from 'react'

const ALLOWED_TAGS = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'section',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
])

const DROP_WITHOUT_CHILDREN = new Set([
  'base',
  'button',
  'embed',
  'form',
  'iframe',
  'input',
  'link',
  'meta',
  'object',
  'script',
  'select',
  'style',
  'textarea',
])

const DATA_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+=*$/i

function normalizeLinkHref(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).toString()
    } catch {
      return null
    }
  }
  if (/^mailto:/i.test(trimmed)) return trimmed
  return null
}

function normalizeImageSrc(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (DATA_IMAGE_RE.test(trimmed)) return trimmed
  if (!/^https?:\/\//i.test(trimmed)) return null
  try {
    return new URL(trimmed).toString()
  } catch {
    return null
  }
}

function readPositiveInteger(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function renderSafeNode(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent
  if (node.nodeType !== Node.ELEMENT_NODE) return null

  const element = node as HTMLElement
  const tag = element.tagName.toLowerCase()
  if (DROP_WITHOUT_CHILDREN.has(tag)) return null

  const children = Array.from(element.childNodes).map((child, index) => renderSafeNode(child, `${key}-${index}`))
  if (!ALLOWED_TAGS.has(tag)) return <Fragment key={key}>{children}</Fragment>

  const props: Record<string, unknown> = { key }

  if (tag === 'a') {
    const href = normalizeLinkHref(element.getAttribute('href') ?? '')
    if (!href) return <Fragment key={key}>{children}</Fragment>
    props.href = href
    props.target = '_blank'
    props.rel = 'noreferrer noopener'
  }

  if (tag === 'img') {
    const src = normalizeImageSrc(element.getAttribute('src') ?? '')
    if (!src) return null
    props.src = src
    props.alt = element.getAttribute('alt') ?? ''
    props.loading = 'lazy'
    const title = element.getAttribute('title')
    if (title) props.title = title
  }

  if (tag === 'td' || tag === 'th') {
    const colSpan = readPositiveInteger(element.getAttribute('colspan'))
    const rowSpan = readPositiveInteger(element.getAttribute('rowspan'))
    if (colSpan) props.colSpan = colSpan
    if (rowSpan) props.rowSpan = rowSpan
  }

  if (tag === 'th') {
    const scope = element.getAttribute('scope')
    if (scope === 'col' || scope === 'row' || scope === 'colgroup' || scope === 'rowgroup') {
      props.scope = scope
    }
  }

  return createElement(tag, props, ...children)
}

export function SafeHtmlContent({ html, className }: { html: string; className?: string }): JSX.Element {
  const content = useMemo(() => {
    if (!html) return null
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return Array.from(doc.body.childNodes).map((node, index) => renderSafeNode(node, `safe-html-${index}`))
  }, [html])

  return <div className={className}>{content}</div>
}
