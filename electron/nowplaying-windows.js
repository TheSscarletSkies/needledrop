// Windows: the system media session (what the volume flyout shows) via WinRT, from a long-lived
// PowerShell process so each poll doesn't pay PowerShell's start-up cost.
// Protocol: we write one command per line on stdin; it answers one line on stdout.
import { app } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SEP = '␟';

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Console]::InputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1'
})[0]
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $task.Wait(-1)
  $task.Result
}
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$mgr = Await ($mgrType::RequestAsync()) $mgrType
$sep = [char]0x241F
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  try {
    $s = $mgr.GetCurrentSession()
    if ($s -eq $null) { [Console]::Out.WriteLine('none'); [Console]::Out.Flush(); continue }
    $parts = $line.Split(' ')
    switch ($parts[0]) {
      'state' {
        $p = Await ($s.TryGetMediaPropertiesAsync()) $propsType
        $pb = $s.GetPlaybackInfo()
        $tl = $s.GetTimelineProperties()
        $pos = $tl.Position.TotalSeconds
        if ("$($pb.PlaybackStatus)" -eq 'Playing') { $pos += ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalSeconds }
        $out = @("$($pb.PlaybackStatus)", $p.Title, $p.Artist, $p.AlbumTitle, $tl.EndTime.TotalSeconds, $pos, $s.SourceAppUserModelId) -join $sep
        [Console]::Out.WriteLine($out)
      }
      'play'   { $null = Await ($s.TryPlayAsync()) ([bool]); [Console]::Out.WriteLine('ok') }
      'pause'  { $null = Await ($s.TryPauseAsync()) ([bool]); [Console]::Out.WriteLine('ok') }
      'toggle' { $null = Await ($s.TryTogglePlayPauseAsync()) ([bool]); [Console]::Out.WriteLine('ok') }
      'next'   { $null = Await ($s.TrySkipNextAsync()) ([bool]); [Console]::Out.WriteLine('ok') }
      'prev'   { $null = Await ($s.TrySkipPreviousAsync()) ([bool]); [Console]::Out.WriteLine('ok') }
      'seek'   {
        $ticks = [long]([double]$parts[1] * 10000000)
        $null = Await ($s.TryChangePlaybackPositionAsync($ticks)) ([bool])
        [Console]::Out.WriteLine('ok')
      }
      default  { [Console]::Out.WriteLine('unknown') }
    }
  } catch {
    [Console]::Out.WriteLine('error')
  }
  [Console]::Out.Flush()
}
`;

let proc = null;
let buffer = '';
const waiting = [];
let broken = false;

function start() {
  // In Needledrop's own app-data folder, not a shared temp dir another program could write to.
  const file = path.join(app.getPath('userData'), 'media-session.ps1');
  fs.writeFileSync(file, `﻿${SCRIPT}`, 'utf8');
  proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true });
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).replace(/\r$/, '');
      buffer = buffer.slice(i + 1);
      waiting.shift()?.(line);
    }
  });
  proc.on('exit', () => {
    proc = null;
    while (waiting.length) waiting.shift()(null);
  });
  proc.on('error', () => { broken = true; });
}

function ask(cmd) {
  if (broken) return Promise.resolve(null);
  if (!proc) start();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      // A hung request poisons the queue; restart the helper.
      const i = waiting.indexOf(done);
      if (i >= 0) waiting.splice(i, 1);
      proc?.kill();
      resolve(null);
    }, 4000);
    const done = (line) => { clearTimeout(timer); resolve(line); };
    waiting.push(done);
    proc.stdin.write(`${cmd}\n`);
  });
}

function label(appId = '') {
  const id = appId.toLowerCase();
  if (id.includes('spotify')) return 'Spotify';
  if (id.includes('applemusic') || id.includes('itunes')) return 'Apple Music';
  if (id.includes('chrome')) return 'Chrome';
  if (id.includes('msedge')) return 'Edge';
  if (id.includes('firefox')) return 'Firefox';
  return appId.replace(/\.exe$/i, '').split(/[!\\]/).pop() || 'Windows';
}

export async function getState() {
  const line = await ask('state');
  if (line === null) return { supported: false, reason: broken ? 'powershell' : 'error' };
  if (line === 'none' || line === 'error') return { supported: true, track: null };
  const [status, title, artist, album, dur, pos, appId] = line.split(SEP);
  if (!title) return { supported: true, track: null };
  return {
    supported: true,
    track: {
      app: appId, via: label(appId),
      playing: status === 'Playing',
      title, artist, album,
      duration: parseFloat(dur) || 0,
      position: parseFloat(pos) || 0,
      artUrl: null, // looked up by artist + album, like Apple Music on macOS
    },
  };
}

export async function command(cmd, arg) {
  if (!['play', 'pause', 'toggle', 'next', 'prev', 'seek'].includes(cmd)) return false;
  return (await ask(cmd === 'seek' ? `seek ${Number(arg) || 0}` : cmd)) === 'ok';
}
