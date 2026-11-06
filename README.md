# Needledrop

![Needledrop: a walnut turntable on a sideboard in warm window light](docs/screenshot.jpg)

A real-time 3D turntable for your desktop. Whatever you're listening to gets pressed onto a record, the platter spins up, and the tonearm tracks across the grooves as the song plays. Built with [three.js](https://threejs.org) and Electron. No models, samples or images are bundled: the turntable, grooves, label, sheen and surface noise are all generated in code.

## Features

Every part of the deck either works or is there because a real direct-drive turntable has it for a reason.

- **The record is physically shaded.** An anisotropy map runs along the grooves, so light fans out radially across the vinyl the way it does on a real LP. Track gaps are glossier bands, the dead wax carries a hand-etched matrix number, the edge has a raised bead, and the paper label is matte.
- **The album art is printed twice:** on the record label and on the jacket lying on the table beside the deck, with ring wear and an inner sleeve slipping out. Click the sleeve to change the record.
- **The tonearm is an S-shaped arm.** It has a gimbal bearing, an offset headshell with finger lift, a cartridge and cantilever, a counterweight with a tracking-force scale, an anti-skate dial and a rubber arm rest.
  - Press play and it lifts, swings to the lead-in and lowers on a damped cue; the audio starts when the needle lands.
  - It moves inward as the track plays.
  - Drag it anywhere on the record to seek.
- **Cue lever:** a real lever and platform. Clicking it raises the platform under the arm tube and lifts the needle.
- **Start/stop, 33 and 45:** the buttons press down, and the speed LEDs light up.
- **Pitch slider (±8 %):** it changes the platter speed and the playback rate of local files and YouTube. A green quartz-lock light glows only at exactly 0.
- **Strobe lamp and dots:** the lamp lights the strobe dots on the platter rim. Their apparent drift is computed from the real speed: at exactly 33⅓ the 33 row stands still, and the 45 row drifts.
- **Hinged dust cover:** smoked acrylic on friction hinges. Click it to open or close.
- **Surface noise:** hiss and pops, a thump on needle drop and a click on lift, all synthesised with Web Audio.
- **Room:** a linen-covered sideboard, a window key light and ambient occlusion for contact shadows. Bloom affects only the LEDs. Light finishes switch to a daylight room.
- **Five finishes:** walnut, light oak, matte black, chalk white and blush.
- **Desktop:** keep-on-top and a compact mode.

## Music sources

| Source | How it works | Setup |
|---|---|---|
| **Spotify / Apple Music** (macOS) | Reads and controls the desktop apps over AppleScript: track, position, artwork, play/pause/seek/skip. | None. macOS asks once for permission to control the app. |
| **YouTube** | Official IFrame Player API. Paste a video or playlist link. *Show video* reveals the player. | None |
| **Local files** | Drag audio files onto the window or use *Add files*. Tags and embedded artwork are read with `music-metadata`. | None |

## Install (macOS)

Download the `.dmg` for your Mac from Releases (`arm64` for Apple Silicon, the other one for Intel), open it, and drag **Needledrop** into Applications.

The builds aren't notarized yet, so the first time you open it, right-click the app and choose **Open**. The first time it reads Spotify or Music, macOS asks whether Needledrop may control that app. Say yes, or the record won't follow along.

## Run it from source

```bash
npm install
npm run dev     # Electron app with hot reload
npm run web     # browser-only (YouTube + local files; no Spotify/Music bridge)
npm run dist    # build the Mac app: release/*.dmg and *.zip for Apple Silicon and Intel
```

### Controls

| | |
|---|---|
| Drag the tonearm | Seek / start / stop |
| START · STOP button | Start / stop |
| Cue lever | Lift / lower the needle |
| 33 / 45 buttons, pitch slider | Speed |
| Dust cover | Click to open / close |
| Album jacket | Click to change the record |
| Drag empty space | Orbit the camera; scroll to zoom |
| `Space` | Play / pause |
| `←` `→` | Seek ±10 s |
| `N` / `P` | Next / previous |

## Project layout

```
electron/
  main.js          window, local http server (YouTube embeds need an http origin), IPC
  nowplaying.js    Spotify / Music bridge via osascript, artwork lookup
  preload.cjs      the window.needledrop API exposed to the renderer
src/
  main.js          app controller: sources ↔ scene, transport, input, settings
  scene/turntable.js  geometry, tonearm kinematics, cueing state machine
  scene/textures.js   procedural grooves, label, sheen, wood grain, strobe
  sources/         system.js, youtube.js, local.js (one shared interface)
  audio/crackle.js synthesised surface noise and needle sounds
```

### Adding a source

A source is an object with `poll() → { track, position, duration, playing }` plus `play()`, `pause()`, `seek(sec)`, `next()` and `prev()`. `track` needs `id`, `album` (a key used to decide when to press a new record), `title`, `artist` and `art` (URL or data URL). Register it in `src/main.js` and add a tab in `index.html`.

## Roadmap ideas

- Windows / Linux now-playing (SMTC / MPRIS)
- Spotify Web API source for non-macOS platforms
- Hinged dust cover, more finishes, picture discs
- Menu-bar mini player

## Credits

Inspired by the turntable apps *MD Vinyl* and *Vinyl for Mac*. Needledrop is an independent project, not affiliated with either, and shares no code or assets with them.

## License

MIT
