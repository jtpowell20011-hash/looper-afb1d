# Basebound Online Deployment

Basebound must be deployed as a Node web service for online rooms to work. A static-only host can serve the page, but it cannot host live room state for friends.

## Current Online Capability

- One public URL hosts the game client and room server.
- Hosts can create rooms for up to 8 players.
- Guests join through a shared link like `https://your-basebound-url.onrender.com/?room=ABCDE`.
- The server owns room membership, ready/start state, shared world settings, shared world seed, and player/base snapshots.
- Clients render the same seeded map and exchange live player/base state through the server.

This is the first playable online layer. The next production milestone is moving combat validation, mobs, loot, objective ownership, base damage, and rewards to a fully authoritative server simulation.

## Render Blueprint Deployment

1. Push the repo to GitHub.
2. In Render, choose **New > Blueprint**.
3. Select this GitHub repo.
4. Render will read `render.yaml`.
5. Confirm the service settings:
   - Environment: `Node`
   - Build Command: `npm run build:pwa`
   - Start Command: `node server.js`
   - Health Check Path: `/api/health`
   - `STATIC_DIR=dist`
   - `HOST=0.0.0.0`
   - `MAX_PLAYERS=8`
6. After the deploy finishes, open the public Render URL.
7. Create a room, copy the invite link, and send it to one friend.

## Manual Node Host Deployment

Use these settings on Railway, Fly.io, Render, or any Node host:

```text
Build command: npm run build:pwa
Start command: node server.js
Port: use the provider's PORT environment variable
STATIC_DIR=dist
HOST=0.0.0.0
MAX_PLAYERS=8
PUBLIC_URL=https://your-public-url
```

## Smoke Test

After deployment:

1. Visit `/api/health`; it should return `{ "ok": true }`.
2. Open the public game URL in one browser and create a multiplayer room.
3. Open the invite link in another browser or send it to a friend.
4. Confirm both players appear in the room list.
5. Host starts the match.
6. Confirm both players load into the same map and see each other moving.

## Important Architecture Note

The current server is a real hosted multiplayer room server, but gameplay authority is still partly client-side. That is good enough for early friend testing and feel checks. Before wider public release, server authority should be added for:

- player movement validation
- ability cooldown validation
- combat damage
- mob and boss simulation
- objective ownership
- base structure damage and recovery
- loot drops and inventory
- win/loss state
