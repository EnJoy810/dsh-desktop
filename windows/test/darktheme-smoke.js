// Smoke: verify dark-theme adaptation of the injected background script.
// Light theme -> UI stays transparent (bg image visible), no dark filter.
// Dark theme  -> transparency lifted (UI dark base restored) + bg dim filter.
// Run: ELECTRON_RUN_AS_NODE= ./node_modules/.bin/electron --no-sandbox test/darktheme-smoke.js
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
const m = src.match(/function injectBackgroundCSS\(\) \{[\s\S]*?const js = `\n([\s\S]*?)\n`\n  wc\.executeJavaScript\(js\)/)
if (!m) { console.error('inject block not found'); process.exit(1) }
const injected = m[1]

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } })
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await win.webContents.executeJavaScript(injected)

  const result = await win.webContents.executeJavaScript(`(async () => {
    const out = [];
    const trans = document.getElementById('dsh-bg-trans');
    out.push('transInitialLen=' + (trans ? trans.textContent.length : -1));

    // --- light theme: dark text color ---
    document.documentElement.style.setProperty('--dsw-alias-label-primary', '#1f2329');
    await new Promise(r => setTimeout(r, 1200));   // let interval fire
    out.push('light_transLen=' + trans.textContent.length);
    out.push('light_darkStyle=' + (!!document.getElementById('dsh-bg-dark')));

    // --- dark theme: light text color ---
    document.documentElement.style.setProperty('--dsw-alias-label-primary', '#e6e8ee');
    await new Promise(r => setTimeout(r, 1200));
    out.push('dark_transLen=' + trans.textContent.length);
    const darkSt = document.getElementById('dsh-bg-dark');
    out.push('dark_darkStyleExists=' + (!!darkSt));
    out.push('dark_filter=' + (darkSt ? darkSt.textContent.includes('brightness(0.55)') : 'n/a'));

    // --- back to light ---
    document.documentElement.style.setProperty('--dsw-alias-label-primary', '#1f2329');
    await new Promise(r => setTimeout(r, 1200));
    out.push('light2_transLen=' + trans.textContent.length);
    out.push('light2_darkStyleEmpty=' + (document.getElementById('dsh-bg-dark').textContent === ''));

    return out.join('\\n');
  })()`)
  console.log(result)
  app.quit()
}).catch((e) => { console.error('SMOKE FAIL', e); app.exit(1) })
