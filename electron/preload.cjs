const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('needledrop', {
  platform: () => ipcRenderer.invoke('np:platform'),
  nowPlaying: () => ipcRenderer.invoke('np:state'),
  command: (cmd, arg) => ipcRenderer.invoke('np:command', cmd, arg),
  fetchImage: (url) => ipcRenderer.invoke('img:fetch', url),
  fileMeta: (p) => ipcRenderer.invoke('files:meta', p),
  pathForFile: (file) => webUtils.getPathForFile(file),
  pin: (on) => ipcRenderer.invoke('win:pin', on),
  compact: (on) => ipcRenderer.invoke('win:compact', on),
});
