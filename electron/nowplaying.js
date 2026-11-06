// Reads and controls whatever is playing in Spotify or Apple Music via AppleScript (macOS only).
// No API keys, no login: it talks to the desktop apps the user already has open.
import { execFile } from 'node:child_process';

let fetchImage = async () => null;
export const setImageFetcher = (fn) => { fetchImage = fn; };

const SEP = '␟';
const APPS = { spotify: 'Spotify', music: 'Music' };
let activeApp = null; // last app we saw playing

function osa(script) {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 3000 }, (err, stdout) => resolve(err ? null : stdout.trim()));
  });
}

const isRunning = (name) => osa(`application "${name}" is running`).then((r) => r === 'true');

function readScript(name) {
  const art = name === 'Spotify' ? 'artwork url of current track' : '""';
  // Spotify reports duration in ms, Music in seconds.
  return `tell application "${name}"
    if player state is stopped then return "stopped"
    set t to current track
    return (player state as string) & "${SEP}" & (name of t) & "${SEP}" & (artist of t) & "${SEP}" & (album of t) & "${SEP}" & (duration of t) & "${SEP}" & (player position) & "${SEP}" & ${art}
  end tell`;
}

async function readApp(key) {
  const name = APPS[key];
  if (!(await isRunning(name))) return null;
  const out = await osa(readScript(name));
  if (!out || out === 'stopped') return null;
  const [state, title, artist, album, dur, pos, artUrl] = out.split(SEP);
  let duration = parseFloat(dur) || 0;
  if (key === 'spotify') duration /= 1000;
  return {
    app: key,
    playing: state === 'playing',
    title, artist, album,
    duration,
    position: parseFloat(pos) || 0,
    artUrl: artUrl || null,
  };
}

const artCache = new Map();
async function artFor(s) {
  const key = `${s.artist}|${s.album}`;
  if (artCache.has(key)) return artCache.get(key);
  let url = s.artUrl;
  if (!url) {
    // Apple Music doesn't hand out artwork URLs over AppleScript; look it up on the iTunes Search API.
    try {
      const q = encodeURIComponent(`${s.artist} ${s.album}`);
      const r = await fetch(`https://itunes.apple.com/search?term=${q}&entity=album&limit=1`);
      const j = await r.json();
      url = j.results?.[0]?.artworkUrl100?.replace('100x100', '1000x1000') || null;
    } catch { url = null; }
  }
  const data = await fetchImage(url);
  artCache.set(key, data);
  return data;
}

export async function getState() {
  if (process.platform !== 'darwin') return { supported: false };
  const [sp, mu] = await Promise.all([readApp('spotify'), readApp('music')]);
  // Prefer whichever is actually playing; otherwise stick with the last active one.
  let s = [sp, mu].find((x) => x?.playing) || (activeApp === 'music' ? mu || sp : sp || mu);
  if (!s) return { supported: true, track: null };
  activeApp = s.app;
  return { supported: true, track: { ...s, art: await artFor(s) } };
}

export async function command(cmd, arg) {
  if (process.platform !== 'darwin') return false;
  const name = APPS[activeApp || 'spotify'];
  const body = {
    play: 'play',
    pause: 'pause',
    toggle: 'playpause',
    next: 'next track',
    prev: 'previous track',
    seek: `set player position to ${Number(arg) || 0}`,
  }[cmd];
  if (!body) return false;
  await osa(`tell application "${name}" to ${body}`);
  return true;
}
