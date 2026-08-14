// Preload: audited native bridge. contextIsolation stays on; everything the
// renderer may touch goes through this single, minimal surface.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshDesktop', {
  platform: process.platform,
  // settings (settings window)
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch)
})
