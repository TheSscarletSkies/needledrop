// YouTube via the official IFrame Player API. Paste a video or playlist link.
let apiReady;
function loadApi() {
  apiReady ||= new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = resolve;
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return apiReady;
}

export function parseYouTube(input) {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return { videoId: s };
  try {
    const u = new URL(s);
    const list = u.searchParams.get('list');
    let videoId = u.searchParams.get('v');
    if (u.hostname === 'youtu.be') videoId = u.pathname.slice(1, 12);
    const m = u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/);
    if (m) videoId = m[1];
    if (videoId || list) return { videoId, list };
  } catch { /* not a URL */ }
  return null;
}

export class YouTubeSource {
  name = 'youtube';
  label = 'YouTube';
  available = true;
  player = null;
  state = { track: null, position: 0, duration: 0, playing: false };
  note = 'Paste a YouTube video or playlist link.';
  #artCache = new Map();

  constructor(host) { this.host = host; }

  async load(input) {
    const parsed = parseYouTube(input);
    if (!parsed) { this.note = "That doesn't look like a YouTube link."; return false; }
    await loadApi();
    const YT = window.YT;
    if (!this.player) {
      await new Promise((resolve) => {
        this.player = new YT.Player(this.host, {
          width: 640, height: 360,
          playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, rel: 0 },
          events: { onReady: () => { if (this.volume !== undefined) this.player.setVolume(Math.round(this.volume * 100)); resolve(); }, onError: (e) => { this.note = `YouTube couldn't play this (error ${e.data}). Some videos block embedding.`; } },
        });
      });
    }
    this.note = '';
    if (parsed.list) this.player.cuePlaylist({ list: parsed.list, listType: 'playlist', index: 0 });
    else this.player.cueVideoById(parsed.videoId);
    return true;
  }

  async poll() {
    const p = this.player;
    if (!p?.getVideoData) return this.state;
    const data = p.getVideoData() || {};
    if (!data.video_id) return this.state;
    const id = data.video_id;
    let art = this.#artCache.get(id);
    if (art === undefined) {
      this.#artCache.set(id, null);
      const url = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      art = window.needledrop ? await window.needledrop.fetchImage(url) : url;
      this.#artCache.set(id, art);
    }
    const ps = p.getPlayerState();
    this.state = {
      track: { id: `yt:${id}`, album: `yt:${id}`, title: data.title || 'YouTube', artist: data.author || '', albumName: '', art, via: 'YouTube' },
      position: p.getCurrentTime() || 0,
      duration: p.getDuration() || 0,
      playing: ps === 1 || ps === 3, // playing or buffering
    };
    return this.state;
  }

  play() { this.player?.playVideo(); }
  pause() { this.player?.pauseVideo(); }
  seek(sec) { this.player?.seekTo(sec, true); }
  next() { this.player?.nextVideo(); }
  prev() {
    if ((this.player?.getCurrentTime() || 0) > 4) this.seek(0);
    else this.player?.previousVideo();
  }
  setVolume(v) { this.volume = v; this.player?.setVolume?.(Math.round(v * 100)); }
  // YouTube snaps to its nearest supported rate.
  setRate(r) { this.rate = r; this.player?.setPlaybackRate?.(r); }
}
