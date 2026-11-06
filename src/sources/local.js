// Local audio files: drag & drop or pick. Plays through an <audio> element.
// At 45 RPM the audio actually speeds up, the way a real deck would.
export class LocalSource {
  name = 'local';
  label = 'Files';
  available = true;
  queue = [];
  index = -1;
  rate = 1;
  note = 'Drop audio files anywhere, or pick some.';
  onQueueChange = () => {};

  constructor() {
    this.audio = new Audio();
    this.audio.preservesPitch = false;
    this.audio.addEventListener('ended', () => {
      if (this.index < this.queue.length - 1) { this.#select(this.index + 1); this.audio.play(); }
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

  async add(files) {
    const audioFiles = [...files].filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|flac|wav|ogg|opus|aiff?)$/i.test(f.name));
    for (const file of audioFiles) {
      const base = file.name.replace(/\.[^.]+$/, '');
      let meta = { title: base, artist: '', album: '', duration: 0, art: null };
      const bridge = window.needledrop;
      if (bridge) {
        try { meta = await bridge.fileMeta(bridge.pathForFile(file)); } catch { /* keep filename */ }
      }
      this.queue.push({ id: `${file.name}:${file.size}`, url: URL.createObjectURL(file), meta });
    }
    if (this.index === -1 && this.queue.length) this.#select(0);
    this.note = this.queue.length ? '' : this.note;
    this.onQueueChange();
    return audioFiles.length;
  }

  // Files opened from the OS by path (Finder, Open With, the Dock). Returns the index of the first one.
  async addPaths(paths) {
    const bridge = window.needledrop;
    if (!bridge?.readFile || !paths.length) return -1;
    const first = this.queue.length;
    for (const p of paths) {
      const [meta, data] = await Promise.all([bridge.fileMeta(p), bridge.readFile(p)]);
      this.queue.push({ id: p, url: URL.createObjectURL(new Blob([data])), meta });
    }
    this.note = '';
    this.onQueueChange();
    return first;
  }

  #select(i) {
    this.index = i;
    this.audio.src = this.queue[i].url;
    this.audio.playbackRate = this.rate;
    this.onQueueChange();
  }

  jump(i) { const wasPlaying = !this.audio.paused; this.#select(i); if (wasPlaying) this.audio.play(); }
  play() { if (this.index >= 0) return this.audio.play(); }
  pause() { this.audio.pause(); }
  seek(sec) { this.audio.currentTime = sec; }
  next() { if (this.index < this.queue.length - 1) this.jump(this.index + 1); }
  prev() { if (this.audio.currentTime > 4 || this.index === 0) this.seek(0); else this.jump(this.index - 1); }
  setRate(r) { this.rate = r; this.audio.playbackRate = r; }
  setVolume(v) { this.audio.volume = Math.max(0, Math.min(1, v)); }
}
