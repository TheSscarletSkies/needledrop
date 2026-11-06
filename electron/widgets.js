// Floating desktop widgets: the 3D turntable itself (transparent and resizable), and a slim
// now-playing strip in frosted glass. The main window owns playback; it broadcasts state here and
// widgets send commands back.
import { app, BrowserWindow, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const KINDS = {
  deck: { w: 440, h: 352, page: 'deck.html', resizable: true, min: [260, 208], max: [1200, 960] },
  strip: { w: 360, h: 104, page: 'widget.html?kind=strip', resizable: false },
};

export class Widgets {
  constructor({ preload, getBaseUrl, onClosed }) {
    this.preload = preload;
    this.getBaseUrl = getBaseUrl;
    this.onClosed = onClosed;
    this.windows = {};
    this.lastState = null;
    this.file = path.join(app.getPath('userData'), 'widgets.json');
    try { this.prefs = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.prefs = {}; }
    this.prefs = { deck: false, strip: false, onTop: true, pos: {}, size: {}, ...this.prefs };
  }

  #save() { fs.writeFile(this.file, JSON.stringify(this.prefs), () => {}); }

  getPrefs() { return { deck: this.prefs.deck, strip: this.prefs.strip, onTop: this.prefs.onTop }; }

  async set({ deck, strip, onTop }) {
    if (onTop !== undefined && onTop !== this.prefs.onTop) {
      this.prefs.onTop = onTop;
      for (const w of Object.values(this.windows)) w.setAlwaysOnTop(onTop, 'floating');
    }
    for (const [kind, want] of [['deck', deck], ['strip', strip]]) {
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
    const { w } = this.#size(kind);
    return { x: workArea.x + workArea.width - w - 24, y: workArea.y + 24 + (kind === 'strip' ? this.#size('deck').h + 16 : 0) };
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

  #size(kind) {
    const k = KINDS[kind];
    const saved = this.prefs.size[kind];
    return k.resizable && saved ? saved : { w: k.w, h: k.h };
  }

  async #open(kind) {
    const k = KINDS[kind];
    const { w, h } = this.#size(kind);
    const { x, y } = this.#position(kind);
    const mac = process.platform === 'darwin';
    // The deck floats on the desktop with only its own shadow; the strip is a frosted-glass card.
    const look = kind === 'deck'
      ? { transparent: true, backgroundColor: '#00000000', hasShadow: false }
      : mac
        ? { vibrancy: 'hud', visualEffectState: 'active', backgroundColor: '#00000000', hasShadow: true }
        : { transparent: true, backgroundColor: '#00000000', hasShadow: true };
    const win = new BrowserWindow({
      width: w, height: h, x, y,
      frame: false, resizable: k.resizable, maximizable: false, minimizable: false, fullscreenable: false,
      skipTaskbar: true, show: false,
      ...(k.resizable ? { minWidth: k.min[0], minHeight: k.min[1], maxWidth: k.max[0], maxHeight: k.max[1] } : {}),
      ...look,
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false },
    });
    win.widgetKind = kind;
    if (k.resizable) {
      win.setAspectRatio(k.w / k.h);
      win.on('resized', () => {
        const [rw, rh] = win.getSize();
        this.prefs.size[kind] = { w: rw, h: rh };
        this.#save();
      });
    }
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
    await win.loadURL(`${this.getBaseUrl()}/${k.page}`);
    if (this.lastState) win.webContents.send('widget:state', this.lastState);
  }

  close(kind) { this.windows[kind]?.close(); }

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
