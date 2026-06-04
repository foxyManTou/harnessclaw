const { existsSync, mkdirSync, readdirSync, rmSync } = require('fs')
const { spawnSync } = require('child_process')
const { join, resolve } = require('path')

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--platform') {
      out.platform = argv[++i]
      continue
    }
    if (arg === '--arch') {
      out.arch = argv[++i]
      continue
    }
    if (arg === '--output-dir') {
      out.outputDir = argv[++i]
      continue
    }
    if (arg === '--engine-source') {
      out.engineSource = argv[++i]
      continue
    }
    if (arg === '--engine-source-dir') {
      out.engineSourceDir = argv[++i]
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return out
}

function normalizeEngineSource(source) {
  if (!source || source === 'local') return 'local'
  if (source === 'release') return 'release'
  throw new Error(`Unsupported engine source: ${source}`)
}

function normalizePlatformForEngine(platform) {
  if (!platform) return ''
  if (platform === 'windows' || platform === 'win') return 'win32'
  if (platform === 'mac' || platform === 'macos') return 'darwin'
  return platform
}

function normalizeArchForEngine(arch) {
  if (!arch) return ''
  if (arch === 'amd64' || arch === 'x86_64') return 'x64'
  return arch
}

function normalizeGoOS(platform) {
  const normalized = normalizePlatformForEngine(platform || process.platform)
  if (normalized === 'win32') return 'windows'
  if (normalized === 'darwin' || normalized === 'linux') return normalized
  throw new Error(`Unsupported Go platform: ${platform}`)
}

function normalizeGoArch(arch) {
  const normalized = normalizeArchForEngine(arch || process.arch)
  if (normalized === 'x64') return 'amd64'
  if (normalized === 'arm64') return 'arm64'
  throw new Error(`Unsupported Go arch: ${arch}`)
}

function resolveFromAppRoot(appRoot, value) {
  if (!value) return ''
  return resolve(appRoot, value)
}

function resolveEngineSourceDir(appRoot, args, env, engineSource) {
  if (engineSource !== 'local') return ''
  const sourceDir = args.engineSourceDir || env.HARNESSCLAW_ENGINE_SOURCE_DIR
  if (!sourceDir || !String(sourceDir).trim()) {
    throw new Error('Local engine source requires HARNESSCLAW_ENGINE_SOURCE_DIR or --engine-source-dir')
  }
  return resolveFromAppRoot(appRoot, sourceDir)
}

function createBundledBinaryPlan({ argv = process.argv.slice(2), env = process.env, scriptDir = __dirname } = {}) {
  const args = parseArgs(argv)
  const appRoot = join(scriptDir, '..')
  const outputDir = args.outputDir
    ? resolveFromAppRoot(appRoot, args.outputDir)
    : join(appRoot, 'resources', 'bin')
  const engineSource = normalizeEngineSource(args.engineSource || env.HARNESSCLAW_ENGINE_BUNDLE_SOURCE || 'local')
  const enginePlatform = normalizePlatformForEngine(args.platform || env.HARNESSCLAW_ENGINE_PLATFORM || process.platform)
  const engineArch = normalizeArchForEngine(args.arch || env.HARNESSCLAW_ENGINE_ARCH || process.arch)
  const goos = normalizeGoOS(args.platform || env.HARNESSCLAW_ENGINE_PLATFORM || process.platform)
  const goarch = normalizeGoArch(args.arch || env.HARNESSCLAW_ENGINE_ARCH || process.arch)
  const extension = goos === 'windows' ? '.exe' : ''
  const engineSourceDir = resolveEngineSourceDir(appRoot, args, env, engineSource)

  return {
    outputDir,
    runtime: {
      source: engineSource,
      releaseScript: join(scriptDir, 'download-harnessclaw-runtime-release.cjs'),
      localScript: join(engineSourceDir, 'scripts', 'prepare-runtime.cjs'),
      env: {
        HARNESSCLAW_ENGINE_PLATFORM: enginePlatform,
        HARNESSCLAW_ENGINE_ARCH: engineArch,
      },
      sourceDir: engineSourceDir,
      goos,
      goarch,
      engineFileName: `harnessclaw-engine${extension}`,
    },
  }
}

function run(script, args, env) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: join(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })

  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

function removeExistingEngineBinaries(outputDir) {
  mkdirSync(outputDir, { recursive: true })
  for (const entry of readdirSync(outputDir)) {
    if (entry === 'README.md') continue
    if (entry === 'harnessclaw-engine' || entry.startsWith('harnessclaw-engine-')) {
      rmSync(join(outputDir, entry), { recursive: true, force: true })
    }
  }
}

function prepareBundledBinaries(plan = createBundledBinaryPlan()) {
  const scriptArgs = [plan.outputDir]
  if (plan.runtime.source === 'local') {
    if (!existsSync(join(plan.runtime.sourceDir, 'go.mod'))) {
      throw new Error(`Local harnessclaw-engine checkout not found at ${plan.runtime.sourceDir}`)
    }
    if (!existsSync(plan.runtime.localScript)) {
      throw new Error(`Local harnessclaw-engine runtime script not found at ${plan.runtime.localScript}`)
    }
    removeExistingEngineBinaries(plan.outputDir)
    run(plan.runtime.localScript, ['--include-engine', '--platform', plan.runtime.env.HARNESSCLAW_ENGINE_PLATFORM, '--arch', plan.runtime.env.HARNESSCLAW_ENGINE_ARCH, '--output-dir', plan.outputDir], plan.runtime.env)
  } else {
    run(plan.runtime.releaseScript, scriptArgs, plan.runtime.env)
  }
}

function main() {
  prepareBundledBinaries(createBundledBinaryPlan())
}

if (require.main === module) {
  main()
}

module.exports = {
  createBundledBinaryPlan,
  normalizeArchForEngine,
  normalizeEngineSource,
  normalizeGoArch,
  normalizeGoOS,
  normalizePlatformForEngine,
  parseArgs,
  resolveEngineSourceDir,
}
