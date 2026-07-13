// @ts-check
import { CONFIG } from "./config.js?v=1.8.64";

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
    this.outgoingEvents = [];
    this.serverClockOffset = 0;
  }

  // Track the server clock so the synchronized match start lines up across
  // clients with different local clocks.
  noteServerTime(room) {
    if (room && Number.isFinite(room.serverNow)) {
      this.serverClockOffset = room.serverNow - Date.now();
    }
  }

  adjustedNow() {
    return Date.now() + this.serverClockOffset;
  }

  async setReady(ready) {
    if (!this.transport || !this.roomCode || !this.transport.setReady) {
      return null;
    }
    this.lastRoom = await this.transport.setReady(this.roomCode, this.playerId, Boolean(ready));
    this.noteServerTime(this.lastRoom);
    return this.lastRoom;
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
    this.noteServerTime(room);
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
    this.noteServerTime(room);
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
        this.lastSseAt = Date.now();
        this.lastRoom = room;
        this.isHost = room.hostId === this.playerId;
        this.roomUpdateHandler?.(room);
      }
    );
  }

  // When the SSE stream is healthy it is the single state channel; state POSTs
  // then request a lean ack instead of pulling the full room back every send.
  isSseHealthy() {
    return Boolean(this.lastSseAt && Date.now() - this.lastSseAt < 2500);
  }

  async getRoom() {
    if (!this.transport || !this.roomCode) {
      return null;
    }
    this.lastRoom = await this.transport.getRoom(this.roomCode, this.playerPayload(this.isHost));
    this.isHost = this.lastRoom.hostId === this.playerId;
    this.noteServerTime(this.lastRoom);
    return this.lastRoom;
  }

  async startRoom(settings = {}) {
    if (!this.transport || !this.roomCode) {
      throw new Error("Create or join a room first.");
    }
    this.lastRoom = await this.transport.startRoom(this.roomCode, this.playerId, settings);
    this.noteServerTime(this.lastRoom);
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
    const hasQueuedEvents = this.outgoingEvents.length > 0;
    if (this.sendTimer > 0 && this.pollTimer > 0 && !hasQueuedEvents) {
      return;
    }

    const shouldSend = this.sendTimer <= 0 || hasQueuedEvents;
    const queuedEvents = this.outgoingEvents.splice(0, CONFIG.multiplayer?.maxEventsPerSync || 24);
    this.sendTimer = shouldSend ? (CONFIG.multiplayer?.playerSyncIntervalMs || 125) / 1000 : this.sendTimer;
    this.pollTimer = this.pollTimer <= 0 ? (CONFIG.multiplayer?.pollIntervalMs || 650) / 1000 : this.pollTimer;
    this.busy = true;
    const state = shouldSend || queuedEvents.length > 0 ? scene.snapshotForMultiplayer() : null;
    const lean = Boolean(state && this.isSseHealthy() && this.transport.isRemote);
    const task = state
      ? this.transport.updatePlayerState(this.roomCode, this.playerPayload(this.isHost), state, queuedEvents, lean)
      : this.transport.getRoom(this.roomCode, this.playerPayload(this.isHost));

    task
      .then((room) => {
        if (!room || !Array.isArray(room.players)) {
          // Lean ack: SSE delivers the room state; just track the server clock.
          this.noteServerTime(room);
          return;
        }
        this.lastRoom = room;
        this.applyRoomToScene(scene, room);
      })
      .catch((error) => {
        if (queuedEvents.length > 0) {
          this.outgoingEvents.unshift(...queuedEvents);
          this.outgoingEvents = this.outgoingEvents.slice(-64);
        }
        scene.addToast?.(`Room sync paused: ${error.message}`);
      })
      .finally(() => {
        this.busy = false;
      });
  }

  applyRoomToScene(scene, room) {
    this.noteServerTime(room);
    this.isHost = room.hostId === this.playerId;
    scene.isHost = this.isHost;
    scene.worldHostId = room.hostId || scene.worldHostId;
    const remotes = (room.players || []).filter((player) => player.id !== this.playerId && player.state);
    scene.setRemoteSnapshots(remotes);
    scene.applyRemoteCombatEvents?.(room.events || []);
  }

  queueCombatEvent(event) {
    if (!event || !this.roomCode) {
      return;
    }
    this.outgoingEvents.push({
      ...event,
      id: event.id || `evt-${this.playerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sourcePlayerId: this.playerId,
      sourceName: this.displayName || "Player",
      timestamp: Date.now()
    });
    this.outgoingEvents = this.outgoingEvents.slice(-64);
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

  async setReady(code, playerId, ready) {
    return requestJson(`/api/rooms/${encodeURIComponent(code)}/ready`, {
      method: "POST",
      body: { playerId, ready }
    });
  }

  async updatePlayerState(code, player, state, events = [], lean = false) {
    return requestJson(`/api/rooms/${encodeURIComponent(code)}/state`, {
      method: "POST",
      body: { player, state, events, lean }
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
    room.startAt = Date.now() + 5000;
    room.updatedAt = Date.now();
    writeRoom(room);
    return room;
  }

  async setReady(code, playerId, ready) {
    const room = readRoom(code);
    if (!room) {
      throw new Error("Room not found.");
    }
    const index = room.players.findIndex((existing) => existing.id === playerId);
    if (index >= 0) {
      room.players[index] = { ...room.players[index], ready: Boolean(ready), lastSeen: Date.now() };
      room.updatedAt = Date.now();
      writeRoom(cleanRoom(room));
    }
    return readRoom(code);
  }

  async updatePlayerState(code, player, state, events = []) {
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
    appendLocalEvents(room, events, player);
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

function appendLocalEvents(room, events = [], player = {}) {
  if (!Array.isArray(events) || events.length === 0) {
    return;
  }
  room.events ||= [];
  room.nextEventSeq ||= 1;
  for (const event of events.slice(0, 24)) {
    if (!event?.type || event.sourcePlayerId !== player.id) {
      continue;
    }
    room.events.push({
      ...event,
      seq: room.nextEventSeq++,
      serverTime: Date.now()
    });
  }
  room.events = room.events.slice(-240);
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
    mode: settings.mode === "coop" ? "coop" : "versus",
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



