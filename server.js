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
      if (body.length > 100_000) {
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
    .slice(0, 2)
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
    createdAt: cleaned.createdAt,
    updatedAt: cleaned.updatedAt,
    startedAt: cleaned.startedAt,
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
    state: state === undefined ? existingIndex >= 0 ? room.players[existingIndex].state : null : state
  };
  if (existingIndex >= 0) {
    room.players[existingIndex] = payload;
    return;
  }
  if (room.players.length >= 2) {
    throw new Error("room_full");
  }
  room.players.push(payload);
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
      createdAt: Date.now(),
      updatedAt: Date.now(),
      startedAt: null,
      players: []
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
      room.status = "started";
      room.startedAt = Date.now();
      broadcastRoom(room);
      sendJson(res, 200, publicRoom(room));
      return true;
    }

    if (req.method === "POST" && parts[3] === "state") {
      const body = await readJson(req);
      upsertPlayer(room, body.player, body.state || null);
      broadcastRoom(room);
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
      maxPlayers: 2,
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
