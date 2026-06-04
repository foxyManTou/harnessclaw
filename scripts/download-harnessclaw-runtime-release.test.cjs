const assert = require('node:assert/strict')
const { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const {
  copyRuntimeFiles,
  normalizeArch,
  normalizePlatform,
} = require('./download-harnessclaw-runtime-release.cjs')

test('normalizes runtime bundle platform and arch names', () => {
  assert.equal(normalizePlatform('mac'), 'darwin')
  assert.equal(normalizePlatform('win32'), 'windows')
  assert.equal(normalizeArch('amd64'), 'x64')
  assert.equal(normalizeArch('aarch64'), 'arm64')
})

test('copies runtime bin files and replaces stale managed files', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'harnessclaw-runtime-test-'))
  const extractDir = join(tmp, 'extract')
  const outputDir = join(tmp, 'resources-bin')
  mkdirSync(join(extractDir, 'bin'), { recursive: true })
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(extractDir, 'bin', 'harnessclaw-engine-darwin-arm64'), 'engine')
  writeFileSync(join(extractDir, 'bin', 'agent-browser-darwin-arm64'), 'agent')
  writeFileSync(join(extractDir, 'manifest.json'), '{"ok":true}\n')
  writeFileSync(join(outputDir, 'README.md'), 'keep')
  writeFileSync(join(outputDir, 'harnessclaw-engine'), 'stale')
  writeFileSync(join(outputDir, 'agent-browser-darwin-arm64'), 'stale')

  copyRuntimeFiles(extractDir, outputDir, 'darwin')

  assert.equal(readFileSync(join(outputDir, 'README.md'), 'utf8'), 'keep')
  assert.equal(readFileSync(join(outputDir, 'harnessclaw-engine-darwin-arm64'), 'utf8'), 'engine')
  assert.equal(readFileSync(join(outputDir, 'agent-browser-darwin-arm64'), 'utf8'), 'agent')
  assert.equal(readFileSync(join(outputDir, 'runtime-manifest.json'), 'utf8'), '{"ok":true}\n')
  assert.equal(existsSync(join(outputDir, 'harnessclaw-engine')), false)
})
