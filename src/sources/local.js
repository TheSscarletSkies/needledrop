// Local audio files and folders: drag & drop, pick, or open from the OS. Plays through an <audio> element.
// At 45 RPM the audio actually speeds up, the way a real deck would.
//
// In the desktop app, files are queued by path and only the track that's about to play is read into
// memory, so dropping a folder of 300 songs costs no more than one song.
const AUDIO = /\.(mp3|m4a|aac|flac|wav|ogg|opus|aiff?)$/i;
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const baseName = (p) => p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');

export class LocalSource {
  name = 'local';
  label = 'Files';
  available = true;
  queue = [];
  index = -1;
  rate = 1;
  wantPlay = false;
  note = 'Drop songs or a whole folder anywhere, or pick some.';
  onQueueChange = () => {};

  constructor() {
    this.audio = new Audio();
    this.audio.preservesPitch = false;
    this.audio.addEventListener('ended', () => {
      if (this.index < this.queue.length - 1) this.#select(this.index + 1);
      else this.wantPlay = false;
    });
  }

  get state() {
    const item = this.queue[this.index];
    if (!item) return { track: null, position: 0, duration: 0, playing: false };
    return {
      track: { id: `file:${item.id}`, album: `${item.meta.artist}|${item.meta.album || item.id}`, title: item.meta.title, artist: item.meta.artist, albumName: item.meta.album, art: item.meta.art, via: 'File' },
      position: this.audio.currentTime || 0,
      duration: this.audio.duration || item.meta.duration || 0,
      playing: !this.audio.paused,
    };
  }

  async poll() { return this.state; }

  /**
   * Add dropped/picked File objects (may include whole folders). Returns the index of the first
   * new track, or -1 if nothing playable was added.
   */
  async add(files) {
    const bridge = window.needledrop;
    // Desktop: go by path, so folders expand on disk and tracks load lazily.
    if (bridge?.expandPaths) {
      const paths = [...files].map((f) => bridge.pathForFile(f)).filter(Boolean);
      if (paths.length) return this.addPaths(await bridge.expandPaths(paths));
    }
    const audio = [...files].filter((f) => f.type.startsWith('audio/') || AUDIO.test(f.name));
    // Folder picks carry their relative paths; keep album order. (Dropped folders arrive pre-sorted.)
    if (audio.some((f) => f.webkitRelativePath)) audio.sort((a, b) => natural(a.webkitRelativePath, b.webkitRelativePath));
    if (!audio.length) return -1;
    const first = this.queue.length;
    for (const f of audio) {
      this.queue.push({ id: `${f.webkitRelativePath || f.name}:${f.size}`, url: URL.createObjectURL(f), meta: { title: baseName(f.name), artist: '', album: '', duration: 0, art: null } });
    }
    this.#added(first);
    return first;
  }

  // Desktop: paths from a drop, a picker, Finder/Open With or the Dock (already expanded and sorted).
  async addPaths(paths) {
    const bridge = window.needledrop;
    const files = (paths || []).filter((p) => AUDIO.test(p));
    if (!bridge || !files.length) return -1;
    const first = this.queue.length;
    // Placeholders first so the queue appears at once; tags and art fill in as they're read.
    const items = files.map((p) => ({ id: p, path: p, url: null, meta: { title: baseName(p), artist: '', album: '', duration: 0, art: null } }));
    this.queue.push(...items);
    this.#added(first);
    for (const item of items) {
      try { item.meta = await bridge.fileMeta(item.path); } catch { /* keep the file name */ }
      if (this.queue[this.index] === item || items.indexOf(item) % 10 === 9) this.onQueueChange();
    }
    this.onQueueChange();
    return first;
  }

  // Drop the whole queue (the "Clear" button).
  clear() {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    for (const q of this.queue) if (q.url) URL.revokeObjectURL(q.url);
    this.queue = [];
    this.index = -1;
    this.wantPlay = false;
    this.onQueueChange();
  }

  #added(first) {
    if (this.index === -1 && this.queue.length) this.#select(first);
    this.note = '';
    this.onQueueChange();
  }

  // Path-based tracks are read from disk only when they're selected; the previous one is released.
  async #load(item) {
    const data = await window.needledrop.readFile(item.path);
    if (!data) throw new Error('unreadable');
    for (const q of this.queue) if (q !== item && q.path && q.url) { URL.revokeObjectURL(q.url); q.url = null; }
    item.url = URL.createObjectURL(new Blob([data]));
  }

  async #select(i) {
    this.index = i;
    const item = this.queue[i];
    this.onQueueChange();
    if (!item.url) {
      this.audio.pause();
      try { await this.#load(item); } catch { return; }
      if (this.index !== i) return; // the user moved on while it loaded
    }
    this.audio.src = item.url;
    this.audio.defaultPlaybackRate = this.rate;
    this.audio.playbackRate = this.rate;
    if (this.wantPlay) this.audio.play().catch(() => {});
  }

  jump(i) { if (i >= 0 && i < this.queue.length) this.#select(i); }
  play() { this.wantPlay = true; if (this.index >= 0 && this.audio.src) return this.audio.play().catch(() => {}); }
  pause() { this.wantPlay = false; this.audio.pause(); }
  seek(sec) { this.audio.currentTime = sec; }
  next() { if (this.index < this.queue.length - 1) this.jump(this.index + 1); }
  prev() { if (this.audio.currentTime > 4 || this.index === 0) this.seek(0); else this.jump(this.index - 1); }
  setRate(r) { this.rate = r; this.audio.defaultPlaybackRate = r; this.audio.playbackRate = r; }
  setVolume(v) { this.audio.volume = Math.max(0, Math.min(1, v)); }
}
