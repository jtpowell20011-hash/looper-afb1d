"use strict";

const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const root = __dirname;
const staticRoot = path.resolve(root, process.env.STATIC_DIR || ".");
const port = Number(process.env.PORT || 4174);
const host = process.env.HOST || "0.0.0.0";
const rooms = new Map();
const roomStreams = new Map();
const ROOM_TTL_MS = 1000 * 60 * 45;
const PLAYER_STALE_MS = 1000 * 35;
const MAX_PLAYERS = Math.max(2, Math.min(8, Number(process.env.MAX_PLAYERS || 8)));
const MAX_ROOM_EVENTS = 240;
const MAX_EVENT_DAMAGE = 1200;
const MAX_BODY_BYTES = Math.max(250_000, Math.min(2_000_000, Number(process.env.MAX_BODY_BYTES || 750_000)));
// Shared countdown so every client unfreezes the match at the same moment.
const START_COUNTDOWN_MS = 5000;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error("payload_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function normalizeRoomCode(code) {
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function cleanRoom(room) {
  const now = Date.now();
  room.players = room.players
    .filter((player) => player.id === room.hostId || now - player.lastSeen < PLAYER_STALE_MS)
    .slice(0, MAX_PLAYERS)
    .map((player) => ({
      ...player,
      isHost: player.id === room.hostId
    }));
  room.updatedAt = now;
  return room;
}

function publicRoom(room) {
  const cleaned = cleanRoom(room);
  return {
    code: cleaned.code,
    hostId: cleaned.hostId,
    status: cleaned.status,
    transport: "server",
    maxPlayers: MAX_PLAYERS,
    settings: sanitizeRoomSettings(cleaned.settings),
    // Clients dedupe events by id; resending only the recent tail keeps
    // broadcast payloads small.
    events: (cleaned.events || []).slice(-40),
    createdAt: cleaned.createdAt,
    updatedAt: cleaned.updatedAt,
    startedAt: cleaned.startedAt,
    startAt: cleaned.startAt || null,
    serverNow: Date.now(),
    players: cleaned.players
  };
}

function getFreshRoom(code) {
  const room = rooms.get(normalizeRoomCode(code));
  if (!room) {
    return null;
  }
  if (Date.now() - room.updatedAt > ROOM_TTL_MS) {
    rooms.delete(room.code);
    return null;
  }
  return room;
}

function sendRoomEvent(res, room) {
  res.write(`event: room\n`);
  res.write(`data: ${JSON.stringify(publicRoom(room))}\n\n`);
}

function broadcastRoom(room) {
  const streams = roomStreams.get(room.code);
  if (!streams) {
    return;
  }
  for (const res of streams) {
    sendRoomEvent(res, room);
  }
}

// High-frequency state updates (every player posts ~8Hz) must NOT each trigger a
// full-room broadcast to every stream — that is O(players^2) full payloads per
// second and floods the relay, delaying everyone's snapshots. Instead, state
// posts mark the room dirty and a single coalescing loop broadcasts at a fixed
// cadence. Lobby-critical routes (join/ready/start/leave) still broadcast
// immediately for snappy lobby UX.
const BROADCAST_INTERVAL_MS = Math.max(50, Number(process.env.BROADCAST_INTERVAL_MS || 100));
const dirtyRooms = new Set();

function markRoomDirty(room) {
  dirtyRooms.add(room.code);
}

setInterval(() => {
  if (dirtyRooms.size === 0) {
    return;
  }
  for (const code of dirtyRooms) {
    const room = rooms.get(code);
    if (room && roomStreams.has(code)) {
      broadcastRoom(room);
    }
  }
  dirtyRooms.clear();
}, BROADCAST_INTERVAL_MS).unref?.();

function broadcastRoomRemoved(code) {
  const streams = roomStreams.get(code);
  if (!streams) {
    return;
  }
  for (const res of streams) {
    res.write(`event: removed\n`);
    res.write(`data: {"code":"${code}"}\n\n`);
  }
  roomStreams.delete(code);
}

function upsertPlayer(room, player, state = undefined) {
  if (!player?.id) {
    throw new Error("missing_player");
  }
  const existingIndex = room.players.findIndex((candidate) => candidate.id === player.id);
  const payload = {
    id: player.id,
    name: String(player.name || "Player").slice(0, 28),
    isHost: player.id === room.hostId,
    joinedAt: existingIndex >= 0 ? room.players[existingIndex].joinedAt : Date.now(),
    lastSeen: Date.now(),
    ready: existingIndex >= 0 ? Boolean(room.players[existingIndex].ready) : false,
    state: state === undefined ? existingIndex >= 0 ? room.players[existingIndex].state : null : state
  };
  if (existingIndex >= 0) {
    room.players[existingIndex] = payload;
    return;
  }
  if (room.players.length >= MAX_PLAYERS) {
    throw new Error("room_full");
  }
  room.players.push(payload);
}

function appendRoomEvents(room, events = [], player = {}) {
  if (!Array.isArray(events) || events.length === 0) {
    return;
  }
  room.events ||= [];
  room.nextEventSeq ||= 1;
  for (const rawEvent of events.slice(0, 24)) {
    const event = sanitizeCombatEvent(rawEvent, player);
    if (!event) {
      continue;
    }
    room.events.push({
      ...event,
      seq: room.nextEventSeq++,
      serverTime: Date.now()
    });
  }
  room.events = room.events.slice(-MAX_ROOM_EVENTS);
}

function sanitizeCombatEvent(rawEvent = {}, player = {}) {
  const type = String(rawEvent.type || "");
  if (!["damage", "projectile", "area", "chestOpened", "mobDefeated", "playerDefeated", "playerEliminated", "coreDestroyed", "lootClaim", "lootGranted"].includes(type)) {
    return null;
  }
  const id = String(rawEvent.id || `${player.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    .replace(/[^a-zA-Z0-9_.:-]/g, "")
    .slice(0, 80);
  const sourcePlayerId = String(rawEvent.sourcePlayerId || player.id || "").slice(0, 80);
  if (!sourcePlayerId || sourcePlayerId !== player.id) {
    return null;
  }
  const targetOwnerId = String(rawEvent.targetOwnerId || rawEvent.victimId || "").slice(0, 80);
  const targetId = String(rawEvent.targetId || "").slice(0, 100);
  const amount = Math.max(0, Math.min(MAX_EVENT_DAMAGE, Math.round(Number(rawEvent.amount || 0))));
  const base = {
    id,
    type,
    sourcePlayerId,
    sourceName: String(rawEvent.sourceName || player.name || "Player").slice(0, 28),
    timestamp: Number(rawEvent.timestamp || Date.now())
  };
  if (type === "projectile") {
    return {
      ...base,
      x: Math.round(Number(rawEvent.x || 0)),
      y: Math.round(Number(rawEvent.y || 0)),
      vx: Math.round(Number(rawEvent.vx || 0)),
      vy: Math.round(Number(rawEvent.vy || 0)),
      range: Math.max(0, Math.min(5000, Math.round(Number(rawEvent.range || 0)))),
      radius: Math.max(1, Math.min(60, Math.round(Number(rawEvent.radius || 6)))),
      color: String(rawEvent.color || "#ffd36a").slice(0, 16),
      pierce: Boolean(rawEvent.pierce)
    };
  }
  if (type === "area") {
    return {
      ...base,
      shape: String(rawEvent.shape || "circle").slice(0, 12),
      x: Math.round(Number(rawEvent.x || 0)),
      y: Math.round(Number(rawEvent.y || 0)),
      radius: Math.max(0, Math.min(2000, Math.round(Number(rawEvent.radius || 0)))),
      x1: Math.round(Number(rawEvent.x1 || 0)),
      y1: Math.round(Number(rawEvent.y1 || 0)),
      x2: Math.round(Number(rawEvent.x2 || 0)),
      y2: Math.round(Number(rawEvent.y2 || 0)),
      dirX: Math.max(-1, Math.min(1, Number(rawEvent.dirX || 0))),
      dirY: Math.max(-1, Math.min(1, Number(rawEvent.dirY || 0))),
      length: Math.max(0, Math.min(1200, Math.round(Number(rawEvent.length || 0)))),
      coneAngle: Math.max(0, Math.min(Math.PI * 2, Number(rawEvent.coneAngle || 0))),
      closeRadius: Math.max(0, Math.min(240, Math.round(Number(rawEvent.closeRadius || 0)))),
      width: Math.max(0, Math.min(2000, Math.round(Number(rawEvent.width || 0)))),
      color: String(rawEvent.color || "#b391f0").slice(0, 16),
      duration: Math.max(0, Math.min(30, Number(rawEvent.duration || 1))),
      effectType: String(rawEvent.effectType || "").slice(0, 24)
    };
  }
  if (type === "lootClaim" || type === "lootGranted") {
    const lootId = String(rawEvent.lootId || "").slice(0, 80);
    if (!lootId) {
      return null;
    }
    return {
      ...base,
      lootId,
      to: String(rawEvent.to || "").slice(0, 80)
    };
  }
  if (type === "damage") {
    if (!targetOwnerId || !targetId || amount <= 0) {
      return null;
    }
    return {
      ...base,
      targetOwnerId,
      targetId,
      targetKind: String(rawEvent.targetKind || "player").slice(0, 24),
      targetType: String(rawEvent.targetType || "").slice(0, 32),
      amount,
      sourceKind: sanitizeSourceKind(rawEvent.sourceKind),
      sourceX: Math.round(Number(rawEvent.sourceX || 0)),
      sourceY: Math.round(Number(rawEvent.sourceY || 0)),
      status: sanitizeStatus(rawEvent.status)
    };
  }
  if (type === "mobDefeated") {
    const killerId = String(rawEvent.killerId || "").slice(0, 80);
    if (!killerId) {
      return null;
    }
    return {
      ...base,
      targetOwnerId: String(rawEvent.targetOwnerId || player.id || "").slice(0, 80),
      targetId,
      killerId,
      killerName: String(rawEvent.killerName || "Player").slice(0, 28),
      mobName: String(rawEvent.mobName || "Mob").slice(0, 40),
      mobTier: Math.max(1, Math.min(10, Math.round(Number(rawEvent.mobTier || 1)))),
      mobLevel: Math.max(1, Math.min(99, Math.round(Number(rawEvent.mobLevel || 1)))),
      bossBuff: Boolean(rawEvent.bossBuff),
      rewardGold: Math.max(0, Math.min(10000, Math.round(Number(rawEvent.rewardGold || 0)))),
      rewardResources: Math.max(0, Math.min(10000, Math.round(Number(rawEvent.rewardResources || 0)))),
      rewardXP: Math.max(0, Math.min(10000, Math.round(Number(rawEvent.rewardXP || 0))))
    };
  }
  if (type === "chestOpened") {
    const openerId = String(rawEvent.openerId || "").slice(0, 80);
    const chestId = String(rawEvent.chestId || targetId || "").slice(0, 100);
    if (!openerId || !chestId) {
      return null;
    }
    return {
      ...base,
      targetOwnerId: String(rawEvent.targetOwnerId || openerId).slice(0, 80),
      targetId: chestId,
      chestId,
      openerId,
      openerName: String(rawEvent.openerName || "Player").slice(0, 28),
      chestKind: String(rawEvent.chestKind || "loot").slice(0, 16),
      chestTier: Math.max(1, Math.min(5, Math.round(Number(rawEvent.chestTier || 1)))),
      x: Math.round(Number(rawEvent.x || 0)),
      y: Math.round(Number(rawEvent.y || 0)),
      rewardGold: Math.max(0, Math.min(10000, Math.round(Number(rawEvent.rewardGold || 0)))),
      rewardResources: Math.max(0, Math.min(10000, Math.round(Number(rawEvent.rewardResources || 0))))
    };
  }
  const victimId = String(rawEvent.victimId || targetOwnerId || "").slice(0, 80);
  const killerId = String(rawEvent.killerId || "").slice(0, 80);
  if (!targetOwnerId || !victimId || victimId !== player.id || !killerId || killerId === player.id) {
    return null;
  }
  return {
    ...base,
    targetOwnerId,
    targetId,
    victimId,
    victimName: String(rawEvent.victimName || "Player").slice(0, 28),
    victimLevel: Math.max(1, Math.min(99, Math.round(Number(rawEvent.victimLevel || 1)))),
    killerId,
    killerName: String(rawEvent.killerName || rawEvent.sourceName || "Player").slice(0, 28),
    rewardGold: Math.max(0, Math.min(10000, Math.round(Number(rawEvent.rewardGold || 0)))),
    rewardResources: Math.max(0, Math.min(10000, Math.round(Number(rawEvent.rewardResources || 0)))),
    rewardXP: Math.max(0, Math.min(10000, Math.round(Number(rawEvent.rewardXP || 0))))
  };
}

function sanitizeStatus(status = null) {
  if (!status || typeof status !== "object") {
    return null;
  }
  const clean = {};
  for (const key of ["slow", "duration", "stun", "curse", "curseDamagePerSecond", "knockback"]) {
    if (Number.isFinite(status[key])) {
      clean[key] = Math.max(0, Math.min(20, Number(status[key])));
    }
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

function sanitizeSourceKind(kind = "remotePlayer") {
  const value = String(kind || "remotePlayer");
  return ["player", "remotePlayer", "tower", "mob", "hostile", "objective", "neutralTower"].includes(value)
    ? value
    : "remotePlayer";
}

function sanitizeRoomSettings(settings = {}) {
  const mapSizes = new Set(["small", "medium", "large"]);
  const worldOptions = settings.worldOptions && typeof settings.worldOptions === "object" ? settings.worldOptions : {};
  const seed = String(settings.worldSeed || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
  return {
    mapSize: mapSizes.has(settings.mapSize) ? settings.mapSize : "large",
    mode: settings.mode === "coop" ? "coop" : "versus",
    worldSeed: seed || makeWorldSeed(),
    worldOptions: {
      bosses: worldOptions.bosses !== false,
      towers: worldOptions.towers !== false,
      villages: worldOptions.villages !== false
    },
    maxPlayers: MAX_PLAYERS
  };
}

function makeWorldSeed() {
  return `bb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function handleRoomApi(req, reqUrl, res) {
  const parts = reqUrl.pathname.split("/").filter(Boolean);

  if (req.method === "POST" && reqUrl.pathname === "/api/rooms") {
    const body = await readJson(req);
    const player = body.player;
    if (!player?.id) {
      sendJson(res, 400, { error: "missing_player" });
      return true;
    }
    const code = makeRoomCode();
    const room = {
      code,
      hostId: player.id,
      status: "lobby",
      settings: sanitizeRoomSettings(body.settings),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      startedAt: null,
      players: [],
      events: [],
      nextEventSeq: 1
    };
    upsertPlayer(room, player);
    rooms.set(code, room);
    broadcastRoom(room);
    sendJson(res, 200, publicRoom(room));
    return true;
  }

  if (parts[0] !== "api" || parts[1] !== "rooms" || !parts[2]) {
    return false;
  }

  const code = normalizeRoomCode(parts[2]);
  const room = getFreshRoom(code);
  if (!room) {
    sendJson(res, 404, { error: "room_not_found" });
    return true;
  }

  try {
    if (req.method === "GET" && parts.length === 3) {
      const playerId = reqUrl.searchParams.get("playerId");
      if (playerId) {
        upsertPlayer(room, {
          id: playerId,
          name: reqUrl.searchParams.get("name") || "Player"
        });
        broadcastRoom(room);
      }
      sendJson(res, 200, publicRoom(room));
      return true;
    }

    if (req.method === "GET" && parts[3] === "events") {
      const playerId = reqUrl.searchParams.get("playerId");
      if (playerId) {
        upsertPlayer(room, {
          id: playerId,
          name: reqUrl.searchParams.get("name") || "Player"
        });
      }
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      res.write(`retry: 1500\n\n`);
      if (!roomStreams.has(room.code)) {
        roomStreams.set(room.code, new Set());
      }
      const streams = roomStreams.get(room.code);
      streams.add(res);
      sendRoomEvent(res, room);
      const ping = setInterval(() => {
        res.write(`event: ping\n`);
        res.write(`data: {}\n\n`);
      }, 20000);
      req.on("close", () => {
        clearInterval(ping);
        streams.delete(res);
        if (streams.size === 0) {
          roomStreams.delete(room.code);
        }
      });
      return true;
    }

    if (req.method === "POST" && parts[3] === "join") {
      const body = await readJson(req);
      if (room.status === "started" && !room.players.some((player) => player.id === body.player?.id)) {
        sendJson(res, 409, { error: "room_started" });
        return true;
      }
      upsertPlayer(room, body.player);
      broadcastRoom(room);
      sendJson(res, 200, publicRoom(room));
      return true;
    }

    if (req.method === "POST" && parts[3] === "start") {
      const body = await readJson(req);
      if (body.playerId !== room.hostId) {
        sendJson(res, 403, { error: "host_only" });
        return true;
      }
      // Everyone except the host must Ready up first (solo host can start alone).
      const allReady = room.players.every((player) => player.id === room.hostId || player.ready);
      if (room.players.length > 1 && !allReady) {
        sendJson(res, 409, { error: "not_ready" });
        return true;
      }
      room.settings = sanitizeRoomSettings({ ...room.settings, ...(body.settings || {}) });
      room.status = "started";
      room.startedAt = Date.now();
      room.startAt = Date.now() + START_COUNTDOWN_MS;
      broadcastRoom(room);
      sendJson(res, 200, publicRoom(room));
      return true;
    }

    if (req.method === "POST" && parts[3] === "ready") {
      const body = await readJson(req);
      const player = room.players.find((candidate) => candidate.id === body.playerId);
      if (player) {
        player.ready = Boolean(body.ready);
        player.lastSeen = Date.now();
        room.updatedAt = Date.now();
        broadcastRoom(room);
      }
      sendJson(res, 200, publicRoom(room));
      return true;
    }

    if (req.method === "POST" && parts[3] === "state") {
      const body = await readJson(req);
      upsertPlayer(room, body.player, body.state || null);
      appendRoomEvents(room, body.events, body.player);
      markRoomDirty(room);
      // Lean mode: the client has a healthy SSE stream (its state channel), so
      // the upload only needs a tiny ack instead of the full room payload.
      if (body.lean) {
        sendJson(res, 200, { ok: true, code: room.code, serverNow: Date.now() });
        return true;
      }
      sendJson(res, 200, publicRoom(room));
      return true;
    }

    if (req.method === "POST" && parts[3] === "leave") {
      const body = await readJson(req);
      room.players = room.players.filter((player) => player.id !== body.playerId);
      if (room.players.length === 0) {
        rooms.delete(room.code);
        broadcastRoomRemoved(room.code);
        sendJson(res, 200, { ok: true, removed: true });
        return true;
      }
      if (room.hostId === body.playerId) {
        room.hostId = room.players[0].id;
      }
      broadcastRoom(room);
      sendJson(res, 200, publicRoom(room));
      return true;
    }
  } catch (error) {
    const status = error.message === "room_full" ? 409 : 400;
    sendJson(res, status, { error: error.message || "room_error" });
    return true;
  }

  return false;
}

function resolveStaticPath(reqUrl) {
  const pathname = reqUrl.pathname === "/" ? "/index.html" : reqUrl.pathname;
  const decoded = decodeURIComponent(pathname);
  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(staticRoot, normalized);
  const relative = path.relative(staticRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return filePath;
}

async function serveStatic(reqUrl, res) {
  const filePath = resolveStaticPath(reqUrl);
  if (!filePath) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": mimeTypes[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(content);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    sendJson(res, 500, { error: "static_file_error", message: error.message });
  }
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && reqUrl.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      app: "basebound",
      version: "0.1.0",
      network: getNetworkInfo(req).multiplayer
    });
    return;
  }

  if (req.method === "GET" && reqUrl.pathname === "/api/network") {
    sendJson(res, 200, getNetworkInfo(req));
    return;
  }

  if (reqUrl.pathname.startsWith("/api/rooms")) {
    try {
      const handled = await handleRoomApi(req, reqUrl, res);
      if (handled) {
        return;
      }
    } catch (error) {
      sendJson(res, 400, { error: error.message || "room_error" });
      return;
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  await serveStatic(reqUrl, res);
});

function getLanUrls() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => `http://${entry.address}:${port}`);
}

function getNetworkInfo(req) {
  const publicUrl = process.env.PUBLIC_URL ? String(process.env.PUBLIC_URL).replace(/\/+$/, "") : "";
  const protocol = req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http");
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${port}`;
  const origin = publicUrl || `${protocol}://${hostHeader}`;
  let hostname = String(hostHeader).split(":")[0];
  if (publicUrl) {
    try {
      hostname = new URL(publicUrl).hostname;
    } catch {}
  }
  const localHostnames = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
  return {
    origin,
    hostname,
    port,
    isLocalOnlyUrl: localHostnames.has(hostname),
    lanUrls: getLanUrls(),
    multiplayer: {
      roomApi: true,
      realtime: true,
      maxPlayers: MAX_PLAYERS,
      transport: "server-sent-events"
    }
  };
}

server.listen(port, host, () => {
  console.log(`Basebound running locally at http://localhost:${port}`);
  console.log(`Serving files from ${staticRoot}`);
  for (const url of getLanUrls()) {
    console.log(`Basebound available on your network at ${url}`);
  }
});
