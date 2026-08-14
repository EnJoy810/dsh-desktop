const { app, BrowserWindow, Menu, dialog, nativeImage, shell } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const http = require('http')
const os = require('os')

const DSH_PORT = 3080
const DSH_URL = `http://127.0.0.1:${DSH_PORT}`

let mainWindow = null
let serverProcess = null

// ---- logging (works even when the server window is blank) ----

function logPath() {
  return path.join(app.getPath('userData'), 'dsh-server.log')
}
function logLine(msg) {
  try {
    fs.appendFileSync(logPath(), `[${new Date().toISOString()}] ${msg}\n`)
  } catch {}
}

// ---- dsh web server lifecycle (portable) ----

function vendorRoot() {
  return path.join(process.resourcesPath, 'vendor')
}

function resolveVendorDshBin() {
  // bundled with the app: resources/vendor/node_modules/@deepseek-ai/dsh/lib/bin.js
  const p = path.join(vendorRoot(), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  return fs.existsSync(p) ? p : null
}

function resolveCachedDshBin() {
  // fallback: npx cache (~/.npm/_npx/.../@deepseek-ai/dsh/lib/bin.js)
  const cacheBase = path.join(app.getPath('home'), '.npm', '_npx')
  try {
    const entries = fs.readdirSync(cacheBase)
    const candidates = entries
      .map((e) => path.join(cacheBase, e, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
      .filter((p) => fs.existsSync(p))
      .sort()
    return candidates.length ? candidates[candidates.length - 1] : null
  } catch {
    return null
  }
}

/** First run on a clean machine: create ~/.dsh and seed settings.yaml + profiles. */
function ensureDshHome() {
  const home = app.getPath('home')
  const dshHome = path.join(home, '.dsh')
  try {
    if (!fs.existsSync(dshHome)) fs.mkdirSync(dshHome, { recursive: true })
    const settingsPath = path.join(dshHome, 'settings.yaml')
    if (!fs.existsSync(settingsPath)) {
      const bundled = path.join(vendorRoot(), 'dsh-config', 'settings.yaml')
      if (fs.existsSync(bundled)) {
        fs.copyFileSync(bundled, settingsPath)
        logLine('seeded ~/.dsh/settings.yaml from bundled template')
      }
    }
    // profiles/ (web, headless) are required for `dsh web` to boot
    const profilesPath = path.join(dshHome, 'profiles')
    if (!fs.existsSync(profilesPath)) {
      const bundledProfiles = path.join(vendorRoot(), 'dsh-config', 'profiles')
      if (fs.existsSync(bundledProfiles)) {
        fs.cpSync(bundledProfiles, profilesPath, { recursive: true })
        logLine('seeded ~/.dsh/profiles from bundled template')
      }
    }
  } catch (err) {
    logLine('ensureDshHome error: ' + String(err))
  }
}

function checkPort(done) {
  const req = http.get(DSH_URL, (res) => {
    res.destroy()
    done(res.statusCode >= 200 && res.statusCode < 300)
  })
  req.setTimeout(3000, () => { req.destroy(); done(false) })
  req.on('error', () => done(false))
}

function spawnServer() {
  let dshBin = resolveVendorDshBin()
  let mode = 'bundled'
  if (!dshBin) {
    dshBin = resolveCachedDshBin()
    mode = 'npx-cache'
  }
  const args = dshBin ? [dshBin, 'web', '--port', String(DSH_PORT)]
                      : ['npx', '-y', '@deepseek-ai/dsh', 'web', '--port', String(DSH_PORT)]
  const logFd = fs.openSync(logPath(), 'a')
  logLine(`spawn dsh (${mode}) args=${args.join(' ')}`)
  // Run Electron's own binary as a Node runtime when a bundled dsh is used,
  // so the end user does not need Node.js installed.
  const runAsNode = dshBin ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env
  const executable = dshBin ? process.execPath : 'node'
  serverProcess = spawn(executable, args, {
    env: runAsNode,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true
  })
  serverProcess.on('error', (err) => {
    logLine('spawn error: ' + String(err))
  })
  serverProcess.on('exit', (code, sig) => {
    logLine(`dsh server exited code=${code} sig=${sig}`)
  })
}

function startServerIfNeeded() {
  checkPort((reachable) => {
    if (reachable) {
      logLine('port already serving, loading UI')
      loadWebUI()
      return
    }
    ensureDshHome()
    spawnServer()
    let tries = 0
    const poll = () => {
      tries += 1
      checkPort((ok) => {
        if (ok) { logLine(`server ready after ${tries}s`); loadWebUI(); return }
        if (tries > 90) {
          logLine('server did not become ready in time')
          loadErrorPage('dsh server did not start in time. See ' + logPath())
          return
        }
        setTimeout(poll, 1000)
      })
    }
    poll()
  })
}

// ---- background helpers ----

function backgroundCachePath() {
  return path.join(app.getPath('userData'), 'background.jpg')
}

function applyBackgroundToWindow(fileData, isJPEG) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const b64 = fileData.toString('base64')
  const mime = isJPEG ? 'image/jpeg' : 'image/png'
  const js = `window.__setBackground && window.__setBackground('data:${mime};base64,${b64}')`
  mainWindow.webContents.executeJavaScript(js).catch(() => {})
}

function loadPersistedBackground() {
  const p = backgroundCachePath()
  if (!fs.existsSync(p)) return
  applyBackgroundToWindow(fs.readFileSync(p), true)
}

// ---- window ----

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'DeepSeek Harness',
    backgroundColor: '#ffffff',
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })

  mainWindow.webContents.on('did-finish-load', () => {
    injectBackgroundCSS()
    loadPersistedBackground()
  })

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    if (url === DSH_URL) {
      logLine(`did-fail-load ${code} ${desc}`)
      loadErrorPage(`Failed to load ${DSH_URL} (${code} ${desc}).\nLog: ${logPath()}`)
    }
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!input.control && !input.meta) return
    const key = input.key.toLowerCase()
    const wc = mainWindow.webContents
    if (key === '=' || key === '+') {
      wc.setZoomFactor(Math.min(wc.getZoomFactor() + 0.1, 3.0)); event.preventDefault()
    } else if (key === '-') {
      wc.setZoomFactor(Math.max(wc.getZoomFactor() - 0.1, 0.5)); event.preventDefault()
    } else if (key === '0') {
      wc.setZoomFactor(1.0); event.preventDefault()
    }
  })

  mainWindow.loadURL(DSH_URL)
}

function loadErrorPage(message) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>DeepSeek Harness</title>
<style>body{font-family:system-ui,sans-serif;background:#f5f6f7;color:#333;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:32px 40px;max-width:560px;box-shadow:0 4px 20px rgba(0,0,0,.06)}
h1{font-size:18px;margin:0 0 12px}pre{white-space:pre-wrap;font-size:13px;background:#fafafa;border:1px solid #eee;border-radius:8px;padding:12px;max-height:220px;overflow:auto}
p{font-size:13px;color:#666;line-height:1.6}</style></head><body>
<div class="card"><h1>DeepSeek Harness 启动失败</h1><pre>${message.replace(/</g, '&lt;')}</pre>
<p>日志文件：<code>${logPath().replace(/</g, '&lt;')}</code><br>
按 <b>Ctrl+Shift+I</b> 打开开发者工具查看更多信息；<b>Ctrl+R</b> 重试。</p></div></body></html>`
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
}

function injectBackgroundCSS() {
  const wc = mainWindow.webContents
  const js = `
(function() {
  var getOr = function(id) {
    var st = document.getElementById(id);
    if (!st) { st = document.createElement('style'); st.id = id; document.documentElement.appendChild(st); }
    return st;
  };
  var trans = getOr('dsh-bg-trans');
  trans.textContent = 'html, body { --dsw-alias-bg-base: transparent !important; } #root { background: transparent !important; } #root [class$=_frame], #root [class$=_root], #root [class$=_sidebarCol] { background: transparent !important; background-color: transparent !important; } #root [class*=_hHd-Xa_] { background: transparent !important; }';

  window.__setBackground = function(dataURI) {
    var st = getOr('dsh-bg-custom');
    st.textContent = 'body::before { content:"" !important; position:fixed !important; left:0 !important; top:0 !important; width:100vw !important; height:100vh !important; z-index:-1 !important; pointer-events:none !important; background:url("' + dataURI + '") center / contain no-repeat fixed !important; }';
  };
  window.__resetBackground = function() {
    var st = document.getElementById('dsh-bg-custom');
    if (st) { st.textContent = ''; st.remove(); }
  };
  var frost = getOr('dsh-bg-frost');
  frost.textContent = '#root [class$=_sidebarCol] { background: rgba(255,255,255,0.16) !important; background-color: rgba(255,255,255,0.16) !important; backdrop-filter: blur(28px) saturate(170%) !important; -webkit-backdrop-filter: blur(28px) saturate(170%) !important; }';
})();
`
  wc.executeJavaScript(js).catch(() => {})
}

// ---- menu ----

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Change Background…',
          accelerator: 'Ctrl+B',
          click: () => changeBackground()
        },
        {
          label: 'Reset Background',
          click: () => resetBackground()
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function changeBackground() {
  const win = mainWindow
  dialog.showOpenDialog(win, {
    title: 'Choose a background image',
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'heic', 'tiff', 'webp', 'bmp', 'gif'] }
    ]
  }).then(({ canceled, filePaths }) => {
    if (canceled || !filePaths.length) return
    const src = filePaths[0]
    let img = nativeImage.createFromPath(src)
    if (img.isEmpty()) {
      dialog.showErrorBox('Invalid image', 'Could not read the selected image.')
      return
    }
    const maxDim = 1920
    const size = img.getSize()
    if (size.width > maxDim || size.height > maxDim) {
      const scale = maxDim / Math.max(size.width, size.height)
      img = img.resize({ width: Math.round(size.width * scale) })
    }
    const jpeg = img.toJPEG(85)
    fs.writeFileSync(backgroundCachePath(), jpeg)
    applyBackgroundToWindow(jpeg, true)
  }).catch(() => {})
}

function resetBackground() {
  try { fs.unlinkSync(backgroundCachePath()) } catch {}
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.executeJavaScript(
      'window.__resetBackground && window.__resetBackground();'
    ).catch(() => {})
  }
}

// ---- lifecycle ----

app.whenReady().then(() => {
  buildMenu()
  createWindow()
  startServerIfNeeded()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null }
})
