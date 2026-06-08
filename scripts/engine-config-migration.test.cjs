const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { dirname, join } = require('node:path')
const { tmpdir } = require('node:os')
const test = require('node:test')
const ts = require('typescript')
const yaml = require('js-yaml')

const root = join(__dirname, '..')

function loadMigrationModule() {
  const sourcePath = join(root, 'src', 'main', 'engine-config-migration.ts')
  return loadTsModule(sourcePath, require)
}

function loadTsModule(sourcePath, moduleRequire) {
  const source = readFileSync(sourcePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const mod = { exports: {} }
  const fn = new Function('require', 'module', 'exports', compiled)
  fn(moduleRequire, mod, mod.exports)
  return mod.exports
}

function loadConfigModule({ homeDir, dbState }) {
  const migrationModule = loadMigrationModule()
  const configPath = join(root, 'src', 'main', 'config.ts')
  return loadTsModule(configPath, (id) => {
    if (id === 'electron') {
      return { app: { isPackaged: false } }
    }
    if (id === 'os') {
      return { homedir: () => homeDir }
    }
    if (id === './engine-config-migration') {
      return migrationModule
    }
    if (id === './db') {
      return {
        getConfigDocument(scope) {
          return dbState[scope] || null
        },
        saveConfigDocument(input) {
          dbState[input.scope] = {
            scope: input.scope,
            storage_format: input.storageFormat,
            schema_version: input.schemaVersion || 1,
            payload_text: input.payloadText,
            created_at: 1,
            updated_at: 2,
          }
        },
      }
    }
    return require(id)
  })
}

function createTempHome() {
  return mkdtempSync(join(tmpdir(), 'harnessclaw-config-test-'))
}

function writeEngineConfig(homeDir, payloadText) {
  const path = join(homeDir, '.harnessclaw', 'harnessclaw-engine.yaml')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, payloadText, 'utf8')
  return path
}

test('packaged engine config template enables browser agent by default', () => {
  const template = readFileSync(join(root, 'resources', 'templates', 'harnessclaw-engine.yaml'), 'utf8')
  const parsed = yaml.load(template)

  assert.equal(parsed.tools.browser_agent.enabled, true)
})

test('migrates old yaml engine config to enable browser agent', () => {
  const { migrateEngineConfigPayloadText } = loadMigrationModule()
  const input = `
tools:
  browser_agent:
    enabled: false
    default_visibility: hidden
    max_steps: 30
`

  const result = migrateEngineConfigPayloadText(input, 'yaml')
  const parsed = yaml.load(result.payloadText)

  assert.equal(result.changed, true)
  assert.equal(parsed.tools.browser_agent.enabled, true)
  assert.equal(parsed.tools.browser_agent.default_visibility, 'hidden')
  assert.equal(parsed.tools.browser_agent.max_steps, 30)
})

test('migrates engine config with missing browser agent block', () => {
  const { migrateEngineConfigPayloadText } = loadMigrationModule()

  const result = migrateEngineConfigPayloadText('tools:\n  web_fetch:\n    enabled: true\n', 'yaml')
  const parsed = yaml.load(result.payloadText)

  assert.equal(result.changed, true)
  assert.equal(parsed.tools.web_fetch.enabled, true)
  assert.equal(parsed.tools.browser_agent.enabled, true)
})

test('migrates stored json engine config documents', () => {
  const { migrateEngineConfigPayloadText } = loadMigrationModule()
  const result = migrateEngineConfigPayloadText(JSON.stringify({
    tools: {
      browser_agent: {
        enabled: false,
        default_visibility: 'hidden',
      },
    },
  }), 'json')
  const parsed = JSON.parse(result.payloadText)

  assert.equal(result.changed, true)
  assert.equal(parsed.tools.browser_agent.enabled, true)
  assert.equal(parsed.tools.browser_agent.default_visibility, 'hidden')
})

test('migrates schema 1 engine config document and file once', () => {
  const homeDir = createTempHome()
  const oldConfig = 'tools:\n  browser_agent:\n    enabled: false\n'
  const engineConfigPath = writeEngineConfig(homeDir, oldConfig)
  const dbState = {
    engine: {
      scope: 'engine',
      storage_format: 'yaml',
      schema_version: 1,
      payload_text: oldConfig,
      created_at: 1,
      updated_at: 1,
    },
  }
  const config = loadConfigModule({ homeDir, dbState })

  const result = config.ensureEngineConfigInitialized()
  const fileConfig = yaml.load(readFileSync(engineConfigPath, 'utf8'))
  const storedConfig = yaml.load(dbState.engine.payload_text)

  assert.equal(result.ok, true)
  assert.equal(fileConfig.tools.browser_agent.enabled, true)
  assert.equal(storedConfig.tools.browser_agent.enabled, true)
  assert.equal(dbState.engine.schema_version, 2)
})

test('preserves schema 2 browser agent disabled setting', () => {
  const homeDir = createTempHome()
  const disabledConfig = 'tools:\n  browser_agent:\n    enabled: false\n'
  const engineConfigPath = writeEngineConfig(homeDir, disabledConfig)
  const dbState = {
    engine: {
      scope: 'engine',
      storage_format: 'yaml',
      schema_version: 2,
      payload_text: disabledConfig,
      created_at: 1,
      updated_at: 1,
    },
  }
  const config = loadConfigModule({ homeDir, dbState })

  const result = config.ensureEngineConfigInitialized()
  const fileConfig = yaml.load(readFileSync(engineConfigPath, 'utf8'))
  const storedConfig = yaml.load(dbState.engine.payload_text)

  assert.equal(result.ok, true)
  assert.equal(fileConfig.tools.browser_agent.enabled, false)
  assert.equal(storedConfig.tools.browser_agent.enabled, false)
  assert.equal(dbState.engine.schema_version, 2)
})
