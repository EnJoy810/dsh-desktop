// Smoke: verify the injected quota-card script against a minimal DOM that
// mimics the dsh Web UI settings panel (.VOzbGW_overlay > .VOzbGW_options).
// Run: ELECTRON_RUN_AS_NODE= ./node_modules/.bin/electron --no-sandbox test/quota-ui-smoke.js
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
const m = src.match(/function injectBackgroundCSS\(\) \{[\s\S]*?const js = `\n([\s\S]*?)\n`\n  wc\.executeJavaScript\(js\)/)
if (!m) { console.error('inject block not found'); process.exit(1) }
const injected = m[1]

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } })
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <div class="VOzbGW_overlay" style="position:fixed;inset:0;z-index:1000">
      <div class="VOzbGW_options" style="position:absolute;top:80px;left:200px;width:600px;height:500px"></div>
    </div>
  </body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await win.webContents.executeJavaScript(injected)
  const result = await win.webContents.executeJavaScript(`(async () => {
    const out = [];
    const box = document.getElementById('dsh-quota-item');
    out.push('cardCreated=' + (!!box));
    out.push('cardDisplay=' + (box ? box.style.display : 'n/a'));
    out.push('cardPosition=' + (box ? box.style.left + ',' + box.style.top + ',' + box.style.width : 'n/a'));
    const r = window.__renderQuota([{n:'deepseek-v4-flash',p:87.5},{n:'glm-5.2',p:35},{n:'sensenova-6.8-flash-lite',p:10}]);
    out.push('render=' + r);
    const body = document.getElementById('dsh-quota-body');
    out.push('rowDivs=' + ((body.innerHTML.match(/<div/g) || []).length));
    out.push('hasModelName=' + body.innerHTML.includes('DeepSeek V4 Flash'));
    out.push('hasPct=' + body.innerHTML.includes('87.5%'));
    out.push('colorHigh=' + body.innerHTML.includes('#3fb27f'));
    out.push('colorMid=' + body.innerHTML.includes('#e8a13c'));
    out.push('colorLow=' + body.innerHTML.includes('#e05252'));
    // click head toggles expand
    document.getElementById('dsh-quota-head').click();
    out.push('expandedAfterClick=' + (document.getElementById('dsh-quota-body').style.display));
    document.getElementById('dsh-quota-head').click();
    out.push('collapsedAfterClick=' + (document.getElementById('dsh-quota-body').style.display));
    // removing the panel hides the card
    document.querySelector('.VOzbGW_overlay').remove();
    window.__quotaEnsureItem();
    out.push('hiddenAfterPanelClose=' + (document.getElementById('dsh-quota-item').style.display));
    return out.join('\\n');
  })()`)
  console.log(result)
  app.quit()
}).catch((e) => { console.error('SMOKE FAIL', e); app.exit(1) })
