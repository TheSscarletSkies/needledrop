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

  // Main window ↔ widgets
  getWidgets: () => ipcRenderer.invoke('widgets:get'),
  setWidgets: (prefs) => ipcRenderer.invoke('widgets:set', prefs),
  broadcast: (state) => ipcRenderer.send('widgets:state', state),
  onRemoteCommand: (cb) => ipcRenderer.on('remote:command', (_e, cmd) => cb(cmd)),
  onWidgetClosed: (cb) => ipcRenderer.on('widgets:closed', (_e, kind) => cb(kind)),

  // Inside a widget window
  onWidgetState: (cb) => ipcRenderer.on('widget:state', (_e, state) => cb(state)),
  widgetCommand: (cmd) => ipcRenderer.send('widget:command', cmd),
});
