#!/usr/bin/env node

const { spawnSync } = require('node:child_process')
const path = require('node:path')

const rootDir = path.resolve(__dirname, '..')

function runElectronSmokeTest() {
  const electronPath = require('electron')
  const result = spawnSync(
    electronPath,
    [
      '-e',
      [
        "const Database = require('better-sqlite3')",
        "const db = new Database(':memory:')",
        "db.prepare('select 1 as ok').get()",
        'db.close()'
      ].join(';')
    ],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1'
      },
      encoding: 'utf8'
    }
  )

  return result
}

function printFailure(result) {
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
  if (output) {
    console.error(output)
  }
}

let result = runElectronSmokeTest()
if (result.status === 0) {
  process.exit(0)
}

console.warn('[native-deps] Electron native dependency check failed; rebuilding app deps...')
printFailure(result)

const yarnBin = process.platform === 'win32' ? 'yarn.cmd' : 'yarn'
const rebuild = spawnSync(yarnBin, ['rebuild:electron-native'], {
  cwd: rootDir,
  env: process.env,
  stdio: 'inherit'
})

if (rebuild.status !== 0) {
  process.exit(rebuild.status ?? 1)
}

result = runElectronSmokeTest()
if (result.status !== 0) {
  printFailure(result)
  process.exit(result.status ?? 1)
}
