// @ts-check

const ROOM_PREFIX = "basebound.room.";
const ROOM_TTL_MS = 1000 * 60 * 45;
const PLAYER_STALE_MS = 1000 * 35;
const MAX_ROOM_PLAYERS = 8;

export class MultiplayerRoomClient {
  constructor(displayName = "Player") {
    this.displayName = displayName || "Player";
    this.playerId = getOrCreatePlayerId();
    this.roomCode = null;
    this.isHost = false;
    this.transport = null;
    this.transportLabel = "Local";
    this.isRemote = false;
    this.sendTimer = 0;
    this.pollTimer = 0;
    this.busy = false;
    this.lastRoom = null;
    this.unsubscribeRoom = null;
    this.roomUpdateHandler = null;
  }

  async createRoom(settings = {}) {
    const player = this.playerPayload(true);
    const { transport, room } = await withFallback((candidate) => candidate.createRoom(player, settings));
    this.transport = transport;
    this.transportLabel = transport.label;
    this.isRemote = Boolean(transport.isRemote);
    this.roomCode = room.code;
    this.isHost = room.hostId === this.playerId;
    this.lastRoom = room;
    return room;
  }

  async joinRoom(code) {
    const player = this.playerPayload(false);
    const { transport, room } = await withFallback((candidate) => candidate.joinRoom(code, player));
    this.transport = transport;
    this.transportLabel = transport.label;
    this.isRemote = Boolean(transport.isRemote);
    this.roomCode = room.code;
    this.isHost = room.hostId === this.playerId;
    this.lastRoom = room;
    return room;
  }

  subscribe(onRoom) {
    this.roomUpdateHandler = typeof onRoom === "function" ? onRoom : null;
    this.unsubscribeRoom?.();
    this.unsubscribeRoom = null;
    if (!this.roomUpdateHandler || !this.transport?.subscribeRoom || !this.roomCode) {
      return;
    }
    this.unsubscribeRoom = this.transport.subscribeRoom(
      this.roomCode,
      this.playerPayload(this.isHost),
      (room) => {
        this.lastRoom = room;
        this.isHost = room.hostId === this.playerId;
        this.roomUpdateHandler?.(room);
      }
    );
  }

  async getRoom() {
    if (!this.transport || !this.roomCode) {
      return null;
    }
    this.lastRoom = await this.transport.getRoom(this.roomCode, this.playerPayload(this.isHost));
    this.isHost = this.lastRoom.hostId === this.playerId;
    return this.lastRoom;
  }

  async startRoom(settings = {}) {
    if (!this.transport || !this.roomCode) {
      throw new Error("Create or join a room first.");
    }
    this.lastRoom = await this.transport.startRoom(this.roomCode, this.playerId, settings);
    return this.lastRoom;
  }

  async leaveRoom() {
    if (!this.transport || !this.roomCode) {
      return;
    }
    const roomCode = this.roomCode;
    this.roomCode = null;
    this.subscribe(null);
    await this.transport.leaveRoom(roomCode, this.playerId).catch(() => {});
  }

  tick(scene, dt) {
    if (!this.transport || !this.roomCode || this.busy) {
      return;
    }
    this.sendTimer -= dt;
    this.pollTimer -= dt;
    if (this.sendTimer > 0 && this.pollTimer > 0) {
      return;
    }

    const shouldSend = this.sendTimer <= 0;
    this.sendTimer = shouldSend ? 0.1 : this.sendTimer;
    this.pollTimer = this.pollTimer <= 0 ? 0.45 : this.pollTimer;
    this.busy = true;
    const state = shouldSend ? scene.snapshotForMultiplayer() : null;
    const task = state
      ? this.transport.updatePlayerState(this.roomCode, this.playerPayload(this.isHost), state)
      : this.transport.getRoom(this.roomCode, this.playerPayload(this.isHost));

    task
      .then((room) => {
        this.lastRoom = room;
        this.applyRoomToScene(scene, room);
      })
      .catch((error) => {
        scene.addToast?.(`Room sync paused: ${error.message}`);
      })
      .finally(() => {
        this.busy = false;
      });
  }

  applyRoomToScene(scene, room) {
    const remotes = (room.players || []).filter((player) => player.id !== this.playerId && player.state);
    scene.setRemoteSnapshots(remotes);
  }

  playerPayload(isHost = false) {
    return {
      id: this.playerId,
      name: this.displayName || "Player",
      isHost
    };
  }
}

class HttpRoomTransport {
  constructor() {
    this.label = "Server Realtime";
    this.isRemote = true;
  }

  async createRoom(player, settings = {}) {
    return requestJson("/api/rooms", {
      method: "POST",
      body: { player, settings }
    });
  }

  async joinRoom(code, player) {
    return requestJson(`/api/rooms/${encodeURIComponent(code)}/join`, {
      method: "POST",
      body: { player }
    });
  }

  async getRoom(code, player) {
    return requestJson(`/api/rooms/${encodeURIComponent(code)}?playerId=${encodeURIComponent(player.id)}&name=${encodeURIComponent(player.name)}`);
  }

  async startRoom(code, playerId, settings = {}) {
    return requestJson(`/api/rooms/${encodeURIComponent(code)}/start`, {
      method: "POST",
      body: { playerId, settings }
    });
  }

  async updatePlayerState(code, player, state) {
    return requestJson(`/api/rooms/${encodeURIComponent(code)}/state`, {
      method: "POST",
      body: { player, state }
    });
  }

  async leaveRoom(code, playerId) {
    return requestJson(`/api/rooms/${encodeURIComponent(code)}/leave`, {
      method: "POST",
      body: { playerId }
    });
  }

  subscribeRoom(code, player, onRoom) {
    if (!("EventSource" in window)) {
      return null;
    }
    const source = new EventSource(
      `/api/rooms/${encodeURIComponent(code)}/events?playerId=${encodeURIComponent(player.id)}&name=${encodeURIComponent(player.name)}`
    );
    source.addEventListener("room", (event) => {
      try {
        onRoom(JSON.parse(event.data));
      } catch {}
    });
    source.addEventListener("removed", () => {
      source.close();
    });
    return () => source.close();
  }
}

class LocalRoomTransport {
  constructor() {
    this.label = "Local Tabs";
    this.isRemote = false;
  }

  async createRoom(player, settings = {}) {
    let code = makeRoomCode();
    while (readRoom(code)) {
      code = makeRoomCode();
    }
    const room = cleanRoom({
      code,
      hostId: player.id,
      status: "lobby",
      transport: "local",
      maxPlayers: MAX_ROOM_PLAYERS,
      settings: sanitizeLocalSettings(settings),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      startedAt: null,
      players: [{ ...player, isHost: true, joinedAt: Date.now(), lastSeen: Date.now(), state: null }]
    });
    writeRoom(room);
    return room;
  }

  async joinRoom(code, player) {
    const normalized = normalizeRoomCode(code);
    const room = readRoom(normalized);
    if (!room) {
      throw new Error("Room not found.");
    }
    if (room.status === "started" && !room.players.some((existing) => existing.id === player.id)) {
      throw new Error("That room has already started.");
    }
    const existingIndex = room.players.findIndex((existing) => existing.id === player.id);
    if (existingIndex >= 0) {
      room.players[existingIndex] = { ...room.players[existingIndex], ...player, lastSeen: Date.now() };
    } else {
      if (room.players.length >= MAX_ROOM_PLAYERS) {
        throw new Error("This room is full.");
      }
      room.players.push({ ...player, isHost: false, joinedAt: Date.now(), lastSeen: Date.now(), state: null });
    }
    room.updatedAt = Date.now();
    writeRoom(cleanRoom(room));
    return readRoom(normalized);
  }

  async getRoom(code, player) {
    const room = readRoom(code);
    if (!room) {
      throw new Error("Room not found.");
    }
    const index = room.players.findIndex((existing) => existing.id === player.id);
    if (index >= 0) {
      room.players[index] = { ...room.players[index], name: player.name, lastSeen: Date.now() };
      room.updatedAt = Date.now();
      writeRoom(cleanRoom(room));
    }
    return readRoom(code);
  }

  async startRoom(code, playerId, settings = {}) {
    const room = readRoom(code);
    if (!room) {
      throw new Error("Room not found.");
    }
    if (room.hostId !== playerId) {
      throw new Error("Only the host can start.");
    }
    room.settings = sanitizeLocalSettings({ ...room.settings, ...settings });
    room.status = "started";
    room.startedAt = Date.now();
    room.updatedAt = Date.now();
    writeRoom(room);
    return room;
  }

  async updatePlayerState(code, player, state) {
    const room = await this.getRoom(code, player);
    const index = room.players.findIndex((existing) => existing.id === player.id);
    if (index >= 0) {
      room.players[index] = {
        ...room.players[index],
        ...player,
        lastSeen: Date.now(),
        state
      };
    }
    room.updatedAt = Date.now();
    writeRoom(cleanRoom(room));
    return readRoom(code);
  }

  async leaveRoom(code, playerId) {
    const room = readRoom(code);
    if (!room) {
      return null;
    }
    room.players = room.players.filter((player) => player.id !== playerId);
    if (room.players.length === 0) {
      localStorage.removeItem(`${ROOM_PREFIX}${normalizeRoomCode(code)}`);
      return null;
    }
    if (room.hostId === playerId) {
      room.hostId = room.players[0].id;
    }
    room.updatedAt = Date.now();
    writeRoom(cleanRoom(room));
    return readRoom(code);
  }
}

async function withFallback(operation) {
  const candidates = [new HttpRoomTransport(), new LocalRoomTransport()];
  let lastError = null;
  for (const transport of candidates) {
    try {
      const room = await operation(transport);
      return { transport, room };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Room service unavailable.");
}

async function requestJson(path, { method = "GET", body = null } = {}) {
  const response = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    let message = `Room request failed (${response.status}).`;
    try {
      message = (await response.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  return response.json();
}

function readRoom(code) {
  try {
    const room = JSON.parse(localStorage.getItem(`${ROOM_PREFIX}${normalizeRoomCode(code)}`) || "null");
    if (!room || Date.now() - room.updatedAt > ROOM_TTL_MS) {
      return null;
    }
    return cleanRoom(room);
  } catch {
    return null;
  }
}

function writeRoom(room) {
  localStorage.setItem(`${ROOM_PREFIX}${room.code}`, JSON.stringify(room));
}

function cleanRoom(room) {
  const now = Date.now();
  const players = (room.players || []).filter((player) => player.id === room.hostId || now - player.lastSeen < PLAYER_STALE_MS);
  return {
    ...room,
    code: normalizeRoomCode(room.code),
    maxPlayers: MAX_ROOM_PLAYERS,
    settings: sanitizeLocalSettings(room.settings),
    players: players.slice(0, MAX_ROOM_PLAYERS).map((player) => ({
      ...player,
      isHost: player.id === room.hostId
    }))
  };
}

function sanitizeLocalSettings(settings = {}) {
  const mapSize = ["small", "medium", "large"].includes(settings.mapSize) ? settings.mapSize : "large";
  const worldOptions = settings.worldOptions && typeof settings.worldOptions === "object" ? settings.worldOptions : {};
  const worldSeed = String(settings.worldSeed || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || makeWorldSeed();
  return {
    mapSize,
    worldSeed,
    worldOptions: {
      bosses: worldOptions.bosses !== false,
      towers: worldOptions.towers !== false,
      villages: worldOptions.villages !== false
    },
    maxPlayers: MAX_ROOM_PLAYERS
  };
}

function makeWorldSeed() {
  return `bb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function normalizeRoomCode(code) {
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function getOrCreatePlayerId() {
  return `player-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}







