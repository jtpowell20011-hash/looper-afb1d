# iPhone Install And Update Path

There are two realistic tracks.

## Track 1: Installable Web App

This is the fastest way to test on an iPhone without waiting for App Store or TestFlight setup.

1. Host the project on an HTTPS URL. Good options are Vercel, Netlify, Cloudflare Pages, or GitHub Pages.
2. Open the HTTPS URL in Safari on the iPhone.
3. Tap Share.
4. Tap Add to Home Screen.
5. Launch Looper from the home-screen icon.

The app now includes:

- `manifest.webmanifest`
- `sw.js`
- iPhone home-screen metadata
- app icon
- offline shell caching

Updates work by deploying new files to the host. Users may need to close and reopen the home-screen app after an update while we are still early in development.

## Track 2: Native TestFlight App

This is the proper path for background playback, lock-screen controls, Photos import polish, and beta updates.

Requirements:

- Apple Developer Program membership.
- A Mac build environment with Xcode, or Xcode Cloud connected to a repo.
- App Store Connect app record.
- TestFlight build upload.

Recommended native stack:

- SwiftUI for the interface.
- PhotosPicker for iPhone Photos imports.
- AVFoundation to export imported video to audio-only `.m4a`.
- AVAudioSession playback category for background audio.
- MPRemoteCommandCenter for lock-screen play/pause/skip controls.
- TestFlight for beta installs and ongoing updates.

## Best Next Step

Use Track 1 immediately by deploying this current web app to an HTTPS host. In parallel, build Track 2 as the native iPhone app once we have the list/import/player behavior locked in.
