# Basebound

Basebound is a browser-based prototype for a top-down action/base-building survival game. Version 1 proves the core loop: move, aim, fight mobs, level up, place a preset base, upgrade buildings, defend the core, capture objectives, survive match phases, test emergency rebuilding, and play against AI enemy players before reopening multiplayer testing.

## Run Locally

```powershell
node server.js
```

Then open [http://localhost:4174](http://localhost:4174).

For another computer on the same Wi-Fi, do not use `127.0.0.1` or `localhost` on the second computer. Those point back to the second computer itself. Start the server with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-mobile-server.ps1
```

Then open the LAN URL printed by the script, such as `http://192.168.1.25:4174/`, from the other computer. Windows Firewall must allow Node on that port.

If Windows blocks the connection, run this once from an elevated PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/allow-firewall.ps1
```

The prototype is dependency-free at runtime and uses browser canvas plus modular ES modules. `tsconfig.json` and `src/game/FutureMultiplayerInterfaces.ts` provide the first TypeScript contracts; Version 2 should move the runtime modules into a Vite/TypeScript build.

You can also open `index.html` directly in a browser, though the local server is better for module loading and service-worker behavior.

## Live Hosting

Multiplayer room work is intentionally paused while the solo AI loop is tested. The small room API in `server.js` is still in the repo for later, but the main menu currently routes playtesting through Solo Test plus configurable AI opponents.

The main menu shows a **Shareable Game URL** helper. If it says the current page is static/local only, start the multiplayer server or use a deployed Node URL before sharing room codes.

When the app is running on the Node server, creating a room generates an invite link like:

```text
https://your-basebound-site.onrender.com/?room=ABCDE
```

The host can copy that link from the room panel. A guest opening it from anywhere will be routed into that room flow automatically.

Recommended prototype deployment:

1. Push this repo to GitHub.
2. Create a Web Service on Render, Railway, Fly.io, or another Node host.
3. Use `npm run build:pwa` as the build command.
4. Use `node server.js` as the start command.
5. Set environment variables:
   - `STATIC_DIR=dist`
   - `HOST=0.0.0.0`
   - Optional: `PUBLIC_URL=https://your-public-basebound-url`

The included `render.yaml` is ready for a Render Blueprint deployment.

## Controls

- `WASD`: move
- Mouse: aim
- Left click: basic ranged attack
- `Q`: skill-shot projectile
- `E`: area ability
- `R`: ultimate ability
- `B`: place, relocate during grace, or emergency rebuild
- `Inventory`: opens loot, objectives, base details, and debug tools
- `Settings`: adjust keybindings or leave the current match
- `F1`: add gold/build resources
- `F2`: add XP
- `F3`: damage the base core
- `F4`: spawn mobs
- `F5`: advance match phase
- `F6`: reset match

## What Version 1 Includes

- Fixed handcrafted map with forests, river crossings, mountains, ruins, danger zone, camps, and central boss area.
- One playable hero with health, speed, XP, levels, currency, resources, loot placeholder, respawn, basic attack, skill-shot, and area ability.
- Configurable solo AI rivals that explore, farm, loot, equip gear, place bases, upgrade defenses, fight objectives, and duel the player.
- Mob camps, aggro, melee attacks, rewards, and base-targeting waves.
- Spawn safe point removed for the current combat-focused test build.
- Preset base placement with core, walls, tower, and generator.
- Compact combat HUD with build hotbar plus collapsible inventory/objective drawer.
- Building upgrades with gold/build costs and base energy enforcement.
- Tower targeting and projectile attacks against mobs.
- Emergency rebuilding with two rebuilds, weaker replacement bases, increased costs, and no-base elimination logic.
- Objectives: shrine, mine, watchtower, relic, and boss.
- Match phases with short development timers.
- Simple fog/vision overlay from hero, base, and captured watchtower.
- UI for health, XP, level, currency, resources, phase timer, base status, core health, energy, objectives, cooldowns, debug tools, and win/loss states.

## Main Files

- `index.html`: game shell and HUD
- `styles.css`: canvas and HUD styling
- `src/main.js`: bootstraps the game
- `src/game/GameScene.js`: main loop, input, camera, combat resolution, spawning, rendering
- `src/game/AIPlayer.js`: solo AI rival controller
- `src/game/Player.js`: hero state, movement, leveling, respawn state
- `src/game/Ability.js`: cooldowns and ability casting
- `src/game/Mob.js`: camp mobs, boss, aggro, attacks
- `src/game/Base.js`: base controller, buildings, upgrades, tower AI, emergency rebuilds
- `src/game/Objective.js`: capture objectives
- `src/game/MatchManager.js`: configurable match phases
- `src/game/RewardSystem.js`: XP/currency/resource rewards and damage contribution placeholder
- `src/game/FutureMultiplayerInterfaces.js`: future multiplayer, alliance, and PvP reward contracts
- `src/game/FutureMultiplayerInterfaces.ts`: typed future multiplayer contracts
- `src/game/Map.js`: handcrafted placeholder map drawing
- `src/game/UIManager.js`: DOM HUD synchronization

## Version 2 Direction

- Move to a real TypeScript build with Vite and typed modules.
- Add class selection for Warrior/Guardian, Ranger/Hunter, Mage/Arcanist, and Engineer/Builder.
- Add click-to-move as a first-class movement mode.
- Expand base building choices beyond the preset layout.
- Add stronger objective rules, boss mechanics, and richer loot.
- Add minimap and persistent explored fog-of-war.
- Add AI enemy heroes to simulate PvP reward contribution.
- Re-enable multiplayer after the AI loop feels fun, then move toward server-authoritative architecture for 4-8 players.
- Prototype temporary alliances, alliance break states, and shared victory voting.
