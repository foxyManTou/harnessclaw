const { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } = require('fs')
const https = require('https')
const { join, resolve } = require('path')

const bundledVersionPath = join(__dirname, '..', 'resources', 'skills', 'agent-browser', 'VERSION')

function normalizePlatform(platform) {
  if (platform === 'darwin' || platform === 'mac' || platform === 'macos') return 'darwin'
  if (platform === 'linux') return 'linux'
  if (platform === 'linux-musl') return 'linux-musl'
  if (platform === 'win32' || platform === 'windows' || platform === 'win') return 'win32'
  throw new Error(`Unsupported platform: ${platform}`)
}

function normalizeArch(arch) {
  if (arch === 'x64' || arch === 'amd64' || arch === 'x86_64') return 'x64'
  if (arch === 'arm64' || arch === 'aarch64') return 'arm64'
  throw new Error(`Unsupported arch: ${arch}`)
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

function readBundledVersion() {
  if (!existsSync(bundledVersionPath)) {
    throw new Error(`Missing bundled agent-browser version lock at ${bundledVersionPath}`)
  }
  const version = readFileSync(bundledVersionPath, 'utf8').trim()
  if (!version) {
    throw new Error(`Bundled agent-browser version lock is empty at ${bundledVersionPath}`)
  }
  return version
}

async function main() {
  const outputDir = resolve(process.argv[2] || join(__dirname, '..', 'resources', 'bin'))
  const baseName = 'agent-browser'
  const platform = normalizePlatform(process.env.AGENT_BROWSER_PLATFORM || process.platform)
  const arch = normalizeArch(process.env.AGENT_BROWSER_ARCH || process.arch)
  const extension = platform === 'win32' ? '.exe' : ''
  const assetName = `${baseName}-${platform}-${arch}${extension}`
  const repo = process.env.AGENT_BROWSER_REPO || 'vercel-labs/agent-browser'
  const version = (process.env.AGENT_BROWSER_VERSION || readBundledVersion()).trim()
  const releaseApiUrl = version && version !== 'latest'
    ? `https://api.github.com/repos/${repo}/releases/tags/v${version.replace(/^v/, '')}`
    : `https://api.github.com/repos/${repo}/releases/latest`
  const token = process.env.AGENT_BROWSER_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'harnessclaw-agent-browser-fetcher',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const release = await fetchJson(releaseApiUrl, headers)
  const asset = Array.isArray(release.assets)
    ? release.assets.find((item) => item && item.name === assetName)
    : null

  if (!asset || !asset.browser_download_url) {
    throw new Error(`Asset ${assetName} not found in agent-browser release ${release.tag_name || '<unknown>'}`)
  }

  mkdirSync(outputDir, { recursive: true })
  for (const entry of readdirSync(outputDir)) {
    if (entry === 'README.md') continue
    if (entry === baseName || entry.startsWith(`${baseName}-`)) {
      rmSync(join(outputDir, entry), { recursive: true, force: true })
    }
  }

  const targetPath = join(outputDir, assetName)
  await downloadToFile(asset.browser_download_url, headers, targetPath)
  if (platform !== 'win32') {
    chmodSync(targetPath, 0o755)
  }

  process.stdout.write(`Downloaded ${asset.name} from pinned agent-browser ${release.tag_name} to ${targetPath}\n`)
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`)
  process.exit(1)
})
