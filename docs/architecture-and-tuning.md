# Basebound — Multiplayer Architecture, Tuning, and Testing Guide

## How multiplayer authority works

Basebound does **not** run game simulation on the Render server. The architecture is:

- **`server.js` (Render)** — a stateless **relay**: room lobby API (create/join/ready/start),
  player-state snapshots, and a per-room combat-event ring buffer, delivered over
  HTTP POST + Server-Sent Events. It validates/sanitizes event payloads but runs
  no game loop.
- **Host player's browser** — the **authoritative simulator** for shared world
  state. `GameScene.isAuthoritativeWorldHost()` gates: mob AI/health, objective
  combat and capture, match phase/timer, world loot, boss spawning, camp spawns,
  base waves, chests/encounters/villages.
- **Every player's own browser** — authoritative for *their own* hero: movement,
  health (PvP damage is victim-authoritative via relayed `damage` intents),
  XP/level/AP/attribute points, inventory, and their own base buildings.
- **Non-host clients** — render synced state: they interpolate remote players and
  mobs toward snapshot positions, mirror objective/loot/phase state, and route
  damage against host-owned entities (mobs, objectives) or other players through
  relay events instead of mutating locally.

**Important:** match-critical simulation must run on the authoritative host, never
split between the Render relay and a second machine. Keep the relay stateless; if
true server-side simulation is ever wanted, that is a dedicated rewrite (e.g.
Colyseus), not an incremental patch.

### Why the match keeps running when the host tabs out
Browsers throttle `requestAnimationFrame` in background tabs. The host runs a
**Web Worker heartbeat** (`GameScene.startSimHeartbeat`, rate
`CONFIG.multiplayer.backgroundTickHz`) that advances the simulation without
rendering while the tab is hidden. The rAF loop skips stepping when hidden so the
sim is never double-stepped.

### The healthRatio rule
`healthRatio` is a **derived getter** on real entities (Entity/Mob/Player/
Objective). Never assign to it — sync raw `health` + `maxHealth` and compute the
ratio locally. `setSyncedHealthRatio()` in `GameScene.js` writes a ratio only on
plain network proxy objects; use it for any new sync code.

## What syncs, and how often (CONFIG.multiplayer)
- Player snapshot ~8Hz (`playerSyncIntervalMs`), poll fallback (`pollIntervalMs`).
- Host world snapshot (mobs near players, objectives, loot, match phase) every
  `worldSyncIntervalMs`, culled by `syncMobRadius` (+ per-map-size overrides) and
  capped by `maxSyncedMobs`.
- Combat/loot events (damage intents, projectile/area ghosts, loot claims, kill
  outcomes) flush immediately with the next send, capped by `maxEventsPerSync`.

## Where the tuning values live (`src/game/config.js`)
- **Progression:** `player.xpBase`, `xpGrowth`, `apPerLevel`,
  `attributePointsPerLevel`, `healthPerLevel`, `moveSpeedPerLevel`,
  `mobilityMoveSpeedPerPoint`, baseline `statTuning` (health/speed multipliers).
- **Combat:** `combat.meleeStructure` (per-class structure damage + close-range
  tower mitigation), `combat.towerProjectiles` (speed, close-range multiplier,
  player damage clamps), `combat.pvp`, `combat.stealth`.
- **Mobs/perf:** `mobs.activationRadius`, `mobs.sleepUpdateInterval` (far mobs
  sleep), camp density per map size, `economy.mobRewards` multipliers.
- **Objectives/bosses:** `objectiveRules.captureRadiusBonus`,
  `objectiveRules.leash` (return speed, healing %, `combatMemorySeconds`).
- **Base:** `base.recovery` (no-damage restore of destroyed structures),
  wall spacing / `towerSlotRatios` per layout, upgrade costs.
- **Loot:** `loot.walkOverRadius`, `autoPickup`, `carryLimit`,
  `backpackFullMessageCooldown`, `maxSyncedDrops`.
- **Map:** `mapGeneration.propClearRadius` (base placement clears trees/rocks),
  density and map-size settings.
- **Phases:** `phases[]` durations (exploration is index 0).

## Testing

### Local multi-client test
1. `node server.js` → open two browser windows at `http://localhost:4174`.
2. Window A: Multiplayer → create room → copy invite. Window B: open invite,
   pick a character, **Ready Up**. A starts; both should hit the countdown
   together.
3. Verify: both damage the same mob and see the same HP (no heal-back); area/
   skill shots are visible to the opponent; phase timer matches; walking over
   loot picks it up exactly once across clients.

### Tab-out test
Host tabs away for 30+ s — the other player's mobs, boss fights, timers, and
capture progress must keep running.

### Boss/objective test
Defeat an objective guardian → capture ring activates for everyone → stand in the
ring → ownership + reward applies on all clients, allied guard tower appears.

### Diagnosing desync
Press **F9** in game: role (HOST/client), room player count, host id, server
clock offset, phase/timer, active vs sleeping mobs, remotes, world drops, and
your level/AP/attr/speed/position. `game.debugMobDamage = true` in the console
logs every mob damage application on the host.

### Deploying
Push `codex-online-multiplayer` → Render auto-deploys via `render.yaml`
(`npm run build:pwa`, `node server.js`, `STATIC_DIR=dist`). After deploy,
hard-refresh and check the menu footer version matches `src/game/config.js`.
Bump the `?v=` cache token across files when shipping client changes.
