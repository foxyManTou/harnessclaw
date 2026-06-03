const assert = require('node:assert/strict')
const { join } = require('node:path')
const test = require('node:test')

const { createBundledBinaryPlan } = require('./prepare-bundled-binaries.cjs')

test('defaults to building the bundled engine from the local sibling checkout', () => {
  const plan = createBundledBinaryPlan({
    argv: ['--platform', 'darwin', '--arch', 'arm64', '--output-dir', 'resources/bin'],
    env: {},
    scriptDir: __dirname,
  })

  assert.equal(plan.engine.source, 'local')
  assert.equal(plan.engine.goos, 'darwin')
  assert.equal(plan.engine.goarch, 'arm64')
  assert.equal(plan.engine.sourceDir, join(__dirname, '..', '..', 'harnessclaw-engine'))
  assert.equal(plan.engine.targetPath, join(__dirname, '..', 'resources', 'bin', 'harnessclaw-engine'))
  assert.equal(plan.agentBrowser.source, 'release')
})

test('keeps release engine downloads available when explicitly requested', () => {
  const plan = createBundledBinaryPlan({
    argv: ['--platform', 'win32', '--arch', 'x64', '--output-dir', 'resources/bin', '--engine-source', 'release'],
    env: {},
    scriptDir: __dirname,
  })

  assert.equal(plan.engine.source, 'release')
  assert.equal(plan.engine.env.HARNESSCLAW_ENGINE_PLATFORM, 'win32')
  assert.equal(plan.engine.env.HARNESSCLAW_ENGINE_ARCH, 'x64')
  assert.equal(plan.engine.script, join(__dirname, 'download-harnessclaw-engine-release.cjs'))
})
