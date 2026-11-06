// Spotify / Apple Music desktop apps (macOS), via the Electron bridge.
// Needs no login: it reads and controls whatever those apps are playing.
const api = () => window.needledrop;

export class SystemSource {
  name = 'system';
  label = 'Spotify · Music';
  available = !!api();
  state = { track: null, position: 0, duration: 0, playing: false };
  note = '';

  async poll() {
    if (!api()) {
      this.note = 'Spotify & Apple Music sync needs the desktop app (npm run dev).';
      return this.state;
    }
    const r = await api().nowPlaying();
    if (!r.supported) {
      this.note = 'Spotify & Apple Music sync is macOS-only for now.';
      this.state = { track: null, position: 0, duration: 0, playing: false };
      return this.state;
    }
    this.note = r.track ? '' : 'Play something in Spotify or Apple Music — the record will follow.';
    const t = r.track;
    this.state = t
      ? {
          track: { id: `${t.app}:${t.artist}|${t.album}|${t.title}`, album: `${t.artist}|${t.album}`, title: t.title, artist: t.artist, albumName: t.album, art: t.art, via: t.app === 'spotify' ? 'Spotify' : 'Apple Music' },
          position: t.position, duration: t.duration, playing: t.playing,
        }
      : { track: null, position: 0, duration: 0, playing: false };
    return this.state;
  }

  play() { return api()?.command('play'); }
  pause() { return api()?.command('pause'); }
  seek(sec) { return api()?.command('seek', sec); }
  next() { return api()?.command('next'); }
  prev() { return api()?.command('prev'); }
}
