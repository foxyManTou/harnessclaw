const yaml = require('js-yaml') as {
  load: (source: string) => unknown
  dump: (value: unknown, options?: Record<string, unknown>) => string
}

export type EngineConfigStorageFormat = 'json' | 'yaml'

type ConfigRecord = Record<string, unknown>

function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePayloadText(payloadText: string, storageFormat: EngineConfigStorageFormat): ConfigRecord | null {
  try {
    const parsed = storageFormat === 'json'
      ? JSON.parse(payloadText)
      : yaml.load(payloadText) ?? {}
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function serializeYaml(data: unknown): string {
  const serialized = yaml.dump(data, {
    noRefs: true,
    lineWidth: 120,
    sortKeys: false,
  })
  return serialized.endsWith('\n') ? serialized : `${serialized}\n`
}

function serializePayloadText(data: unknown, storageFormat: EngineConfigStorageFormat): string {
  if (storageFormat === 'json') {
    return `${JSON.stringify(data, null, 2)}\n`
  }
  return serializeYaml(data)
}

function ensureRecord(parent: ConfigRecord, key: string): { record: ConfigRecord; changed: boolean } {
  const existing = parent[key]
  if (isRecord(existing)) {
    return { record: existing, changed: false }
  }

  const record: ConfigRecord = {}
  parent[key] = record
  return { record, changed: true }
}

function ensureBrowserAgentEnabled(config: ConfigRecord): boolean {
  let changed = false

  const tools = ensureRecord(config, 'tools')
  changed = tools.changed || changed

  const browserAgent = ensureRecord(tools.record, 'browser_agent')
  changed = browserAgent.changed || changed

  if (browserAgent.record.enabled !== true) {
    browserAgent.record.enabled = true
    changed = true
  }

  return changed
}

function lineIndent(line: string): number {
  const match = line.match(/^(\s*)/)
  return match ? match[1].length : 0
}

function isYamlSectionBoundary(line: string, parentIndent: number): boolean {
  if (!line.trim() || line.trimStart().startsWith('#')) {
    return false
  }
  return lineIndent(line) <= parentIndent
}

function patchYamlBrowserAgentBlock(payloadText: string): string | null {
  const newline = payloadText.includes('\r\n') ? '\r\n' : '\n'
  const lines = payloadText.replace(/\r\n/g, '\n').split('\n')
  const browserAgentIndex = lines.findIndex((line) => /^\s*browser_agent:\s*(?:#.*)?$/.test(line))
  if (browserAgentIndex < 0) return null

  const browserAgentIndent = lineIndent(lines[browserAgentIndex])
  const enabledLinePattern = /^(\s*)enabled:\s*false(\s*(?:#.*)?)?$/
  let insertIndex = browserAgentIndex + 1

  for (let index = browserAgentIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (isYamlSectionBoundary(line, browserAgentIndent)) {
      break
    }

    insertIndex = index + 1
    const match = line.match(enabledLinePattern)
    if (match) {
      lines[index] = `${match[1]}enabled: true${match[2] ?? ''}`
      return lines.join(newline)
    }
  }

  lines.splice(insertIndex, 0, `${' '.repeat(browserAgentIndent + 2)}enabled: true`)
  return lines.join(newline)
}

function parsedBrowserAgentEnabled(payloadText: string, storageFormat: EngineConfigStorageFormat): boolean {
  const parsed = parsePayloadText(payloadText, storageFormat)
  if (!parsed) return false
  const tools = parsed.tools
  if (!isRecord(tools)) return false
  const browserAgent = tools.browser_agent
  return isRecord(browserAgent) && browserAgent.enabled === true
}

export function migrateEngineConfigPayloadText(
  payloadText: string,
  storageFormat: EngineConfigStorageFormat,
): { payloadText: string; changed: boolean } {
  const parsed = parsePayloadText(payloadText, storageFormat)
  if (!parsed) {
    return { payloadText, changed: false }
  }

  if (parsedBrowserAgentEnabled(payloadText, storageFormat)) {
    return { payloadText, changed: false }
  }

  if (storageFormat === 'yaml') {
    const patchedText = patchYamlBrowserAgentBlock(payloadText)
    if (patchedText && parsedBrowserAgentEnabled(patchedText, storageFormat)) {
      return { payloadText: patchedText, changed: true }
    }
  }

  const changed = ensureBrowserAgentEnabled(parsed)
  return changed
    ? { payloadText: serializePayloadText(parsed, storageFormat), changed: true }
    : { payloadText, changed: false }
}
