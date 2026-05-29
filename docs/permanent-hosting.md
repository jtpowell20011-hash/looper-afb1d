# Permanent Hosting For Basebound

The local `http://192.168...` link is only a temporary LAN preview. A public playtest needs an HTTPS host.

## Important Multiplayer Note

Multiplayer is currently paused in the main menu while the solo AI enemy-player loop is being tested. Keep this document for the next multiplayer pass.

Basebound's room codes use a small API in `server.js`. Static hosts can serve the game, but they cannot keep the in-memory room server running.

- Use a Node web service for public two-player room testing.
- Use static Netlify hosting only for solo mode or same-browser local-tab room testing.

## Recommended Prototype Host

Use Render, Railway, Fly.io, or another Node-capable host.

Build command:

```text
npm run build:pwa
```

Start command:

```text
node server.js
```

Environment variables:

```text
STATIC_DIR=dist
HOST=0.0.0.0
PUBLIC_URL=https://your-public-basebound-url
```

`PUBLIC_URL` is optional on hosts that correctly send forwarded host headers, but it is useful for custom domains, tunnels, or any host where copied invite links should use a specific public URL.

This repo includes `render.yaml`, so Render can import it as a Blueprint.

## Invite Links

When the game is running on the hosted Node service, the host can create a room and copy an invite link from the room panel.

The link format is:

```text
https://your-public-basebound-url/?room=ABCDE
```

Guests who open that link from anywhere will be placed into the room join flow automatically.

## LAN Testing

For another device on the same Wi-Fi:

1. Run `scripts/start-multiplayer-server.ps1`.
2. Use the printed LAN IP URL, such as `http://192.168.1.25:4174/`.
3. Allow Node through Windows Firewall if prompted.

If Windows does not prompt, run `scripts/allow-firewall.ps1` from an elevated PowerShell session.

Do not use `127.0.0.1` from the second device. On that device, `127.0.0.1` means itself, not the host computer.
