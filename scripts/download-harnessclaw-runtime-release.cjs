const { chmodSync, copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } = require('fs')
const https = require('https')
const os = require('os')
const { join, resolve } = require('path')
const { spawnSync } = require('child_process')

function normalizePlatform(platform) {
  if (platform === 'darwin' || platform === 'mac' || platform === 'macos') return 'darwin'
  if (platform === 'linux') return 'linux'
  if (platform === 'win32' || platform === 'windows' || platform === 'win') return 'windows'
  throw new Error(`Unsupported runtime platform: ${platform}`)
}

function normalizeArch(arch) {
  if (arch === 'x64' || arch === 'amd64' || arch === 'x86_64') return 'x64'
  if (arch === 'arm64' || arch === 'aarch64') return 'arm64'
  throw new Error(`Unsupported runtime arch: ${arch}`)
}

function request(url, headers, redirectCount = 0) {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = https.get(url, { headers }, (response) => {
      const statusCode = response.statusCode || 0

      if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
        response.resume()
        if (redirectCount >= 5) {
          rejectRequest(new Error(`Too many redirects while requesting ${url}`))
          return
        }
        resolveRequest(request(response.headers.location, headers, redirectCount + 1))
        return
      }

      if (statusCode < 200 || statusCode >= 300) {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          rejectRequest(new Error(`Request to ${url} failed: ${statusCode} ${Buffer.concat(chunks).toString('utf8').trim()}`))
        })
        return
      }

      resolveRequest(response)
    })

    req.on('error', rejectRequest)
  })
}

async function fetchJson(url, headers) {
  const response = await request(url, headers)
  const chunks = []
  for await (const chunk of response) {
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function downloadToFile(url, headers, targetPath) {
  const response = await request(url, headers)
  await new Promise((resolveDownload, rejectDownload) => {
    const fileStream = createWriteStream(targetPath)
    response.pipe(fileStream)

    response.on('error', rejectDownload)
    fileStream.on('error', rejectDownload)
    fileStream.on('finish', () => {
      fileStream.close((error) => {
        if (error) {
          rejectDownload(error)
          return
        }
        resolveDownload()
      })
    })
  })
}

function removeManagedRuntimeFiles(outputDir) {
  mkdirSync(outputDir, { recursive: true })
  for (const entry of readdirSync(outputDir)) {
    if (entry === 'README.md') continue
    if (
      entry === 'harnessclaw-engine' ||
      entry === 'harnessclaw-engine.exe' ||
      entry.startsWith('harnessclaw-engine-') ||
      entry === 'agent-browser' ||
      entry.startsWith('agent-browser-') ||
      entry === 'runtime-manifest.json'
    ) {
      rmSync(join(outputDir, entry), { recursive: true, force: true })
    }
  }
}

function extractZip(zipPath, extractDir) {
  mkdirSync(extractDir, { recursive: true })

  if (process.platform === 'win32') {
    const command = `Expand-Archive -Force -Path ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(extractDir)}`
    const result = spawnSync('powershell', ['-NoProfile', '-Command', command], { stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status || 1)
    return
  }

  const result = spawnSync('unzip', ['-q', '-o', zipPath, '-d', extractDir], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

function copyRuntimeFiles(extractDir, outputDir, platform) {
  const binDir = join(extractDir, 'bin')
  if (!existsSync(binDir) || !statSync(binDir).isDirectory()) {
    throw new Error(`Runtime bundle does not contain a bin directory at ${binDir}`)
  }

  removeManagedRuntimeFiles(outputDir)
  for (const entry of readdirSync(binDir)) {
    const source = join(binDir, entry)
    if (!statSync(source).isFile()) continue
    const target = join(outputDir, entry)
    copyFileSync(source, target)
    if (platform !== 'windows' && (entry.startsWith('harnessclaw-engine') || entry.startsWith('agent-browser'))) {
      chmodSync(target, 0o755)
    }
  }

  const manifestPath = join(extractDir, 'manifest.json')
  if (existsSync(manifestPath) && statSync(manifestPath).isFile()) {
    copyFileSync(manifestPath, join(outputDir, 'runtime-manifest.json'))
  }
}

async function main() {
  const outputDir = resolve(process.argv[2] || join(__dirname, '..', 'resources', 'bin'))
  const platform = normalizePlatform(process.env.HARNESSCLAW_ENGINE_PLATFORM || process.platform)
  const arch = normalizeArch(process.env.HARNESSCLAW_ENGINE_ARCH || process.arch)
  const assetName = `harnessclaw-engine-runtime-${platform}-${arch}.zip`
  const repo = process.env.HARNESSCLAW_ENGINE_REPO || 'harnessclaw/harnessclaw-engine'
  const runtimeVersion = (process.env.HARNESSCLAW_ENGINE_RUNTIME_VERSION || '').trim()
  const releaseApiUrl = runtimeVersion
    ? `https://api.github.com/repos/${repo}/releases/tags/v${runtimeVersion.replace(/^v/, '')}`
    : `https://api.github.com/repos/${repo}/releases/latest`
  const token = process.env.HARNESSCLAW_ENGINE_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'harnessclaw-runtime-fetcher',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const release = await fetchJson(releaseApiUrl, headers)
  const asset = Array.isArray(release.assets)
    ? release.assets.find((item) => item && item.name === assetName)
    : null
  if (!asset || !asset.browser_download_url) {
    throw new Error(`Asset ${assetName} not found in harnessclaw-engine release ${release.tag_name || '<unknown>'}`)
  }

  const tempRoot = join(os.tmpdir(), `harnessclaw-runtime-${process.pid}-${Date.now()}`)
  const zipPath = join(tempRoot, assetName)
  const extractDir = join(tempRoot, 'extract')
  try {
    mkdirSync(tempRoot, { recursive: true })
    await downloadToFile(asset.browser_download_url, headers, zipPath)
    extractZip(zipPath, extractDir)
    copyRuntimeFiles(extractDir, outputDir, platform)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }

  process.stdout.write(`Downloaded ${asset.name} from ${release.tag_name} to ${outputDir}\n`)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${String(error)}\n`)
    process.exit(1)
  })
}

module.exports = {
  copyRuntimeFiles,
  normalizeArch,
  normalizePlatform,
  removeManagedRuntimeFiles,
}
