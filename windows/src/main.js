const { app, BrowserWindow, Menu, dialog, nativeImage, shell, ipcMain } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const http = require('http')
const https = require('https')
const os = require('os')

const DSH_PORT = 3080
const DSH_URL = `http://127.0.0.1:${DSH_PORT}`

// ---- quota (SenseNova 调用余量) ----
const QUOTA_CONFIG_PATH = () => path.join(app.getPath('home'), '.dsh', 'snova-quota.json')
const QUOTA_API = 'https://platform.sensenova.cn/lite/console/v1/user/coding-plan/usages'
const QUOTA_REFRESH_MS = 1200 * 1000 // 20 min, mirrors macOS build

let mainWindow = null
let settingsWindow = null
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

// ---- settings (userData/settings.json) ----

const SETTINGS_FILE = 'settings.json'
let appSettings = {}

function settingsFilePath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE)
}

function loadSettings() {
  try {
    appSettings = JSON.parse(fs.readFileSync(settingsFilePath(), 'utf8'))
  } catch {
    appSettings = {}
  }
}

function saveSettingsToDisk() {
  try {
    fs.writeFileSync(settingsFilePath(), JSON.stringify(appSettings, null, 2))
  } catch {}
}

/** The physical key (lowercased, e.g. "f2", "insert") bound to open the
 *  "Change Background…" dialog. null / empty = disabled (Ctrl+B only). */
function bgChangeKey() {
  const k = appSettings.bgChangeKey
  return typeof k === 'string' && k.trim() ? k.trim().toLowerCase() : null
}

ipcMain.handle('settings:get', () => appSettings)

ipcMain.handle('settings:save', (_event, patch) => {
  if (patch && typeof patch === 'object') {
    appSettings = { ...appSettings, ...patch }
    saveSettingsToDisk()
  }
  return appSettings
})

// ---- settings window ----

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return
  }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 400,
    resizable: false,
    minimizable: false,
    title: 'Settings — DeepSeek Harness',
    parent: mainWindow,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  })
  settingsWindow.setMenuBarVisibility(false)
  settingsWindow.on('closed', () => { settingsWindow = null })
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'))
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
    const key = input.key.toLowerCase()
    const wc = mainWindow.webContents
    // physical-key background switcher (bare key, no modifiers)
    if (input.type === 'keyDown' && !input.control && !input.meta && !input.alt) {
      const bk = bgChangeKey()
      if (bk && key === bk) {
        event.preventDefault()
        changeBackground()
        return
      }
    }
    if (!input.control && !input.meta) return
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
    st.textContent = 'body::before { content:"" !important; position:fixed !important; left:0 !important; top:0 !important; width:100vw !important; height:100vh !important; z-index:-1 !important; pointer-events:none !important; background:url("' + dataURI + '") center / cover no-repeat fixed !important; }';
  };
  window.__resetBackground = function() {
    var st = document.getElementById('dsh-bg-custom');
    if (st) { st.textContent = ''; st.remove(); }
  };
  var frost = getOr('dsh-bg-frost');
  frost.textContent = '#root [class$=_sidebarCol] { background: rgba(255,255,255,0.16) !important; background-color: rgba(255,255,255,0.16) !important; backdrop-filter: blur(28px) saturate(170%) !important; -webkit-backdrop-filter: blur(28px) saturate(170%) !important; }';
})();

(function() {
  // ---- 调用余量卡片（SenseNova quota）----
  // 跟随 dsh Web UI 的设置面板（.VOzbGW_overlay / .VOzbGW_options）定位，
  // 用 rAF 跟踪位置；面板关闭时隐藏卡片。
  var MODEL_NAMES = {
    'deepseek-v4-flash': 'DeepSeek V4 Flash',
    'glm-5.2': 'GLM-5.2',
    'sensenova-6.8-flash-lite': 'SenseNova 6.8 Flash Lite',
    'sensenova-u1-fast': 'SenseNova U1 Fast'
  };
  window.__quotaModelNames = MODEL_NAMES;
  window.__quotaRows = [];
  window.__quotaLastRect = '';
  window.__quotaTick = 0;
  window.__quotaRAF = 0;
  window.__quotaExpanded = false;
  window.__quotaColor = function(p) { return p > 60 ? '#3fb27f' : (p > 30 ? '#e8a13c' : '#e05252'); };
  window.__quotaStopFollow = function() {
    if (window.__quotaRAF) { cancelAnimationFrame(window.__quotaRAF); window.__quotaRAF = 0; }
  };
  window.__quotaFollow = function() {
    window.__quotaRAF = 0;
    var overlay = document.querySelector('.VOzbGW_overlay');
    var opts = overlay && overlay.querySelector('.VOzbGW_options');
    var box = document.getElementById('dsh-quota-item');
    if (!opts || !box) return;
    var r = opts.getBoundingClientRect();
    var key = Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width);
    box.style.left = (r.left + 12) + 'px';
    box.style.top = (r.top + 12) + 'px';
    box.style.width = (r.width - 24) + 'px';
    if (key === window.__quotaLastRect) { window.__quotaTick += 1; } else { window.__quotaTick = 0; }
    window.__quotaLastRect = key;
    if (window.__quotaTick < 3) { window.__quotaRAF = requestAnimationFrame(window.__quotaFollow); }
  };
  window.__quotaEnsureItem = function() {
    var overlay = document.querySelector('.VOzbGW_overlay');
    var box = document.getElementById('dsh-quota-item');
    if (!overlay) { if (box) box.style.display = 'none'; return; }
    if (!box) {
      box = document.createElement('div');
      box.id = 'dsh-quota-item';
      box.style.cssText = 'position:fixed;z-index:2147483647;border:1px solid rgba(255,255,255,0.09);border-radius:10px;background:rgba(24,24,27,0.92);font-family:-apple-system,system-ui,sans-serif;';
      document.body.appendChild(box);
      var head = document.createElement('div');
      head.id = 'dsh-quota-head';
      head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 14px;cursor:pointer';
      head.innerHTML = '<div style="display:flex;flex-direction:column;min-width:0"><span style="font-size:13px;font-weight:600;color:#e6e8ee">调用余量</span><span style="font-size:11px;color:#8b90a0">SenseNova 账户按模型余量，自动刷新</span></div><svg id="dsh-quota-chev" width="14" height="14" viewBox="0 0 14 14" fill="none" style="transform:rotate(0deg);transition:transform .15s;flex:none"><path d="M4 5l3 3 3-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      head.addEventListener('click', function() {
        window.__quotaExpanded = !window.__quotaExpanded;
        var body = document.getElementById('dsh-quota-body');
        var chev = document.getElementById('dsh-quota-chev');
        if (!body) return;
        body.style.display = window.__quotaExpanded ? 'block' : 'none';
        chev.style.transform = window.__quotaExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
        if (window.__quotaExpanded) window.__renderQuota(window.__quotaRows);
      });
      box.appendChild(head);
      var body = document.createElement('div');
      body.id = 'dsh-quota-body';
      body.style.cssText = 'display:none;padding:2px 14px 12px';
      box.appendChild(body);
    }
    var opts = overlay.querySelector('.VOzbGW_options');
    if (!opts) { box.style.display = 'none'; window.__quotaStopFollow(); return; }
    box.style.display = 'block';
    window.__quotaFollow();
  };
  window.__renderQuota = function(rows) {
    window.__quotaRows = rows;
    var body = document.getElementById('dsh-quota-body');
    if (!body) return 'nobody';
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var name = MODEL_NAMES[r.n] || r.n;
      var p = Math.max(0, Math.min(100, Number(r.p)));
      var pct = p.toFixed(1);
      var color = window.__quotaColor(p);
      html += '<div style="display:flex;align-items:center;margin-top:10px"><span style="font-size:12px;color:#9aa0ae;width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + name + '</span><div style="flex:1;height:8px;border-radius:4px;background:rgba(255,255,255,0.12);overflow:hidden;margin:0 12px"><div style="height:100%;width:' + p + '%;border-radius:4px;background:' + color + ';transition:width .4s"></div></div><span style="font-size:12px;font-weight:600;color:' + color + ';width:44px;text-align:right">' + pct + '%</span></div>';
    }
    if (body.innerHTML !== html) { body.innerHTML = html; }
    return 'setting-ok';
  };
  window.__quotaEnsureItem();
  new MutationObserver(function() { window.__quotaEnsureItem(); }).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(function() { window.__quotaEnsureItem(); }, 500);
})();

(function() {
  // ---- 深色主题适配：恢复 UI 深色底 + 压暗浅色背景图 ----
  // 浅色主题下 UI 保持透明以显示背景图；深色主题下 UI 恢复自身的深色
  // 背景（避免透出白底），背景图叠加暗化滤镜，整体协调。
  var DARK_FILTER = 'brightness(0.55) saturate(0.92)';
  window.__dshTransCss = (function() {
    var t = document.getElementById('dsh-bg-trans');
    return t ? t.textContent : '';
  })();
  var current = null;

  function luminance(color) {
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
    if (!m) {
      var h = /#([0-9a-f]{6})/i.exec(color);
      if (h) m = [null, parseInt(h[1].slice(0, 2), 16), parseInt(h[1].slice(2, 4), 16), parseInt(h[1].slice(4, 6), 16)];
    }
    if (!m) return null;
    return 0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3];
  }

  var themeProbe = null;
  function themeIsDark() {
    // 文字主色探针：浅色主题=深色文字（低亮度），深色主题=浅色文字（高亮度）。
    // 变量定义可能在深层组件，探针挂到 body 下继承，直接读计算后的颜色。
    try {
      if (!themeProbe || !themeProbe.isConnected) {
        themeProbe = document.createElement('div');
        themeProbe.id = 'dsh-theme-probe';
        themeProbe.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;visibility:hidden;';
        themeProbe.style.color = 'var(--dsw-alias-label-primary)';
        (document.body || document.documentElement).appendChild(themeProbe);
      }
      var lum = luminance(getComputedStyle(themeProbe).color);
      if (lum !== null) return lum > 140;
    } catch (e) {}
    // 兜底：跟随系统深浅色
    try { return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); } catch (e2) { return false; }
  }

  function applyBgDark() {
    var dark = themeIsDark();
    if (dark === current) return;
    current = dark;
    var trans = document.getElementById('dsh-bg-trans');
    var darkSt = document.getElementById('dsh-bg-dark');
    if (dark) {
      if (trans) trans.textContent = '';  // UI 恢复自身深色底
      if (!darkSt) {
        darkSt = document.createElement('style');
        darkSt.id = 'dsh-bg-dark';
        document.documentElement.appendChild(darkSt);
      }
      darkSt.textContent = 'body::before { filter: ' + DARK_FILTER + ' !important; }';
    } else {
      if (trans && window.__dshTransCss) trans.textContent = window.__dshTransCss;  // 恢复透明
      if (darkSt) darkSt.textContent = '';
    }
    window.__dshTheme = dark ? 'dark' : 'light';
  }

  applyBgDark();
  new MutationObserver(function() { applyBgDark(); }).observe(
    document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'data-theme'] }
  );
  setInterval(applyBgDark, 1000);
})();
`
  wc.executeJavaScript(js).catch(() => {})
}

// ---- quota (SenseNova 调用余量) ----

function quotaConfig() {
  try {
    return JSON.parse(fs.readFileSync(QUOTA_CONFIG_PATH(), 'utf8'))
  } catch {
    return null
  }
}

/** Push quota rows into the injected card; retry until the UI body exists. */
function pushQuotaToUI(rows, attempt) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const js = `window.__renderQuota ? window.__renderQuota([${rows}]) : 'nofn'`
  mainWindow.webContents.executeJavaScript(js)
    .then((res) => {
      if (res === 'nobody' && attempt < 10) {
        setTimeout(() => pushQuotaToUI(rows, attempt + 1), 1500)
      }
    })
    .catch(() => {
      // page not ready yet
      if (attempt < 10) setTimeout(() => pushQuotaToUI(rows, attempt + 1), 1500)
    })
}

function fetchQuota() {
  const cfg = quotaConfig()
  if (!cfg || !cfg.token || !cfg.account_id ||
      !Array.isArray(cfg.models) || cfg.models.length === 0) {
    logLine('[quota] config missing, skip')
    return
  }
  let url
  try {
    url = new URL(QUOTA_API)
    url.searchParams.set('account_id', String(cfg.account_id))
    cfg.models.forEach((m) => url.searchParams.append('model_ids', m))
  } catch (e) {
    logLine('[quota] url error ' + String(e))
    return
  }
  const req = https.get(url, { headers: { Authorization: 'Bearer ' + cfg.token } }, (res) => {
    let raw = ''
    res.on('data', (d) => { raw += d })
    res.on('end', () => {
      try {
        const j = JSON.parse(raw)
        const pct = j && j.model_remaining_percent
        if (!pct || typeof pct !== 'object') {
          logLine(`[quota] parse failed status=${res.statusCode}`)
          return
        }
        const rows = Object.entries(pct).map(([n, v]) => `{n:'${n}',p:${Number(v)}}`).join(',')
        logLine(`[quota] got ${Object.keys(pct).length} models`)
        pushQuotaToUI(rows, 1)
      } catch (e) {
        logLine('[quota] parse error ' + String(e))
      }
    })
  })
  req.setTimeout(15000, () => req.destroy())
  req.on('error', (e) => logLine('[quota] request error ' + String(e)))
}

function startQuotaRefresher() {
  fetchQuota()
  setInterval(fetchQuota, QUOTA_REFRESH_MS)
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
      label: 'Settings',
      submenu: [
        {
          label: 'Settings…',
          accelerator: 'Ctrl+,',
          click: () => openSettings()
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        ...listDefaultBackgrounds().map((e) => ({
          label: `Default Background > 🐋 奶鲸 ${e.n}`,
          click: () => setDefaultBackground(e.n)
        })),
        { type: 'separator' },
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

function listDefaultBackgrounds() {
  const dir = path.join(process.resourcesPath, 'vendor', 'backgrounds')
  try {
    return fs.readdirSync(dir)
      .filter((f) => /^bg-\d+\.jpg$/.test(f))
      .sort()
      .map((f) => ({ n: f.replace(/^bg-(\d+)\.jpg$/, '$1'), file: path.join(dir, f) }))
  } catch {
    return []
  }
}

function setDefaultBackground(n) {
  const entry = listDefaultBackgrounds().find((e) => e.n === n)
  if (!entry) return
  let data
  try { data = fs.readFileSync(entry.file) } catch { return }
  try {
    fs.writeFileSync(backgroundCachePath(), data)
  } catch {}
  applyBackgroundToWindow(data, true)
}

// ---- lifecycle ----

app.whenReady().then(() => {
  loadSettings()
  buildMenu()
  createWindow()
  startServerIfNeeded()
  startQuotaRefresher()

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
