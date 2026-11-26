const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('patterner', {
  platform: process.platform,

  openDialog: () => ipcRenderer.invoke('file:open-dialog'),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  save: (payload) => ipcRenderer.invoke('file:save', payload),
  chooseDirectory: () => ipcRenderer.invoke('file:choose-directory'),
  exportFile: (payload) => ipcRenderer.invoke('file:export', payload),

  /** Real filesystem path of a dropped File (Electron ≥ 32). */
  // system clipboard (works even where navigator.clipboard is unavailable)
  writeClipboard: (text) => ipcRenderer.invoke('clip:write', text),
  readClipboard: () => ipcRenderer.invoke('clip:read'),

  // pattern library
  listLibrary: () => ipcRenderer.invoke('lib:list'),
  saveToLibrary: (payload) => ipcRenderer.invoke('lib:save', payload),
  readFromLibrary: (name) => ipcRenderer.invoke('lib:read', name),
  deleteFromLibrary: (name) => ipcRenderer.invoke('lib:delete', name),
  copyFromLibrary: (payload) => ipcRenderer.invoke('lib:copy', payload),
  revealLibrary: () => ipcRenderer.invoke('lib:reveal'),

  openSvgDialog: () => ipcRenderer.invoke('file:open-svg'),

  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },

  setDirty: (value) => ipcRenderer.send('window:dirty', value),
  setTitle: (title) => ipcRenderer.send('window:title', title),
  quitNow: () => ipcRenderer.send('app:quit-now'),
  cancelQuit: () => ipcRenderer.send('app:cancel-quit'),

  onMenu: (cb) => {
    const handler = (_event, action) => cb(action);
    ipcRenderer.on('menu', handler);
    return () => ipcRenderer.removeListener('menu', handler);
  },

  onOpenPath: (cb) => {
    const handler = (_event, filePath) => cb(filePath);
    ipcRenderer.on('open-path', handler);
    return () => ipcRenderer.removeListener('open-path', handler);
  },
});
