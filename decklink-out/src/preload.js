'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('decklinkOut', {
  sendFrameRgba: (uint8Array) => {
    ipcRenderer.send('decklink-frame-rgba', uint8Array);
  },
});
