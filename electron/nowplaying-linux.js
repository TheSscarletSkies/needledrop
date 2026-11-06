// Linux: any MPRIS media player (Spotify, Rhythmbox, VLC, browsers…) via the playerctl CLI.
import { execFile } from 'node:child_process';

const SEP = '␟';
const FORMAT = ['status', 'title', 'artist', 'album', 'mpris:length', 'position', 'mpris:artUrl', 'playerName']
  .map((k) => `{{${k}}}`).join(SEP);

let player = null; // stick to the player we last saw, for commands
let missing = false;

function playerctl(args) {
  return new Promise((resolve) => {
    execFile('playerctl', args, { timeout: 3000 }, (err, stdout) => {
      if (err?.code === 'ENOENT') missing = true;
      resolve(err ? null : stdout.trim());
    });
  });
}

const label = (name = '') => ({ spotify: 'Spotify', rhythmbox: 'Rhythmbox', vlc: 'VLC', firefox: 'Firefox', chromium: 'Chromium' }[name.split('.')[0].toLowerCase()] || name);

export async function getState() {
  // Prefer a player that's actually playing; otherwise whichever playerctl picks.
  const playing = await playerctl(['--all-players', 'metadata', '--format', FORMAT]);
  if (missing) return { supported: false, reason: 'playerctl' };
  const lines = (playing || '').split('\n').filter(Boolean);
  const line = lines.find((l) => l.startsWith('Playing')) || lines.find((l) => player && l.endsWith(`${SEP}${player}`)) || lines[0];
  if (!line) return { supported: true, track: null };
  const [status, title, artist, album, len, pos, artUrl, name] = line.split(SEP);
  if (!title || status === 'Stopped') return { supported: true, track: null };
  player = name;
  return {
    supported: true,
    track: {
      app: name, via: label(name),
      playing: status === 'Playing',
      title, artist, album,
      duration: (parseFloat(len) || 0) / 1e6, // microseconds
      position: (parseFloat(pos) || 0) / 1e6,
      artUrl: artUrl || null,
    },
  };
}

export async function command(cmd, arg) {
  const verb = { play: ['play'], pause: ['pause'], toggle: ['play-pause'], next: ['next'], prev: ['previous'], seek: ['position', String(Number(arg) || 0)] }[cmd];
  if (!verb) return false;
  return (await playerctl([...(player ? ['--player', player] : []), ...verb])) !== null;
}
