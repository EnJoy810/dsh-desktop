// Preload: currently a no-op bridge placeholder. Kept so contextIsolation stays on
// and future native bridge calls have a single, audited entry point.
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('dshDesktop', {
  platform: process.platform
})
