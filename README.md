# Looper

Looper lets users import videos they already have permission to use, extract audio locally when the browser supports it, auto-trim unwanted endings, preview the trim, and save the result into a personal loopable audio library.

## What this builds

- A simple import form for an audio/video file or Looper share.
- Video imports auto-trim the last 4 seconds before the save step.
- A preview screen with thumbnail, waveform, detected duration, trimmed duration, start/end handles, original playback, trimmed playback, loop preview, save, and discard.
- An inline player list inspired by mobile sound search results: thumbnail play buttons start looping without navigating away.
- Loop controls using start and end seconds, with support for minute-length loops by entering larger second values.
- Rename, delete, skip previous/next, like, playlist, share, play-next, add-to-queue, repeat sound, repeat playlist, shuffle, and local trending/top filters.

See [docs/ios-mobile-architecture.md](docs/ios-mobile-architecture.md) for the native iPhone path for background playback, Photos import, and lock-screen controls.

See [docs/iphone-install.md](docs/iphone-install.md) for the installable iPhone testing path and the later TestFlight path.

See [docs/permanent-hosting.md](docs/permanent-hosting.md) for the stable HTTPS hosting and update path.

## Run locally

```powershell
node server.js
```

Then open [http://localhost:4173](http://localhost:4173).

The server uses only Node built-ins. No npm install is required.

You can also open `index.html` directly for the offline library UI.

## Test On iPhone

Fastest public iPhone test:

```powershell
npm run build:pwa
```

Deploy the `dist` folder through the connected Netlify site. Open the deployed HTTPS URL in iPhone Safari, then Share -> Add to Home Screen.

Local Wi-Fi test:

```powershell
.\scripts\start-mobile-server.ps1
```

If your phone cannot load the LAN URL, open PowerShell as Administrator and run:

```powershell
.\scripts\allow-firewall.ps1
```

Then reload the iPhone URL printed by the start script.

## Test

```powershell
node test/domain.test.js
```

## Product boundary

This starter intentionally does not download, cache, or extract public TikTok audio. The independent player works with media files imported by the user.

Browser video-to-audio conversion is best-effort because media container support differs by browser. The production iOS app should use the native AVFoundation export path described in `docs/ios-mobile-architecture.md`.
