'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('marketAPI', {
  request: (action, payload) => ipcRenderer.invoke('market:request', { action, payload }),
});
