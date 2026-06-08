import { app } from 'electron'
import { dirname, join } from 'path'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import {
  getConfigDocument,
  saveConfigDocument,
  type ConfigScope,
  type ConfigStorageFormat,
} from './db'
import { migrateEngineConfigPayloadText } from './engine-config-migration'

const yaml = require('js-yaml') as {
  load: (source: string) => unknown
  dump: (value: unknown, options?: Record<string, unknown>) => string
}

const ENGINE_CONFIG_SCHEMA_VERSION = 2

export const HARNESSCLAW_DIR = join(homedir(), '.harnessclaw')
export const ENGINE_CONFIG_PATH = join(HARNESSCLAW_DIR, 'harnessclaw-engine.yaml')
export const LEGACY_APP_CONFIG_PATH = join(HARNESSCLAW_DIR, 'harnessclaw.json')
export const APP_RESOURCES_DIR = app.isPackaged
  ? process.resourcesPath
  : join(process.cwd(), 'resources')
export const BUNDLED_BIN_DIR = join(APP_RESOURCES_DIR, 'bin')
export const ENGINE_CONFIG_TEMPLATE_PATH = join(APP_RESOURCES_DIR, 'templates', 'harnessclaw-engine.yaml')

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function readJsonConfig(path: string, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  try {
    if (!existsSync(path)) return fallback
    const raw = readFileSync(path, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    return { ...fallback, _error: String(err) }
  }
}

export function saveJsonConfig(path: string, data: unknown): { ok: boolean; error?: string } {
  try {
    ensureDir(dirname(path))
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

export function readYamlConfig(path: string, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  try {
    if (!existsSync(path)) return fallback
    const raw = readFileSync(path, 'utf-8')
    const parsed = yaml.load(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return fallback
  } catch (err) {
    return { ...fallback, _error: String(err) }
  }
}

export function saveYamlConfig(path: string, data: unknown): { ok: boolean; error?: string } {
  try {
    ensureDir(dirname(path))
    const serialized = serializeYaml(data)
    writeFileSync(path, serialized, 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

function readText(path: string): string {
  return readFileSync(path, 'utf-8')
}

function writeText(path: string, content: string): void {
  ensureDir(dirname(path))
  writeFileSync(path, content, 'utf-8')
}

function parseJsonText(text: string, fallback: Record<string, unknown>): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : fallback
  } catch (err) {
    return { ...fallback, _error: String(err) }
  }
}

function parseYamlText(text: string, fallback: Record<string, unknown>): Record<string, unknown> {
  try {
    const parsed = yaml.load(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : fallback
  } catch (err) {
    return { ...fallback, _error: String(err) }
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

function persistConfigDocument(
  scope: ConfigScope,
  storageFormat: ConfigStorageFormat,
  payloadText: string,
  schemaVersion?: number,
): { ok: boolean; error?: string } {
  try {
    saveConfigDocument({
      scope,
      storageFormat,
      payloadText,
      schemaVersion,
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

function ensureConfigDocumentInitialized(
  scope: ConfigScope,
  storageFormat: ConfigStorageFormat,
  seed: () => { ok: boolean; payloadText?: string; error?: string },
): { ok: boolean; created?: boolean; error?: string } {
  const existing = getConfigDocument(scope)
  if (existing) {
    return { ok: true, created: false }
  }

  const seeded = seed()
  if (!seeded.ok || typeof seeded.payloadText !== 'string') {
    return { ok: false, error: seeded.error || `Unable to seed ${scope} config` }
  }

  return {
    ...persistConfigDocument(scope, storageFormat, seeded.payloadText),
    created: true,
  }
}

function seedAppConfigDocument(): { ok: boolean; payloadText?: string; error?: string } {
  try {
    if (existsSync(LEGACY_APP_CONFIG_PATH)) {
      const raw = readText(LEGACY_APP_CONFIG_PATH)
      const parsed = parseJsonText(raw, {})
      return { ok: true, payloadText: `${JSON.stringify(parsed, null, 2)}\n` }
    }

    return { ok: true, payloadText: '{}\n' }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

function seedEngineConfigDocument(): { ok: boolean; payloadText?: string; error?: string } {
  try {
    if (existsSync(ENGINE_CONFIG_PATH)) {
      const migrated = migrateEngineConfigPayloadText(readText(ENGINE_CONFIG_PATH), 'yaml')
      if (migrated.changed) {
        writeText(ENGINE_CONFIG_PATH, migrated.payloadText)
      }
      return { ok: true, payloadText: migrated.payloadText }
    }

    if (!existsSync(ENGINE_CONFIG_TEMPLATE_PATH)) {
      return {
        ok: false,
        error: `Engine config template not found at ${ENGINE_CONFIG_TEMPLATE_PATH}`,
      }
    }

    copyFileSync(ENGINE_CONFIG_TEMPLATE_PATH, ENGINE_CONFIG_PATH)
    const migrated = migrateEngineConfigPayloadText(readText(ENGINE_CONFIG_PATH), 'yaml')
    if (migrated.changed) {
      writeText(ENGINE_CONFIG_PATH, migrated.payloadText)
    }
    return { ok: true, payloadText: migrated.payloadText }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

function parseConfigDocumentPayload(
  storageFormat: ConfigStorageFormat,
  payloadText: string,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  return storageFormat === 'yaml'
    ? parseYamlText(payloadText, fallback)
    : parseJsonText(payloadText, fallback)
}

function engineConfigFileTextFromDocument(
  storageFormat: ConfigStorageFormat,
  payloadText: string,
  fallback: Record<string, unknown>,
): string {
  return storageFormat === 'yaml'
    ? payloadText
    : serializeYaml(parseJsonText(payloadText, fallback))
}

function migrateStoredEngineConfigDocument(
  storageFormat: ConfigStorageFormat,
  payloadText: string,
  schemaVersion: number,
): { ok: boolean; payloadText: string; changed: boolean; error?: string } {
  if (schemaVersion >= ENGINE_CONFIG_SCHEMA_VERSION) {
    return { ok: true, payloadText, changed: false }
  }

  const migrated = migrateEngineConfigPayloadText(payloadText, storageFormat)
  const persisted = persistConfigDocument('engine', storageFormat, migrated.payloadText, ENGINE_CONFIG_SCHEMA_VERSION)
  return {
    ok: persisted.ok,
    payloadText: migrated.payloadText,
    changed: migrated.changed,
    error: persisted.error,
  }
}

function migrateEngineConfigFileIfPresent(shouldMigrate: boolean): { ok: boolean; changed?: boolean; error?: string } {
  if (!existsSync(ENGINE_CONFIG_PATH)) {
    return { ok: true, changed: false }
  }

  if (!shouldMigrate) {
    return { ok: true, changed: false }
  }

  try {
    const migrated = migrateEngineConfigPayloadText(readText(ENGINE_CONFIG_PATH), 'yaml')
    if (migrated.changed) {
      writeText(ENGINE_CONFIG_PATH, migrated.payloadText)
    }
    return { ok: true, changed: migrated.changed }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

export function ensureHarnessclawConfigInitialized(): { ok: boolean; created?: boolean; error?: string } {
  ensureDir(HARNESSCLAW_DIR)
  return ensureConfigDocumentInitialized('app', 'json', seedAppConfigDocument)
}

export function readHarnessclawConfig(fallback: Record<string, unknown> = {}): Record<string, unknown> {
  const initialized = ensureHarnessclawConfigInitialized()
  if (!initialized.ok) {
    return { ...fallback, _error: initialized.error || 'Unable to initialize app config document' }
  }

  const stored = getConfigDocument('app')
  if (!stored) return fallback
  return parseJsonText(stored.payload_text, fallback)
}

export function saveHarnessclawConfig(data: unknown): { ok: boolean; error?: string } {
  const initialized = ensureHarnessclawConfigInitialized()
  if (!initialized.ok) return initialized
  return persistConfigDocument('app', 'json', `${JSON.stringify(data, null, 2)}\n`)
}

export function readEngineConfig(fallback: Record<string, unknown> = {}): Record<string, unknown> {
  const initialized = ensureEngineConfigInitialized()
  if (!initialized.ok) {
    return { ...fallback, _error: initialized.error || 'Unable to initialize engine config file' }
  }

  const stored = getConfigDocument('engine')
  if (stored) {
    const shouldMigrate = stored.schema_version < ENGINE_CONFIG_SCHEMA_VERSION
    const migrated = migrateStoredEngineConfigDocument(stored.storage_format, stored.payload_text, stored.schema_version)
    if (!migrated.ok) return { ...fallback, _error: migrated.error || 'Unable to migrate engine config document' }

    const fileMigration = migrateEngineConfigFileIfPresent(shouldMigrate)
    if (!fileMigration.ok) return { ...fallback, _error: fileMigration.error || 'Unable to migrate engine config file' }

    if (!existsSync(ENGINE_CONFIG_PATH)) {
      writeText(ENGINE_CONFIG_PATH, engineConfigFileTextFromDocument(stored.storage_format, migrated.payloadText, fallback))
    }

    return parseConfigDocumentPayload(stored.storage_format, migrated.payloadText, fallback)
  }

  if (existsSync(ENGINE_CONFIG_PATH)) {
    const migrated = migrateEngineConfigPayloadText(readText(ENGINE_CONFIG_PATH), 'yaml')
    if (migrated.changed) {
      writeText(ENGINE_CONFIG_PATH, migrated.payloadText)
    }
    void persistConfigDocument('engine', 'yaml', migrated.payloadText, ENGINE_CONFIG_SCHEMA_VERSION)
    return parseYamlText(migrated.payloadText, fallback)
  }
  return fallback
}

export function saveEngineConfig(data: unknown): { ok: boolean; error?: string } {
  const initialized = ensureEngineConfigInitialized()
  if (!initialized.ok) return initialized

  const payloadText = serializeYaml(data)
  const persisted = persistConfigDocument('engine', 'yaml', payloadText, ENGINE_CONFIG_SCHEMA_VERSION)
  if (!persisted.ok) return persisted

  return saveYamlConfig(ENGINE_CONFIG_PATH, data)
}

export function ensureEngineConfigInitialized(): { ok: boolean; created?: boolean; error?: string } {
  ensureDir(HARNESSCLAW_DIR)
  const stored = getConfigDocument('engine')

  if (stored) {
    const shouldMigrate = stored.schema_version < ENGINE_CONFIG_SCHEMA_VERSION
    const migrated = migrateStoredEngineConfigDocument(stored.storage_format, stored.payload_text, stored.schema_version)
    if (!migrated.ok) {
      return { ok: false, error: migrated.error }
    }

    const fileMigration = migrateEngineConfigFileIfPresent(shouldMigrate)
    if (!fileMigration.ok) {
      return { ok: false, error: fileMigration.error }
    }

    if (!existsSync(ENGINE_CONFIG_PATH)) {
      writeText(ENGINE_CONFIG_PATH, engineConfigFileTextFromDocument(stored.storage_format, migrated.payloadText, {}))
      return { ok: true, created: true }
    }

    return { ok: true, created: false }
  }

  if (existsSync(ENGINE_CONFIG_PATH)) {
    const migrated = migrateEngineConfigPayloadText(readText(ENGINE_CONFIG_PATH), 'yaml')
    if (migrated.changed) {
      writeText(ENGINE_CONFIG_PATH, migrated.payloadText)
    }
    const persisted = persistConfigDocument('engine', 'yaml', migrated.payloadText, ENGINE_CONFIG_SCHEMA_VERSION)
    return {
      ok: persisted.ok,
      created: false,
      error: persisted.error,
    }
  }

  const seeded = seedEngineConfigDocument()
  if (!seeded.ok || typeof seeded.payloadText !== 'string') {
    return { ok: false, error: seeded.error || 'Unable to seed engine config' }
  }

  const persisted = persistConfigDocument('engine', 'yaml', seeded.payloadText, ENGINE_CONFIG_SCHEMA_VERSION)
  if (!persisted.ok) {
    return { ok: false, error: persisted.error }
  }

  writeText(ENGINE_CONFIG_PATH, seeded.payloadText)
  return { ok: true, created: true }
}

// Backward-compatible aliases. Renderer and older code may still use the nanobot name.
export const NANOBOT_CONFIG_PATH = ENGINE_CONFIG_PATH
export const readNanobotConfig = readEngineConfig
export const saveNanobotConfig = saveEngineConfig

function normalizePlatform(platform: NodeJS.Platform): 'darwin' | 'linux' | 'windows' {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'darwin'
  return 'linux'
}

function normalizeArch(arch: string): string {
  switch (arch) {
    case 'x64':
    case 'amd64':
      return 'x64'
    case 'arm64':
      return 'arm64'
    default:
      return arch
  }
}

export function getBundledBinaryFileName(baseName: string, platform = process.platform, arch = process.arch): string {
  const normalizedPlatform = normalizePlatform(platform)
  const normalizedArch = normalizeArch(arch)
  const extension = normalizedPlatform === 'windows' ? '.exe' : ''
  return `${baseName}-${normalizedPlatform}-${normalizedArch}${extension}`
}

export function getBundledAgentBrowserFileName(platform = process.platform, arch = process.arch): string {
  const normalizedPlatform = normalizePlatform(platform)
  const binaryPlatform = normalizedPlatform === 'windows' ? 'win32' : normalizedPlatform
  const normalizedArch = normalizeArch(arch)
  const extension = normalizedPlatform === 'windows' ? '.exe' : ''
  return `agent-browser-${binaryPlatform}-${normalizedArch}${extension}`
}

export function getBundledBinaryPath(baseName: string, platform = process.platform, arch = process.arch): string {
  return join(BUNDLED_BIN_DIR, getBundledBinaryFileName(baseName, platform, arch))
}

export function resolveBundledBinaryPath(baseName: string, platform = process.platform, arch = process.arch): string | null {
  const candidate = getBundledBinaryPath(baseName, platform, arch)
  return existsSync(candidate) && statSync(candidate).isFile() ? candidate : null
}

export function getBundledAgentBrowserPath(platform = process.platform, arch = process.arch): string {
  return join(BUNDLED_BIN_DIR, getBundledAgentBrowserFileName(platform, arch))
}

export function resolveBundledAgentBrowserPath(platform = process.platform, arch = process.arch): string | null {
  const candidate = getBundledAgentBrowserPath(platform, arch)
  return existsSync(candidate) && statSync(candidate).isFile() ? candidate : null
}
