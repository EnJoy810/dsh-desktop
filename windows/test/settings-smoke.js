// Smoke test: load src/settings.html in a hidden window and verify the
// physical-key capture logic (normalize / bind / escape / modifier ignore).
// Run: ./node_modules/.bin/electron test/settings-smoke.js
const { app, BrowserWindow } = require('electron')
const path = require('path')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '..', 'src', 'preload.js')
    }
  })
  await win.loadFile(path.join(__dirname, '..', 'src', 'settings.html'))
  const js = `(async () => {
    const out = [];
    const disp = document.getElementById('keyDisplay');
    const bindBtn = document.getElementById('bindBtn');
    const clearBtn = document.getElementById('clearBtn');
    const press = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

    out.push('initial=' + disp.textContent + '|clearDisabled=' + clearBtn.disabled);

    bindBtn.click();
    out.push('capturingBtn=' + bindBtn.textContent);
    press('F2');
    out.push('afterF2=' + disp.textContent + '|capturingAfter=' + bindBtn.textContent + '|clearDisabled=' + clearBtn.disabled);

    bindBtn.click();
    press('Escape');
    out.push('afterEsc=' + disp.textContent);

    bindBtn.click();
    press('PageDown');
    out.push('afterPageDown=' + disp.textContent);

    bindBtn.click();
    press('Shift');            // bare modifier must be ignored
    out.push('afterModifier=' + bindBtn.textContent + '|' + disp.textContent);

    bindBtn.click();
    press('a');                // letter key binds
    out.push('afterLetter=' + disp.textContent);

    clearBtn.click();
    out.push('afterClear=' + disp.textContent + '|clearDisabled=' + clearBtn.disabled);
    return out.join('\\n');
  })()`
  const result = await win.webContents.executeJavaScript(js)
  console.log(result)
  app.quit()
}).catch((err) => { console.error('SMOKE FAIL:', err); app.exit(1) })
