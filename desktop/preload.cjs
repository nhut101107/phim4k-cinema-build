const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('Phim4KSecureSession', Object.freeze({
  get: () => ipcRenderer.invoke('phim4k:session:get'),
  set: ({ value } = {}) => ipcRenderer.invoke('phim4k:session:set', { value }),
  clear: () => ipcRenderer.invoke('phim4k:session:clear'),
}));
