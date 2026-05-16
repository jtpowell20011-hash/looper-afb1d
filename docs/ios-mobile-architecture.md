# iOS Mobile Architecture

The browser prototype can validate the import and player experience, but iPhone background playback needs a native app shell.

## Required iOS pieces

- Use `AVAudioSession` with the `playback` category so audio can continue when the phone locks or the app goes into the background.
- Enable the `audio` background mode in the iOS app capabilities.
- Use `AVPlayer` or `AVQueuePlayer` for local audio/video-file playback.
- Use `MPRemoteCommandCenter` for lock-screen and headphone controls: play, pause, next track, previous track, and seek.
- Use `MPNowPlayingInfoCenter` to show title, account name, artwork, duration, and current time.
- Use `PHPickerViewController` or SwiftUI `PhotosPicker` so users can import videos from Photos without leaving the app.
- Use `AVAssetExportSession` or an `AVAssetReader`/`AVAssetWriter` pipeline to export imported videos as audio-only `.m4a` files.
- Trim the final 4 seconds by default during export by setting the export time range to `0...(duration - 4s)`, while allowing the user to adjust the handles before saving.
- Store imported media in the app sandbox, then persist metadata separately in a local database.

## Product flow

1. User chooses a video/audio from Photos.
2. App copies the media into its sandbox.
3. App creates a playable library item with title, loop settings, liked state, and local media path.
4. Player loops forever by default, or stops after a user-specified number of minutes.
5. Next/previous skip controls work inside the app and through iOS lock-screen controls.

## Notes

This preserves the desired phone experience without depending on another app being open. The playable source comes from user-authorized Photos import or creator-owned media.
