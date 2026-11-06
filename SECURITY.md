# Security

## Reporting a problem

Please report security issues privately rather than in a public issue: open a [private security advisory](https://github.com/TheSscarletSkies/needledrop/security/advisories/new) on this repository.

Include what you found, how to reproduce it, and which version and operating system you used. You'll get a reply as soon as possible, and a fix in a new release if the report is confirmed.

## Supported versions

Only the [latest release](https://github.com/TheSscarletSkies/needledrop/releases/latest) gets security fixes.

## What Needledrop does to stay safe

- **Its windows only ever show its own pages.**
  - Navigation away and `<webview>` are blocked.
  - Only `https` links open, and they open in your browser.
- **Every permission request is denied** (camera, microphone, notifications, geolocation…). The only exception is capturing Needledrop's own window audio for the speakers, and only from its own top-level page.
- **The YouTube player is a cross-origin iframe,** so it can't reach the app's desktop features.
- **File access is narrow:**
  - Reading files is limited to audio files the user opened, and cover-art images.
  - Image downloads are limited to `http(s)` URLs that return images.
- **Every window is hardened:** sandboxed, with context isolation and no Node.js integration. There's a strict Content Security Policy on every page.
- **Electron fuses are set:** run-as-Node, `NODE_OPTIONS` and `--inspect` are disabled, and only the integrity-checked `app.asar` is loaded.
- **Helper processes are called safely:** AppleScript, PowerShell and `playerctl` are called with fixed commands, never through a shell or with user-supplied text.
