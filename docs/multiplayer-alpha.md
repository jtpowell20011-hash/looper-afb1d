# Basebound Online Alpha

This build supports a lightweight online room test for friends:

- Up to 8 players per room through `server.js`
- Shareable invite links like `https://your-site.example/?room=ABCDE`
- Server-sent event room updates for player/base snapshots
- PvP damage and outcome events for remote heroes, bases, walls, towers, cores, rewards, and elimination checks
- Shared map size, world options, and world seed so clients generate the same map
- Local fallback for same-browser-tab testing if the Node room API is unavailable

This is not fully server-authoritative yet. The next multiplayer milestone should move combat simulation, mobs, objectives, loot, base damage, rewards, and win/loss checks onto the server for anti-cheat and public-scale stability.

## Local Test

```powershell
node server.js
```

Open `http://localhost:4174`, create a room, copy the invite link, and open it in another browser tab.

## Internet Test

Deploy as a Node web service, not a static-only site. Render works with the included `render.yaml`.

Use:

- Build command: `npm run build:pwa`
- Start command: `node server.js`
- Environment:
  - `STATIC_DIR=dist`
  - `HOST=0.0.0.0`
  - `MAX_PLAYERS=8`
  - Optional `PUBLIC_URL=https://your-public-url`

Once deployed, create a room from the public URL and share the generated invite link.
