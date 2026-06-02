const { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } = require('fs')
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

function normalizePlatformForAgentBrowser(platform) {
  if (!platform) return ''
  if (platform === 'windows' || platform === 'win') return 'win32'
  if (platform === 'mac' || platform === 'macos') return 'darwin'
  return platform
}

function normalizeArchForAgentBrowser(arch) {
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
  const engineSourceDir = args.engineSourceDir
    ? resolveFromAppRoot(appRoot, args.engineSourceDir)
    : join(appRoot, '..', 'harnessclaw-engine')

  const agentBrowserPlatform = normalizePlatformForAgentBrowser(args.platform || env.AGENT_BROWSER_PLATFORM || process.platform)
  const agentBrowserArch = normalizeArchForAgentBrowser(args.arch || env.AGENT_BROWSER_ARCH || process.arch)

  return {
    outputDir,
    engine: {
      source: engineSource,
      script: join(scriptDir, 'download-harnessclaw-engine-release.cjs'),
      env: {
        HARNESSCLAW_ENGINE_PLATFORM: enginePlatform,
        HARNESSCLAW_ENGINE_ARCH: engineArch,
      },
      sourceDir: engineSourceDir,
      goos,
      goarch,
      targetPath: join(outputDir, `harnessclaw-engine${extension}`),
    },
    agentBrowser: {
      source: 'release',
      script: join(scriptDir, 'download-agent-browser-release.cjs'),
      env: {
        AGENT_BROWSER_PLATFORM: agentBrowserPlatform,
        AGENT_BROWSER_ARCH: agentBrowserArch,
      },
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

function resolveGoBinary(env) {
  if (env.GO) return env.GO
  const homebrewGo = '/opt/homebrew/bin/go'
  if (existsSync(homebrewGo)) return homebrewGo
  return 'go'
}

function buildLocalEngine(plan, env = process.env) {
  if (!existsSync(join(plan.engine.sourceDir, 'go.mod'))) {
    throw new Error(`Local harnessclaw-engine checkout not found at ${plan.engine.sourceDir}`)
  }
  if (!existsSync(join(plan.engine.sourceDir, 'cmd', 'server'))) {
    throw new Error(`Local harnessclaw-engine server entrypoint not found under ${plan.engine.sourceDir}`)
  }

  removeExistingEngineBinaries(plan.outputDir)
  const result = spawnSync(resolveGoBinary(env), ['build', '-trimpath', '-o', plan.engine.targetPath, './cmd/server'], {
    cwd: plan.engine.sourceDir,
    stdio: 'inherit',
    env: {
      ...env,
      GOOS: plan.engine.goos,
      GOARCH: plan.engine.goarch,
    },
  })

  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
  if (plan.engine.goos !== 'windows') {
    chmodSync(plan.engine.targetPath, 0o755)
  }
  process.stdout.write(`Built local harnessclaw-engine ${plan.engine.goos}/${plan.engine.goarch} from ${plan.engine.sourceDir} to ${plan.engine.targetPath}\n`)
}

function prepareBundledBinaries(plan = createBundledBinaryPlan()) {
  const scriptArgs = [plan.outputDir]
  if (plan.engine.source === 'local') {
    buildLocalEngine(plan)
  } else {
    run(plan.engine.script, scriptArgs, plan.engine.env)
  }
  run(plan.agentBrowser.script, scriptArgs, plan.agentBrowser.env)
}

function main() {
  prepareBundledBinaries(createBundledBinaryPlan())
}

if (require.main === module) {
  main()
}

module.exports = {
  createBundledBinaryPlan,
  normalizeArchForAgentBrowser,
  normalizeArchForEngine,
  normalizeEngineSource,
  normalizeGoArch,
  normalizeGoOS,
  normalizePlatformForAgentBrowser,
  normalizePlatformForEngine,
  parseArgs,
}
