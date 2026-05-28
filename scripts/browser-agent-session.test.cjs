const test = require('node:test')
const assert = require('node:assert/strict')

const {
  BrowserAgentSessionManager,
  createRemoteDebuggingTargetResolver,
} = require('../out/main/browser-agent-session.js')

class FakeWindow {
  constructor(id, options) {
    this.id = id
    this.options = options
    this.loaded = []
    this.visible = false
    this.focused = false
    this.destroyed = false
  }

  async loadURL(url) {
    this.loaded.push(url)
  }

  show() {
    this.visible = true
  }

  focus() {
    this.focused = true
  }

  destroy() {
    this.destroyed = true
  }

  isDestroyed() {
    return this.destroyed
  }
}

test('creates isolated browser session without navigating away from the CDP marker', async () => {
  let nextId = 41
  const windows = []
  const manager = new BrowserAgentSessionManager({
    createWindow(options) {
      const win = new FakeWindow(nextId++, options)
      windows.push(win)
      return win
    },
    async resolveCDPEndpoint(markerURL) {
      assert.match(markerURL, /^about:blank#harnessclaw-browser-session=/)
      return 'ws://127.0.0.1:9222/devtools/page/page-41'
    },
    createSessionID() {
      return 'sess_test_1'
    },
  })

  const result = await manager.createSession({
    start_url: 'https://example.com',
    visibility: 'visible',
    task_id: 'task A',
  })

  assert.equal(result.session_id, 'sess_test_1')
  assert.equal(result.window_id, '41')
  assert.equal(result.cdp_endpoint, 'ws://127.0.0.1:9222/devtools/page/page-41')
  assert.equal(result.partition, 'persist:browser-agent-task-A')
  assert.equal(windows[0].options.webPreferences.sandbox, true)
  assert.equal(windows[0].options.webPreferences.contextIsolation, true)
  assert.equal(windows[0].options.webPreferences.nodeIntegration, false)
  assert.equal(windows[0].options.webPreferences.partition, 'persist:browser-agent-task-A')
  assert.equal(windows[0].loaded[0], 'about:blank#harnessclaw-browser-session=sess_test_1')
  assert.equal(windows[0].loaded.length, 1)
  assert.equal(windows[0].visible, true)
  assert.equal(windows[0].focused, true)
})

test('closes tracked browser session', async () => {
  const win = new FakeWindow(7, {})
  const manager = new BrowserAgentSessionManager({
    createWindow() {
      return win
    },
    async resolveCDPEndpoint() {
      return 'ws://127.0.0.1:9222/devtools/page/page-7'
    },
    createSessionID() {
      return 'sess_close'
    },
  })

  await manager.createSession({})
  const result = manager.closeSession({ session_id: 'sess_close' })

  assert.equal(result.closed, true)
  assert.equal(win.destroyed, true)
  assert.equal(manager.getSession('sess_close'), undefined)
})

test('defaults new browser session to visible and rejects non-http start URL', async () => {
  const win = new FakeWindow(9, {})
  const manager = new BrowserAgentSessionManager({
    createWindow(options) {
      win.options = options
      return win
    },
    async resolveCDPEndpoint() {
      return 'ws://127.0.0.1:9222/devtools/page/page-9'
    },
    createSessionID() {
      return 'sess_hidden'
    },
  })

  const result = await manager.createSession({})
  assert.equal(result.visible, true)
  assert.equal(win.options.show, true)
  assert.equal(win.visible, true)
  assert.equal(win.focused, true)

  await assert.rejects(
    () => manager.createSession({ start_url: 'file:///etc/passwd' }),
    /start_url scheme must be http or https/,
  )
})

test('shows window for human takeover', async () => {
  const win = new FakeWindow(8, {})
  const manager = new BrowserAgentSessionManager({
    createWindow() {
      return win
    },
    async resolveCDPEndpoint() {
      return 'ws://127.0.0.1:9222/devtools/page/page-8'
    },
    createSessionID() {
      return 'sess_human'
    },
  })

  await manager.createSession({})
  const result = manager.askHuman({ session_id: 'sess_human', message: 'Please solve captcha' })

  assert.equal(result.status, 'shown')
  assert.equal(win.visible, true)
  assert.equal(win.focused, true)
})

test('remote debugging resolver selects target by marker URL', async () => {
  const resolver = createRemoteDebuggingTargetResolver(9333, async (url) => {
    assert.equal(url, 'http://127.0.0.1:9333/json/list')
    return {
      ok: true,
      async json() {
        return [
          { url: 'https://example.com', webSocketDebuggerUrl: 'ws://wrong' },
          {
            url: 'about:blank#harnessclaw-browser-session=sess_target',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/target',
          },
        ]
      },
    }
  }, { retries: 1, delayMs: 1 })

  const endpoint = await resolver('about:blank#harnessclaw-browser-session=sess_target')
  assert.equal(endpoint, 'ws://127.0.0.1:9333/devtools/page/target')
})
