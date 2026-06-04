const assert = require('node:assert/strict')
const { join } = require('node:path')
const test = require('node:test')

const { createBundledBinaryPlan } = require('./prepare-bundled-binaries.cjs')

test('uses explicit local engine source from environment', () => {
  const plan = createBundledBinaryPlan({
    argv: ['--platform', 'darwin', '--arch', 'arm64', '--output-dir', 'resources/bin'],
    env: { HARNESSCLAW_ENGINE_SOURCE_DIR: '../custom-engine' },
    scriptDir: __dirname,
  })

  assert.equal(plan.runtime.source, 'local')
  assert.equal(plan.runtime.goos, 'darwin')
  assert.equal(plan.runtime.goarch, 'arm64')
  assert.equal(plan.runtime.sourceDir, join(__dirname, '..', '..', 'custom-engine'))
  assert.equal(plan.runtime.localScript, join(__dirname, '..', '..', 'custom-engine', 'scripts', 'prepare-runtime.cjs'))
  assert.equal(plan.runtime.releaseScript, join(__dirname, 'download-harnessclaw-runtime-release.cjs'))
})

test('uses explicit local engine source from arguments', () => {
  const plan = createBundledBinaryPlan({
    argv: ['--platform', 'darwin', '--arch', 'arm64', '--output-dir', 'resources/bin', '--engine-source-dir', '/tmp/harnessclaw-engine'],
    env: { HARNESSCLAW_ENGINE_SOURCE_DIR: '../ignored-engine' },
    scriptDir: __dirname,
  })

  assert.equal(plan.runtime.sourceDir, '/tmp/harnessclaw-engine')
  assert.equal(plan.runtime.localScript, join('/tmp/harnessclaw-engine', 'scripts', 'prepare-runtime.cjs'))
})

test('requires explicit local engine source without sibling fallback', () => {
  assert.throws(() => createBundledBinaryPlan({
    argv: ['--platform', 'darwin', '--arch', 'arm64', '--output-dir', 'resources/bin'],
    env: {},
    scriptDir: __dirname,
  }), /HARNESSCLAW_ENGINE_SOURCE_DIR/)
})

test('uses the engine runtime bundle release when explicitly requested', () => {
  const plan = createBundledBinaryPlan({
    argv: ['--platform', 'win32', '--arch', 'x64', '--output-dir', 'resources/bin', '--engine-source', 'release'],
    env: {},
    scriptDir: __dirname,
  })

  assert.equal(plan.runtime.source, 'release')
  assert.equal(plan.runtime.env.HARNESSCLAW_ENGINE_PLATFORM, 'win32')
  assert.equal(plan.runtime.env.HARNESSCLAW_ENGINE_ARCH, 'x64')
  assert.equal(plan.runtime.releaseScript, join(__dirname, 'download-harnessclaw-runtime-release.cjs'))
})
