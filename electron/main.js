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
let winReady = false;

// Audio files opened with Needledrop: double-click / Open With / dropped on the Dock (macOS 'open-file'),
// or passed on the command line (Windows, Linux). They're queued until the window can take them.
const AUDIO_EXT = /\.(mp3|m4a|aac|flac|wav|ogg|opus|aiff?)$/i;
let pendingFiles = [];
// Folders become their audio files: recursive, natural order (01, 02 … 10), hidden files skipped.
async function expandPaths(paths, limit = 5000) {
  const out = [];
  const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  async function walk(p, depth) {
    if (out.length >= limit) return;
    let st;
    try { st = await fs.promises.stat(p); } catch { return; }
    if (st.isDirectory()) {
      if (depth > 6) return;
      let names = [];
      try { names = await fs.promises.readdir(p); } catch { return; }
      for (const n of names.filter((n) => !n.startsWith('.')).sort(natural)) await walk(path.join(p, n), depth + 1);
    } else if (AUDIO_EXT.test(p)) {
      out.push(p);
    }
  }
  for (const p of paths) await walk(p, 0);
  return out;
}

async function openFiles(paths) {
  const files = await expandPaths(paths.filter((p) => !p.startsWith('-')));
  if (!files.length) return;
  if (win && winReady) {
    win.webContents.send('files:open', files);
    win.show();
    win.focus();
  } else {
    pendingFiles.push(...files);
    if (app.isReady() && !win) createWindow();
  }
}
app.on('open-file', (e, file) => { e.preventDefault(); openFiles([file]); });
// Windows / Linux pass files and folders on the command line.
if (process.platform !== 'darwin') openFiles(process.argv.slice(app.isPackaged ? 1 : 2));
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  openFiles(argv.slice(1));
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

const PRELOAD = path.join(__dirname, 'preload.cjs');

// ---- security ----------------------------------------------------------------------------------
// Needledrop windows only ever show Needledrop's own pages. The YouTube player is a cross-origin iframe
// and never gets the preload API; these rules make sure nothing can swap the page out from under it.
const isOwnUrl = (url) => {
  try { return !!baseUrl && new URL(url).origin === new URL(baseUrl).origin; } catch { return false; }
};
app.on('web-contents-created', (_e, contents) => {
  const block = (e, url) => { if (!isOwnUrl(url)) e.preventDefault(); };
  contents.on('will-navigate', block);
  contents.on('will-redirect', block);
  contents.on('will-attach-webview', (e) => e.preventDefault());
  // Links that try to open a window go to the browser, and only if they're ordinary web links.
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
});
// Deny every permission (camera, mic, notifications, location…) except what our own pages need:
// capture of the app's own audio for the speakers, and full screen. No microphone or camera.
const ALLOWED = new Set(['display-capture', 'fullscreen']);
function lockDownPermissions() {
  const s = session.defaultSession;
  s.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(ALLOWED.has(permission) && details?.isMainFrame !== false && isOwnUrl(details?.requestingUrl || wc.getURL()));
  });
  s.setPermissionCheckHandler((_wc, permission, origin, details) => ALLOWED.has(permission) && details?.isMainFrame !== false && isOwnUrl(origin));
}
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
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());

  // Widgets mirror the main window's playback, so they go away with it (and come back with it).
  win.on('closed', () => { win = null; winReady = false; widgets.closeAll(); });
  baseUrl ||= process.env.VITE_DEV_SERVER_URL || (await serveDist());
  await win.loadURL(baseUrl);
  winReady = true;
  if (pendingFiles.length) { win.webContents.send('files:open', pendingFiles); pendingFiles = []; }
  widgets.quitting = false;
  widgets.set(widgets.getPrefs());
}

// The speakers listen to this window's own audio (YouTube and local files). getDisplayMedia is
// answered with the page itself, so no screen is shared and no screen-recording permission is needed.
// On Windows, system loopback is available, so the speakers also hear Spotify and anything else.
function allowOwnAudioCapture() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    // Only Needledrop's own top-level page may capture, and only itself.
    if (!request.frame || request.frame.parent || !isOwnUrl(request.frame.url)) return callback(null);
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

ipcMain.handle('files:expand', (_e, paths) => expandPaths(Array.isArray(paths) ? paths : []));
ipcMain.handle('files:read', (_e, filePath) => (AUDIO_EXT.test(filePath) ? fs.promises.readFile(filePath) : null));

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
      // Linux players (MPRIS) often hand out cover art as local files. Images only.
      const file = fileURLToPath(url);
      const ext = path.extname(file).slice(1).toLowerCase();
      if (!['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) return null;
      const data = `data:image/${ext === 'jpg' ? 'jpeg' : ext || 'jpeg'};base64,${fs.readFileSync(file).toString('base64')}`;
      imgCache.set(url, data);
      return data;
    }
    if (!/^https?:\/\//i.test(url)) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || 'image/jpeg';
    if (!type.startsWith('image/')) return null;
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

app.whenReady().then(() => { lockDownPermissions(); allowOwnAudioCapture(); createWindow(); });
app.on('before-quit', () => widgets.closeAll());
// Mac convention: closing the window keeps the app in the Dock; clicking the Dock icon brings it back.
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!win) createWindow(); });
