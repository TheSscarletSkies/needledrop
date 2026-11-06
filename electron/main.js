// Needledrop — Electron main process.
// Serves the built renderer over http://127.0.0.1 (YouTube embeds refuse file:// origins),
// and exposes a small IPC surface: now-playing from the OS media player, file metadata, image fetching,
// desktop widgets, and capture of the window's own audio so the speakers can move with the music.
import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as nowPlaying from './nowplaying.js';
import { Widgets } from './widgets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
let win;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2',
};

function serveDist() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = path.normalize(path.join(DIST, urlPath));
      if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

let baseUrl;
const PRELOAD = path.join(__dirname, 'preload.cjs');
const widgets = new Widgets({
  preload: PRELOAD,
  getBaseUrl: () => baseUrl,
  onClosed: (kind) => win?.webContents.send('widgets:closed', kind),
});

// macOS gets the inset traffic lights over the scene; Windows and Linux keep their native title bar.
const chrome = process.platform === 'darwin'
  ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } }
  : { autoHideMenuBar: true };

async function createWindow() {
  win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 420,
    minHeight: 360,
    ...chrome,
    backgroundColor: '#16120f',
    title: 'Needledrop',
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  // External links open in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  // Widgets mirror the main window's playback, so they go away with it (and come back with it).
  win.on('closed', () => { win = null; widgets.closeAll(); });
  baseUrl ||= process.env.VITE_DEV_SERVER_URL || (await serveDist());
  await win.loadURL(baseUrl);
  widgets.quitting = false;
  widgets.set(widgets.getPrefs());
}

// The speakers listen to this window's own audio (YouTube and local files). getDisplayMedia is
// answered with the page itself, so no screen is shared and no screen-recording permission is needed.
// On Windows, system loopback is available, so the speakers also hear Spotify and anything else.
function allowOwnAudioCapture() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!request.frame) return callback(null);
    callback({
      video: request.frame,
      audio: process.platform === 'win32' ? 'loopback' : request.frame,
      enableLocalEcho: true,
    });
  });
}

// ---- IPC ----------------------------------------------------------------

ipcMain.handle('np:platform', () => process.platform);
ipcMain.handle('np:state', () => nowPlaying.getState());
ipcMain.handle('np:command', (_e, cmd, arg) => nowPlaying.command(cmd, arg));

ipcMain.handle('img:fetch', async (_e, url) => fetchAsDataUrl(url));

ipcMain.handle('files:meta', async (_e, filePath) => {
  const { parseFile } = await import('music-metadata');
  try {
    const m = await parseFile(filePath, { duration: true });
    const pic = m.common.picture?.[0];
    return {
      title: m.common.title || path.basename(filePath, path.extname(filePath)),
      artist: m.common.artist || '',
      album: m.common.album || '',
      duration: m.format.duration || 0,
      art: pic ? `data:${pic.format};base64,${Buffer.from(pic.data).toString('base64')}` : null,
    };
  } catch {
    return { title: path.basename(filePath, path.extname(filePath)), artist: '', album: '', duration: 0, art: null };
  }
});

ipcMain.handle('widgets:get', () => widgets.getPrefs());
ipcMain.handle('widgets:set', (_e, prefs) => widgets.set(prefs));
ipcMain.on('widgets:state', (_e, state) => widgets.broadcast(state));
ipcMain.on('widget:command', (e, cmd, arg) => {
  if (cmd === 'open') { if (win) { win.show(); win.focus(); } else createWindow(); return; }
  if (cmd === 'close') { BrowserWindow.fromWebContents(e.sender)?.close(); return; }
  win?.webContents.send('remote:command', cmd, arg);
});
ipcMain.on('widget:moveTo', (e, x, y) => BrowserWindow.fromWebContents(e.sender)?.setPosition(x, y));

ipcMain.handle('win:pin', (_e, on) => { if (!win) return false; win.setAlwaysOnTop(!!on, 'floating'); return win.isAlwaysOnTop(); });
ipcMain.handle('win:compact', (_e, on) => {
  if (!win) return;
  if (on) { win.setSize(440, 420, true); } else { win.setSize(1080, 760, true); }
});

const imgCache = new Map();
export async function fetchAsDataUrl(url) {
  if (!url) return null;
  if (imgCache.has(url)) return imgCache.get(url);
  try {
    if (url.startsWith('file://')) {
      // Linux players (MPRIS) often hand out cover art as local files.
      const file = fileURLToPath(url);
      const ext = path.extname(file).slice(1).toLowerCase();
      const data = `data:image/${ext === 'jpg' ? 'jpeg' : ext || 'jpeg'};base64,${fs.readFileSync(file).toString('base64')}`;
      imgCache.set(url, data);
      return data;
    }
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await res.arrayBuffer());
    const data = `data:${type};base64,${buf.toString('base64')}`;
    imgCache.set(url, data);
    return data;
  } catch {
    return null;
  }
}
nowPlaying.setImageFetcher(fetchAsDataUrl);

app.setName('Needledrop');
app.setAboutPanelOptions({
  applicationName: 'Needledrop',
  applicationVersion: app.getVersion(),
  copyright: 'MIT License',
  credits: 'A 3D turntable for Spotify, Apple Music, YouTube and your own files.',
});

app.whenReady().then(() => { allowOwnAudioCapture(); createWindow(); });
app.on('before-quit', () => widgets.closeAll());
// Mac convention: closing the window keeps the app in the Dock; clicking the Dock icon brings it back.
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!win) createWindow(); });
