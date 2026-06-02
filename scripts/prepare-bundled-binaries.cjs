const { spawnSync } = require('child_process')
const { join } = require('path')

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
    throw new Error(`Unknown argument: ${arg}`)
  }
  return out
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

function main() {
  const args = parseArgs(process.argv.slice(2))
  const outputDir = args.outputDir || join(__dirname, '..', 'resources', 'bin')
  const scriptArgs = [outputDir]
  const engineEnv = {}
  const agentBrowserEnv = {}

  if (args.platform) {
    engineEnv.HARNESSCLAW_ENGINE_PLATFORM = normalizePlatformForEngine(args.platform)
    agentBrowserEnv.AGENT_BROWSER_PLATFORM = normalizePlatformForAgentBrowser(args.platform)
  }
  if (args.arch) {
    engineEnv.HARNESSCLAW_ENGINE_ARCH = normalizeArchForEngine(args.arch)
    agentBrowserEnv.AGENT_BROWSER_ARCH = normalizeArchForAgentBrowser(args.arch)
  }

  run(join(__dirname, 'download-harnessclaw-engine-release.cjs'), scriptArgs, engineEnv)
  run(join(__dirname, 'download-agent-browser-release.cjs'), scriptArgs, agentBrowserEnv)
}

main()
