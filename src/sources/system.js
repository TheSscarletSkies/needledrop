// Whatever the computer is playing, via the Electron bridge: Spotify / Apple Music on macOS,
// the system media session on Windows, MPRIS players on Linux. No login needed.
const api = () => window.needledrop;

export class SystemSource {
  name = 'system';
  label = 'Spotify · Music';
  available = !!api();
  isMac = /mac/i.test(navigator.platform);
  state = { track: null, position: 0, duration: 0, playing: false };
  note = '';

  async poll() {
    if (!api()) {
      this.note = 'Spotify & Apple Music sync needs the desktop app (npm run dev).';
      return this.state;
    }
    const r = await api().nowPlaying();
    if (!r.supported) {
      this.note = {
        playerctl: 'Install playerctl (e.g. sudo apt install playerctl) so Needledrop can see what your music player is playing.',
        powershell: 'Needledrop couldn’t reach Windows media controls (PowerShell is unavailable).',
      }[r.reason] || 'Following your music player isn’t supported on this system.';
      this.state = { track: null, position: 0, duration: 0, playing: false };
      return this.state;
    }
    this.note = r.track ? '' : (this.isMac ? 'Play something in Spotify or Apple Music — the record will follow.' : 'Play something in Spotify or any music player — the record will follow.');
    const t = r.track;
    this.state = t
      ? {
          track: { id: `${t.app}:${t.artist}|${t.album}|${t.title}`, album: `${t.artist}|${t.album}`, title: t.title, artist: t.artist, albumName: t.album, art: t.art, via: t.via },
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
