// Floating desktop widgets: a square spinning record, and a slim now-playing strip.
// They're small frameless windows with native frosted glass. The main window owns playback;
// it broadcasts state here and widgets send commands back.
import { app, BrowserWindow, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const SIZES = { record: { w: 220, h: 220 }, strip: { w: 360, h: 104 } };

export class Widgets {
  constructor({ preload, getBaseUrl, onClosed }) {
    this.preload = preload;
    this.getBaseUrl = getBaseUrl;
    this.onClosed = onClosed;
    this.windows = {};
    this.lastState = null;
    this.file = path.join(app.getPath('userData'), 'widgets.json');
    try { this.prefs = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.prefs = {}; }
    this.prefs = { record: false, strip: false, onTop: true, pos: {}, ...this.prefs };
  }

  #save() { fs.writeFile(this.file, JSON.stringify(this.prefs), () => {}); }

  getPrefs() { return { record: this.prefs.record, strip: this.prefs.strip, onTop: this.prefs.onTop }; }

  async set({ record, strip, onTop }) {
    if (onTop !== undefined && onTop !== this.prefs.onTop) {
      this.prefs.onTop = onTop;
      for (const w of Object.values(this.windows)) w.setAlwaysOnTop(onTop, 'floating');
    }
    for (const [kind, want] of [['record', record], ['strip', strip]]) {
      if (want === undefined) continue;
      this.prefs[kind] = want;
      if (want && !this.windows[kind]) await this.#open(kind);
      if (!want && this.windows[kind]) this.windows[kind].close();
    }
    this.#save();
    return this.getPrefs();
  }

  // Default spot: top-right of the screen, stacked.
  #defaultPos(kind) {
    const { workArea } = screen.getPrimaryDisplay();
    const { w } = SIZES[kind];
    return { x: workArea.x + workArea.width - w - 24, y: workArea.y + 24 + (kind === 'strip' ? SIZES.record.h + 16 : 0) };
  }

  // Keep a saved position only if it's still on a connected display.
  #position(kind) {
    const saved = this.prefs.pos[kind];
    if (saved && screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return saved.x >= a.x - 40 && saved.y >= a.y - 40 && saved.x < a.x + a.width - 40 && saved.y < a.y + a.height - 40;
    })) return saved;
    return this.#defaultPos(kind);
  }

  async #open(kind) {
    const { w, h } = SIZES[kind];
    const { x, y } = this.#position(kind);
    const mac = process.platform === 'darwin';
    const win = new BrowserWindow({
      width: w, height: h, x, y,
      frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      skipTaskbar: true, hasShadow: true, show: false,
      // Native frosted glass on macOS; elsewhere the page paints its own translucent card.
      ...(mac ? { vibrancy: 'hud', visualEffectState: 'active', backgroundColor: '#00000000' } : { transparent: true, backgroundColor: '#00000000' }),
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false },
    });
    win.setAlwaysOnTop(this.prefs.onTop, 'floating');
    if (mac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    win.once('ready-to-show', () => win.showInactive());
    win.on('moved', () => {
      const [px, py] = win.getPosition();
      this.prefs.pos[kind] = { x: px, y: py };
      this.#save();
    });
    win.on('closed', () => {
      delete this.windows[kind];
      if (!this.quitting) {
        this.prefs[kind] = false;
        this.#save();
        this.onClosed?.(kind);
      }
    });
    this.windows[kind] = win;
    await win.loadURL(`${this.getBaseUrl()}/widget.html?kind=${kind}`);
    if (this.lastState) win.webContents.send('widget:state', this.lastState);
  }

  // Art is large, so it only travels when it changes.
  broadcast(state) {
    if (state.art === undefined && this.lastState) state.art = this.lastState.art;
    this.lastState = state;
    for (const w of Object.values(this.windows)) w.webContents.send('widget:state', state);
  }

  closeAll() {
    this.quitting = true;
    for (const w of Object.values(this.windows)) w.close();
  }
}
