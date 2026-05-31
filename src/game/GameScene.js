// @ts-check
import { BaseController } from "./Base.js?v=1.8.61";
import { AIPlayerController } from "./AIPlayer.js?v=1.8.61";
import { getCharacterClass, randomCharacterClassId } from "./CharacterClasses.js?v=1.8.61";
import { CONFIG } from "./config.js?v=1.8.61";
import { FutureMultiplayerContracts } from "./FutureMultiplayerInterfaces.js?v=1.8.61";
import { GameMap } from "./Map.js?v=1.8.61";
import { LowPolyRenderer } from "./LowPolyRenderer.js?v=1.8.61";
import { MatchManager } from "./MatchManager.js?v=1.8.61";
import { Mob } from "./Mob.js?v=1.8.61";
import { createObjectives } from "./Objective.js?v=1.8.61";
import { Player } from "./Player.js?v=1.8.61";
import { RewardSystem } from "./RewardSystem.js?v=1.8.61";
import { UIManager } from "./UIManager.js?v=1.8.61";
import { DEFAULT_KEYBINDINGS } from "./InputBindings.js?v=1.8.61";
import { clamp, circleIntersects, distance, distanceSq, formatTime, normalize, randRange } from "./math.js?v=1.8.61";

// `healthRatio` is a derived getter on real entities (Entity/Mob/Player/Objective),
// so assigning to it throws "Cannot set property healthRatio ... which has only a
// getter" and pauses room sync. Network proxies, by contrast, are plain objects that
// DO store healthRatio. This helper writes the value only when it is safe (plain
// carriers); entities keep deriving it from health/maxHealth. Preferred sync model:
// replicate raw health + maxHealth and compute the ratio locally for health bars.
function setSyncedHealthRatio(target, ratio) {
  if (!target) {
    return;
  }
  let obj = target;
  while (obj && obj !== Object.prototype) {
    const desc = Object.getOwnPropertyDescriptor(obj, "healthRatio");
    if (desc) {
      if (desc.get && !desc.set) {
        return; // derived getter — value comes from health/maxHealth
      }
      break;
    }
    obj = Object.getPrototypeOf(obj);
  }
  target.healthRatio = ratio;
}

export class GameScene {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.lowPolyCanvas = document.querySelector("#threeCanvas");
    this.lowPolyRenderer = null;
    this.minimapCanvas = document.querySelector("#minimapCanvas");
    this.minimapCtx = this.minimapCanvas?.getContext("2d") || null;
    this.dpr = 1;
    this.viewWidth = 0;
    this.viewHeight = 0;
    this.camera = { x: 0, y: 0 };
    this.input = {
      keys: new Set(),
      mouseScreen: { x: 0, y: 0 },
      mouseWorld: { x: 0, y: 0 }
    };
    this.lastPrimaryMouseDownAt = 0;
    this.lastTime = 0;
    this.started = false;
    this.destroyed = false;
    this.keybindings = { ...DEFAULT_KEYBINDINGS, ...(options.keybindings || {}) };
    this.multiplayer = options.multiplayer || null;
    // In a real multiplayer room the roster is human players; AI rivals are
    // simulated independently per client and would desync, so disable them.
    this.aiCount = this.multiplayer ? 0 : Math.max(0, Math.min(7, Number(options.aiCount || 0)));
    this.mapSizeId = CONFIG.mapSizes?.[options.mapSize] ? options.mapSize : CONFIG.world.mapSize || "large";
    this.applyMapSizeConfig(this.mapSizeId);
    this.worldOptions = {
      bosses: true,
      towers: true,
      villages: true,
      ...(options.worldOptions || {})
    };
    this.selectedCharacterId = getCharacterClass(options.characterId || "ranger").id;
    this.aiClassAssignments = Array.isArray(options.aiClassAssignments) ? options.aiClassAssignments : [];
    this.isHost = Boolean(options.isHost);
    this.playerName = options.playerName || "Basebound Scout";
    this.roomCode = options.roomCode || null;
    this.worldSeed = options.worldSeed || null;
    this.onLeaveMatch = typeof options.onLeaveMatch === "function" ? options.onLeaveMatch : null;
    // Server-clock timestamp at which all clients begin the match together (0 = no sync gate).
    this.matchStartAt = Number.isFinite(options.startAt) ? options.startAt : 0;
    this.remotePlayers = new Map();
    this.remoteBases = new Map();
    this.rewardSystem = new RewardSystem();
    this.ui = new UIManager({
      placeBase: () => this.toggleBasePlacementPreview(),
      upgrade: (type) => this.upgradeBuilding(type),
      upgradeBuildingById: (id) => this.upgradeBuildingById(id),
      upgradeAllOfType: (type) => this.upgradeAllOfType(type),
      addCurrency: () => this.debugAddCurrency(),
      addXP: () => this.debugAddXP(),
      damageCore: () => this.debugDamageCore(),
      spawnMobs: () => this.debugSpawnMobs(),
      advancePhase: () => this.debugAdvancePhase(),
      equipLoot: (id, slot) => this.equipLoot(id, slot),
      pickupLoot: (id) => this.pickupLoot(id),
      pickupAllLoot: () => this.pickupAllNearbyLoot(),
      depositLoot: () => this.depositLootAtCore(),
      deleteLoot: (id) => this.deleteLoot(id),
      sellLoot: (id) => this.sellLoot(id),
      upgradeAbility: (id) => this.upgradeAbility(id),
      upgradeAttribute: (id) => this.upgradeAttribute(id),
      toggleCameraLock: () => this.toggleCameraLock(),
      buyWard: () => this.buyWard(),
      placeWard: () => this.placeWardAtNearestSite(),
      buyShopItem: (tierKey) => this.buyShopItem(tierKey),
      buyPotion: () => this.buyHealthPotion(),
      usePotion: () => this.useHealthPotion(),
      buyDefense: (type) => this.buyDefense(type),
      upgradeWallHealth: () => this.upgradeWallHealth(),
      repairWalls: () => this.repairWalls(),
      rebuildWalls: () => this.rebuildWalls(),
      quickUpgradeBuilding: (id) => this.quickUpgradeBuilding(id),
      openBuildingUpgradeList: (id) => this.openBuildingUpgradeList(id),
      basicAttack: () => this.handlePrimaryAttackInput(),
      toggleAbility: (id) => this.toggleAbilityPreview(id),
      setBaseLayout: (layoutId) => this.setBaseLayout(layoutId),
      leaveMatch: () => this.leaveMatch(),
      reset: () => this.reset()
    });

    this.bindEvents();
    this.reset();
    this.multiplayer?.subscribe?.((room) => this.multiplayer.applyRoomToScene(this, room));
    console.info("Basebound multiplayer-ready contracts", FutureMultiplayerContracts);
  }

  applyMapSizeConfig(mapSizeId = "large") {
    const mapSize = CONFIG.mapSizes?.[mapSizeId] || CONFIG.mapSizes?.large;
    if (!mapSize) {
      return;
    }
    CONFIG.world.mapSize = mapSizeId;
    CONFIG.world.width = mapSize.width;
    CONFIG.world.height = mapSize.height;
  }

  initLowPolyRenderer() {
    if (!this.lowPolyCanvas || !LowPolyRenderer.isAvailable()) {
      this.lowPolyCanvas && (this.lowPolyCanvas.hidden = true);
      return;
    }
    if (!this.lowPolyRenderer) {
      this.lowPolyRenderer = new LowPolyRenderer(this.lowPolyCanvas);
    }
    this.lowPolyRenderer.reset(this);
  }

  start() {
    if (this.started || this.destroyed) {
      return;
    }
    this.started = true;
    this.resize();
    requestAnimationFrame((time) => this.loop(time));
  }

  reset() {
    this.applyMapSizeConfig(this.mapSizeId);
    this.base = new BaseController();
    this.selectedBaseLayoutId = "outpost";
    this.basePlacementPreviewActive = false;
    this.baseReplotsRemaining = CONFIG.base.maxReplots;
    this.match = new MatchManager();
    this.createSharedWorldState();
    this.spawnPoint = this.selectRandomSpawnPoint();
    document.body.dataset.spawnX = String(Math.round(this.spawnPoint.x));
    document.body.dataset.spawnY = String(Math.round(this.spawnPoint.y));
    this.player = new Player(this.spawnPoint.x, this.spawnPoint.y, this.selectedCharacterId);
    this.player.id = this.multiplayer?.playerId || "player-local";
    this.player.displayName = this.playerName;
    this.worldHostId = this.multiplayer?.lastRoom?.hostId || (this.isHost ? this.player.id : null);
    this.aiPlayers = this.createAIPlayers();
    this.createFogOfWar();
    this.mobs = [];
    this.projectiles = [];
    this.areaEffects = [];
    this.delayedAreaEffects = [];
    this.baseEffects = [];
    this.baseDefenders = [];
    this.droppedLoot = [];
    this.placedWards = [];
    this.floatingTexts = [];
    this.floatingTextPool = [];
    this.floatingTextSerial = 0;
    this.toasts = [];
    this.cameraLookTarget = null;
    this.cameraLocked = true;
    this.minimapDragging = false;
    this.queuedAbilityId = null;
    this.hoverTarget = null;
    this.hoveredBaseBuilding = null;
    this.selectedTarget = null;
    this.autoAttackToastTimer = 0;
    this.targetPanelDirty = true;
    this.spectating = false;
    this.spectatorFocusId = null;
    this.sceneStartedAt = Date.now();
    this.appliedRemoteCombatEventIds = new Set();
    this.appliedRemoteCombatEventOrder = [];
    this.sentPvPOutcomeEvents = new Set();
    this.recall = {
      active: false,
      timer: 0,
      duration: CONFIG.recall?.duration || 8
    };
    this.phaseWarningIndex = null;
    this.showDebugOverlay = false;
    // Optional mob-damage debug logging (source player, ability, amount, before/
    // after health). Toggle at runtime via the console: `game.debugMobDamage = true`.
    this.debugMobDamage = false;
    this.performanceStats = {
      fps: 0,
      mobs: 0,
      camps: 0,
      bosses: 0,
      ai: 0,
      projectiles: 0,
      towers: 0,
      effects: 0,
      pathfindingCalls: 0,
      collisionChecks: 0,
      uiHz: CONFIG.performance?.hudUpdateHz || 10
    };
    this.campStates = withSeededRandom(`${this.worldSeed || "local"}-camp-timers`, () =>
      this.campDefinitions.map((camp) => ({
        ...camp,
        timer: randRange(1, CONFIG.mobs.baseSpawnInterval)
      }))
    );
    this.campSpawnAccumulator = 0;
    this.waveTimer = CONFIG.mobs.waveInterval;
    this.objectiveIncomeTimer = 0;
    this.gameOver = false;
    this.gameWon = false;
    this.bossDefeated = false;
    this.bossSpawned = false;
    this.initLowPolyRenderer();
    this.ui.hideMessage();
    this.addToast(`Spawned near ${Math.round(this.spawnPoint.x)}, ${Math.round(this.spawnPoint.y)}. Scout and place your core.`);
    if (this.aiPlayers.length > 0) {
      this.addToast(`${this.aiPlayers.length} AI rival${this.aiPlayers.length === 1 ? "" : "s"} scouting the map.`);
    }
    if (this.roomCode) {
      this.addToast(`Room ${this.roomCode}: ${this.isHost ? "host" : "joined"} sync active.`);
    }
    if (this.isAuthoritativeWorldHost()) {
      this.spawnOpeningCamps();
    }
    this.updateFogOfWar();
  }

  createSharedWorldState() {
    const buildWorld = () => {
      this.map = new GameMap({ worldOptions: this.worldOptions });
      this.objectives = createObjectives(this.map);
      if (!this.worldOptions.bosses) {
        this.objectives = this.objectives.filter((objective) => objective.type !== "boss");
      }
      this.neutralTowers = (this.map.neutralTowers || []).map((tower) => this.hydrateNeutralTower(tower));
      this.villages = (this.map.villages || []).map((village) => ({ ...village }));
      this.campDefinitions = this.map.createCampConfigs(CONFIG.camps);
      this.wardSites = this.map.offsetConfigs(CONFIG.wardSites);
      this.explorationChests = this.createExplorationChests();
      this.roamingEncounters = this.map.offsetConfigs(CONFIG.roamingEncounters).map((encounter) => ({
        ...encounter,
        triggered: false
      }));
    };
    withSeededRandom(this.worldSeed, buildWorld);
  }

  hydrateNeutralTower(tower) {
    return {
      ...tower,
      takeDamage(amount) {
        const applied = Math.min(this.health, Math.max(0, amount));
        this.health -= applied;
        if (this.health <= 0) {
          this.health = 0;
          this.alive = false;
        }
        return applied;
      },
      get healthRatio() {
        return this.health / Math.max(1, this.maxHealth);
      }
    };
  }

  createExplorationChests() {
    const fixedChests = this.map.offsetConfigs(CONFIG.explorationChests).map((chest) => this.prepareExplorationChest(chest));
    const randomChests = this.map.offsetConfigs(CONFIG.randomExplorationChests).flatMap((roll) =>
      Array.from({ length: roll.count }, (_, index) => {
        const tier = Math.floor(randRange(roll.minTier, roll.maxTier + 1));
        return this.prepareExplorationChest({
          id: `${roll.id}-${index + 1}`,
          x: randRange(roll.xMin, roll.xMax),
          y: randRange(roll.yMin, roll.yMax),
          tier,
          kind: Math.random() < roll.baitChance ? "bait" : "loot"
        });
      })
    );
    return [...fixedChests, ...randomChests];
  }

  prepareExplorationChest(chest) {
    return {
      ...chest,
      radius: 30,
      opened: false,
      pulse: randRange(0, Math.PI * 2),
      displayTier: chest.kind === "bait" ? chest.displayTier || chest.tier : chest.tier
    };
  }

  createAIPlayers() {
    const players = [];
    for (let index = 0; index < this.aiCount; index += 1) {
      let spawn = this.selectRandomSpawnPoint();
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const farFromHero = distance(spawn, this.player) > 1800;
        const farFromAI = players.every((ai) => distance(spawn, ai.player) > 1400);
        if (farFromHero && farFromAI) {
          break;
        }
        spawn = this.selectRandomSpawnPoint();
      }
      players.push(
        new AIPlayerController(index, spawn, {
          characterId: this.aiClassAssignments[index] || randomCharacterClassId(this.selectedCharacterId)
        })
      );
    }
    return players;
  }

  selectRandomSpawnPoint() {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const candidate = {
        x: randRange(760, CONFIG.world.width - 760),
        y: randRange(760, CONFIG.world.height - 760)
      };
      if (this.isSafeSpawnPoint(candidate)) {
        return candidate;
      }
    }

    const fallbackSpawns = [
      { x: 5600, y: 2400 },
      { x: 9800, y: 4200 },
      { x: 4200, y: 6500 },
      { x: 11200, y: 6200 },
      { x: 15400, y: 5200 },
      { x: 6400, y: 11100 }
    ].filter((point) => this.isSafeSpawnPoint(point, 420));
    return fallbackSpawns[Math.floor(randRange(0, fallbackSpawns.length))] || { x: 5600, y: 2400 };
  }

  isSafeSpawnPoint(point, objectivePadding = 1050) {
    if (this.map.isRiverBlocked?.(point, 140)) {
      return false;
    }
    const insideZone = this.map.zones.some((zone) => pointInsideRect(point, zone, 140));
    if (insideZone) {
      return false;
    }
    const nearObjective = this.objectives.some((objective) => distance(point, objective) < objectivePadding + objective.radius);
    if (nearObjective) {
      return false;
    }
    if ((this.neutralTowers || []).some((tower) => distance(point, tower) < objectivePadding)) {
      return false;
    }
    if ((this.villages || []).some((village) => distance(point, village) < 620)) {
      return false;
    }
    const nearCamp = (this.campDefinitions || CONFIG.camps).some((camp) => distance(point, camp) < 720);
    if (nearCamp) {
      return false;
    }
    return true;
  }

  bindEvents() {
    this.boundHandlers = {
      resize: () => this.resize(),
      keydown: (event) => this.handleKeyDown(event),
      keyup: (event) => this.input.keys.delete(event.code),
      mousemove: (event) => this.handleMouseMove(event),
      mousedown: (event) => this.handleMouseDown(event),
      click: (event) => this.handleCanvasClick(event),
      contextmenu: (event) => event.preventDefault(),
      blur: () => this.clearMovementKeys(),
      visibilitychange: () => {
        if (document.hidden) {
          this.clearMovementKeys();
        }
      },
      uiPointerDown: (event) => {
        if (event.target !== this.canvas && event.target !== this.minimapCanvas) {
          this.clearMovementKeys();
        }
      },
      minimapPointerDown: (event) => this.handleMinimapPointerDown(event),
      minimapPointerMove: (event) => this.handleMinimapPointerMove(event),
      pointerup: () => {
        this.minimapDragging = false;
      }
    };
    window.addEventListener("resize", this.boundHandlers.resize);
    window.addEventListener("keydown", this.boundHandlers.keydown);
    window.addEventListener("keyup", this.boundHandlers.keyup);
    window.addEventListener("blur", this.boundHandlers.blur);
    document.addEventListener("visibilitychange", this.boundHandlers.visibilitychange);
    document.addEventListener("pointerdown", this.boundHandlers.uiPointerDown, true);
    this.canvas.addEventListener("mousemove", this.boundHandlers.mousemove);
    this.canvas.addEventListener("mousedown", this.boundHandlers.mousedown);
    this.canvas.addEventListener("click", this.boundHandlers.click);
    this.canvas.addEventListener("contextmenu", this.boundHandlers.contextmenu);
    this.minimapCanvas?.addEventListener("pointerdown", this.boundHandlers.minimapPointerDown);
    this.minimapCanvas?.addEventListener("pointermove", this.boundHandlers.minimapPointerMove);
    window.addEventListener("pointerup", this.boundHandlers.pointerup);
  }

  destroy() {
    this.destroyed = true;
    this.started = false;
    this.multiplayer?.subscribe?.(null);
    this.input.keys.clear();
    this.ui.setDrawer(false);
    if (this.boundHandlers) {
      window.removeEventListener("resize", this.boundHandlers.resize);
      window.removeEventListener("keydown", this.boundHandlers.keydown);
      window.removeEventListener("keyup", this.boundHandlers.keyup);
      window.removeEventListener("blur", this.boundHandlers.blur);
      document.removeEventListener("visibilitychange", this.boundHandlers.visibilitychange);
      document.removeEventListener("pointerdown", this.boundHandlers.uiPointerDown, true);
      window.removeEventListener("pointerup", this.boundHandlers.pointerup);
      this.canvas.removeEventListener("mousemove", this.boundHandlers.mousemove);
      this.canvas.removeEventListener("mousedown", this.boundHandlers.mousedown);
      this.canvas.removeEventListener("click", this.boundHandlers.click);
      this.canvas.removeEventListener("contextmenu", this.boundHandlers.contextmenu);
      this.minimapCanvas?.removeEventListener("pointerdown", this.boundHandlers.minimapPointerDown);
      this.minimapCanvas?.removeEventListener("pointermove", this.boundHandlers.minimapPointerMove);
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.viewWidth, this.viewHeight);
    this.lowPolyRenderer?.dispose();
    this.lowPolyRenderer = null;
  }

  resize() {
    this.viewWidth = this.canvas.clientWidth || window.innerWidth;
    this.viewHeight = this.canvas.clientHeight || window.innerHeight;
    this.dpr = 1;
    this.canvas.width = Math.floor(this.viewWidth * this.dpr);
    this.canvas.height = Math.floor(this.viewHeight * this.dpr);
    this.ctx.imageSmoothingEnabled = false;
    this.lowPolyRenderer?.resize(this.viewWidth, this.viewHeight);
  }

  captureRenderState() {
    return {
      viewWidth: this.viewWidth,
      viewHeight: this.viewHeight,
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      cameraX: this.camera.x,
      cameraY: this.camera.y
    };
  }

  restoreRenderState(state) {
    if (!state) {
      return;
    }
    this.viewWidth = state.viewWidth;
    this.viewHeight = state.viewHeight;
    this.dpr = 1;
    if (this.canvas.width !== state.canvasWidth || this.canvas.height !== state.canvasHeight) {
      this.canvas.width = state.canvasWidth;
      this.canvas.height = state.canvasHeight;
      this.ctx.imageSmoothingEnabled = false;
    }
    this.camera.x = clamp(state.cameraX, 0, Math.max(0, CONFIG.world.width - this.viewWidth));
    this.camera.y = clamp(state.cameraY, 0, Math.max(0, CONFIG.world.height - this.viewHeight));
    this.lowPolyRenderer?.resize?.(this.viewWidth, this.viewHeight);
  }

  syncMouseFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.input.mouseScreen.x = event.clientX - rect.left;
    this.input.mouseScreen.y = event.clientY - rect.top;
    this.input.mouseWorld = this.screenToWorld(this.input.mouseScreen);
  }

  handleMouseMove(event) {
    this.syncMouseFromEvent(event);
    this.hoverTarget = this.findTargetAtPoint(this.input.mouseWorld, CONFIG.combat?.autoAttack?.hoverRadius || 44);
    this.hoveredBaseBuilding = this.findFriendlyBaseBuildingAtPoint(this.input.mouseWorld);
  }

  handleMouseDown(event) {
    this.syncMouseFromEvent(event);
    if (event.button === 0) {
      this.lastPrimaryMouseDownAt = performance.now();
    }
    if (event.button === 0 && this.basePlacementPreviewActive) {
      event.preventDefault();
      this.placeBaseAtPlayer();
      return;
    }

    if (event.button === 0 && this.queuedAbilityId) {
      event.preventDefault();
      this.castQueuedAbility();
      return;
    }

    if (event.button === 0 && this.keybindings.basicAttack === "MouseLeft") {
      event.preventDefault();
      this.handlePrimaryAttackInput();
    }
  }

  handleCanvasClick(event) {
    if (event.button !== 0) {
      return;
    }
    const sinceMouseDown = performance.now() - (this.lastPrimaryMouseDownAt || 0);
    if (sinceMouseDown < 180) {
      return;
    }
    this.handleMouseDown(event);
  }

  handleMinimapPointerDown(event) {
    this.minimapDragging = true;
    this.handleMinimapPointer(event);
    this.minimapCanvas?.setPointerCapture?.(event.pointerId);
  }

  handleMinimapPointerMove(event) {
    if (!this.minimapDragging) {
      return;
    }
    this.handleMinimapPointer(event);
  }

  handleMinimapPointer(event) {
    if (!this.minimapCanvas) {
      return;
    }
    event.preventDefault();
    const rect = this.minimapCanvas.getBoundingClientRect();
    const xRatio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const yRatio = clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
    const worldX = xRatio * CONFIG.world.width;
    const worldY = yRatio * CONFIG.world.height;
    this.cameraLocked = false;
    this.cameraLookTarget = { x: worldX, y: worldY };
    this.camera.x = clamp(worldX - this.viewWidth / 2, 0, Math.max(0, CONFIG.world.width - this.viewWidth));
    this.camera.y = clamp(worldY - this.viewHeight / 2, 0, Math.max(0, CONFIG.world.height - this.viewHeight));
    this.input.mouseWorld = this.screenToWorld(this.input.mouseScreen);
  }

  handleKeyDown(event) {
    const gameKeys = new Set(Object.values(this.keybindings).filter((code) => code !== "MouseLeft"));
    if (gameKeys.has(event.code) || event.code === "Tab" || event.code === "Escape") {
      event.preventDefault();
    }

    if (this.isFormInputTarget(event.target) && event.code !== "Escape") {
      return;
    }

    this.input.keys.add(event.code);
    if (event.repeat) {
      return;
    }

    if (event.code === (CONFIG.performance?.debugKey || "F9")) {
      event.preventDefault();
      this.showDebugOverlay = !this.showDebugOverlay;
      this.addToast(`Performance debug ${this.showDebugOverlay ? "on" : "off"}.`);
      return;
    }

    if (event.code === "Tab") {
      this.clearMovementKeys();
      this.ui.open("inventory");
      return;
    }

    if (event.code === "Escape") {
      this.clearMovementKeys();
      // Back out of any open in-game menu/preview first; only open Settings
      // when nothing else is open.
      if (this.closeTopMenuOrPreview()) {
        return;
      }
      document.getElementById("settingsButton")?.click();
      return;
    }

    if (this.recall.active && !this.isBound(event.code, "recall")) {
      this.cancelRecall("Recall interrupted.");
    }

    if (this.isBound(event.code, "basicAttack")) {
      this.clearQueuedAbility();
      this.handlePrimaryAttackInput();
    } else if (this.isBound(event.code, "skillshot")) {
      this.toggleAbilityPreview("skillshot");
    } else if (this.isBound(event.code, "area")) {
      this.toggleAbilityPreview("area");
    } else if (this.isBound(event.code, "ultimate")) {
      this.toggleAbilityPreview("ultimate");
    } else if (this.isBound(event.code, "placeBase")) {
      this.clearQueuedAbility();
      if (this.openHoveredBaseBuildingMenu()) {
        return;
      }
      this.toggleBasePlacementPreview();
    } else if (this.isBound(event.code, "recall")) {
      this.clearQueuedAbility();
      this.startRecall();
    } else if (this.isBound(event.code, "cameraLock")) {
      this.toggleCameraLock();
    } else if (this.isBound(event.code, "usePotion")) {
      this.clearQueuedAbility();
      this.useHealthPotion();
    } else if (this.isBound(event.code, "quickWard")) {
      this.clearQueuedAbility();
      this.placeWardAtNearestSite();
    } else if (this.isBound(event.code, "placeWard")) {
      this.clearQueuedAbility();
      this.placeWardAtNearestSite();
    } else if (this.isBound(event.code, "debugCurrency")) {
      this.debugAddCurrency();
    } else if (this.isBound(event.code, "debugXp")) {
      this.debugAddXP();
    } else if (this.isBound(event.code, "debugCore")) {
      this.debugDamageCore();
    } else if (this.isBound(event.code, "debugMob")) {
      this.debugSpawnMobs();
    } else if (this.isBound(event.code, "debugPhase")) {
      this.debugAdvancePhase();
    } else if (this.isBound(event.code, "reset")) {
      this.reset();
    }
  }

  isBound(code, action) {
    return this.keybindings[action] === code;
  }

  toggleAbilityPreview(abilityId) {
    if (!this.player?.alive || this.gameOver || this.gameWon) {
      return;
    }
    if (this.queuedAbilityId === abilityId) {
      this.clearQueuedAbility();
      return;
    }
    const ability = this.player.abilityBook.abilities[abilityId];
    if (!ability) {
      return;
    }
    if (!ability.ready) {
      this.addToast(`${ability.config.label} is cooling down (${ability.cooldownRemaining.toFixed(1)}s).`);
      return;
    }
    this.queuedAbilityId = abilityId;
    this.addToast(`${ability.config.label} readied. Aim with mouse, left click to cast.`);
  }

  clearQueuedAbility() {
    this.queuedAbilityId = null;
  }

  // Esc backs out of one layer of UI/preview at a time.
  closeTopMenuOrPreview() {
    if (this.ui?.closeTopMenu?.()) {
      return true;
    }
    if (this.basePlacementPreviewActive) {
      this.basePlacementPreviewActive = false;
      this.addToast?.("Base placement cancelled.");
      return true;
    }
    if (this.queuedAbilityId) {
      this.clearQueuedAbility();
      return true;
    }
    if (this.selectedTarget) {
      this.clearSelectedTarget();
      return true;
    }
    return false;
  }

  findFriendlyBaseBuildingAtPoint(point) {
    if (!this.base?.active || !point) {
      return null;
    }
    let best = null;
    let bestScore = Infinity;
    for (const building of this.base.livingBuildings) {
      const padding = building.type === "wall" ? 8 : 18;
      const halfWidth = (building.width || building.radius * 2) / 2 + padding;
      const halfHeight = (building.height || building.radius * 2) / 2 + padding;
      const insideRect =
        point.x >= building.x - halfWidth &&
        point.x <= building.x + halfWidth &&
        point.y >= building.y - halfHeight &&
        point.y <= building.y + halfHeight;
      const targetRadius = (building.radius || 24) + padding;
      const insideCircle = distance(point, building) <= targetRadius;
      if (!insideRect && !insideCircle) {
        continue;
      }
      const score = Math.max(0, distance(point, building) - targetRadius);
      if (score < bestScore) {
        best = building;
        bestScore = score;
      }
    }
    if (best) {
      return best;
    }
    const screenPoint = this.input?.mouseScreen;
    const project = this.lowPolyRenderer?.worldToScreen?.bind(this.lowPolyRenderer);
    if (!screenPoint || !project) {
      return null;
    }
    let screenBest = null;
    let screenBestScore = Infinity;
    for (const building of this.base.livingBuildings) {
      const zHeight = building.type === "wall" ? 0.55 : building.type === "core" ? 1.25 : 0.95;
      if (building.type === "wall" || Number.isFinite(building.width) || Number.isFinite(building.height)) {
        const halfWidth = (building.width || 36) / 2;
        const halfHeight = (building.height || 36) / 2;
        const corners = [
          project(building.x - halfWidth, building.y - halfHeight, zHeight, this.viewWidth, this.viewHeight),
          project(building.x + halfWidth, building.y - halfHeight, zHeight, this.viewWidth, this.viewHeight),
          project(building.x + halfWidth, building.y + halfHeight, zHeight, this.viewWidth, this.viewHeight),
          project(building.x - halfWidth, building.y + halfHeight, zHeight, this.viewWidth, this.viewHeight)
        ].filter(Boolean);
        if (corners.length < 2) {
          continue;
        }
        const minX = Math.min(...corners.map((corner) => corner.x)) - 28;
        const maxX = Math.max(...corners.map((corner) => corner.x)) + 28;
        const minY = Math.min(...corners.map((corner) => corner.y)) - 28;
        const maxY = Math.max(...corners.map((corner) => corner.y)) + 28;
        if (screenPoint.x >= minX && screenPoint.x <= maxX && screenPoint.y >= minY && screenPoint.y <= maxY) {
          const center = project(building.x, building.y, zHeight, this.viewWidth, this.viewHeight);
          const score = center ? distance(screenPoint, center) : 0;
          if (score < screenBestScore) {
            screenBest = building;
            screenBestScore = score;
          }
        }
        continue;
      }
      const center = project(building.x, building.y, zHeight, this.viewWidth, this.viewHeight);
      const edge = project(building.x + (building.radius || 26), building.y, zHeight, this.viewWidth, this.viewHeight);
      if (!center) {
        continue;
      }
      const projectedRadius = edge ? Math.max(30, distance(center, edge) + 24) : 42;
      const score = distance(screenPoint, center);
      if (score <= projectedRadius && score < screenBestScore) {
        screenBest = building;
        screenBestScore = score;
      }
    }
    return screenBest;
  }

  openHoveredBaseBuildingMenu() {
    if (!this.hoveredBaseBuilding?.alive) {
      return false;
    }
    this.clearQueuedAbility();
    this.basePlacementPreviewActive = false;
    this.ui.openBuildingQuickMenu(this.hoveredBaseBuilding, this);
    this.addToast(`${this.hoveredBaseBuilding.label || "Building"} selected for quick upgrades.`);
    return true;
  }

  quickUpgradeBuilding(id) {
    const building = this.base.livingBuildings.find((candidate) => candidate.id === id);
    if (!building) {
      this.addToast("That building is no longer available.");
      this.ui.closeBuildingQuickMenu();
      return;
    }
    if (building.type === "wall") {
      this.upgradeWallHealth();
    } else {
      this.upgradeBuildingById(id);
    }
    const refreshed = this.base.livingBuildings.find((candidate) => candidate.id === id);
    if (refreshed) {
      this.ui.openBuildingQuickMenu(refreshed, this);
    }
  }

  openBuildingUpgradeList(id) {
    const building = this.base.livingBuildings.find((candidate) => candidate.id === id);
    if (!building) {
      this.addToast("That building is no longer available.");
      this.ui.closeBuildingQuickMenu();
      return;
    }
    if (building.type === "wall") {
      this.ui.open("base");
      return;
    }
    this.ui.openUpgradeList(building.type === "tower" || building.type === "ballista" || building.type === "pulseTower" ? "tower" : building.type);
  }

  castQueuedAbility() {
    const abilityId = this.queuedAbilityId;
    if (!abilityId || !this.player?.alive) {
      return;
    }
    this.cancelRecall("Recall interrupted.");
    let cast = false;
    if (abilityId === "skillshot") {
      cast = this.player.abilityBook.castSkillshot(this, this.player, this.input.mouseWorld);
    } else if (abilityId === "area") {
      cast = this.player.abilityBook.castArea(this, this.player, this.input.mouseWorld);
    } else if (abilityId === "ultimate") {
      cast = this.player.abilityBook.castUltimate(this, this.player, this.input.mouseWorld);
    }
    if (!cast) {
      const ability = this.player.abilityBook.abilities[abilityId];
      this.addToast(ability ? `${ability.config.label} is not ready.` : "Ability unavailable.");
    }
    this.clearQueuedAbility();
  }

  refreshKeybindings(keybindings) {
    this.keybindings = { ...DEFAULT_KEYBINDINGS, ...(keybindings || {}) };
    this.addToast("Keybindings updated.");
  }

  isMovementInputActive() {
    return (
      this.input.keys.has(this.keybindings.moveRight || "KeyD") ||
      this.input.keys.has(this.keybindings.moveLeft || "KeyA") ||
      this.input.keys.has(this.keybindings.moveDown || "KeyS") ||
      this.input.keys.has(this.keybindings.moveUp || "KeyW")
    );
  }

  clearMovementKeys() {
    this.input.keys.delete(this.keybindings.moveRight || "KeyD");
    this.input.keys.delete(this.keybindings.moveLeft || "KeyA");
    this.input.keys.delete(this.keybindings.moveDown || "KeyS");
    this.input.keys.delete(this.keybindings.moveUp || "KeyW");
    if (this.player) {
      this.player.vx = 0;
      this.player.vy = 0;
    }
  }

  isFormInputTarget(target) {
    return Boolean(target?.closest?.("input, select, textarea, [contenteditable='true']"));
  }

  startRecall() {
    if (!this.player.alive || this.gameOver || this.gameWon) {
      return;
    }
    if (!this.base.core) {
      this.addToast("Recall requires an active home core.");
      return;
    }
    if (this.recall.active) {
      return;
    }
    this.recall.active = true;
    this.recall.duration = CONFIG.recall?.duration || 8;
    this.recall.timer = this.recall.duration;
    this.player.vx = 0;
    this.player.vy = 0;
    this.addToast(`Recall channel started. Hold still for ${this.recall.duration} seconds.`);
  }

  updateRecall(dt) {
    if (!this.recall.active) {
      return;
    }
    this.recall.timer = Math.max(0, this.recall.timer - dt);
    if (this.recall.timer > 0) {
      return;
    }
    const core = this.base.core;
    this.recall.active = false;
    if (!core) {
      this.addToast("Recall failed: no active core.");
      return;
    }
    this.player.x = core.x + 92;
    this.player.y = core.y + 32;
    this.resolveWallCollisions(this.player);
    this.cameraLocked = true;
    this.cameraLookTarget = null;
    this.addToast("Recall complete. Returned to home core.");
    this.addFloatingText(this.player.x, this.player.y - 42, "Recall", "#72d8e8");
  }

  cancelRecall(message = "Recall interrupted.") {
    if (!this.recall?.active) {
      return;
    }
    this.recall.active = false;
    this.recall.timer = 0;
    this.addToast(message);
  }

  handlePrimaryAttackInput() {
    if (!this.player?.alive || this.gameOver || this.gameWon) {
      return;
    }
    const clickedTarget = this.findTargetAtPoint(this.input.mouseWorld, CONFIG.combat?.autoAttack?.clickRadius || 56);
    if (clickedTarget) {
      this.selectTarget(clickedTarget);
      this.cancelRecall("Recall interrupted.");
      this.tryAutoAttackSelected(true);
      return;
    }
    this.clearSelectedTarget();
    this.cancelRecall("Recall interrupted.");
    this.player.abilityBook.castBasic(this, this.player, this.input.mouseWorld);
  }

  selectTarget(target) {
    if (!target || !this.isAutoAttackTargetValid(target)) {
      return false;
    }
    this.selectedTarget = target;
    this.targetPanelDirty = true;
    return true;
  }

  clearSelectedTarget() {
    if (this.selectedTarget) {
      this.targetPanelDirty = true;
    }
    this.selectedTarget = null;
  }

  findTargetAtPoint(point, radius = 56) {
    const candidates = this.getPlayerAutoAttackTargets();
    let best = null;
    let bestScore = radius * radius;
    for (const target of candidates) {
      const targetPoint = this.getTargetPoint(target);
      const targetRadius = this.getTargetRadius(target);
      if (!this.isPointCurrentlyVisible(targetPoint, targetRadius + 20)) {
        continue;
      }
      const score = Math.max(0, distance(point, targetPoint) - targetRadius);
      if (score * score <= bestScore) {
        best = target;
        bestScore = score * score;
      }
    }
    return best;
  }

  getPlayerAutoAttackTargets() {
    const targets = [];
    targets.push(...(this.mobs || []).filter((mob) => mob.alive));
    targets.push(...(this.objectives || []).filter((objective) => objective.alive && this.canDamageObjective(objective, { sourceOwnerId: this.player.id, sourceKind: "player" })));
    targets.push(...(this.neutralTowers || []).filter((tower) => this.canDamageNeutralTower(tower, { sourceOwnerId: this.player.id, sourceKind: "player" })));
    for (const ai of this.aiPlayers || []) {
      if (ai.player?.alive) {
        targets.push(ai.player);
      }
      targets.push(...(ai.base?.livingBuildings || []));
    }
    for (const remote of this.remotePlayers?.values?.() || []) {
      if (remote?.alive) {
        targets.push(remote);
      }
    }
    for (const remoteBase of this.remoteBases?.values?.() || []) {
      targets.push(...(remoteBase.buildings || []).filter((building) => building.alive !== false));
    }
    for (const defender of this.baseDefenders || []) {
      if (defender.alive && defender.ownerId !== this.player.id) {
        targets.push(defender);
      }
    }
    return targets.filter((target) => this.isAutoAttackTargetValid(target));
  }

  isAutoAttackTargetValid(target) {
    if (!target?.alive || target === this.player || this.isEntityStealthed(target)) {
      return false;
    }
    if ((target.type === "wall" || target.type) && target.ownerId === this.player.id) {
      return false;
    }
    if ((this.objectives || []).includes(target)) {
      return this.canDamageObjective(target, { sourceOwnerId: this.player.id, sourceKind: "player" });
    }
    if ((this.neutralTowers || []).includes(target)) {
      return this.canDamageNeutralTower(target, { sourceOwnerId: this.player.id, sourceKind: "player" });
    }
    if (target?.isRemoteMob) {
      return this.mobs.includes(target);
    }
    if (target?.isRemotePlayer || target?.isRemoteBuilding || target?.isRemoteDeployable) {
      const stillPresent = target.isRemotePlayer
        ? this.remotePlayers?.has?.(target.id)
        : target.isRemoteDeployable
          ? (this.baseDefenders || []).includes(target)
          : this.getRemoteBaseBuildings().includes(target);
      return Boolean(this.multiplayer && stillPresent && target.ownerId !== this.player.id && target.id !== this.player.id);
    }
    return true;
  }

  updateAutoAttack(dt) {
    this.autoAttackToastTimer = Math.max(0, (this.autoAttackToastTimer || 0) - dt);
    if (!this.selectedTarget) {
      return;
    }
    if (!this.player?.alive || !this.isAutoAttackTargetValid(this.selectedTarget)) {
      this.clearSelectedTarget();
      return;
    }
    const targetPoint = this.getTargetPoint(this.selectedTarget);
    if (!this.isPointCurrentlyVisible(targetPoint, this.getTargetRadius(this.selectedTarget) + 24)) {
      this.clearSelectedTarget();
      return;
    }
    const facing = normalize(targetPoint.x - this.player.x, targetPoint.y - this.player.y);
    if (Math.abs(facing.x) + Math.abs(facing.y) > 0.001) {
      this.player.facing = facing;
    }
    this.tryAutoAttackSelected(false);
  }

  tryAutoAttackSelected(showFeedback = false) {
    const target = this.selectedTarget;
    if (!target || !this.player?.alive) {
      return false;
    }
    const ability = this.player.abilityBook.abilities.basic;
    const targetPoint = this.getTargetPoint(target);
    const targetRadius = this.getTargetRadius(target);
    const range = (ability?.range || this.player.characterClass?.abilities?.basic?.range || 120) + targetRadius + (CONFIG.combat?.autoAttack?.outOfRangeBuffer || 0);
    if (distance(this.player, targetPoint) > range) {
      if (showFeedback || this.autoAttackToastTimer <= 0) {
        this.addToast(`${this.getTargetName(target)} is out of attack range.`);
        this.autoAttackToastTimer = CONFIG.combat?.autoAttack?.outOfRangeToastCooldown || 0.85;
      }
      return false;
    }
    if (!ability?.ready) {
      return false;
    }
    this.player.abilityBook.castBasic(this, this.player, targetPoint);
    return true;
  }

  getTargetPoint(target) {
    return target?.combatPoint || target?.guardianPoint || target || { x: 0, y: 0 };
  }

  getTargetRadius(target) {
    if (Number.isFinite(target?.radius)) {
      return target.radius;
    }
    if (Number.isFinite(target?.width) || Number.isFinite(target?.height)) {
      return Math.max(target.width || 0, target.height || 0) * 0.5;
    }
    return 24;
  }

  getTargetName(target) {
    return target?.label || target?.displayName || target?.name || target?.campLabel || target?.type || "Target";
  }

  getTargetType(target) {
    if ((this.mobs || []).includes(target)) return "Mob";
    if ((this.objectives || []).includes(target)) return target.type === "boss" ? "Boss Objective" : "Objective";
    if ((this.neutralTowers || []).includes(target)) return target.type === "vision" ? "Vision Tower" : "Turret Tower";
    if ((this.baseDefenders || []).includes(target)) return "Deployable";
    if (this.isAIPlayerEntity(target)) return "AI Rival";
    if (target?.isRemotePlayer) return "Enemy Player";
    if (target?.isRemoteBuilding) return "Enemy Structure";
    if (target?.type) return "Structure";
    return "Enemy";
  }

  getTargetLevel(target) {
    return target?.level || target?.scaleLevel || target?.recommendedLevel || target?.campLevel || 1;
  }

  screenToWorld(point) {
    const lowPolyPoint = this.lowPolyRenderer?.screenToWorld?.(point, this.viewWidth, this.viewHeight);
    if (lowPolyPoint) {
      return lowPolyPoint;
    }
    return {
      x: point.x + this.camera.x,
      y: point.y + this.camera.y
    };
  }

  loop(time) {
    if (this.destroyed) {
      return;
    }
    const dt = Math.min(0.05, (time - this.lastTime) / 1000 || 0);
    this.lastTime = time;
    this.updatePerformanceStats(dt);
    this.update(dt);
    this.draw();
    this.ui.render(this);
    if (!this.destroyed) {
      requestAnimationFrame((nextTime) => this.loop(nextTime));
    }
  }

  updatePerformanceStats(dt) {
    if (!this.performanceStats) {
      return;
    }
    const instantFps = dt > 0 ? 1 / dt : 0;
    this.performanceStats.fps = Math.round(this.performanceStats.fps ? this.performanceStats.fps * 0.9 + instantFps * 0.1 : instantFps);
    this.performanceStats.mobs = this.mobs?.filter((mob) => mob.alive).length || 0;
    this.performanceStats.camps = this.campStates?.length || 0;
    this.performanceStats.bosses = this.mobs?.filter((mob) => mob.alive && mob.isBoss).length || 0;
    this.performanceStats.ai = this.aiPlayers?.length || 0;
    this.performanceStats.projectiles = this.projectiles?.length || 0;
    this.performanceStats.towers =
      (this.base?.livingBuildings || []).filter((building) => ["tower", "ballista", "pulseTower"].includes(building.type)).length +
      (this.aiPlayers || []).reduce(
        (sum, ai) => sum + ai.base.livingBuildings.filter((building) => ["tower", "ballista", "pulseTower"].includes(building.type)).length,
        0
      ) +
      (this.neutralTowers || []).filter((tower) => tower.alive).length;
    this.performanceStats.effects = (this.areaEffects?.length || 0) + (this.baseEffects?.length || 0) + (this.delayedAreaEffects?.length || 0);
  }

  update(dt) {
    // Synchronized start: hold the simulation (world already built behind a
    // countdown overlay) until the shared server-stamped start time so every
    // client begins at the same moment.
    if (this.matchStartAt && this.multiplayer) {
      const remainingMs = this.matchStartAt - this.multiplayer.adjustedNow();
      if (remainingMs > 0) {
        this.setCountdownOverlay(`Starting in ${Math.max(1, Math.ceil(remainingMs / 1000))}`);
        this.updateMultiplayer(dt);
        return;
      }
      this.matchStartAt = 0;
      this.setCountdownOverlay(null);
    }
    this.updateToasts(dt);
    this.updateFloatingTexts(dt);
    this.updateBaseEffects(dt);
    this.updateDroppedLoot(dt);

    if (this.gameOver || this.gameWon) {
      return;
    }

    if (this.spectating) {
      this.updateSpectator(dt);
      return;
    }

    // The host owns match phase/timer authority; non-hosts only count the timer
    // down locally for smooth display and adopt the host's phase from snapshots.
    const matchEvent = this.isAuthoritativeWorldHost() ? this.match.update(dt) : this.match.tickDisplay(dt);
    if (matchEvent === "phase_changed") {
      this.phaseWarningIndex = null;
      this.addToast(`${this.match.currentPhase.label}: ${this.match.currentPhase.description}`);
      this.handlePhaseChanged();
      if (this.areRivalBasesRevealed()) {
        this.addToast("Rival base cores are now marked on the minimap.");
      }
    } else if (matchEvent === "match_complete") {
      this.win("You survived every prototype phase.");
      return;
    }
    this.updatePhaseWarnings();

    if (this.recall.active && this.isMovementInputActive()) {
      this.cancelRecall("Recall interrupted.");
    }

    this.player.tickConsumables(dt);
    if (this.isAuthoritativeWorldHost()) {
      this.updateMidBossSpawn();
    }

    if (this.recall.active) {
      this.player.abilityBook.update(dt);
      this.player.vx = 0;
      this.player.vy = 0;
      this.updateRecall(dt);
    } else {
      this.player.update(dt, this.input, this.keybindings);
      this.resolveWallCollisions(this.player);
    }
    this.updateAutoAttack(dt);
    this.updateAIPlayers(dt);
    this.updateClassPassives(dt);
    this.updateHomeRegeneration(dt);
    this.updateMultiplayer(dt);
    this.tryRespawn();
    if (this.isAuthoritativeWorldHost()) {
      this.updateExplorationChests(dt);
      this.updateRoamingEncounters();
      this.updateVillages(dt);
      this.updateCampSpawns(dt);
      this.updateBaseWaves(dt);
    }
    this.updateProjectiles(dt);
    this.updateDelayedAreaEffects(dt);
    this.updateAreaEffects(dt);
    this.updateStatusDots(dt);
    if (this.isAuthoritativeWorldHost()) {
      this.updateBossScaling();
    }
    this.updateNeutralTowers(dt);

    if (this.isAuthoritativeWorldHost()) {
      for (const mob of this.mobs) {
        mob.update(dt, this);
      }
    }

    this.base.update(dt, this);
    this.updateBaseDefenders(dt);

    for (const objective of this.objectives) {
      objective.update(dt, this);
    }

    this.updateObjectiveIncome(dt);
    this.checkObjectiveControlWin();
    this.updateFogOfWar();
    this.cleanupDeadEntities();
  }

  isAuthoritativeWorldHost() {
    return !this.multiplayer || this.isHost;
  }

  updateSpectator(dt) {
    this.updateMultiplayer(dt);
    this.updateProjectiles(dt);
    this.updateDelayedAreaEffects(dt);
    this.updateAreaEffects(dt);
    this.updateBaseEffects(dt);
    this.updateFogOfWar();
    this.cleanupDeadEntities();
  }

  handlePhaseChanged() {
    if (!this.match.canPlaceBase && this.basePlacementPreviewActive) {
      this.basePlacementPreviewActive = false;
    }
    if (!this.match.canPlaceBase && !this.base.active && !this.base.displaced && !this.player.nomadMode) {
      this.activateNomadPath(this.player);
    }
    for (const ai of this.aiPlayers || []) {
      if (!this.match.canPlaceBase && !ai.base.active && !ai.base.displaced && !ai.player.nomadMode) {
        ai.player.applyNomadMode?.();
        ai.intent = "hunt";
        this.addToast(`${ai.name} skipped a core and became a nomad rival.`);
      }
    }
  }

  activateNomadPath(player) {
    const result = player.applyNomadMode?.();
    if (player === this.player) {
      this.addToast(result?.message || "Nomad path active. You have one life unless the mid boss blessing is earned.");
    }
  }

  getMatchDuration() {
    return this.match.phases.reduce((sum, phase) => sum + phase.duration, 0);
  }

  getMidBossSpawnTime() {
    return Math.floor(this.getMatchDuration() / 2);
  }

  getMidBossTimeRemaining() {
    return Math.max(0, this.getMidBossSpawnTime() - this.match.totalElapsed);
  }

  updateMidBossSpawn() {
    if (!this.worldOptions.bosses) {
      return;
    }
    if (this.bossSpawned || this.bossDefeated || this.match.totalElapsed < this.getMidBossSpawnTime()) {
      return;
    }
    this.spawnBoss();
    this.addToast(`The ${this.activeBossTemplate?.label || "Central Boss"} has spawned. Defeat it for a major buff and one extra life.`);
  }

  updateMultiplayer(dt) {
    if (!this.multiplayer) {
      return;
    }
    this.interpolateRemotePlayers(dt);
    if (!this.isAuthoritativeWorldHost()) {
      this.interpolateRemoteMobs(dt);
    }
    this.multiplayer.tick(this, dt);
  }

  // Host streams mobs at a throttled cadence; gate inclusion so the heavy world
  // payload doesn't flood every ~10Hz player-state send.
  shouldSyncWorldNow() {
    if (!this.isAuthoritativeWorldHost()) {
      return false;
    }
    const interval = CONFIG.multiplayer?.worldSyncIntervalMs ?? 200;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - (this.lastWorldSyncAt || 0) < interval) {
      return false;
    }
    this.lastWorldSyncAt = now;
    return true;
  }

  // Non-host clients receive mob positions at the world cadence; ease toward
  // them each frame (and derive facing) so mobs/bosses move smoothly.
  interpolateRemoteMobs(dt) {
    const k = Math.min(1, dt * 12);
    for (const mob of this.mobs) {
      if (!mob.alive || !Number.isFinite(mob.targetX) || !Number.isFinite(mob.targetY)) {
        continue;
      }
      const dx = mob.targetX - mob.x;
      const dy = mob.targetY - mob.y;
      mob.vx = dx;
      mob.vy = dy;
      mob.x += dx * k;
      mob.y += dy * k;
    }
  }

  // Smoothly ease each remote proxy toward its last networked position so
  // movement reads cleanly between the ~8Hz network updates instead of teleporting.
  interpolateRemotePlayers(dt) {
    const k = Math.min(1, dt * 18);
    for (const remote of this.remotePlayers.values()) {
      if (!Number.isFinite(remote.targetX) || !Number.isFinite(remote.targetY)) {
        continue;
      }
      const dx = remote.targetX - remote.x;
      const dy = remote.targetY - remote.y;
      if (dx * dx + dy * dy > 1) {
        const facing = normalize(dx, dy);
        if (Math.abs(facing.x) + Math.abs(facing.y) > 0.001) {
          remote.facing = facing;
        }
      }
      remote.x += dx * k;
      remote.y += dy * k;
    }
  }

  updateAIPlayers(dt) {
    for (const ai of this.aiPlayers || []) {
      ai.update(dt, this);
    }
    this.aiPlayers = (this.aiPlayers || []).filter((ai) => !ai.eliminated);
  }

  updatePhaseWarnings() {
    if (this.phaseWarningIndex === this.match.phaseIndex || this.match.timeRemaining > 60) {
      return;
    }
    this.phaseWarningIndex = this.match.phaseIndex;
    const message = this.match.canPlaceBase
      ? `One minute left in ${this.match.currentPhase.label}. Base placement and relocation will lock soon.`
      : `One minute left in ${this.match.currentPhase.label}.`;
    this.addToast(message);
  }

  updateHomeRegeneration(dt) {
    this.regeneratePlayerAtBase(this.player, this.base, dt);
    for (const ai of this.aiPlayers || []) {
      ai.player.tickRecovery?.(dt);
      this.regeneratePlayerAtBase(ai.player, ai.base, dt);
    }
  }

  regeneratePlayerAtBase(player, base, dt) {
    const core = base?.core;
    if (!player?.alive || !core || player.timeSinceDamage < CONFIG.player.baseRegenDelay || distance(player, core) > 330) {
      return;
    }
    const healed = player.heal(Math.max(2, player.effectiveMaxHealth * CONFIG.player.baseRegenPercentPerSecond) * dt);
    if (healed > 0 && Math.random() < 0.025) {
      this.spawnBaseEffect({
        type: "pulse",
        x: player.x,
        y: player.y,
        color: "#63d46b",
        radius: player.radius + 6,
        life: 0.45,
        maxLife: 0.45
      });
    }
  }

  snapshotForMultiplayer() {
    return {
      player: {
        id: this.player.id,
        name: this.player.displayName || this.playerName,
        x: Math.round(this.player.x),
        y: Math.round(this.player.y),
        level: this.player.level,
        characterId: this.player.characterId,
        characterLabel: this.player.characterClass?.label,
        health: Math.ceil(this.player.health),
        maxHealth: this.player.effectiveMaxHealth,
        healthRatio: this.player.healthRatio,
        alive: this.player.alive,
        eliminated: Boolean(this.player.eliminated),
        spectating: Boolean(this.spectating),
        respawnTimer: this.player.respawnTimer,
        stealthTimer: Math.round((this.player.stealthTimer || 0) * 100) / 100,
        stealthMaxTimer: Math.round((this.player.stealthMaxTimer || 0) * 100) / 100,
        stealthUntargetable: Boolean(this.player.stealthUntargetable && (this.player.stealthTimer || 0) > 0),
        stealthUntargetableKinds: this.player.stealthUntargetableKinds || [],
        radius: this.player.radius,
        fx: this.player.facing ? Math.round((this.player.facing.x || 0) * 100) / 100 : 0,
        fy: this.player.facing ? Math.round((this.player.facing.y || 1) * 100) / 100 : 1
      },
      base: {
        active: this.base.active,
        displaced: this.base.displaced,
        buildings: this.base.livingBuildings.map((building) => ({
          id: building.id,
          type: building.type,
          x: Math.round(building.x),
          y: Math.round(building.y),
          level: building.level,
          health: Math.ceil(building.health),
          maxHealth: Math.ceil(building.maxHealth),
          healthRatio: building.healthRatio,
          width: building.width,
          height: building.height,
          radius: building.radius,
          layer: building.layer || 1,
          label: building.label
        }))
      },
      match: {
        phaseIndex: this.match.phaseIndex,
        timeRemaining: Math.ceil(this.match.timeRemaining)
      },
      deployables: this.createDeployableSnapshot(),
      world: this.shouldSyncWorldNow() ? this.createWorldSnapshot() : null
    };
  }

  createDeployableSnapshot() {
    return (this.baseDefenders || [])
      .filter((defender) => defender.alive && defender.ownerId === this.player.id && !defender.isRemoteDeployable)
      .slice(0, CONFIG.multiplayer?.maxSyncedDeployables || 24)
      .map((defender) => ({
        id: defender.id,
        kind: defender.kind || "guard",
        x: Math.round(defender.x),
        y: Math.round(defender.y),
        ownerId: defender.ownerId,
        health: Math.ceil(defender.health || 0),
        maxHealth: Math.ceil(defender.maxHealth || 1),
        healthRatio: defender.healthRatio ?? (defender.health && defender.maxHealth ? defender.health / Math.max(1, defender.maxHealth) : 1),
        radius: defender.radius || 14,
        range: defender.range || 120,
        life: defender.life || 0,
        maxLife: defender.maxLife || 0,
        color: defender.color || this.player.color || "#72d8e8"
      }));
  }

  createWorldSnapshot() {
    const anchors = [this.player, ...this.remotePlayers.values()].filter(
      (point) => point && Number.isFinite(point.x) && Number.isFinite(point.y)
    );
    const sizeCap = CONFIG.multiplayer?.maxSyncedMobsByMapSize?.[this.mapSizeId] ?? CONFIG.multiplayer?.maxSyncedMobs ?? 280;
    const maxMobs = Math.min(
      CONFIG.multiplayer?.maxSyncedMobs || 280,
      Math.round(sizeCap + Math.max(0, anchors.length - 1) * 14)
    );
    const radius = CONFIG.multiplayer?.syncMobRadiusByMapSize?.[this.mapSizeId] ?? CONFIG.multiplayer?.syncMobRadius ?? 1550;
    const radiusSq = radius * radius;
    // Stream mobs near ANY player (host + remotes) so each client gets its own
    // nearby mobs; bosses always sync. Sort by proximity so the cap keeps the
    // most relevant ones.
    const nearestDistSq = (mob) => {
      let best = Infinity;
      for (const anchor of anchors) {
        const dx = anchor.x - mob.x;
        const dy = anchor.y - mob.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < best) {
          best = distSq;
        }
      }
      return best;
    };
    return {
      hostId: this.player.id,
      worldSeed: this.worldSeed,
      mapSize: this.mapSizeId,
      bossSpawned: Boolean(this.bossSpawned),
      bossDefeated: Boolean(this.bossDefeated),
      match: {
        phaseIndex: this.match.phaseIndex,
        timeRemaining: Math.max(0, this.match.timeRemaining),
        matchWon: Boolean(this.match.matchWon)
      },
      openedChests: (this.explorationChests || []).filter((chest) => chest.opened).map((chest) => chest.id),
      mobs: this.mobs
        .filter((mob) => mob.alive && !mob.rewardsGranted)
        .map((mob) => ({ mob, sortKey: mob.isBoss ? -1 : nearestDistSq(mob) }))
        .filter((entry) => entry.mob.isBoss || entry.sortKey <= radiusSq)
        .sort((a, b) => a.sortKey - b.sortKey)
        .slice(0, maxMobs)
        .map(({ mob }) => ({
          id: mob.id,
          x: Math.round(mob.x),
          y: Math.round(mob.y),
          spawnX: Math.round(mob.spawnX || mob.x),
          spawnY: Math.round(mob.spawnY || mob.y),
          tier: mob.tier || 1,
          campId: mob.campId || "wild",
          campType: mob.campType || "goblin",
          archetype: mob.archetype || "melee",
          isBoss: Boolean(mob.isBoss),
          targetBase: Boolean(mob.targetBase),
          health: Math.ceil(mob.health),
          maxHealth: Math.ceil(mob.maxHealth),
          radius: mob.radius || 20,
          scaledLevel: mob.scaledLevel || 1,
          arenaBounds: mob.arenaBounds || null
        }))
    };
  }

  setRemoteSnapshots(remotePlayers) {
    const seen = new Set();
    const nextBases = new Map();
    const nextRemoteDeployables = [];
    for (const remote of remotePlayers) {
      const snap = remote.state?.player || {};
      seen.add(remote.id);
      if (remote.isHost || remote.id === this.multiplayer?.lastRoom?.hostId) {
        this.worldHostId = remote.id;
        if (!this.isAuthoritativeWorldHost() && remote.state?.world) {
          this.applyHostWorldSnapshot(remote.state.world, remote.id);
        }
      }
      // Reuse the existing proxy so interpolation state (x/y) survives updates.
      let proxy = this.remotePlayers.get(remote.id);
      if (!proxy) {
        proxy = {
          id: remote.id,
          isRemotePlayer: true,
          x: Number.isFinite(snap.x) ? snap.x : 0,
          y: Number.isFinite(snap.y) ? snap.y : 0,
          facing: { x: 0, y: 1 }
        };
        this.remotePlayers.set(remote.id, proxy);
      }
      proxy.name = remote.name || snap.name || "Player";
      proxy.displayName = proxy.name;
      proxy.ownerId = remote.id;
      proxy.isRemotePlayer = true;
      proxy.characterId = snap.characterId || proxy.characterId || "ranger";
      proxy.characterLabel = snap.characterLabel || proxy.characterLabel;
      proxy.level = snap.level ?? proxy.level ?? 1;
      proxy.alive = snap.alive !== false;
      proxy.eliminated = Boolean(snap.eliminated);
      proxy.spectating = Boolean(snap.spectating);
      proxy.stealthTimer = Math.max(0, snap.stealthTimer || 0);
      proxy.stealthMaxTimer = Math.max(0, snap.stealthMaxTimer || proxy.stealthTimer || 0);
      proxy.stealthUntargetable = Boolean(snap.stealthUntargetable && proxy.stealthTimer > 0);
      proxy.stealthUntargetableKinds = Array.isArray(snap.stealthUntargetableKinds)
        ? snap.stealthUntargetableKinds
        : CONFIG.combat?.stealth?.defaultUntargetableKinds || [];
      proxy.health = snap.health;
      proxy.maxHealth = snap.maxHealth;
      setSyncedHealthRatio(proxy, snap.healthRatio ?? 1);
      proxy.respawnTimer = snap.respawnTimer || 0;
      proxy.radius = snap.radius || proxy.radius || 22;
      if (Number.isFinite(snap.fx) || Number.isFinite(snap.fy)) {
        proxy.facing = { x: snap.fx || 0, y: snap.fy ?? 1 };
      }
      if (Number.isFinite(snap.x) && Number.isFinite(snap.y)) {
        // Snap on first sight or a teleport-sized jump (respawn), else interpolate.
        if (!Number.isFinite(proxy.targetX) || Math.hypot(snap.x - proxy.x, snap.y - proxy.y) > 700) {
          proxy.x = snap.x;
          proxy.y = snap.y;
        }
        proxy.targetX = snap.x;
        proxy.targetY = snap.y;
      }
      if (remote.state?.base?.buildings) {
        const remoteBuildings = remote.state.base.buildings.map((building) => ({
          ...building,
          id: building.id,
          ownerId: remote.id,
          ownerName: proxy.name,
          isRemoteBuilding: true,
          alive: building.healthRatio !== 0 && building.health !== 0,
          health: building.health,
          maxHealth: building.maxHealth,
          healthRatio: building.healthRatio ?? (building.health && building.maxHealth ? building.health / Math.max(1, building.maxHealth) : 1),
          radius: building.radius || (building.type === "core" ? 34 : 24),
          label: building.label || `${proxy.name}'s ${labelizeBuildingType(building.type)}`
        }));
        nextBases.set(remote.id, {
          playerId: remote.id,
          name: proxy.name,
          active: remote.state.base.active !== false,
          displaced: Boolean(remote.state.base.displaced),
          buildings: remoteBuildings
        });
      }
      for (const deployable of remote.state?.deployables || []) {
        nextRemoteDeployables.push(this.hydrateRemoteDeployable(deployable, remote.id, proxy.name));
      }
    }
    for (const id of [...this.remotePlayers.keys()]) {
      if (!seen.has(id)) {
        this.remotePlayers.delete(id);
      }
    }
    this.remoteBases = nextBases;
    const localDeployables = (this.baseDefenders || []).filter((defender) => !defender.isRemoteDeployable);
    this.baseDefenders = [...localDeployables, ...nextRemoteDeployables];
  }

  applyHostWorldSnapshot(world, hostId) {
    if (!world || this.isAuthoritativeWorldHost()) {
      return;
    }
    this.worldHostId = world.hostId || hostId || this.worldHostId;
    if (world.mapSize && CONFIG.mapSizes?.[world.mapSize] && world.mapSize !== this.mapSizeId) {
      this.mapSizeId = world.mapSize;
      this.applyMapSizeConfig(this.mapSizeId);
    }
    if (world.worldSeed && world.worldSeed !== this.worldSeed) {
      this.worldSeed = world.worldSeed;
      this.createSharedWorldState();
      this.campStates = withSeededRandom(`${this.worldSeed || "remote"}-camp-timers`, () =>
        this.campDefinitions.map((camp) => ({
          ...camp,
          timer: randRange(1, CONFIG.mobs.baseSpawnInterval)
        }))
      );
      this.updateFogOfWar();
    }
    this.bossSpawned = Boolean(world.bossSpawned);
    this.bossDefeated = Boolean(world.bossDefeated);
    if (world.match) {
      // Adopt the host's authoritative phase/timer so everyone sees the same one.
      const phaseEvent = this.match.applyAuthoritativeState(world.match);
      if (phaseEvent === "phase_changed") {
        this.phaseWarningIndex = null;
        this.addToast(`${this.match.currentPhase.label}: ${this.match.currentPhase.description}`);
        if (this.areRivalBasesRevealed()) {
          this.addToast("Rival base cores are now marked on the minimap.");
        }
      }
      if (world.match.matchWon && !this.gameWon && !this.gameOver) {
        this.win("The match has ended.");
      }
    }
    const openedChests = new Set(world.openedChests || []);
    for (const chest of this.explorationChests || []) {
      if (openedChests.has(chest.id)) {
        chest.opened = true;
      }
    }
    const existing = new Map((this.mobs || []).map((mob) => [mob.id, mob]));
    const nextMobs = [];
    for (const snapshot of world.mobs || []) {
      if (!snapshot?.id) {
        continue;
      }
      let mob = existing.get(snapshot.id);
      if (!mob) {
        mob = new Mob({
          x: snapshot.x,
          y: snapshot.y,
          tier: snapshot.tier || 1,
          campId: snapshot.campId || "remote",
          isBoss: Boolean(snapshot.isBoss),
          targetBase: Boolean(snapshot.targetBase),
          archetype: snapshot.archetype || "melee",
          campType: snapshot.campType || "goblin",
          arenaBounds: snapshot.arenaBounds || null
        });
        mob.id = snapshot.id;
      }
      mob.isRemoteMob = true;
      mob.remoteOwnerId = this.worldHostId || hostId;
      const snapX = Number.isFinite(snapshot.x) ? snapshot.x : mob.x;
      const snapY = Number.isFinite(snapshot.y) ? snapshot.y : mob.y;
      // Interpolate toward the host's position instead of teleporting. Snap only
      // for brand-new mobs or teleport-sized jumps (spawns/respawns).
      if (!Number.isFinite(mob.targetX) || Math.hypot(snapX - mob.x, snapY - mob.y) > 700) {
        mob.x = snapX;
        mob.y = snapY;
      }
      mob.targetX = snapX;
      mob.targetY = snapY;
      mob.spawnX = Number.isFinite(snapshot.spawnX) ? snapshot.spawnX : mob.spawnX;
      mob.spawnY = Number.isFinite(snapshot.spawnY) ? snapshot.spawnY : mob.spawnY;
      mob.tier = snapshot.tier || mob.tier || 1;
      mob.campId = snapshot.campId || mob.campId;
      mob.campType = snapshot.campType || mob.campType;
      mob.archetype = snapshot.archetype || mob.archetype;
      mob.isBoss = Boolean(snapshot.isBoss);
      mob.targetBase = Boolean(snapshot.targetBase);
      mob.radius = snapshot.radius || mob.radius;
      mob.maxHealth = Math.max(1, snapshot.maxHealth || mob.maxHealth || 1);
      mob.health = Math.max(0, Math.min(mob.maxHealth, snapshot.health ?? mob.health));
      mob.alive = mob.health > 0;
      mob.scaledLevel = snapshot.scaledLevel || mob.scaledLevel || 1;
      mob.arenaBounds = snapshot.arenaBounds || mob.arenaBounds || null;
      mob.rewardsGranted = false;
      nextMobs.push(mob);
    }
    this.mobs = nextMobs;
  }

  hydrateRemoteDeployable(snapshot, ownerId, ownerName = "Player") {
    const existing = (this.baseDefenders || []).find((defender) => defender.isRemoteDeployable && defender.id === snapshot.id);
    const deployable =
      existing ||
      createBaseDefender({
        x: snapshot.x,
        y: snapshot.y,
        kind: snapshot.kind || "guard",
        ownerId,
        color: snapshot.color || "#ff8068",
        barracksId: `${ownerId}-remote-deployable`,
        level: 1
      });
    deployable.id = snapshot.id || deployable.id;
    deployable.kind = snapshot.kind || deployable.kind || "guard";
    deployable.ownerId = ownerId;
    deployable.ownerName = ownerName;
    deployable.isRemoteDeployable = true;
    deployable.alive = snapshot.health !== 0;
    deployable.x = Number.isFinite(snapshot.x) ? snapshot.x : deployable.x;
    deployable.y = Number.isFinite(snapshot.y) ? snapshot.y : deployable.y;
    deployable.radius = snapshot.radius || deployable.radius || 14;
    deployable.range = snapshot.range || deployable.range || 120;
    deployable.maxHealth = Math.max(1, snapshot.maxHealth || deployable.maxHealth || 1);
    deployable.health = Math.max(0, Math.min(deployable.maxHealth, snapshot.health ?? deployable.health ?? deployable.maxHealth));
    setSyncedHealthRatio(deployable, snapshot.healthRatio ?? deployable.health / Math.max(1, deployable.maxHealth));
    deployable.life = snapshot.life || 0;
    deployable.maxLife = snapshot.maxLife || 0;
    deployable.color = snapshot.color || deployable.color || "#ff8068";
    deployable.temporary = true;
    deployable.takeDamage = function takeRemoteDeployableDamage(amount) {
      const applied = Math.min(this.health, Math.max(0, amount));
      this.health -= applied;
      setSyncedHealthRatio(this, this.health / Math.max(1, this.maxHealth));
      if (this.health <= 0) {
        this.health = 0;
        setSyncedHealthRatio(this, 0);
        this.alive = false;
      }
      return applied;
    };
    return deployable;
  }

  getRemoteBaseBuildings() {
    return Array.from(this.remoteBases.values()).flatMap((remoteBase) => remoteBase.buildings || []).filter((building) => building.alive !== false);
  }

  isRemoteMobTarget(target) {
    return Boolean(this.multiplayer && target?.isRemoteMob);
  }

  isRemoteCombatTarget(target) {
    return Boolean(this.multiplayer && target && (target.isRemotePlayer || target.isRemoteBuilding || target.isRemoteMob || target.isRemoteDeployable));
  }

  emitRemoteDamageIntent(target, amount, source = {}) {
    if (!CONFIG.combat?.pvp?.enabled || !CONFIG.combat?.pvp?.remoteDamageEvents || !this.multiplayer?.queueCombatEvent) {
      return false;
    }
    const sourceOwnerId = source.sourceOwnerId || source.sourceId || this.player.id;
    const hostWorldSource = this.isAuthoritativeWorldHost() && ["mob", "hostile", "objective", "neutralTower"].includes(source.sourceKind);
    if (sourceOwnerId !== this.player.id && !hostWorldSource) {
      return false;
    }
    const targetOwnerId = target.isRemoteMob ? this.getWorldHostPlayerId() : target.isRemotePlayer ? target.id : target.ownerId;
    if (!targetOwnerId || targetOwnerId === this.player.id) {
      return false;
    }
    const event = {
      type: "damage",
      targetOwnerId,
      targetId: target.id,
      targetKind: target.isRemoteMob ? "mob" : target.isRemotePlayer ? "player" : target.isRemoteDeployable ? "deployable" : "building",
      targetType: target.type || "player",
      amount: Math.max(1, Math.round(amount)),
      sourceKind: source.sourceKind || "player",
      sourceX: Number.isFinite(source.sourceX) ? source.sourceX : this.player.x,
      sourceY: Number.isFinite(source.sourceY) ? source.sourceY : this.player.y,
      status: source.status || null
    };
    this.multiplayer.queueCombatEvent(event);
    this.addDamageNumber(target, event.amount, this.isStructureDamageTarget(target) ? "structure" : "damage", source);
    this.applyPredictedRemoteDamage(target, event.amount);
    return true;
  }

  getWorldHostPlayerId() {
    return this.worldHostId || this.multiplayer?.lastRoom?.hostId || (this.isHost ? this.player.id : null);
  }

  applyPredictedRemoteDamage(target, amount) {
    if (target.isRemotePlayer) {
      const maxHealth = Math.max(1, target.maxHealth || 100);
      const currentHealth = Number.isFinite(target.health) ? target.health : maxHealth * (target.healthRatio ?? 1);
      target.health = Math.max(0, currentHealth - amount);
      setSyncedHealthRatio(target, target.health / maxHealth);
      target.alive = target.health > 0;
      return;
    }
    if (target.isRemoteBuilding) {
      const maxHealth = Math.max(1, target.maxHealth || 120);
      const currentHealth = Number.isFinite(target.health) ? target.health : maxHealth * (target.healthRatio ?? 1);
      target.health = Math.max(0, currentHealth - amount);
      setSyncedHealthRatio(target, target.health / maxHealth);
      target.alive = target.health > 0;
      return;
    }
    if (target.isRemoteMob) {
      // Mob health is host-authoritative. Do NOT predict it locally: a stale
      // host snapshot would then bump it back up and look like the mob "healed".
      // The floating damage number is shown by the caller; the real health drop
      // arrives with the next world snapshot from the host.
      return;
    }
    if (target.isRemoteDeployable) {
      const maxHealth = Math.max(1, target.maxHealth || 80);
      const currentHealth = Number.isFinite(target.health) ? target.health : maxHealth * (target.healthRatio ?? 1);
      target.health = Math.max(0, currentHealth - amount);
      setSyncedHealthRatio(target, target.health / maxHealth);
      target.alive = target.health > 0;
    }
  }

  applyRemoteCombatEvents(events = []) {
    if (!Array.isArray(events) || events.length === 0 || !this.multiplayer) {
      return;
    }
    for (const event of events) {
      if (!event?.id || this.appliedRemoteCombatEventIds.has(event.id)) {
        continue;
      }
      this.appliedRemoteCombatEventIds.add(event.id);
      this.appliedRemoteCombatEventOrder.push(event.id);
      if (this.appliedRemoteCombatEventOrder.length > 600) {
        const oldId = this.appliedRemoteCombatEventOrder.shift();
        this.appliedRemoteCombatEventIds.delete(oldId);
      }
      if (event.type === "damage") {
        if (event.sourcePlayerId === this.player.id) {
          continue;
        }
        this.applyIncomingPvPDamage(event);
      } else if (event.type === "projectile") {
        if (event.sourcePlayerId === this.player.id) {
          continue;
        }
        this.spawnRemoteGhostProjectile(event);
      } else if (event.type === "area") {
        if (event.sourcePlayerId === this.player.id) {
          continue;
        }
        this.spawnRemoteGhostArea(event);
      } else {
        this.applyPvPOutcomeEvent(event);
      }
    }
  }

  applyIncomingPvPDamage(event) {
    if (event.targetOwnerId !== this.player.id) {
      return;
    }
    const target =
      event.targetKind === "player"
        ? this.player
        : event.targetKind === "mob"
          ? this.mobs.find((mob) => mob.id === event.targetId)
          : event.targetKind === "deployable"
            ? this.baseDefenders.find((defender) => defender.id === event.targetId && defender.ownerId === this.player.id)
          : this.base.buildings.find((building) => building.id === event.targetId);
    if (!target?.alive) {
      return;
    }
    const wasAlive = target.alive;
    this.applyDamage(target, event.amount, {
      sourceId: event.sourcePlayerId,
      sourceOwnerId: event.sourcePlayerId,
      sourceKind: event.sourceKind || "remotePlayer",
      sourceX: event.sourceX,
      sourceY: event.sourceY,
      status: event.status,
      remoteEvent: true
    });
    if (wasAlive && !target.alive && (target === this.player || target.type === "core")) {
      this.emitPvPOutcomeForLocalDeath(target, event);
    }
  }

  emitPvPOutcomeForLocalDeath(target, sourceEvent) {
    if (!this.multiplayer?.queueCombatEvent || !sourceEvent?.sourcePlayerId) {
      return;
    }
    if (target === this.player) {
      const eliminated = Boolean(this.player.eliminated || (!this.base.hasActiveCore && !this.player.alive));
      const type = eliminated ? "playerEliminated" : "playerDefeated";
      const key = `${type}:${this.player.id}:${sourceEvent.sourcePlayerId}`;
      if (this.sentPvPOutcomeEvents.has(key)) {
        return;
      }
      this.sentPvPOutcomeEvents.add(key);
      this.multiplayer.queueCombatEvent({
        type,
        targetOwnerId: this.player.id,
        victimId: this.player.id,
        victimName: this.player.displayName || this.playerName,
        victimLevel: this.player.level,
        killerId: sourceEvent.sourcePlayerId,
        killerName: sourceEvent.sourceName || "Enemy",
        targetId: this.player.id
      });
      return;
    }
    if (target.type === "core") {
      const key = `coreDestroyed:${target.id}:${sourceEvent.sourcePlayerId}`;
      if (this.sentPvPOutcomeEvents.has(key)) {
        return;
      }
      this.sentPvPOutcomeEvents.add(key);
      this.multiplayer.queueCombatEvent({
        type: "coreDestroyed",
        targetOwnerId: this.player.id,
        targetId: target.id,
        victimId: this.player.id,
        victimName: this.player.displayName || this.playerName,
        victimLevel: this.player.level,
        killerId: sourceEvent.sourcePlayerId,
        killerName: sourceEvent.sourceName || "Enemy"
      });
    }
  }

  applyPvPOutcomeEvent(event) {
    if (event.serverTime && event.serverTime < (this.sceneStartedAt || 0) - 1500) {
      return;
    }
    const isKiller = event.killerId === this.player.id;
    const isVictim = event.victimId === this.player.id || event.targetOwnerId === this.player.id;
    if (isKiller && event.type === "mobDefeated") {
      const reward = this.rewardSystem.grantSyncedMobReward(this.player, event);
      this.addToast(`${event.mobName || "Mob"} defeated: +${reward.xp} XP, +${reward.gold}g, +${reward.resources} build.`);
      this.addFloatingText(this.player.x, this.player.y - 60, "PvE reward", "#e7bd58");
      return;
    }
    if (event.type === "chestOpened") {
      this.applyRemoteChestOpened(event);
      return;
    }
    if (isKiller && (event.type === "playerDefeated" || event.type === "playerEliminated")) {
      const reward = this.rewardSystem.grantPlayerKillReward(this.player, event);
      this.addToast(`${event.victimName || "Enemy"} defeated: +${reward.xp} XP, +${reward.gold}g, +${reward.resources} build.`);
      this.addFloatingText(this.player.x, this.player.y - 60, "PvP reward", "#ffcf5a");
      if (event.type === "playerEliminated") {
        this.checkMultiplayerVictory();
      }
      return;
    }
    if (isKiller && event.type === "coreDestroyed") {
      const reward = this.rewardSystem.grantCoreDestroyReward(this.player);
      this.addToast(`${event.victimName || "Enemy"} core destroyed: +${reward.xp} XP, +${reward.gold}g, +${reward.resources} build.`);
      this.addFloatingText(this.player.x, this.player.y - 60, "Core bounty", "#e85b58");
      return;
    }
    if (isVictim) {
      return;
    }
    if (event.type === "playerEliminated") {
      this.addToast(`${event.killerName || "A rival"} eliminated ${event.victimName || "a player"}.`);
      this.checkMultiplayerVictory();
    } else if (event.type === "coreDestroyed") {
      this.addToast(`${event.killerName || "A rival"} destroyed ${event.victimName || "a player"}'s core.`);
    } else if (event.type === "playerDefeated") {
      this.addToast(`${event.killerName || "A rival"} defeated ${event.victimName || "a player"}.`);
    }
  }

  checkMultiplayerVictory() {
    if (!this.multiplayer || this.gameOver || this.gameWon) {
      return;
    }
    const activeRivals = Array.from(this.remotePlayers.values()).filter(
      (remote) => !remote.eliminated && !remote.spectating && (remote.alive || (remote.respawnTimer || 0) > 0)
    );
    const activeRivalIds = new Set(activeRivals.map((remote) => remote.id));
    const activeRivalCores = Array.from(this.remoteBases.values()).some(
      (remoteBase) =>
        activeRivalIds.has(remoteBase.playerId) &&
        remoteBase.buildings?.some((building) => building.type === "core" && building.alive !== false)
    );
    if (activeRivals.length === 0 && !activeRivalCores) {
      this.win("All online rivals have been eliminated.");
    }
  }

  tryRespawn() {
    if (this.player.alive || this.player.respawnTimer > 0) {
      return;
    }

    const core = this.base.core;
    if (core) {
      this.player.respawnAt(core.x + 72, core.y + 24);
      this.sentPvPOutcomeEvents.clear();
      this.addToast("Hero respawned at the base core.");
    } else {
      this.eliminate("Your hero died while no active base core existed.");
    }
  }

  getRespawnSeconds(player = this.player) {
    const respawn = CONFIG.player || {};
    const baseSeconds = respawn.respawnBaseSeconds ?? 5;
    const perLevel = respawn.respawnPerLevelSeconds ?? 1.65;
    const perPhase = respawn.respawnPhaseSeconds ?? 2;
    const maxSeconds = respawn.respawnMaxSeconds ?? 60;
    const level = Math.max(1, player?.level || 1);
    return Math.min(maxSeconds, Math.ceil(baseSeconds + (level - 1) * perLevel + this.match.phaseIndex * perPhase));
  }

  getMapMobDensityMultiplier() {
    return CONFIG.mapSizes?.[this.mapSizeId]?.mobDensityMultiplier ?? 1;
  }

  isEntityStealthed(entity) {
    return Boolean(entity?.stealthUntargetable && (entity.stealthTimer || 0) > 0);
  }

  canTargetEntity(target, sourceKind = "mob") {
    if (!target?.alive) {
      return false;
    }
    if (!this.isEntityStealthed(target)) {
      return true;
    }
    return !this.stealthBlocksSourceKind(target, sourceKind);
  }

  stealthBlocksSourceKind(target, sourceKind = "mob") {
    if (!this.isEntityStealthed(target)) {
      return false;
    }
    const blockedKinds =
      target.stealthUntargetableKinds?.length > 0
        ? target.stealthUntargetableKinds
        : CONFIG.combat?.stealth?.defaultUntargetableKinds || ["mob", "tower", "objective", "ai", "neutralTower", "player", "remotePlayer"];
    return blockedKinds.includes("*") || blockedKinds.includes(sourceKind);
  }

  updateClassPassives() {
    const actors = [this.player, ...(this.aiPlayers || []).map((ai) => ai.player)].filter(Boolean);
    for (const actor of actors) {
      actor.passiveSpeedBonus = 0;
      actor.passiveDamageReduction = 0;
      actor.passiveStatusLabel = "";
      if (!actor.alive) {
        continue;
      }
      if (actor.characterId === "druid") {
        const inForest =
          this.map.zoneForPoint?.(actor)?.type === "forest" ||
          (this.villages || []).some((village) => distance(actor, village) <= village.radius + 180);
        if (inForest) {
          actor.passiveSpeedBonus = CONFIG.classPassives?.druid?.forestBondSpeedBonus || 0;
          actor.passiveStatusLabel = "Forest Bond";
        }
      } else if (actor.characterId === "sentinel") {
        const passive = CONFIG.classPassives?.sentinel || {};
        const nearStrategicPoint =
          (this.map.bridges || []).some((bridge) => distance(actor, bridge) <= bridge.radius + 220) ||
          (this.neutralTowers || []).some((tower) => distance(actor, tower) <= 520) ||
          (this.objectives || []).some((objective) => distance(actor, objective) <= objective.radius + 260) ||
          (this.villages || []).some((village) => distance(actor, village) <= village.radius + 160) ||
          (actor.id === this.player.id ? this.base.core && distance(actor, this.base.core) <= 560 : this.getAIById(actor.id)?.base.core && distance(actor, this.getAIById(actor.id).base.core) <= 560);
        if (nearStrategicPoint || (actor.stationaryTimer || 0) >= (passive.holdStillSeconds || 1.2)) {
          actor.passiveDamageReduction = passive.holdDamageReduction || 0.12;
          actor.passiveStatusLabel = "Hold Line";
        }
      }
    }
  }

  absorbShieldDamage(target, amount) {
    if (!target?.absorbShieldDamage || amount <= 0) {
      return amount;
    }
    const remaining = target.absorbShieldDamage(amount);
    const absorbed = amount - remaining;
    if (absorbed > 0) {
      this.addDamageNumber?.(target, absorbed, "shield", { sourceKind: "shield" });
    }
    return remaining;
  }

  updateCampSpawns(dt) {
    this.campSpawnAccumulator = (this.campSpawnAccumulator || 0) + dt;
    if (this.campSpawnAccumulator < 0.25) {
      return;
    }
    const step = this.campSpawnAccumulator;
    this.campSpawnAccumulator = 0;
    const campCounts = new Map();
    for (const mob of this.mobs) {
      if (mob.alive && mob.campId) {
        campCounts.set(mob.campId, (campCounts.get(mob.campId) || 0) + 1);
      }
    }
    for (const camp of this.campStates) {
      const activeRadius = CONFIG.performance?.activeCampRadius || 2400;
      const hasNearbyActor =
        distance(camp, this.player) < activeRadius ||
        (this.aiPlayers || []).some((ai) => ai.player.alive && distance(camp, ai.player) < activeRadius) ||
        Array.from(this.remotePlayers?.values?.() || []).some((remote) => remote.alive && distance(camp, remote) < activeRadius);
      const tierConfig = CONFIG.campTiers[camp.tier] || CONFIG.campTiers[1];
      const baseCampMax = camp.maxMobs || tierConfig.maxMobs || CONFIG.mobs.campMax;
      const campMax = Math.max(1, Math.round(baseCampMax * this.getMapMobDensityMultiplier()));
      const livingCampMobs = campCounts.get(camp.id) || 0;
      if (livingCampMobs > 0) {
        camp.wasPopulated = true;
        camp.clearTimer = 0;
      } else if (camp.wasPopulated) {
        if (!Number.isFinite(camp.clearTimer) || camp.clearTimer <= 0) {
          camp.clearTimer = camp.clearRespawn || tierConfig.clearRespawn || Math.max(36, (camp.respawn || tierConfig.respawn || 18) * 1.6);
        }
        camp.clearTimer -= hasNearbyActor ? step : step * 0.5;
        if (camp.clearTimer > 0) {
          continue;
        }
        camp.wasPopulated = false;
        camp.timer = 0;
      }
      camp.timer -= hasNearbyActor ? step : step * 0.25;
      if (livingCampMobs >= campMax || camp.timer > 0) {
        continue;
      }
      this.spawnCampMob(camp);
      camp.wasPopulated = true;
      camp.clearTimer = 0;
      campCounts.set(camp.id, livingCampMobs + 1);
      camp.timer = camp.respawn || tierConfig.respawn || CONFIG.mobs.baseSpawnInterval + randRange(0, 4);
    }
  }

  updateBaseWaves(dt) {
    if (this.match.phaseIndex < 2 || !this.base.core) {
      return;
    }

    this.waveTimer -= dt;
    if (this.waveTimer > 0) {
      return;
    }

    this.waveTimer = Math.max(11, CONFIG.mobs.waveInterval - this.match.phaseIndex * 2);
    const core = this.base.core;
    const angle = randRange(0, Math.PI * 2);
    const spawnX = clamp(core.x + Math.cos(angle) * 720, 80, CONFIG.world.width - 80);
    const spawnY = clamp(core.y + Math.sin(angle) * 720, 80, CONFIG.world.height - 80);
    const count = 3 + this.match.phaseIndex;
    const tier = this.match.phaseIndex >= 3 ? 2 : 1;
    this.spawnMobsAround(spawnX, spawnY, count, tier, true, "base-wave", ["melee", "brute", "ranged"]);
    this.addToast(`Mob wave incoming: ${count} attackers are moving toward your base.`);
  }

  updateProjectiles(dt) {
    for (const projectile of this.projectiles) {
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      projectile.travelled += Math.hypot(projectile.vx, projectile.vy) * dt;

      if (projectile.travelled >= projectile.range) {
        projectile.alive = false;
        continue;
      }

      // Replicated enemy shots are visual-only: move + expire, never collide.
      if (projectile.team === "remoteGhost") {
        continue;
      }

      if (projectile.team === "player") {
        for (const mob of this.mobs) {
          if (!mob.alive || projectile.hitIds.has(mob.id) || !circleIntersects(projectile, mob)) {
            continue;
          }
          projectile.hitIds.add(mob.id);
          this.applyDamage(mob, projectile.damage, this.projectileSource(projectile));
          if (!projectile.pierce) {
            projectile.alive = false;
            break;
          }
        }
        if (projectile.alive) {
          for (const objective of this.objectives) {
            if (!objective.alive || projectile.hitIds.has(objective.id) || !this.projectileHitsObjective(projectile, objective)) {
              continue;
            }
            projectile.hitIds.add(objective.id);
            this.applyDamage(objective, projectile.damage, this.projectileSource(projectile));
            if (!projectile.pierce) {
              projectile.alive = false;
              break;
            }
          }
        }
        if (projectile.alive) {
          for (const ai of this.aiPlayers || []) {
            if (!ai.player.alive || projectile.hitIds.has(ai.player.id) || !circleIntersects(projectile, ai.player)) {
              continue;
            }
            projectile.hitIds.add(ai.player.id);
            this.applyDamage(ai.player, this.getProjectileDamageAgainstPlayer(projectile, ai.player), this.projectileSource(projectile));
            if (!projectile.pierce) {
              projectile.alive = false;
              break;
            }
          }
        }
        if (projectile.alive) {
          for (const remote of this.remotePlayers.values()) {
            if (!this.canTargetEntity(remote, "player") || projectile.hitIds.has(remote.id) || !circleIntersects(projectile, remote)) {
              continue;
            }
            projectile.hitIds.add(remote.id);
            this.applyDamage(remote, this.getProjectileDamageAgainstPlayer(projectile, remote), this.projectileSource(projectile));
            if (!projectile.pierce) {
              projectile.alive = false;
              break;
            }
          }
        }
        if (projectile.alive) {
          for (const ai of this.aiPlayers || []) {
            for (const building of ai.base.livingBuildings) {
              if (projectile.hitIds.has(building.id) || !circleIntersects(projectile, building)) {
                continue;
              }
              projectile.hitIds.add(building.id);
              this.applyDamage(building, projectile.damage, this.projectileSource(projectile));
              projectile.alive = false;
              break;
            }
            if (!projectile.alive) {
              break;
            }
          }
        }
        if (projectile.alive) {
          for (const building of this.getRemoteBaseBuildings()) {
            if (projectile.hitIds.has(building.id) || !circleIntersectsBuilding(projectile, building)) {
              continue;
            }
            projectile.hitIds.add(building.id);
            this.applyDamage(building, projectile.damage, this.projectileSource(projectile));
            projectile.alive = false;
            break;
          }
        }
      } else if (projectile.team === "ai") {
        if (this.canTargetEntity(this.player, "ai") && !projectile.hitIds.has(this.player.id) && circleIntersects(projectile, this.player)) {
          projectile.hitIds.add(this.player.id);
          this.applyDamage(this.player, this.getProjectileDamageAgainstPlayer(projectile, this.player), this.projectileSource(projectile));
          projectile.alive = false;
          continue;
        }

        for (const building of this.base.livingBuildings) {
          if (projectile.hitIds.has(building.id) || !circleIntersects(projectile, building)) {
            continue;
          }
          projectile.hitIds.add(building.id);
          this.applyDamage(building, projectile.damage, this.projectileSource(projectile));
          projectile.alive = false;
          break;
        }

        if (!projectile.alive) {
          continue;
        }

        for (const ai of this.aiPlayers || []) {
          if (
            ai.id === projectile.sourceOwnerId ||
            ai.id === projectile.sourceId ||
            !this.canTargetEntity(ai.player, "ai") ||
            projectile.hitIds.has(ai.player.id) ||
            !circleIntersects(projectile, ai.player)
          ) {
            continue;
          }
          projectile.hitIds.add(ai.player.id);
          this.applyDamage(ai.player, this.getProjectileDamageAgainstPlayer(projectile, ai.player), this.projectileSource(projectile));
          projectile.alive = false;
          break;
        }

        if (!projectile.alive) {
          continue;
        }

        for (const mob of this.mobs) {
          if (!mob.alive || projectile.hitIds.has(mob.id) || !circleIntersects(projectile, mob)) {
            continue;
          }
          projectile.hitIds.add(mob.id);
          this.applyDamage(mob, projectile.damage, this.projectileSource(projectile));
          if (!projectile.pierce) {
            projectile.alive = false;
            break;
          }
        }

        if (projectile.alive) {
          for (const objective of this.objectives) {
            if (!objective.alive || projectile.hitIds.has(objective.id) || !this.projectileHitsObjective(projectile, objective)) {
              continue;
            }
            projectile.hitIds.add(objective.id);
            this.applyDamage(objective, projectile.damage, this.projectileSource(projectile));
            if (!projectile.pierce) {
              projectile.alive = false;
              break;
            }
          }
        }
      } else if (projectile.team === "mob" || projectile.team === "hostile") {
        if (
          this.canTargetEntity(this.player, "mob") &&
          projectile.sourceOwnerId !== this.player.id &&
          !projectile.hitIds.has(this.player.id) &&
          circleIntersects(projectile, this.player)
        ) {
          projectile.hitIds.add(this.player.id);
          this.applyDamage(this.player, projectile.damage, this.projectileSource(projectile));
          projectile.alive = false;
          continue;
        }

        for (const ai of this.aiPlayers || []) {
          if (
            projectile.sourceOwnerId === ai.id ||
            projectile.sourceOwnerId === ai.player.id ||
            !this.canTargetEntity(ai.player, "mob") ||
            projectile.hitIds.has(ai.player.id) ||
            !circleIntersects(projectile, ai.player)
          ) {
            continue;
          }
          projectile.hitIds.add(ai.player.id);
          this.applyDamage(ai.player, projectile.damage, this.projectileSource(projectile));
          projectile.alive = false;
          break;
        }

        if (!projectile.alive) {
          continue;
        }

        for (const building of this.base.livingBuildings) {
          if (projectile.hitIds.has(building.id) || !circleIntersects(projectile, building)) {
            continue;
          }
          projectile.hitIds.add(building.id);
          this.applyDamage(building, projectile.damage, this.projectileSource(projectile));
          projectile.alive = false;
          break;
        }

        if (!projectile.alive) {
          continue;
        }

        for (const ward of this.placedWards) {
          if (!ward.alive || projectile.hitIds.has(ward.id) || !circleIntersects(projectile, ward)) {
            continue;
          }
          projectile.hitIds.add(ward.id);
          this.applyDamage(ward, projectile.damage, this.projectileSource(projectile));
          projectile.alive = false;
          break;
        }
      }

      if (projectile.alive && (projectile.team === "player" || projectile.team === "ai")) {
        this.checkProjectileNeutralTowerHits(projectile);
      }

      if (projectile.alive) {
        this.checkProjectileDefenderHits(projectile);
      }
    }
    this.projectiles = this.projectiles.filter((projectile) => projectile.alive);
  }

  checkProjectileDefenderHits(projectile) {
    for (const defender of this.baseDefenders || []) {
      if (
        !defender.alive ||
        projectile.hitIds.has(defender.id) ||
        this.isProjectileFriendlyToDefender(projectile, defender) ||
        !circleIntersects(projectile, defender)
      ) {
        continue;
      }
      projectile.hitIds.add(defender.id);
      this.applyDamage(defender, projectile.damage, this.projectileSource(projectile));
      projectile.alive = false;
      return true;
    }
    return false;
  }

  checkProjectileNeutralTowerHits(projectile) {
    for (const tower of this.neutralTowers || []) {
      if (!this.canDamageNeutralTower(tower, projectile) || projectile.hitIds.has(tower.id) || !circleIntersects(projectile, tower)) {
        continue;
      }
      projectile.hitIds.add(tower.id);
      this.applyDamage(tower, projectile.damage, this.projectileSource(projectile));
      if (!projectile.pierce) {
        projectile.alive = false;
      }
      return true;
    }
    return false;
  }

  isProjectileFriendlyToDefender(projectile, defender) {
    if (!defender?.ownerId) {
      return false;
    }
    if (projectile.sourceOwnerId === defender.ownerId || projectile.sourceId === defender.ownerId) {
      return true;
    }
    if (projectile.team === "player" && defender.ownerId === this.player.id) {
      return true;
    }
    return false;
  }

  updateAreaEffects(dt) {
    for (const effect of this.areaEffects) {
      effect.elapsed += dt;
      if (effect.tickRate) {
        effect.tickTimer = (effect.tickTimer || effect.tickRate) - dt;
        if (effect.tickTimer <= 0) {
          this.applyAreaEffectDamage(effect);
          effect.tickTimer = effect.tickRate;
        }
      }
    }
    this.areaEffects = this.areaEffects.filter((effect) => effect.elapsed < effect.duration);
  }

  updateDelayedAreaEffects(dt) {
    if (!this.delayedAreaEffects?.length) {
      return;
    }
    for (const effect of this.delayedAreaEffects) {
      effect.delay -= dt;
      if (effect.delay <= 0 && !effect.spawned) {
        effect.spawned = true;
        this.spawnAreaEffect(effect);
      }
    }
    this.delayedAreaEffects = this.delayedAreaEffects.filter((effect) => !effect.spawned);
  }

  projectileSource(projectile) {
    return {
      sourceId: projectile.sourceId,
      sourceOwnerId: projectile.sourceOwnerId,
      sourceX: projectile.sourceX,
      sourceY: projectile.sourceY,
      sourceKind: projectile.sourceKind,
      team: projectile.team,
      status: projectile.status,
      structureMultiplier: projectile.structureMultiplier
    };
  }

  effectSource(effect) {
    return {
      sourceId: effect.sourceId,
      sourceOwnerId: effect.sourceOwnerId,
      sourceX: effect.sourceX,
      sourceY: effect.sourceY,
      sourceKind: effect.sourceKind,
      team: effect.team,
      status: effect.status,
      structureMultiplier: effect.structureMultiplier
    };
  }

  projectileHitsObjective(projectile, objective) {
    const combatPoint = objective.combatPoint || objective;
    return distance(projectile, combatPoint) <= projectile.radius + combatPoint.radius;
  }

  getProjectileDamageAgainstPlayer(projectile, targetPlayer) {
    if (projectile.sourceKind !== "tower" && projectile.sourceKind !== "neutralTower") {
      return projectile.damage;
    }
    const towerLevel = projectile.towerLevel || 1;
    const targetLevel = targetPlayer.level || 1;
    const levelDelta = towerLevel - targetLevel;
    const projectileConfig = CONFIG.combat?.towerProjectiles || {};
    const multiplier = clamp(
      0.22 + levelDelta * 0.055,
      projectileConfig.playerDamageMin ?? 0.12,
      projectileConfig.playerDamageMax ?? 0.55
    );
    let finalDamage = projectile.damage * multiplier;
    const meleeConfig = CONFIG.combat?.meleeStructure || {};
    const classConfig = meleeConfig[targetPlayer.characterId];
    if (classConfig) {
      const sourcePoint = {
        x: Number.isFinite(projectile.sourceX) ? projectile.sourceX : projectile.x,
        y: Number.isFinite(projectile.sourceY) ? projectile.sourceY : projectile.y
      };
      if (distance(sourcePoint, targetPlayer) <= (meleeConfig.closeRange || 170)) {
        finalDamage *= projectileConfig.closeRangeDamageMultiplier ?? meleeConfig.closeRangeTowerMitigation ?? 0.9;
        finalDamage *= classConfig.closeTowerDamageTaken ?? 1;
      }
    }
    return Math.max(1, Math.round(finalDamage));
  }

  updateBaseEffects(dt) {
    for (const effect of this.baseEffects) {
      effect.life -= dt;
      if (effect.type === "repairField") {
        this.tickRepairField(effect, dt);
      } else if (effect.type === "overclock") {
        this.tickOverclockEffect(effect, dt);
      }
    }
    this.baseEffects = this.baseEffects.filter((effect) => effect.life > 0);
  }

  updateDroppedLoot(dt) {
    for (const item of this.droppedLoot) {
      item.ttl -= dt;
    }
    this.droppedLoot = this.droppedLoot.filter((item) => item.ttl > 0);
    if (this.droppedLoot.length > CONFIG.loot.maxWorldDrops) {
      this.droppedLoot.sort((a, b) => a.ttl - b.ttl);
      this.droppedLoot = this.droppedLoot.slice(this.droppedLoot.length - CONFIG.loot.maxWorldDrops);
    }
  }

  updateBossScaling() {
    if (!this.bossSpawned || this.bossDefeated) {
      return;
    }
    const scaleLevel = Math.max(5, Math.round(this.getAveragePlayerLevel() + 2));
    for (const mob of this.mobs) {
      if (!mob.isBoss || mob.objectiveScaleLevel === scaleLevel) {
        continue;
      }
      const oldMax = mob.maxHealth;
      mob.objectiveScaleLevel = scaleLevel;
      mob.maxHealth = Math.round(720 * (1 + (scaleLevel - 1) * 0.22));
      mob.damage = Math.round(28 * (1 + (scaleLevel - 1) * 0.08));
      if (mob.alive) {
        mob.health = Math.min(mob.maxHealth, mob.health + Math.max(0, mob.maxHealth - oldMax));
      }
    }
  }

  updateExplorationChests(dt) {
    for (const chest of this.explorationChests) {
      if (chest.opened) {
        continue;
      }
      chest.pulse += dt * 3;
      if (this.player.alive && distance(this.player, chest) <= chest.radius + this.player.radius + 42) {
        this.openExplorationChest(chest, this.player);
        continue;
      }
      const aiOpener = (this.aiPlayers || []).find((ai) => ai.player.alive && distance(ai.player, chest) <= chest.radius + ai.player.radius + 42);
      if (aiOpener) {
        this.openExplorationChest(chest, aiOpener.player);
        continue;
      }
      const remoteOpener = Array.from(this.remotePlayers?.values?.() || []).find(
        (remote) => remote.alive && distance(remote, chest) <= chest.radius + (remote.radius || 22) + 42
      );
      if (remoteOpener) {
        this.openExplorationChest(chest, remoteOpener);
      }
    }
  }

  updateRoamingEncounters() {
    for (const encounter of this.roamingEncounters) {
      if (encounter.triggered) {
        continue;
      }
      const playerTriggered = this.player.alive && distance(this.player, encounter) <= encounter.triggerRadius;
      const aiTriggered = (this.aiPlayers || []).some((ai) => ai.player.alive && distance(ai.player, encounter) <= encounter.triggerRadius);
      if (!playerTriggered && !aiTriggered) {
        continue;
      }
      encounter.triggered = true;
      this.spawnMobsAround(encounter.x, encounter.y, encounter.count, encounter.tier, false, encounter.id, encounter.variants);
      this.addToast(playerTriggered ? "Ambush camp alerted. Enemies are moving toward you." : "An AI rival triggered an ambush camp.");
    }
  }

  updateVillages(dt) {
    for (const village of this.villages || []) {
      if (village.looted) {
        continue;
      }
      const visitor =
        this.player.alive && distance(this.player, village) <= village.radius + this.player.radius
          ? this.player
          : (this.aiPlayers || []).find((ai) => ai.player.alive && distance(ai.player, village) <= village.radius + ai.player.radius)?.player;
      if (!visitor) {
        continue;
      }
      village.looted = true;
      visitor.currency += CONFIG.villages?.rewardGold || 30;
      visitor.resources += CONFIG.villages?.rewardResources || 25;
      if (village.ambush) {
        this.spawnMobsAround(village.x, village.y, 3, 1, false, `${village.id}-ambush`, ["swift", "melee", "ranged"]);
        this.addToast(`${visitor === this.player ? "You found" : visitor.displayName || "An AI found"} an ambushed village.`);
      } else if (visitor === this.player) {
        this.addToast(`Village supplies found: +${CONFIG.villages?.rewardGold || 30}g, +${CONFIG.villages?.rewardResources || 25} build.`);
      }
    }
  }

  updateNeutralTowers(dt) {
    for (const tower of this.neutralTowers || []) {
      if (!tower.alive) {
        continue;
      }
      if (tower.type === "vision") {
        const contestant = this.getNeutralTowerContestant(tower);
        if (contestant) {
          if (tower.captureOwnerId && tower.captureOwnerId !== contestant.id) {
            tower.progress = 0;
          }
          tower.captureOwnerId = contestant.id;
          tower.progress = Math.min(tower.config.captureSeconds || 8, (tower.progress || 0) + dt);
          if (tower.progress >= (tower.config.captureSeconds || 8)) {
            tower.captured = true;
            tower.ownerId = contestant.id;
            tower.progress = tower.config.captureSeconds || 8;
            if (contestant === this.player) {
              this.addToast(`${tower.label} captured. Vision online.`);
            }
          }
        } else if (!tower.captured) {
          tower.progress = Math.max(0, (tower.progress || 0) - dt * 0.5);
        }
        continue;
      }
      tower.fireTimer = Math.max(0, (tower.fireTimer || 0) - dt);
      if (tower.fireTimer > 0) {
        continue;
      }
      const target = this.getNeutralTurretTarget(tower);
      if (!target) {
        continue;
      }
      tower.fireTimer = tower.config.fireRate || 1.5;
      const direction = normalize(target.x - tower.x, target.y - tower.y);
      this.spawnProjectile({
        x: tower.x + direction.x * 24,
        y: tower.y + direction.y * 24,
        vx: direction.x * (tower.config.projectileSpeed || 540),
        vy: direction.y * (tower.config.projectileSpeed || 540),
        radius: 7,
        range: (tower.config.targetingRadius || 620) + 120,
        damage: Math.round((tower.config.damage || 20) * (1 + tower.level * 0.08)),
        color: tower.color,
        pierce: false,
        sourceId: tower.id,
        sourceOwnerId: "neutral",
        sourceX: tower.x,
        sourceY: tower.y,
        sourceKind: "neutralTower",
        towerLevel: tower.level,
        team: "hostile"
      });
    }
  }

  getNeutralTowerContestant(tower) {
    const candidates = [];
    if (this.player.alive && distance(this.player, tower) <= tower.radius + 92) {
      candidates.push(this.player);
    }
    for (const ai of this.aiPlayers || []) {
      if (ai.player.alive && distance(ai.player, tower) <= tower.radius + 92) {
        candidates.push(ai.player);
      }
    }
    candidates.sort((a, b) => distanceSq(a, tower) - distanceSq(b, tower));
    return candidates[0] || null;
  }

  getNeutralTurretTarget(tower) {
    const range = tower.config.targetingRadius || 620;
    const candidates = [];
    if (this.canTargetEntity(this.player, "neutralTower") && distance(this.player, tower) <= range) {
      candidates.push(this.player);
    }
    for (const ai of this.aiPlayers || []) {
      if (this.canTargetEntity(ai.player, "neutralTower") && distance(ai.player, tower) <= range) {
        candidates.push(ai.player);
      }
    }
    for (const remote of this.remotePlayers?.values?.() || []) {
      if (this.canTargetEntity(remote, "neutralTower") && distance(remote, tower) <= range) {
        candidates.push(remote);
      }
    }
    candidates.sort((a, b) => distanceSq(a, tower) - distanceSq(b, tower));
    return candidates[0] || null;
  }

  updateStatusDots(dt) {
    const targets = [this.player, ...(this.aiPlayers || []).map((ai) => ai.player), ...this.mobs];
    for (const target of targets) {
      if (!target?.alive || !(target.curseTimer > 0) || !(target.curseDps > 0)) {
        continue;
      }
      target.curseTickTimer = (target.curseTickTimer || 0) - dt;
      if (target.curseTickTimer > 0) {
        continue;
      }
      target.curseTickTimer = 1;
      this.applyDamage(target, Math.max(1, Math.round(target.curseDps)), {
        ...(target.curseSource || {}),
        sourceKind: "curse",
        status: null
      });
    }
  }

  openExplorationChest(chest, owner = this.player) {
    chest.opened = true;
    if (chest.kind === "bait") {
      const fakeTier = chest.displayTier || chest.tier;
      const count = 2 + fakeTier * 2;
      const variants =
        fakeTier >= 3 ? ["tank", "summoner", "ranged", "skitter"] : fakeTier >= 2 ? ["brute", "ranged", "swift"] : ["swift", "melee"];
      this.spawnMobsAround(chest.x, chest.y, count, Math.min(5, fakeTier + 1), false, `${chest.id}-bait`, variants);
      if (owner?.isRemotePlayer) {
        this.emitRemoteChestReward(chest, owner, { gold: 0, resources: 0 });
      }
      this.addToast("Bait chest! It snapped open into a monster ambush.");
      this.addFloatingText(chest.x, chest.y - 36, "Ambush!", "#e85b58");
      return;
    }

    const gold = 36 + chest.tier * 28;
    const build = 18 + chest.tier * 18;
    if (owner?.isRemotePlayer) {
      this.emitRemoteChestReward(chest, owner, { gold, resources: build });
      this.addToast(`${owner.displayName || owner.name || "A rival"} opened a loot chest.`);
      this.addFloatingText(chest.x, chest.y - 36, "Chest opened", "#e7bd58");
      return;
    }
    owner.currency += gold;
    owner.resources += build;
    this.spawnDroppedLoot(chest.x, chest.y, this.rewardSystem.createExplorationLoot(chest.tier, "chest"));
    if (chest.tier >= 2) {
      this.spawnDroppedLoot(chest.x + 20, chest.y + 12, this.rewardSystem.createExplorationLoot(chest.tier, "chest"));
    }
    this.addToast(`${owner === this.player ? "Loot chest opened" : `${owner.displayName || "AI"} opened a chest`}: +${gold}g, +${build} build, gear dropped.`);
    this.addFloatingText(chest.x, chest.y - 36, "Chest opened", "#e7bd58");
  }

  emitRemoteChestReward(chest, opener, reward) {
    if (!this.multiplayer?.queueCombatEvent || !opener?.id) {
      return;
    }
    this.multiplayer.queueCombatEvent({
      type: "chestOpened",
      targetOwnerId: opener.id,
      targetId: chest.id,
      chestId: chest.id,
      openerId: opener.id,
      openerName: opener.displayName || opener.name || "Player",
      chestKind: chest.kind || "loot",
      chestTier: chest.tier || 1,
      x: chest.x,
      y: chest.y,
      rewardGold: reward.gold || 0,
      rewardResources: reward.resources || 0
    });
  }

  applyRemoteChestOpened(event) {
    const chest = (this.explorationChests || []).find((candidate) => candidate.id === event.chestId || candidate.id === event.targetId);
    if (chest) {
      chest.opened = true;
    }
    if (event.openerId !== this.player.id) {
      this.addToast(`${event.openerName || "A rival"} opened a chest.`);
      return;
    }
    const gold = Math.max(0, Math.round(Number(event.rewardGold || 0)));
    const resources = Math.max(0, Math.round(Number(event.rewardResources || 0)));
    if (event.chestKind === "bait") {
      this.addToast("Bait chest! It snapped open into a monster ambush.");
      this.addFloatingText(this.player.x, this.player.y - 52, "Ambush!", "#e85b58");
      return;
    }
    this.player.currency += gold;
    this.player.resources += resources;
    const x = Number.isFinite(event.x) ? event.x : chest?.x || this.player.x;
    const y = Number.isFinite(event.y) ? event.y : chest?.y || this.player.y;
    const tier = Math.max(1, Math.round(Number(event.chestTier || chest?.tier || 1)));
    this.spawnDroppedLoot(x, y, this.rewardSystem.createExplorationLoot(tier, "chest"));
    if (tier >= 2) {
      this.spawnDroppedLoot(x + 20, y + 12, this.rewardSystem.createExplorationLoot(tier, "chest"));
    }
    this.addToast(`Loot chest opened: +${gold}g, +${resources} build.`);
    this.addFloatingText(this.player.x, this.player.y - 52, "Chest reward", "#e7bd58");
  }

  updateObjectiveIncome(dt) {
    this.objectiveIncomeTimer += dt;
    if (this.objectiveIncomeTimer < 5) {
      return;
    }
    this.objectiveIncomeTimer = 0;

    for (const objective of this.objectives) {
      if (!objective.captured) {
        continue;
      }
      const owner = objective.ownerId === this.player.id ? this.player : this.getAIById(objective.ownerId)?.player;
      if (!owner) {
        continue;
      }
      if (objective.type === "shrine") {
        owner.currency += 14;
        owner.addXP(6);
        if (owner === this.player) {
          this.addFloatingText(objective.x, objective.y - 42, "+14g shrine", "#e7bd58");
        }
      } else if (objective.type === "mine") {
        owner.resources += 16;
        if (owner === this.player) {
          this.addFloatingText(objective.x, objective.y - 42, "+16 build mine", "#63d46b");
        }
      }
    }
  }

  updateFloatingTexts(dt) {
    const active = [];
    for (const text of this.floatingTexts) {
      text.x += (text.vx || 0) * dt;
      text.y -= (text.riseSpeed || 28) * dt;
      text.life -= dt;
    }
    for (const text of this.floatingTexts) {
      if (text.life > 0) {
        active.push(text);
      } else {
        this.releaseFloatingText(text);
      }
    }
    this.floatingTexts = active;
  }

  updateToasts(dt) {
    for (const toast of this.toasts) {
      toast.life -= dt;
    }
    this.toasts = this.toasts.filter((toast) => toast.life > 0);
  }

  cleanupDeadEntities() {
    this.mobs = this.mobs.filter((mob) => mob.alive || !mob.rewardsGranted);
    this.placedWards = this.placedWards.filter((ward) => ward.alive);
    if (this.selectedTarget && !this.isAutoAttackTargetValid(this.selectedTarget)) {
      this.clearSelectedTarget();
    }
    if (this.hoverTarget && !this.isAutoAttackTargetValid(this.hoverTarget)) {
      this.hoverTarget = null;
    }
  }

  spawnOpeningCamps() {
    for (const camp of this.campStates) {
      const baseOpeningCount = camp.minor ? 1 : camp.tier >= 3 ? 1 : 2;
      const openingCount = Math.max(1, Math.round(baseOpeningCount * this.getMapMobDensityMultiplier()));
      if (distance(camp, this.spawnPoint) < 680) {
        continue;
      }
      const tierConfig = CONFIG.campTiers[camp.tier] || CONFIG.campTiers[1];
      const rewardConfig = CONFIG.economy?.mobRewards || {};
      const zoneScale = rewardConfig.zoneMultipliers?.[camp.zoneType] || 1;
      this.spawnMobsAround(camp.x, camp.y, openingCount, camp.tier, false, camp.id, camp.variants, {
        campType: camp.campType,
        rewardScale: (tierConfig.rewardScale || 1) * zoneScale * (camp.minor ? rewardConfig.minorCampRewardMultiplier || 0.82 : 1)
      });
    }
  }

  spawnBoss() {
    if (!this.worldOptions.bosses) {
      return;
    }
    if (this.bossSpawned || this.bossDefeated) {
      return;
    }
    const bossObjective = this.objectives.find((objective) => objective.type === "boss");
    const bossTemplates = Object.values(CONFIG.bossTemplates || {});
    const template = bossTemplates[Math.floor(Math.random() * bossTemplates.length)] || { label: "Central Boss", reward: "Boss blessing" };
    this.activeBossTemplate = template;
    if (bossObjective) {
      bossObjective.label = template.label || bossObjective.label;
      bossObjective.reward = template.reward || bossObjective.reward;
    }
    this.bossSpawned = true;
    this.mobs.push(
      new Mob({
        x: bossObjective?.x || 2100,
        y: bossObjective?.y || 1600,
        tier: 5,
        campId: "boss-center",
        isBoss: true,
        campType: "wraith",
        rewardScale: 2.2,
        arenaBounds: bossObjective?.guardianBounds || null
      })
    );
  }

  spawnCampMob(camp) {
    const tierConfig = CONFIG.campTiers[camp.tier] || CONFIG.campTiers[1];
    const baseCount = camp.minor ? 1 : camp.tier >= 3 && Math.random() < 0.25 ? 2 : 1;
    const count = Math.max(1, Math.round(baseCount * this.getMapMobDensityMultiplier()));
    const rewardConfig = CONFIG.economy?.mobRewards || {};
    const zoneScale = rewardConfig.zoneMultipliers?.[camp.zoneType] || 1;
    this.spawnMobsAround(camp.x, camp.y, count, camp.tier, false, camp.id, camp.variants || CONFIG.campTypes[camp.campType]?.variants, {
      campType: camp.campType,
      rewardScale: (tierConfig.rewardScale || 1) * zoneScale * (camp.minor ? rewardConfig.minorCampRewardMultiplier || 0.82 : 1)
    });
  }

  spawnMobsAround(x, y, count, tier, targetBase = false, campId = "wild", variants = ["melee"], options = {}) {
    const spawnCount = options.ignoreMapMobScale ? count : Math.max(1, Math.round(count * this.getMapMobDensityMultiplier()));
    for (let index = 0; index < spawnCount; index += 1) {
      const angle = randRange(0, Math.PI * 2);
      const radius = randRange(86, 210);
      const archetype = variants[Math.floor(Math.random() * variants.length)] || "melee";
      const spawn = {
        x: clamp(x + Math.cos(angle) * radius, 40, CONFIG.world.width - 40),
        y: clamp(y + Math.sin(angle) * radius, 40, CONFIG.world.height - 40),
        radius: 20,
        alive: true,
        vy: 0
      };
      this.map.resolveRiverCollision?.(spawn);
      this.mobs.push(
        new Mob({
          x: spawn.x,
          y: spawn.y,
          tier,
          campId,
          targetBase,
          archetype,
          campType: options.campType,
          rewardScale: options.rewardScale
        })
      );
    }
  }

  spawnProjectile(projectile) {
    const created = {
      ...projectile,
      sourceX: projectile.sourceX ?? projectile.x,
      sourceY: projectile.sourceY ?? projectile.y,
      travelled: 0,
      alive: true,
      hitIds: new Set()
    };
    this.projectiles.push(created);
    // Replicate the local player's shots so opponents can see them coming.
    if (this.multiplayer && created.team === "player") {
      this.emitProjectileSpawn(created);
    }
    return created;
  }

  emitProjectileSpawn(projectile) {
    if (!this.multiplayer?.queueCombatEvent) {
      return;
    }
    this.multiplayer.queueCombatEvent({
      type: "projectile",
      x: Math.round(projectile.x),
      y: Math.round(projectile.y),
      vx: Math.round(projectile.vx || 0),
      vy: Math.round(projectile.vy || 0),
      range: Math.round(projectile.range || 600),
      radius: Math.round(projectile.radius || 6),
      color: projectile.color || "#ffd36a",
      pierce: Boolean(projectile.pierce)
    });
  }

  // Spawn a non-damaging visual copy of a remote player's projectile, advanced
  // by the relay latency so it lines up roughly with where the real shot is.
  spawnRemoteGhostProjectile(event) {
    const now = this.multiplayer?.adjustedNow ? this.multiplayer.adjustedNow() : Date.now();
    const elapsed = Math.max(0, Math.min(0.6, (now - (event.serverTime || event.timestamp || now)) / 1000));
    const vx = event.vx || 0;
    const vy = event.vy || 0;
    this.projectiles.push({
      x: event.x + vx * elapsed,
      y: event.y + vy * elapsed,
      vx,
      vy,
      range: event.range || 600,
      radius: event.radius || 6,
      color: event.color || "#ff7b5c",
      team: "remoteGhost",
      travelled: Math.hypot(vx, vy) * elapsed,
      alive: true,
      hitIds: new Set()
    });
  }

  emitAreaEffectSpawn(effect) {
    if (!this.multiplayer?.queueCombatEvent) {
      return;
    }
    this.multiplayer.queueCombatEvent({
      type: "area",
      shape: effect.shape || "circle",
      x: Math.round(effect.x || 0),
      y: Math.round(effect.y || 0),
      radius: Math.round(effect.radius || 0),
      x1: Math.round(effect.x1 || 0),
      y1: Math.round(effect.y1 || 0),
      x2: Math.round(effect.x2 || 0),
      y2: Math.round(effect.y2 || 0),
      dirX: Math.round((effect.dirX || 0) * 100) / 100,
      dirY: Math.round((effect.dirY || 0) * 100) / 100,
      length: Math.round(effect.length || 0),
      coneAngle: Math.round((effect.coneAngle || 0) * 100) / 100,
      closeRadius: Math.round(effect.closeRadius || 0),
      width: Math.round(effect.width || 0),
      color: effect.color || "#b391f0",
      duration: Math.round((effect.duration || 1) * 100) / 100,
      effectType: effect.type || effect.kind || ""
    });
  }

  // Non-damaging visual copy of a remote player's area ability (zone or wall).
  spawnRemoteGhostArea(event) {
    this.areaEffects.push({
      ghost: true,
      shape: event.shape || "circle",
      x: event.x,
      y: event.y,
      radius: event.radius || 60,
      x1: event.x1,
      y1: event.y1,
      x2: event.x2,
      y2: event.y2,
      dirX: event.dirX,
      dirY: event.dirY,
      length: event.length,
      coneAngle: event.coneAngle,
      closeRadius: event.closeRadius,
      width: event.width,
      color: event.color || "#b391f0",
      type: event.effectType || undefined,
      duration: Math.max(0.2, Math.min(30, event.duration || 1)),
      elapsed: 0,
      hitIds: new Set()
    });
  }

  setCountdownOverlay(text) {
    const el = typeof document !== "undefined" ? document.getElementById("matchCountdown") : null;
    if (!el) {
      return;
    }
    if (text == null) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = text;
  }

  spawnBaseEffect(effect) {
    this.baseEffects.push(effect);
  }

  spawnDroppedLoot(x, y, item, options = {}) {
    if (!item) {
      return;
    }
    const scatter = options.scatter ?? 22;
    this.droppedLoot.push({
      ...item,
      id: item.id || `loot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      x: clamp(x + randRange(-scatter, scatter), 24, CONFIG.world.width - 24),
      y: clamp(y + randRange(-scatter, scatter), 24, CONFIG.world.height - 24),
      radius: 15,
      pulse: randRange(0, Math.PI * 2),
      ttl: options.ttl ?? CONFIG.loot.dropDespawnSeconds
    });
  }

  spawnAreaEffect(effect) {
    const nextEffect = {
      ...effect,
      elapsed: 0,
      tickTimer: effect.tickRate || 0,
      hitIds: new Set()
    };
    if (!nextEffect.tickRate || effect.tickImmediately) {
      this.applyAreaEffectDamage(nextEffect);
    }
    this.areaEffects.push(nextEffect);
    // Replicate the local player's area abilities so opponents see the zone/wall.
    if (this.multiplayer && nextEffect.team === "player" && !nextEffect.ghost) {
      this.emitAreaEffectSpawn(nextEffect);
    }
  }

  applyAreaEffectDamage(nextEffect) {
    if (nextEffect.ghost) {
      return;
    }
    const source = this.effectSource(nextEffect);
    for (const mob of this.mobs) {
      if (mob.alive && this.effectContainsTarget(nextEffect, mob)) {
        nextEffect.hitIds.add(mob.id);
        this.applyDamage(mob, nextEffect.damage, source);
      }
    }
    for (const objective of this.objectives) {
      const combatPoint = objective.combatPoint || objective;
      if (objective.alive && this.effectContainsTarget(nextEffect, combatPoint)) {
        nextEffect.hitIds.add(objective.id);
        this.applyDamage(objective, nextEffect.damage, source);
      }
    }
    if (nextEffect.team === "player") {
      for (const ai of this.aiPlayers || []) {
        if (this.canTargetEntity(ai.player, "player") && this.effectContainsTarget(nextEffect, ai.player)) {
          nextEffect.hitIds.add(ai.player.id);
          this.applyDamage(ai.player, nextEffect.damage, source);
        }
      }
      for (const remote of this.remotePlayers.values()) {
        if (this.canTargetEntity(remote, "player") && this.effectContainsTarget(nextEffect, remote)) {
          nextEffect.hitIds.add(remote.id);
          this.applyDamage(remote, nextEffect.damage, source);
        }
      }
      for (const ai of this.aiPlayers || []) {
        for (const building of ai.base.livingBuildings) {
          if (this.effectContainsTarget(nextEffect, building)) {
            this.applyDamage(building, nextEffect.damage, source);
          }
        }
      }
      for (const building of this.getRemoteBaseBuildings()) {
        if (this.effectContainsTarget(nextEffect, building)) {
          this.applyDamage(building, nextEffect.damage, source);
        }
      }
      for (const defender of this.baseDefenders || []) {
        if (defender.alive && defender.ownerId !== this.player.id && this.effectContainsTarget(nextEffect, defender)) {
          this.applyDamage(defender, nextEffect.damage, source);
        }
      }
      for (const tower of this.neutralTowers || []) {
        if (this.canDamageNeutralTower(tower, nextEffect) && this.effectContainsTarget(nextEffect, tower)) {
          this.applyDamage(tower, nextEffect.damage, source);
        }
      }
    } else if (nextEffect.team === "ai") {
      if (this.canTargetEntity(this.player, "ai") && this.effectContainsTarget(nextEffect, this.player)) {
        this.applyDamage(this.player, nextEffect.damage, source);
      }
      for (const building of this.base.livingBuildings) {
        if (this.effectContainsTarget(nextEffect, building)) {
          this.applyDamage(building, nextEffect.damage, source);
        }
      }
      for (const defender of this.baseDefenders || []) {
        if (defender.alive && defender.ownerId !== nextEffect.sourceOwnerId && this.effectContainsTarget(nextEffect, defender)) {
          this.applyDamage(defender, nextEffect.damage, source);
        }
      }
      for (const tower of this.neutralTowers || []) {
        if (this.canDamageNeutralTower(tower, nextEffect) && this.effectContainsTarget(nextEffect, tower)) {
          this.applyDamage(tower, nextEffect.damage, source);
        }
      }
    } else if (nextEffect.team === "mob" || nextEffect.team === "hostile") {
      for (const defender of this.baseDefenders || []) {
        if (defender.alive && this.effectContainsTarget(nextEffect, defender)) {
          this.applyDamage(defender, nextEffect.damage, source);
        }
      }
    }
  }

  effectContainsTarget(effect, target) {
    if (effect.shape === "wall") {
      const width = effect.width || effect.radius * 2 || 48;
      return pointLineDistance(target, { x: effect.x1, y: effect.y1 }, { x: effect.x2, y: effect.y2 }) <= width * 0.5 + (target.radius || 18);
    }
    if (effect.shape === "cone") {
      const origin = {
        x: Number.isFinite(effect.sourceX) ? effect.sourceX : effect.x,
        y: Number.isFinite(effect.sourceY) ? effect.sourceY : effect.y
      };
      const direction = normalize(effect.dirX || effect.x - origin.x, effect.dirY || effect.y - origin.y);
      const dx = (target.x || 0) - origin.x;
      const dy = (target.y || 0) - origin.y;
      const targetRadius = this.getTargetRadius?.(target) || target.radius || 18;
      const length = effect.length || effect.radius || 90;
      const targetDistance = Math.hypot(dx, dy);
      if (targetDistance <= (effect.closeRadius || CONFIG.combat?.melee?.defaultCloseRadius || 52) + targetRadius) {
        return true;
      }
      if (targetDistance > length + targetRadius) {
        return false;
      }
      const nx = dx / Math.max(1, targetDistance);
      const ny = dy / Math.max(1, targetDistance);
      const dot = nx * direction.x + ny * direction.y;
      const halfAngle = (effect.coneAngle || CONFIG.combat?.melee?.defaultConeAngle || 1.72) * 0.5;
      const radiusGrace = Math.min(0.22, targetRadius / Math.max(1, targetDistance));
      return dot >= Math.cos(halfAngle) - radiusGrace;
    }
    return distance(effect, target) <= effect.radius + (target.radius || 18);
  }

  deployTemporaryTurret(caster, point, ability) {
    const ownerId = caster.id;
    const level = ability.level || 1;
    const turret = createBaseDefender({
      x: point.x,
      y: point.y,
      kind: "archer",
      ownerId,
      color: ability.config.color || caster.color,
      barracksId: `${ownerId}-mini-turret`,
      level
    });
    turret.id = `mini-turret-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    turret.kind = "turret";
    turret.radius = ability.effectRadius || 22;
    turret.maxHealth = Math.round(
      (ability.config.turretHealthBase || 85) +
        Math.max(0, (caster.level || 1) - 1) * (ability.config.turretHealthPerLevel || 12) +
        Math.max(0, level - 1) * (ability.config.turretHealthPerAbilityLevel || 22)
    );
    turret.health = turret.maxHealth;
    const turretBaseDamage =
      ability.previewDamage?.(caster) ||
      Math.round((ability.config.damage || 10) + (caster.level || 1) * CONFIG.abilityScaling.turretDamagePerLevel + level * 4);
    turret.damage = Math.max(1, Math.round(turretBaseDamage * (ability.config.turretDamageScale || 0.72)));
    turret.speed = 0;
    turret.range = 360 + level * 24;
    turret.cooldown = Math.max(0.55, 1.05 - level * 0.06);
    turret.temporary = true;
    turret.life = ability.config.duration + level * 1.2;
    turret.maxLife = turret.life;
    this.baseDefenders.push(turret);
    this.spawnBaseEffect({
      type: "pulse",
      x: point.x,
      y: point.y,
      color: ability.config.color,
      radius: 64,
      life: 0.6,
      maxLife: 0.6
    });
  }

  summonTemporaryUnit(caster, point, ability, damage = 10) {
    const kind = ability.config.summonKind || "guard";
    const level = ability.level || 1;
    const summon = createBaseDefender({
      x: point.x,
      y: point.y,
      kind,
      ownerId: caster.id,
      color: ability.config.color || caster.color,
      barracksId: `${caster.id}-${kind}-summon`,
      level
    });
    summon.id = `summon-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    summon.temporary = true;
    summon.life = ability.config.duration + level * 1.2;
    summon.maxLife = summon.life;
    summon.ownerEntityId = caster.id;
    summon.followOwner = true;
    summon.maxHealth = Math.round((ability.config.summonHealth || summon.maxHealth) + Math.max(0, (caster.level || 1) - 1) * 12 + level * 18);
    summon.health = summon.maxHealth;
    summon.damage = Math.max(1, Math.round(damage * (kind === "ent" ? 0.68 : 0.48)));
    summon.range = kind === "imp" ? 300 : summon.range;
    summon.speed = kind === "imp" ? Math.max(summon.speed || 0, 190) : summon.speed;
    this.baseDefenders.push(summon);
    this.spawnBaseEffect({
      type: "pulse",
      x: point.x,
      y: point.y,
      color: ability.config.color,
      radius: kind === "ent" ? 92 : 58,
      life: 0.65,
      maxLife: 0.65
    });
  }

  spawnRepairField(caster, point, ability) {
    this.spawnBaseEffect({
      type: "repairField",
      x: point.x,
      y: point.y,
      radius: ability.effectRadius,
      color: ability.config.color,
      life: ability.config.duration + ability.level * 0.45,
      maxLife: ability.config.duration + ability.level * 0.45,
      ownerId: caster.id,
      repairPerSecond:
        (ability.config.repairPerSecond || 18) +
        Math.max(0, (caster.level || 1) - 1) * (ability.config.repairPerLevel || CONFIG.abilityScaling.repairPerLevel || 0) +
        Math.max(0, ability.level - 1) * (ability.config.repairPerAbilityLevel || 7),
      healPerSecond: (ability.config.healPerSecond || 4) + Math.max(0, (caster.level || 1) - 1) * (ability.config.healPerLevel || 0.6) + ability.level * 1.5
    });
  }

  spawnOverclockDefense(caster, point, ability) {
    this.spawnBaseEffect({
      type: "overclock",
      x: point.x,
      y: point.y,
      radius: ability.effectRadius,
      color: ability.config.color,
      life: ability.config.duration + ability.level * 0.35,
      maxLife: ability.config.duration + ability.level * 0.35,
      ownerId: caster.id,
      damageMultiplier: 1.18 + ability.level * 0.06,
      fireRateMultiplier: 1.2 + ability.level * 0.07,
      repairPerSecond: 12 + ability.level * 4
    });
    this.addFloatingText(point.x, point.y - 42, "Overclock", ability.config.color);
  }

  tickRepairField(effect, dt) {
    const base = this.getBaseByOwnerId(effect.ownerId);
    for (const building of base?.livingBuildings || []) {
      if (distance(effect, building) > effect.radius + (building.radius || 24) || building.health >= building.maxHealth) {
        continue;
      }
      building.health = Math.min(building.maxHealth, building.health + effect.repairPerSecond * dt);
    }
    for (const defender of this.baseDefenders || []) {
      if (
        !defender.alive ||
        defender.ownerId !== effect.ownerId ||
        distance(effect, defender) > effect.radius + (defender.radius || 18) ||
        defender.health >= defender.maxHealth
      ) {
        continue;
      }
      defender.health = Math.min(defender.maxHealth, defender.health + effect.repairPerSecond * dt);
    }
    const owner = effect.ownerId === this.player.id ? this.player : this.getAIById(effect.ownerId)?.player;
    if (owner?.alive && distance(effect, owner) <= effect.radius + owner.radius) {
      owner.heal?.(effect.healPerSecond * dt);
    }
  }

  tickOverclockEffect(effect, dt) {
    const base = this.getBaseByOwnerId(effect.ownerId);
    for (const building of base?.livingBuildings || []) {
      if (distance(effect, building) > effect.radius + (building.radius || 24) || building.health >= building.maxHealth) {
        continue;
      }
      building.health = Math.min(building.maxHealth, building.health + effect.repairPerSecond * dt);
    }
  }

  getDefenseOverclock(ownerId, source) {
    const active = (this.baseEffects || []).find(
      (effect) => effect.type === "overclock" && effect.ownerId === ownerId && distance(effect, source) <= effect.radius + (source.radius || 24)
    );
    return active ? { damage: active.damageMultiplier || 1, fireRate: active.fireRateMultiplier || 1 } : { damage: 1, fireRate: 1 };
  }

  executeMarkedTarget(caster, point, ability, damage) {
    const targets = this.getAbilityTargetsForCaster(caster).filter((target) => distance(point, target.combatPoint || target) <= ability.effectRadius + (target.radius || 24));
    targets.sort((a, b) => (a.healthRatio ?? a.health / Math.max(1, a.maxHealth || 1)) - (b.healthRatio ?? b.health / Math.max(1, b.maxHealth || 1)));
    const target = targets[0];
    if (!target) {
      this.spawnBaseEffect({ type: "pulse", x: point.x, y: point.y, color: ability.config.color, radius: ability.effectRadius, life: 0.45, maxLife: 0.45 });
      return;
    }
    const ratio = target.healthRatio ?? target.health / Math.max(1, target.maxHealth || 1);
    const finalDamage = Math.round(damage * (ratio < 0.35 ? 1.55 : 1));
    const targetPoint = target.combatPoint || target;
    const direction = normalize(targetPoint.x - caster.x, targetPoint.y - caster.y);
    this.dashEntity(caster, direction, Math.min(ability.range, Math.max(0, distance(caster, targetPoint) - 34)));
    this.applyDamage(target, finalDamage, {
      sourceId: caster.id,
      sourceOwnerId: caster.id,
      sourceX: caster.x,
      sourceY: caster.y,
      sourceKind: caster.team === "ai" ? "ai" : "player",
      team: caster.team
    });
    this.spawnBaseEffect({ type: "shockwave", x: targetPoint.x, y: targetPoint.y, color: ability.config.color, radius: ability.effectRadius, life: 0.45, maxLife: 0.45 });
  }

  spawnMeteorStorm(caster, point, ability, damage) {
    const impacts = 5 + Math.min(3, ability.level);
    for (let index = 0; index < impacts; index += 1) {
      const angle = (Math.PI * 2 * index) / impacts + randRange(-0.35, 0.35);
      const radius = randRange(0, ability.effectRadius * 0.72);
      const impact = {
        x: clamp(point.x + Math.cos(angle) * radius, 0, CONFIG.world.width),
        y: clamp(point.y + Math.sin(angle) * radius, 0, CONFIG.world.height),
        radius: Math.max(70, ability.effectRadius * 0.38),
        damage: Math.round(damage * (index === 0 ? 1 : 0.62)),
        duration: 0.35,
        delay: 0.45 + index * 0.18,
        sourceId: caster.id,
        sourceOwnerId: caster.id,
        sourceX: caster.x,
        sourceY: caster.y,
        sourceKind: caster.team === "ai" ? "ai" : "player",
        team: caster.team,
        color: ability.config.color,
        status: ability.config.status,
        structureMultiplier: ability.config.structureMultiplier
      };
      this.delayedAreaEffects.push(impact);
      this.spawnBaseEffect({
        type: "warning",
        x: impact.x,
        y: impact.y,
        color: ability.config.color,
        radius: impact.radius,
        life: impact.delay,
        maxLife: impact.delay
      });
    }
  }

  dashEntity(entity, direction, distanceValue) {
    const steps = 8;
    const step = distanceValue / steps;
    for (let index = 0; index < steps; index += 1) {
      entity.x = clamp(entity.x + direction.x * step, entity.radius || 10, CONFIG.world.width - (entity.radius || 10));
      entity.y = clamp(entity.y + direction.y * step, entity.radius || 10, CONFIG.world.height - (entity.radius || 10));
      this.map.resolveRiverCollision?.(entity);
      this.resolveWallCollisions?.(entity);
    }
    entity.vx = direction.x * 120;
    entity.vy = direction.y * 120;
  }

  damageLine(start, endEntity, radius, damage, source) {
    const end = { x: endEntity.x, y: endEntity.y };
    for (const target of this.getAbilityTargetsForCaster({ id: source.sourceOwnerId || source.sourceId, team: source.team })) {
      const targetPoint = target.combatPoint || target;
      if (pointLineDistance(targetPoint, start, end) <= radius + (targetPoint.radius || target.radius || 18)) {
        this.applyDamage(target, damage, source);
      }
    }
  }

  getAbilityTargetsForCaster(caster) {
    const targets = [];
    const casterOwnerId = caster.id;
    targets.push(...this.mobs.filter((mob) => mob.alive));
    targets.push(...this.objectives.filter((objective) => objective.alive && this.canDamageObjective(objective, { sourceOwnerId: casterOwnerId })));
    targets.push(...(this.neutralTowers || []).filter((tower) => this.canDamageNeutralTower(tower, { sourceOwnerId: casterOwnerId })));
    if (caster.team === "ai") {
      if (this.canTargetEntity(this.player, "ai")) targets.push(this.player);
      targets.push(...this.base.livingBuildings);
      for (const ai of this.aiPlayers || []) {
        if (ai.id !== casterOwnerId && this.canTargetEntity(ai.player, "ai")) {
          targets.push(ai.player, ...ai.base.livingBuildings);
        }
      }
    } else {
      for (const ai of this.aiPlayers || []) {
        if (this.canTargetEntity(ai.player, "player")) targets.push(ai.player);
        targets.push(...ai.base.livingBuildings);
      }
      targets.push(...Array.from(this.remotePlayers.values()).filter((remote) => this.canTargetEntity(remote, "player")));
      targets.push(...this.getRemoteBaseBuildings());
    }
    return targets.filter((target) => target?.alive !== false);
  }

  applyDamage(target, amount, source = {}) {
    if (!target || !target.alive || amount <= 0) {
      return;
    }

    const sourceOwnerId = source.sourceOwnerId || source.sourceId;
    if (this.stealthBlocksSourceKind(target, source.sourceKind) && sourceOwnerId !== target.id) {
      return;
    }

    if (this.objectives.includes(target) && !this.canDamageObjective(target, source)) {
      return;
    }

    if (target instanceof Mob && target.isBoss && target.arenaBounds && ["player", "ai"].includes(source.sourceKind)) {
      const sourceOwner = this.getRewardPlayerForSource(source);
      const sourcePoint =
        sourceOwner ||
        (Number.isFinite(source.sourceX) && Number.isFinite(source.sourceY)
          ? { x: source.sourceX, y: source.sourceY }
          : null);
      if (!target.isPointInArena(sourcePoint, 0)) {
        return;
      }
    }

    let finalAmount = amount;
    if (this.isStructureDamageTarget(target) && Number.isFinite(source.structureMultiplier)) {
      finalAmount *= source.structureMultiplier;
    }
    finalAmount *= this.getStructureDamageMultiplierForSource(target, source);
    if (target.damageReductionTimer > 0) {
      finalAmount *= Math.max(0.05, 1 - (target.damageReduction || 0));
      if (source.sourceKind === "tower") {
        finalAmount *= Math.max(0.05, 1 - (target.towerReduction || 0));
      }
    }
    if ((target === this.player || this.isAIPlayerEntity(target)) && Number.isFinite(target.characterClass?.stats?.defense)) {
      finalAmount *= Math.max(0.35, 1 - target.characterClass.stats.defense);
    }
    if ((target.passiveDamageReduction || 0) > 0) {
      finalAmount *= Math.max(0.35, 1 - target.passiveDamageReduction);
    }
    if (Number.isFinite(target.damageTakenMultiplier) && target.damageTakenMultiplierTimer > 0) {
      finalAmount *= target.damageTakenMultiplier;
    }
    finalAmount = Math.max(1, Math.round(finalAmount));

    if (this.redirectBlockedBuildingDamage(target, finalAmount, source)) {
      return;
    }

    if (this.isRemoteCombatTarget(target)) {
      this.emitRemoteDamageIntent(target, finalAmount, source);
      return;
    }

    finalAmount = this.absorbShieldDamage(target, finalAmount);
    if (finalAmount <= 0) {
      return;
    }

    const applied = target.takeDamage(finalAmount);
    if (applied > 0) {
      const damageKind =
        source.sourceKind === "tower" || source.sourceKind === "neutralTower"
          ? "tower"
          : this.isStructureDamageTarget(target)
            ? "structure"
            : "damage";
      this.addDamageNumber(target, applied, damageKind, source);
      this.applyCombatStatus(target, source.status, source);
      if (target instanceof Mob || this.objectives.includes(target)) {
        // Mark the mob/objective guardian as "in combat" so leash regen is
        // suppressed briefly (prevents "healing back up" while being fought).
        target.combatTimer = CONFIG.objectiveRules?.leash?.combatMemorySeconds ?? 5;
        if (this.debugMobDamage) {
          console.info(
            `[mob-damage] mob=${target.id} src=${source.sourceOwnerId || source.sourceId || "?"} kind=${source.sourceKind || "?"} dmg=${applied} hp=${Math.ceil(target.health)}/${Math.ceil(target.maxHealth)} alive=${target.alive}`
          );
        }
      }
    }
    if (target === this.player && applied > 0) {
      this.cancelRecall("Recall interrupted by damage.");
    }
    if (target.damageTracker) {
      target.damageTracker.record(source.sourceOwnerId || source.sourceId, source.sourceKind, applied);
    }
    if (applied > 0) {
      this.applySourceCombatProgress(source, target, applied);
    }

    if (target === this.player && !target.alive) {
      this.handlePlayerDeath();
    } else if (this.isAIPlayerEntity(target) && !target.alive) {
      this.handleAIPlayerDeath(target, source);
    } else if (target instanceof Mob && !target.alive) {
      this.handleMobDeath(target, source);
    } else if (this.objectives.includes(target) && !target.alive) {
      this.handleObjectiveGuardianDefeated(target, source);
    } else if (target.ward && !target.alive) {
      this.addToast("A ward was destroyed.");
      this.addFloatingText(target.x, target.y - 32, "Ward down", "#72d8e8");
    } else if ((this.neutralTowers || []).includes(target) && !target.alive) {
      this.handleNeutralTowerDestroyed(target, source);
    } else if (target.type === "core" && !target.alive) {
      this.addFloatingText(target.x, target.y - 40, "Core down", "#e85b58");
    }
  }

  applySourceCombatProgress(source, target, amount) {
    const owner = this.getRewardPlayerForSource(source);
    if (!owner) {
      return;
    }
    if (owner.characterId === "berserker") {
      const passive = CONFIG.classPassives?.berserker || {};
      owner.rageStacks = Math.min(passive.maxRage || 12, (owner.rageStacks || 0) + (passive.rageOnDamage || 1));
    }
  }

  applyCombatStatus(target, status = null, source = {}) {
    if (!status || !target?.alive) {
      return;
    }
    if (Number.isFinite(status.slow) && Number.isFinite(status.duration)) {
      target.slowAmount = Math.max(target.slowAmount || 0, status.slow);
      target.slowTimer = Math.max(target.slowTimer || 0, status.duration);
    }
    if (Number.isFinite(status.stun)) {
      target.stunTimer = Math.max(target.stunTimer || 0, status.stun);
    }
    if (Number.isFinite(status.curse)) {
      target.curseTimer = Math.max(target.curseTimer || 0, status.curse);
      target.curseDps = Math.max(target.curseDps || 0, status.curseDamagePerSecond || 4);
      target.curseSource = source;
      target.curseTickTimer = 1;
    }
    if (Number.isFinite(status.knockback) && Number.isFinite(source.sourceX) && Number.isFinite(source.sourceY)) {
      const direction = normalize(target.x - source.sourceX, target.y - source.sourceY);
      target.x = clamp(target.x + direction.x * status.knockback, target.radius || 10, CONFIG.world.width - (target.radius || 10));
      target.y = clamp(target.y + direction.y * status.knockback, target.radius || 10, CONFIG.world.height - (target.radius || 10));
      target.vx = (target.vx || 0) + direction.x * status.knockback * 4;
      target.vy = (target.vy || 0) + direction.y * status.knockback * 4;
      this.map.resolveRiverCollision?.(target);
      this.resolveWallCollisions?.(target);
    }
  }

  redirectBlockedBuildingDamage(target, amount, source = {}) {
    if (!target?.type || target.type === "wall" || source.blockedByWall || !["player", "remotePlayer", "ai", "mob"].includes(source.sourceKind)) {
      return false;
    }
    const blocker = this.findWallBlockingBuildingDamage(target, source);
    if (!blocker) {
      return false;
    }
    this.applyDamage(blocker, amount, {
      ...source,
      blockedByWall: true
    });
    if (source.sourceOwnerId === this.player.id || source.sourceId === this.player.id) {
      this.addFloatingText(blocker.x, blocker.y - 30, "Wall blocks", "#d8c59a");
    }
    return true;
  }

  handleObjectiveGuardianDefeated(objective, source = {}) {
    objective.progress = 0;
    objective.captureReady = true;
    objective.captureOwnerId = null;
    const owner = this.getRewardPlayerForSource(source) || this.player;
    const rewardText = this.rewardSystem.grantObjectiveGuardianReward(owner, objective);
    const ownerName = owner === this.player ? "you" : owner.displayName || "AI";
    this.addToast(`${objective.label} guardian defeated by ${ownerName}. The capture zone is active: ${rewardText}.`);
    this.addFloatingText(objective.x, objective.y - 64, "Guardian down", "#e7bd58");
    this.addFloatingText(objective.x, objective.y - 92, "Capture now", "#63d46b");
    this.spawnBaseEffect({
      type: "pulse",
      x: objective.x,
      y: objective.y,
      color: "#63d46b",
      radius: objective.radius + (CONFIG.objectiveRules?.captureRadiusBonus || 0),
      life: 0.9,
      maxLife: 0.9
    });
    this.spawnDroppedLoot(objective.x, objective.y, this.rewardSystem.createObjectiveLoot(objective));
  }

  handleNeutralTowerDestroyed(tower, source = {}) {
    const owner = this.getRewardPlayerForSource(source) || this.player;
    owner.currency += tower.config?.rewardGold || 60;
    owner.addXP?.(tower.config?.rewardXP || 80);
    if (tower.type === "vision") {
      tower.alive = true;
      tower.health = tower.maxHealth;
      tower.captured = true;
      tower.ownerId = owner.id;
      tower.progress = tower.config?.captureSeconds || 8;
      this.addToast(`${tower.label} seized by ${owner === this.player ? "you" : owner.displayName || "AI"}. Vision online.`);
    } else {
      this.addToast(`${tower.label} destroyed by ${owner === this.player ? "you" : owner.displayName || "AI"}: +${tower.config?.rewardGold || 60}g.`);
    }
    this.addFloatingText(tower.x, tower.y - 56, tower.type === "vision" ? "Captured" : "Tower down", tower.color || "#e7bd58");
  }

  canDamageObjective(objective, source = {}) {
    if (["player", "ai"].includes(source.sourceKind) || source.sourceOwnerId || source.sourceId) {
      const rules = CONFIG.objectiveRules?.leash || {};
      const sourcePoint = this.getDamageSourcePoint(source);
      const padding = Number.isFinite(rules.arenaDamagePadding) ? rules.arenaDamagePadding : 0;
      if (sourcePoint && !this.isPointInObjectiveArena(objective, sourcePoint, padding)) {
        return false;
      }
    }
    if (!objective.captured || !objective.ownerId) {
      return true;
    }
    const sourceOwnerId = source.sourceOwnerId || source.sourceId;
    return sourceOwnerId !== objective.ownerId;
  }

  canDamageNeutralTower(tower, source = {}) {
    if (!tower?.alive) {
      return false;
    }
    const sourceOwnerId = source.sourceOwnerId || source.sourceId;
    return !tower.captured || !tower.ownerId || tower.ownerId !== sourceOwnerId;
  }

  checkObjectiveControlWin() {
    if (this.gameOver || this.gameWon) {
      return;
    }
    const capturableObjectives = this.objectives.filter((objective) => objective.type !== "boss");
    if (capturableObjectives.length === 0 || capturableObjectives.some((objective) => !objective.captured || !objective.ownerId)) {
      return;
    }
    const ownerId = capturableObjectives[0].ownerId;
    if (!capturableObjectives.every((objective) => objective.ownerId === ownerId)) {
      return;
    }
    if (ownerId === this.player.id) {
      this.win("You controlled every map objective.");
      return;
    }
    const ai = this.getAIById(ownerId);
    this.eliminate(`${ai?.name || "An AI rival"} controlled every map objective.`);
  }

  handleAIPlayerDeath(aiPlayer, source = {}) {
    const ai = this.getAIByPlayer(aiPlayer);
    if (!ai || aiPlayer.respawnTimer > 0) {
      return;
    }
    if (aiPlayer.consumeExtraLife?.()) {
      this.addToast(`${ai.name}'s boss blessing triggered an instant extra life.`);
      this.addFloatingText(aiPlayer.x, aiPlayer.y - 52, "Extra life", "#ffcf5a");
      return;
    }
    const killer = this.getRewardPlayerForSource(source);
    if (killer && killer !== aiPlayer) {
      killer.addXP(120 + aiPlayer.level * 24);
      killer.currency += 110 + aiPlayer.level * 18;
      killer.resources += 70 + aiPlayer.level * 12;
      if (killer.characterId === "berserker") {
        const healed = killer.heal?.(killer.effectiveMaxHealth * (CONFIG.classPassives?.berserker?.playerKillHealPercent || 0)) || 0;
        if (healed > 0 && killer === this.player) {
          this.addFloatingText(killer.x, killer.y - 50, `+${Math.round(healed)} Bloodlust`, "#e85b58");
        }
      }
      if (killer === this.player) {
        this.addToast(`${ai.name} defeated. Player-kill style reward granted.`);
      }
    }
    const droppedItems = this.dropPlayerHeldLoot(aiPlayer, `${ai.name}'s gear`);
    if (droppedItems > 0) {
      this.addFloatingText(aiPlayer.x, aiPlayer.y - 52, `${droppedItems} gear dropped`, "#72d8e8");
    }
    if (!ai.base.hasActiveCore) {
      ai.eliminated = true;
      this.addToast(`${ai.name} was eliminated with no active core.`);
      return;
    }
    aiPlayer.beginRespawn(this.getRespawnSeconds(aiPlayer));
  }

  handlePlayerDeath() {
    if (this.player.eliminated) {
      return;
    }

    this.clearQueuedAbility();
    if (this.player.consumeExtraLife()) {
      this.addToast("Boss blessing consumed: instant extra life triggered. No loot dropped.");
      this.addFloatingText(this.player.x, this.player.y - 52, "Extra life", "#ffcf5a");
      return;
    }
    const droppedItems = this.dropPlayerHeldLoot(this.player, "Your gear");
    if (this.multiplayer && !this.base.hasActiveCore) {
      this.enterSpectatorMode("You were defeated with no active base core. You can keep watching the match or leave the room.");
      return;
    }
    if (!this.base.hasActiveCore) {
      this.eliminate("You died while displaced with no active core.");
      return;
    }

    const droppedGold = Math.floor(this.player.currency * 0.2);
    const droppedBuild = Math.floor(this.player.resources * 0.18);
    this.player.currency -= droppedGold;
    this.player.resources -= droppedBuild;
    const deathTimer = this.getRespawnSeconds(this.player);
    this.player.beginRespawn(deathTimer);
    this.addToast(
      `Hero down. Dropped ${droppedItems} gear item${droppedItems === 1 ? "" : "s"} and ${droppedGold}g/${droppedBuild} build. Respawn in ${formatTime(
        deathTimer
      )}.`
    );
  }

  enterSpectatorMode(reason) {
    if (this.spectating) {
      return;
    }
    this.spectating = true;
    this.player.alive = false;
    this.player.health = 0;
    this.player.respawnTimer = 0;
    this.player.eliminated = true;
    this.match.matchLost = true;
    this.cameraLocked = false;
    const focus = this.getSpectatorFocus();
    if (focus) {
      this.cameraLookTarget = focus;
      this.spectatorFocusId = focus.id || null;
    }
    this.addToast("You are now spectating the match.");
    this.ui.showMessage("Eliminated", "Spectator Mode", reason, {
      primaryLabel: "Leave Match",
      primaryAction: "leave",
      secondaryLabel: "Spectate",
      secondaryAction: "hide"
    });
  }

  leaveMatch() {
    if (this.onLeaveMatch) {
      this.onLeaveMatch();
      return;
    }
    this.multiplayer?.leaveRoom?.();
    window.location.href = window.location.pathname;
  }

  dropPlayerHeldLoot(player, label = "Gear") {
    const dropped = player.dropCarriedAndEquippedLoot?.() || [];
    for (const item of dropped) {
      this.spawnDroppedLoot(player.x, player.y, item, {
        scatter: 64,
        ttl: CONFIG.loot.deathDropDespawnSeconds
      });
    }
    if (dropped.length > 0) {
      this.addToast(`${label} dropped: ${dropped.length} item${dropped.length === 1 ? "" : "s"}.`);
    }
    return dropped.length;
  }

  handleMobDeath(mob, source = {}) {
    if (mob.rewardsGranted) {
      return;
    }
    mob.rewardsGranted = true;

    const remoteKillerId = source.sourceOwnerId || source.sourceId;
    if (this.multiplayer && remoteKillerId && remoteKillerId !== this.player.id && this.remotePlayers.has(remoteKillerId)) {
      const reward = {
        xp: mob.isBoss ? 180 : mob.xpReward || 0,
        gold: mob.isBoss ? 260 : mob.goldReward || 0,
        resources: mob.isBoss ? 220 : mob.resourceReward || 0
      };
      if (mob.isBoss) {
        this.bossDefeated = true;
        const bossObjective = this.objectives.find((objective) => objective.type === "boss");
        if (bossObjective) {
          bossObjective.captured = true;
          bossObjective.ownerId = remoteKillerId;
        }
      }
      this.emitRemoteMobReward(mob, remoteKillerId, reward);
      this.addFloatingText(mob.x, mob.y - 50, "Defeated", "#e7bd58");
      return;
    }

    if (mob.isBoss) {
      const owner = this.getRewardPlayerForSource(source) || this.player;
      const bossLoot = this.rewardSystem.grantBossReward(owner);
      this.spawnDroppedLoot(mob.x, mob.y, bossLoot);
      this.bossDefeated = true;
      const bossObjective = this.objectives.find((objective) => objective.type === "boss");
      if (bossObjective) {
        bossObjective.captured = true;
        bossObjective.ownerId = owner.id;
      }
      this.addFloatingText(mob.x, mob.y - 50, "Boss defeated", "#e7bd58");
      if (owner === this.player) {
        this.addToast("Central boss defeated. Boss blessing gained: all stats boosted and one extra life banked.");
      } else {
        this.addToast(`${owner.displayName || "An AI rival"} defeated the central boss and gained the boss blessing.`);
      }
      return;
    }

    const owner = this.getRewardPlayerForSource(source) || this.player;
    const reward = this.rewardSystem.grantMobReward(owner, mob);
    if (owner?.characterId === "guardian") {
      const percent = CONFIG.classPassives?.guardian?.mobKillHealPercent || 0;
      const healed = owner.heal?.(owner.effectiveMaxHealth * percent) || 0;
      if (healed > 0 && owner === this.player) {
        this.addDamageNumber(owner, healed, "heal", { sourceKind: "guardianPassive" });
      }
    }
    if (owner?.characterId === "berserker") {
      const percent = CONFIG.classPassives?.berserker?.mobKillHealPercent || 0;
      const healed = owner.heal?.(owner.effectiveMaxHealth * percent) || 0;
      if (healed > 0 && owner === this.player) {
        this.addDamageNumber(owner, healed, "heal", { sourceKind: "bloodlust" });
      }
    }
    if (owner?.characterId === "warlock" && (mob.curseSource || source.status?.curse)) {
      const passive = CONFIG.classPassives?.warlock || {};
      owner.soulStacks = Math.min(passive.maxSoulStacks || 18, (owner.soulStacks || 0) + 1);
      if (owner === this.player) {
        this.addFloatingText(owner.x, owner.y - 50, `Soul ${owner.soulStacks}`, "#b391f0");
      }
    }
    if (reward.lootItem) {
      this.spawnDroppedLoot(mob.x, mob.y, reward.lootItem);
      this.addFloatingText(mob.x, mob.y - 48, "Loot dropped", "#72d8e8");
    }
    if (owner === this.player || distance(this.player, mob) < 900) {
      this.addFloatingText(mob.x, mob.y - 26, `+${reward.xp} XP +${reward.gold}g +${reward.resources}b`, "#e7bd58");
    }
  }

  emitRemoteMobReward(mob, killerId, reward) {
    if (!this.multiplayer?.queueCombatEvent || !killerId) {
      return;
    }
    this.multiplayer.queueCombatEvent({
      type: "mobDefeated",
      targetOwnerId: this.player.id,
      targetId: mob.id,
      killerId,
      killerName: this.remotePlayers.get(killerId)?.displayName || this.remotePlayers.get(killerId)?.name || "Player",
      mobTier: mob.tier || 1,
      mobLevel: mob.scaledLevel || mob.tier || 1,
      mobName: mob.isBoss ? "Boss" : `${labelizeBuildingType(mob.campType || "Mob")} Mob`,
      bossBuff: Boolean(mob.isBoss),
      rewardXP: reward.xp || 0,
      rewardGold: reward.gold || 0,
      rewardResources: reward.resources || 0
    });
  }

  onObjectiveCaptured(objective, owner = this.player) {
    objective.claim?.(owner);
    const rewardText = this.rewardSystem.grantObjectiveReward(owner, objective);
    if (objective.type === "relic") {
      const ai = this.getAIByPlayer(owner);
      if (ai) {
        ai.base.applyRelicBuff(60);
      } else {
        this.base.applyRelicBuff(60);
      }
    }
    this.addToast(`${objective.label} captured by ${owner === this.player ? "you" : owner.displayName || "AI"}: ${rewardText}. A guard tower is online.`);
    this.addFloatingText(objective.x, objective.y - 54, "Captured", "#63d46b");
  }

  isAIPlayerEntity(entity) {
    return (this.aiPlayers || []).some((ai) => ai.player === entity);
  }

  getAIByPlayer(entity) {
    return (this.aiPlayers || []).find((ai) => ai.player === entity) || null;
  }

  getAIById(id) {
    return (this.aiPlayers || []).find((ai) => ai.id === id || ai.player.id === id) || null;
  }

  getPlayerVisualById(id) {
    if (id === this.player.id) {
      return { player: this.player, color: "#72d8e8", name: this.player.displayName || "You" };
    }
    const ai = this.getAIById(id);
    if (ai) {
      return { player: ai.player, color: ai.color || "#ff8068", name: ai.name };
    }
    return null;
  }

  getRewardPlayerForSource(source = {}) {
    if (
      source.sourceOwnerId === this.player.id ||
      source.sourceId === this.player.id ||
      (source.sourceKind === "player" && !source.sourceOwnerId && !source.sourceId)
    ) {
      return this.player;
    }
    const ai = this.getAIById(source.sourceOwnerId || source.sourceId);
    return ai?.player || null;
  }

  isStructureDamageTarget(target) {
    const structureTypes = new Set(["core", "wall", "tower", "generator", "ballista", "pulseTower", "barracks", "resourceGenerator", "repairStation", "visionTower"]);
    return structureTypes.has(target?.type) || (this.neutralTowers || []).includes(target);
  }

  getStructureDamageMultiplierForSource(target, source = {}) {
    if (!this.isStructureDamageTarget(target)) {
      return 1;
    }
    const owner = this.getRewardPlayerForSource(source);
    if (!owner) {
      return 1;
    }
    const classConfig = CONFIG.combat?.meleeStructure?.[owner.characterId];
    if (!classConfig) {
      return 1;
    }
    let multiplier = classConfig.structureDamage || 1;
    if (owner.characterId === "berserker" && (owner.speedMultiplierTimer || 0) > 0) {
      multiplier *= classConfig.frenzyStructureDamage || 1;
    }
    if (owner.characterId === "sentinel" && (owner.passiveDamageReduction || 0) > 0) {
      multiplier *= classConfig.holdLineStructureDamage || 1;
    }
    return multiplier;
  }

  getBaseForBuilding(building) {
    if (this.base.buildings.includes(building)) {
      return { base: this.base, ownerId: this.player.id, owner: this.player };
    }
    for (const ai of this.aiPlayers || []) {
      if (ai.base.buildings.includes(building)) {
        return { base: ai.base, ownerId: ai.id, owner: ai.player };
      }
    }
    for (const remoteBase of this.remoteBases?.values?.() || []) {
      if ((remoteBase.buildings || []).includes(building)) {
        return {
          base: {
            ...remoteBase,
            active: remoteBase.active !== false,
            livingBuildings: (remoteBase.buildings || []).filter((candidate) => candidate.alive !== false)
          },
          ownerId: remoteBase.playerId,
          owner: this.remotePlayers.get(remoteBase.playerId) || null
        };
      }
    }
    return null;
  }

  findWallBlockingBuildingDamage(building, source = {}) {
    const owner = this.getBaseForBuilding(building);
    if (!owner || source.sourceOwnerId === owner.ownerId || source.sourceId === owner.ownerId) {
      return null;
    }
    const sourcePoint = this.getDamageSourcePoint(source);
    if (!sourcePoint) {
      return null;
    }
    const targetLayer = building.layer || 1;
    const blockers = owner.base.livingBuildings
      .filter((candidate) => candidate.type === "wall" && (candidate.layer || 1) <= targetLayer)
      .filter((wall) => lineIntersectsBuildingRect(sourcePoint, building, wall))
      .sort((a, b) => distanceSq(sourcePoint, a) - distanceSq(sourcePoint, b));
    return blockers[0] || null;
  }

  getDamageSourcePoint(source = {}) {
    if (Number.isFinite(source.sourceX) && Number.isFinite(source.sourceY)) {
      return { x: source.sourceX, y: source.sourceY };
    }
    const id = source.sourceOwnerId || source.sourceId;
    if (!id) {
      return null;
    }
    if (id === this.player.id) {
      return this.player;
    }
    const ai = this.getAIById(id);
    if (ai) {
      return ai.player;
    }
    const remote = this.remotePlayers?.get?.(id);
    if (remote) {
      return remote;
    }
    const mob = this.mobs.find((candidate) => candidate.id === id);
    if (mob) {
      return mob;
    }
    return null;
  }

  findNearestMob(source, range) {
    let best = null;
    let bestDistance = range * range;
    for (const mob of this.mobs) {
      if (!mob.alive) {
        continue;
      }
      const currentDistance = distanceSq(source, mob);
      if (currentDistance <= bestDistance) {
        best = mob;
        bestDistance = currentDistance;
      }
    }
    return best;
  }

  findNearestEnemyForPlayerBase(source, range) {
    let best = this.findNearestMob(source, range);
    let bestDistance = best ? distanceSq(source, best) : range * range;
    for (const ai of this.aiPlayers || []) {
      if (!this.canTargetEntity(ai.player, "tower")) {
        continue;
      }
      const currentDistance = distanceSq(source, ai.player);
      if (currentDistance <= bestDistance) {
        best = ai.player;
        bestDistance = currentDistance;
      }
    }
    for (const remote of this.remotePlayers?.values?.() || []) {
      if (!this.canTargetEntity(remote, "tower")) {
        continue;
      }
      const currentDistance = distanceSq(source, remote);
      if (currentDistance <= bestDistance) {
        best = remote;
        bestDistance = currentDistance;
      }
    }
    return best;
  }

  updateBarracks(barracks, ownerBase, dt) {
    if (!barracks.alive) {
      return;
    }
    barracks.defenderCooldown = Math.max(0, (barracks.defenderCooldown || 0) - dt);
    const owner = this.getBaseOwner(ownerBase);
    const liveDefenders = this.baseDefenders.filter((defender) => defender.alive && defender.barracksId === barracks.id);
    if (liveDefenders.length > 0) {
      return;
    }
    const enemy = this.findNearestEnemyForBaseOwner(owner.ownerId, barracks, 680);
    if (!enemy || barracks.defenderCooldown > 0) {
      return;
    }
    barracks.defenderCooldown = 10;
    const kind = barracksDefenderKind(barracks.level);
    for (let index = 0; index < 4; index += 1) {
      const angle = (Math.PI * 2 * index) / 4;
      this.baseDefenders.push(createBaseDefender({
        x: barracks.x + Math.cos(angle) * 44,
        y: barracks.y + Math.sin(angle) * 44,
        kind,
        ownerId: owner.ownerId,
        color: owner.color,
        barracksId: barracks.id,
        level: barracks.level
      }));
    }
    this.spawnBaseEffect({
      type: "pulse",
      x: barracks.x,
      y: barracks.y,
      color: owner.color || "#63d46b",
      radius: 54,
      life: 0.7,
      maxLife: 0.7
    });
    if (owner.ownerId === this.player.id) {
      this.addToast(`Barracks spawned ${kind} defenders.`);
    }
  }

  updateBaseDefenders(dt) {
    for (const defender of this.baseDefenders) {
      if (!defender.alive) {
        continue;
      }
      if (defender.temporary) {
        defender.life = Math.max(0, (defender.life || 0) - dt);
        if (defender.life <= 0) {
          defender.alive = false;
          continue;
        }
      }
      defender.attackTimer = Math.max(0, defender.attackTimer - dt);
      if (defender.kind === "builder" && this.repairNearestStructure(defender, dt)) {
        continue;
      }
      const target = this.findNearestEnemyForBaseOwner(defender.ownerId, defender, defender.range + 220);
      if (!target) {
        if (defender.followOwner) {
          const owner = defender.ownerId === this.player.id ? this.player : this.getAIById(defender.ownerId)?.player;
          if (owner?.alive && distance(defender, owner) > 82) {
            const direction = normalize(owner.x - defender.x, owner.y - defender.y);
            defender.x = clamp(defender.x + direction.x * (defender.speed || 140) * dt, defender.radius, CONFIG.world.width - defender.radius);
            defender.y = clamp(defender.y + direction.y * (defender.speed || 140) * dt, defender.radius, CONFIG.world.height - defender.radius);
            defender.facing = direction;
            this.resolveWallCollisions(defender);
            continue;
          }
        }
        defender.x += Math.sin(performance.now() / 600 + defender.spawnPhase) * 8 * dt;
        defender.y += Math.cos(performance.now() / 700 + defender.spawnPhase) * 8 * dt;
        continue;
      }
      const targetDistance = distance(defender, target);
      if (targetDistance <= defender.range) {
        this.attackWithDefender(defender, target);
      } else {
        const direction = normalize(target.x - defender.x, target.y - defender.y);
        defender.x = clamp(defender.x + direction.x * defender.speed * dt, defender.radius, CONFIG.world.width - defender.radius);
        defender.y = clamp(defender.y + direction.y * defender.speed * dt, defender.radius, CONFIG.world.height - defender.radius);
        defender.facing = direction;
        this.resolveWallCollisions(defender);
      }
    }
    this.baseDefenders = this.baseDefenders.filter((defender) => defender.alive);
  }

  repairNearestStructure(defender, dt) {
    const ownerBase = this.getBaseByOwnerId(defender.ownerId);
    const damaged = ownerBase?.livingBuildings
      .filter((building) => building.health < building.maxHealth)
      .sort((a, b) => distanceSq(defender, a) - distanceSq(defender, b))[0];
    if (!damaged || distance(defender, damaged) > 230) {
      return false;
    }
    damaged.health = Math.min(damaged.maxHealth, damaged.health + (3 + defender.level * 1.4) * dt);
    if (Math.random() < 0.02) {
      this.addFloatingText(damaged.x, damaged.y - 28, "Repair", "#63d46b");
    }
    return true;
  }

  attackWithDefender(defender, target) {
    if (defender.attackTimer > 0) {
      return;
    }
    defender.attackTimer = defender.cooldown;
    const direction = normalize(target.x - defender.x, target.y - defender.y);
    defender.facing = direction;
      if (defender.kind === "archer" || defender.kind === "mage" || defender.kind === "turret" || defender.kind === "imp") {
        this.spawnProjectile({
          x: defender.x + direction.x * 18,
          y: defender.y + direction.y * 18,
          vx: direction.x * (defender.kind === "mage" ? 430 : defender.kind === "turret" ? 620 : defender.kind === "imp" ? 470 : 560),
          vy: direction.y * (defender.kind === "mage" ? 430 : defender.kind === "turret" ? 620 : defender.kind === "imp" ? 470 : 560),
          radius: defender.kind === "mage" ? 7 : 5,
        range: defender.range + 120,
        damage: defender.damage,
        color: defender.kind === "mage" ? "#b391f0" : defender.color,
        pierce: false,
        sourceId: defender.id,
        sourceOwnerId: defender.ownerId,
        sourceKind: defender.ownerId === this.player.id ? "player" : "ai",
        team: defender.ownerId === this.player.id ? "player" : "ai"
      });
      return;
    }
    this.applyDamage(target, defender.damage, {
      sourceId: defender.id,
      sourceOwnerId: defender.ownerId,
      sourceX: defender.x,
      sourceY: defender.y,
      sourceKind: defender.ownerId === this.player.id ? "player" : "ai"
    });
  }

  findNearestEnemyForBaseOwner(ownerId, source, range) {
    let best = null;
    let bestDistance = range * range;
    const consider = (target) => {
      if (!target?.alive || !this.canTargetEntity(target, "tower")) {
        return;
      }
      const currentDistance = distanceSq(source, target);
      if (currentDistance <= bestDistance) {
        best = target;
        bestDistance = currentDistance;
      }
    };
    if (ownerId !== this.player.id) {
      consider(this.player);
      for (const building of this.base.livingBuildings) {
        consider(building);
      }
    }
    for (const ai of this.aiPlayers || []) {
      if (ownerId === ai.id || ownerId === ai.player.id) {
        continue;
      }
      consider(ai.player);
      for (const building of ai.base.livingBuildings) {
        consider(building);
      }
    }
    for (const remote of this.remotePlayers?.values?.() || []) {
      if (ownerId === remote.id || ownerId === remote.ownerId) {
        continue;
      }
      consider(remote);
    }
    for (const remoteBase of this.remoteBases?.values?.() || []) {
      if (ownerId === remoteBase.playerId) {
        continue;
      }
      for (const building of remoteBase.buildings || []) {
        consider(building);
      }
    }
    for (const mob of this.mobs) {
      consider(mob);
    }
    return best;
  }

  getBaseOwner(base) {
    if (base === this.base) {
      return { ownerId: this.player.id, player: this.player, color: "#72d8e8" };
    }
    const ai = (this.aiPlayers || []).find((candidate) => candidate.base === base);
    return { ownerId: ai?.id || "neutral", player: ai?.player || null, color: ai?.color || "#ff8068" };
  }

  getBaseByOwnerId(ownerId) {
    if (ownerId === this.player.id) {
      return this.base;
    }
    return this.getAIById(ownerId)?.base || null;
  }

  getBlockingWalls(entity = null) {
    const walls = [];
    // Friendly troops/deployables pass through their own owner's walls; only
    // enemy walls block. ownerId ties a defender to the base it belongs to.
    const ownerId = entity?.ownerId;
    if (entity !== this.player && ownerId !== this.player.id) {
      walls.push(...this.base.livingBuildings.filter((building) => building.type === "wall"));
    }
    for (const ai of this.aiPlayers || []) {
      if (entity === ai.player || ownerId === ai.player.id) {
        continue;
      }
      walls.push(...ai.base.livingBuildings.filter((building) => building.type === "wall"));
    }
    for (const remoteBase of this.remoteBases?.values?.() || []) {
      if (entity?.id === remoteBase.playerId || ownerId === remoteBase.playerId) {
        continue;
      }
      walls.push(...(remoteBase.buildings || []).filter((building) => building.type === "wall" && building.alive !== false));
    }
    return walls;
  }

  resolveWallCollisions(entity) {
    if (!entity?.alive) {
      return;
    }
    this.map.resolveRiverCollision?.(entity);
    for (const wall of this.getBlockingWalls(entity)) {
      resolveCircleRectCollision(entity, wall);
    }
  }

  isEnemyInsideBaseLayers(base, ownerId) {
    if (!base?.active) {
      return false;
    }
    const candidates = [];
    if (ownerId !== this.player.id && this.player.alive) {
      candidates.push(this.player);
    }
    for (const ai of this.aiPlayers || []) {
      if ((ai.id === ownerId || ai.player.id === ownerId) || !ai.player.alive) {
        continue;
      }
      candidates.push(ai.player);
    }
    for (const remote of this.remotePlayers.values()) {
      if (remote.id === ownerId || !remote.alive) {
        continue;
      }
      candidates.push(remote);
    }
    return candidates.some((candidate) => base.isPointInsideAnyWallLayer(candidate));
  }

  findNearestWard(source, range) {
    let best = null;
    let bestDistance = range * range;
    for (const ward of this.placedWards) {
      if (!ward.alive) {
        continue;
      }
      const currentDistance = distanceSq(source, ward);
      if (currentDistance <= bestDistance) {
        best = ward;
        bestDistance = currentDistance;
      }
    }
    return best;
  }

  getObjectiveContestants(objective) {
    const contestants = [];
    const captureRadius = objective.radius + (objective.alive ? 0 : CONFIG.objectiveRules?.captureRadiusBonus || 0);
    if (this.player.alive && distance(objective, this.player) <= captureRadius + this.player.radius) {
      contestants.push({ player: this.player, distance: distance(objective, this.player) });
    }
    for (const ai of this.aiPlayers || []) {
      if (ai.player.alive && distance(objective, ai.player) <= captureRadius + ai.player.radius) {
        contestants.push({ player: ai.player, distance: distance(objective, ai.player) });
      }
    }
    return contestants.sort((a, b) => a.distance - b.distance);
  }

  getObjectiveAttackTarget(objective) {
    const candidates = [];
    const inThreatArea = (player) => this.isPointInObjectiveArena(objective, player, 0);
    if (this.canTargetEntity(this.player, "objective") && objective.ownerId !== this.player.id && inThreatArea(this.player)) {
      candidates.push(this.player);
    }
    for (const ai of this.aiPlayers || []) {
      if (this.canTargetEntity(ai.player, "objective") && objective.ownerId !== ai.id && objective.ownerId !== ai.player.id && inThreatArea(ai.player)) {
        candidates.push(ai.player);
      }
    }
    candidates.sort((a, b) => distanceSq(objective.guardianPoint, a) - distanceSq(objective.guardianPoint, b));
    return candidates[0] || null;
  }

  isPointInObjectiveArena(objective, point, padding = 0) {
    if (!objective || !point) {
      return false;
    }
    const bounds = objective.guardianBounds;
    if (bounds) {
      return (
        point.x >= bounds.x - padding &&
        point.x <= bounds.x + bounds.w + padding &&
        point.y >= bounds.y - padding &&
        point.y <= bounds.y + bounds.h + padding
      );
    }
    const leashRules = CONFIG.objectiveRules?.leash || {};
    const fallbackRadius = objective.radius + (leashRules.engagePadding || 92) + padding;
    return distance(objective, point) <= fallbackRadius + (point.radius || 0);
  }

  findNearestTargetForAIBase(aiOwner, source, range) {
    let best = null;
    let bestDistance = range * range;
    const consider = (target) => {
      if (!target?.alive || !this.canTargetEntity(target, "tower")) {
        return;
      }
      const currentDistance = distanceSq(source, target);
      if (currentDistance <= bestDistance) {
        best = target;
        bestDistance = currentDistance;
      }
    };
    consider(this.player);
    for (const building of this.base.livingBuildings) {
      consider(building);
    }
    for (const mob of this.mobs) {
      consider(mob);
    }
    for (const ai of this.aiPlayers || []) {
      if (ai === aiOwner) {
        continue;
      }
      consider(ai.player);
      for (const building of ai.base.livingBuildings) {
        consider(building);
      }
    }
    return best;
  }

  placeBaseAtPlayer() {
    if (!this.player.alive || this.gameOver || this.gameWon) {
      return;
    }

    if (this.player.nomadMode) {
      this.addToast("Nomad path locked in. You cannot place a core this match.");
      return;
    }

    const placementCheck = this.isBaseClaimLocationAllowed(this.player);
    if (!placementCheck.ok) {
      this.addToast(placementCheck.message);
      return;
    }

    const emergencyAvailable =
      this.base.displaced &&
      this.base.emergencyTimer > 0 &&
      this.base.emergencyCount <= CONFIG.base.maxEmergencyRebuilds;

    if (emergencyAvailable) {
      const renderState = this.captureRenderState();
      this.base.placeAt(this.player.x, this.player.y, { emergency: true, layoutId: this.selectedBaseLayoutId });
      this.clearBaseFootprint();
      this.restoreRenderState(renderState);
      this.basePlacementPreviewActive = false;
      this.player.applyBaseLayoutBonus(this.base.getHeroBonus());
      this.player.currency = Math.max(0, Math.floor(this.player.currency * 0.82));
      this.player.resources = Math.max(0, Math.floor(this.player.resources * 0.78));
      this.addToast(`Emergency base placed. Upgrade costs increased and base energy reduced.`);
      return;
    }

    if (this.base.displaced) {
      this.addToast("Emergency rebuild unavailable. No more cores can be placed this match.");
      return;
    }

    if (!this.match.canPlaceBase) {
      this.addToast("Base placement is locked after the grace phases.");
      return;
    }

    if (this.base.active) {
      if (this.baseReplotsRemaining <= 0) {
        this.addToast("No base replots remain for this match.");
        return;
      }
      const renderState = this.captureRenderState();
      this.base.replotTo(this.player.x, this.player.y, this.selectedBaseLayoutId);
      this.clearBaseFootprint();
      this.restoreRenderState(renderState);
      this.basePlacementPreviewActive = false;
      this.player.applyBaseLayoutBonus(this.base.getHeroBonus());
      this.baseReplotsRemaining -= 1;
      this.addToast(`Base replotted as ${CONFIG.base.layouts[this.base.layoutId]?.label || "Outpost"}. ${this.baseReplotsRemaining} replots left.`);
      return;
    }

    const renderState = this.captureRenderState();
    this.base.placeAt(this.player.x, this.player.y, { emergency: false, layoutId: this.selectedBaseLayoutId });
    this.clearBaseFootprint();
    this.restoreRenderState(renderState);
    this.basePlacementPreviewActive = false;
    this.player.applyBaseLayoutBonus(this.base.getHeroBonus());
    const layout = CONFIG.base.layouts[this.base.layoutId] || CONFIG.base.layouts.outpost;
    this.addToast(`${layout.label} base deployed. ${layout.summary}`);
  }

  canArmBasePlacementPreview() {
    if (!this.player?.alive || this.player.nomadMode || this.gameOver || this.gameWon) {
      return false;
    }
    const emergencyAvailable =
      this.base.displaced &&
      this.base.emergencyTimer > 0 &&
      this.base.emergencyCount <= CONFIG.base.maxEmergencyRebuilds;
    if (emergencyAvailable) {
      return true;
    }
    if (!this.match.canPlaceBase || this.base.displaced) {
      return false;
    }
    return !this.base.active || this.baseReplotsRemaining > 0;
  }

  toggleBasePlacementPreview() {
    if (this.basePlacementPreviewActive) {
      this.basePlacementPreviewActive = false;
      this.addToast("Base placement preview cancelled.");
      return;
    }

    if (!this.canArmBasePlacementPreview()) {
      if (this.base.active && !this.base.displaced) {
        this.ui.open("base");
        return;
      }
      if (this.player.nomadMode) {
        this.addToast("Nomad path locked in. You cannot place a core this match.");
        return;
      }
      this.addToast(this.base.displaced ? "Emergency rebuild unavailable." : "Base placement is locked.");
      return;
    }

    this.basePlacementPreviewActive = true;
    this.clearQueuedAbility();
    const layout = CONFIG.base.layouts[this.selectedBaseLayoutId] || CONFIG.base.layouts.outpost;
    this.addToast(`${layout.label} preview armed. Left click to place, B to cancel.`);
  }

  isBaseClaimLocationAllowed(point) {
    const edge = CONFIG.base.edgeClaimExclusion;
    if (point.x < edge || point.y < edge || point.x > CONFIG.world.width - edge || point.y > CONFIG.world.height - edge) {
      return {
        ok: false,
        message: "Move farther from the map edge before claiming a base."
      };
    }
    if (this.map.isRiverBlocked?.(point, CONFIG.base.relocationRadius)) {
      return {
        ok: false,
        message: "Base cores cannot be claimed in the river. Use open ground near a bridge instead."
      };
    }
    if (this.map.riverDistance?.(point) < CONFIG.base.riverClaimExclusion) {
      return {
        ok: false,
        message: "Move farther from the river before claiming a base."
      };
    }
    const pathExclusion = CONFIG.mapGeneration?.pathClaimExclusion || 0;
    if (pathExclusion > 0 && this.distanceToNearestPath(point) < pathExclusion) {
      return {
        ok: false,
        message: "Move off the main road before claiming a base."
      };
    }
    for (const objective of this.objectives || []) {
      const minDistance = objective.radius + CONFIG.base.objectiveClaimExclusion;
      if (distance(point, objective) < minDistance) {
        return {
          ok: false,
          message: `Move farther from ${objective.label} before claiming a base.`
        };
      }
    }
    for (const tower of this.neutralTowers || []) {
      const minDistance = tower.radius + (CONFIG.base.neutralTowerClaimExclusion || CONFIG.neutralTowers?.basePlacementExclusion || 820);
      if (distance(point, tower) < minDistance) {
        return {
          ok: false,
          message: `Move farther from ${tower.label} before claiming a base.`
        };
      }
    }
    for (const village of this.villages || []) {
      const minDistance = village.radius + (CONFIG.base.villageClaimExclusion || 480);
      if (distance(point, village) < minDistance) {
        return {
          ok: false,
          message: `Move farther from ${village.label} before claiming a base.`
        };
      }
    }
    return { ok: true, message: "Base site available." };
  }

  distanceToNearestPath(point) {
    let best = Infinity;
    for (const path of this.map?.paths || []) {
      for (let index = 0; index < path.length - 1; index += 1) {
        best = Math.min(best, distanceToSegment(point, path[index], path[index + 1]));
      }
    }
    return best;
  }

  clearBaseFootprint() {
    if (!this.base?.active) {
      return;
    }
    const bounds = this.base.getWallBounds?.() || null;
    const radius = CONFIG.mapGeneration?.propClearRadius || 620;
    const center = this.base.origin || this.base.core || this.player;
    const inFootprint = (prop) => {
      if (bounds) {
        return (
          prop.x >= center.x - bounds.x - radius * 0.28 &&
          prop.x <= center.x + bounds.x + radius * 0.28 &&
          prop.y >= center.y - bounds.y - radius * 0.28 &&
          prop.y <= center.y + bounds.y + radius * 0.28
        );
      }
      return distance(prop, center) <= radius;
    };
    if (this.map?.trees) {
      this.map.trees = this.map.trees.filter((tree) => !inFootprint(tree));
    }
    if (this.map?.rocks) {
      this.map.rocks = this.map.rocks.filter((rock) => !inFootprint(rock));
    }
    this.lowPolyRenderer?.reset?.(this, { preserveCamera: true });
  }

  setBaseLayout(layoutId) {
    if (!CONFIG.base.layouts[layoutId]) {
      return;
    }
    this.selectedBaseLayoutId = layoutId;
    this.input.keys.clear();
    this.canvas?.focus?.();
    const layout = CONFIG.base.layouts[layoutId];
    this.addToast(`${layout.label} selected: ${layout.summary}`);
  }

  upgradeBuilding(type) {
    if (!this.isPlayerNearCore()) {
      this.addToast("Base upgrades are available only near your core.");
      return;
    }
    const result = this.base.upgrade(type, this.player);
    this.addToast(result.message);
  }

  upgradeBuildingById(id) {
    if (!this.isPlayerNearCore()) {
      this.addToast("Base upgrades are available only near your core.");
      return;
    }
    const result = this.base.upgradeById(id, this.player);
    this.addToast(result.message);
  }

  upgradeAllOfType(type) {
    if (!this.isPlayerNearCore()) {
      this.addToast("Base upgrades are available only near your core.");
      return;
    }
    const result = this.base.upgradeAllOfType(type, this.player);
    this.addToast(result.message);
  }

  applyCoreDestroyedPenalty() {
    this.player.applyCoreDebuff();
    this.player.applyBaseLayoutBonus({});
    this.addToast(`Core loss debuff applied: ${this.player.baseDebuffStacks} stack(s).`);
  }

  debugAddCurrency() {
    this.player.currency += 220;
    this.player.resources += 160;
    this.addToast("Debug: added gold and build resources.");
  }

  debugAddXP() {
    this.player.addXP(1000);
    this.addToast(`Debug: added XP. Points: ${this.player.skillPoints} AP / ${this.player.attributePoints} attr.`);
  }

  debugDamageCore() {
    const core = this.base.core;
    if (!core) {
      this.addToast("Debug: no active core to damage.");
      return;
    }
    this.applyDamage(core, 320, {
      sourceId: "debug",
      sourceKind: "system"
    });
    this.addToast("Debug: damaged base core.");
  }

  debugSpawnMobs() {
    const targetBase = Boolean(this.base.core);
    const offset = 360;
    this.spawnMobsAround(this.player.x + offset, this.player.y + 140, 5, 2, targetBase, "debug", ["melee", "ranged", "brute", "swift"]);
    this.addToast("Debug: spawned mobs near the hero.");
  }

  equipLoot(id, slot = null) {
    if (this.player.getLootSource(id) === "core" && !this.isPlayerNearCore()) {
      this.addToast("Stored gear can only be equipped while near your core.");
      return;
    }
    const result = this.player.equipLoot(id, slot);
    this.addToast(result.message);
  }

  deleteLoot(id) {
    const result = this.player.deleteLoot(id);
    this.addToast(result.message);
  }

  sellLoot(id) {
    if (!this.canUseShop()) {
      this.addToast("Sell items from the shop while near your core, or anywhere on the nomad path.");
      return;
    }
    const result = this.player.sellLoot(id);
    this.addToast(result.message);
  }

  getNearbyLoot() {
    if (!this.player.alive) {
      return [];
    }
    return this.droppedLoot.filter((item) => distance(this.player, item) <= CONFIG.loot.pickupRadius);
  }

  pickupLoot(id) {
    const index = this.droppedLoot.findIndex((item) => item.id === id && distance(this.player, item) <= CONFIG.loot.pickupRadius + 20);
    if (index < 0) {
      this.addToast("Move closer to pick up that loot.");
      return;
    }
    const item = this.droppedLoot[index];
    const result = this.player.addLoot({
      id: item.id,
      label: item.label,
      tier: item.tier,
      slot: item.slot,
      rarity: item.rarity,
      rarityLabel: item.rarityLabel,
      color: item.color,
      stats: item.stats,
      description: item.description,
      value: item.value
    });
    if (!result.ok) {
      this.addToast(result.message);
      return;
    }
    this.droppedLoot.splice(index, 1);
    this.addToast(result.message);
  }

  pickupAllNearbyLoot() {
    for (const item of [...this.getNearbyLoot()]) {
      if (this.player.carriedLootFull) {
        this.addToast(`Backpack full (${this.player.carriedLootCount}/${this.player.carryLimit}). Store loot at your core.`);
        break;
      }
      this.pickupLoot(item.id);
    }
  }

  depositLootAtCore() {
    if (!this.isPlayerNearCore()) {
      this.addToast("Stand near your core to store backpack loot.");
      return;
    }
    const result = this.player.depositLootToCore();
    this.addToast(result.message);
  }

  upgradeAbility(id) {
    const result = this.player.upgradeAbility(id);
    this.addToast(result.message);
  }

  upgradeAttribute(id) {
    const result = this.player.upgradeAttribute(id);
    this.addToast(result.message);
  }

  toggleCameraLock() {
    this.cameraLocked = !this.cameraLocked;
    if (this.cameraLocked) {
      this.cameraLookTarget = null;
    }
    this.addToast(this.cameraLocked ? "Camera locked to hero." : "Camera unlocked. Drag the minimap to scout.");
  }

  isPlayerNearCore(radius = 260) {
    const core = this.base.core;
    return Boolean(core && distance(this.player, core) <= radius);
  }

  canUseShop() {
    return this.player.nomadMode || this.isPlayerNearCore();
  }

  buyWard() {
    if (!this.canUseShop()) {
      this.addToast("Shop is available near your core, or anywhere on the nomad path.");
      return;
    }
    const wardConfig = CONFIG.shop.ward;
    const cost = wardConfig.cost;
    if (this.player.wards >= wardConfig.maxHeld) {
      this.addToast(`Ward pouch full (${wardConfig.maxHeld} max).`);
      return;
    }
    if (this.player.currency < cost) {
      this.addToast(`Need ${cost} gold for a ward.`);
      return;
    }
    this.player.currency -= cost;
    this.player.wards += 1;
    this.addToast("Ward purchased. Stand on a ward site and press V.");
  }

  getEquipmentShopInfo(tierKey = "standard") {
    const tier = CONFIG.shop.equipmentTiers[tierKey] || CONFIG.shop.equipmentTiers.standard;
    return { ...tier, key: tierKey };
  }

  buyShopItem(tierKey = "standard") {
    if (!this.canUseShop()) {
      this.addToast("Shop is available near your core, or anywhere on the nomad path.");
      return;
    }
    const info = this.getEquipmentShopInfo(tierKey);
    if (this.player.currency < info.cost) {
      this.addToast(`Need ${info.cost} gold for ${info.label.toLowerCase()}.`);
      return;
    }
    this.player.currency -= info.cost;
    const item = this.rewardSystem.createShopLoot(this.player.level, tierKey);
    if (this.base.core && this.player.coreStorage.length < CONFIG.loot.baseStorageLimit) {
      this.player.coreStorage.push(item);
      this.addToast(`${info.label}: ${item.label} purchased and stored in your core.`);
      return;
    }
    const result = this.player.addLoot(item);
    if (!result.ok) {
      this.player.currency += info.cost;
      this.addToast(`${result.message} Purchase cancelled.`);
      return;
    }
    this.addToast(`${info.label}: ${item.label} purchased.`);
  }

  getHealthPotionInfo() {
    const potion = CONFIG.shop.healthPotion;
    return {
      heal: Math.round(this.player.effectiveMaxHealth * potion.healRatio + this.player.level * potion.perLevelHeal),
      cost: Math.round(potion.baseGold + this.player.level * potion.perLevelGold + this.player.effectiveMaxHealth * potion.healthCostFactor)
    };
  }

  buyHealthPotion() {
    if (!this.canUseShop()) {
      this.addToast("Health potions can be bought near your core, or anywhere on the nomad path.");
      return;
    }
    const potion = this.getHealthPotionInfo();
    if (this.player.healthPotions >= CONFIG.shop.healthPotion.maxHeld) {
      this.addToast(`Potion pouch full (${CONFIG.shop.healthPotion.maxHeld} max).`);
      return;
    }
    if (this.player.currency < potion.cost) {
      this.addToast(`Need ${potion.cost} gold for a health potion.`);
      return;
    }
    this.player.currency -= potion.cost;
    this.player.healthPotions += 1;
    this.addToast(`Health potion purchased. It heals ${potion.heal} HP.`);
  }

  useHealthPotion() {
    if (this.player.healthPotions <= 0) {
      this.addToast("No health potions available.");
      return;
    }
    if (this.player.potionCooldown > 0) {
      this.addToast(`Potion cooling down (${this.player.potionCooldown.toFixed(1)}s).`);
      return;
    }
    const potion = this.getHealthPotionInfo();
    const healed = this.player.heal(potion.heal);
    if (healed <= 0) {
      this.addToast("Hero is already at full health.");
      return;
    }
    this.player.healthPotions -= 1;
    this.player.potionCooldown = CONFIG.shop.healthPotion.cooldown;
    this.addToast(`Health potion used: restored ${Math.round(healed)} HP.`);
    this.addDamageNumber(this.player, healed, "heal", { sourceKind: "potion" });
  }

  buyDefense(type) {
    if (!this.isPlayerNearCore()) {
      this.addToast("Defense purchases are available only near your core.");
      return;
    }
    const result = this.base.purchaseDefense(type, this.player);
    this.addToast(result.message);
  }

  repairWalls() {
    if (!this.isPlayerNearCore()) {
      this.addToast("Wall repairs are available only near your core.");
      return;
    }
    const result = this.base.repairWalls(this.player);
    this.addToast(result.message);
  }

  upgradeWallHealth() {
    if (!this.isPlayerNearCore()) {
      this.addToast("Wall health upgrades are available only near your core.");
      return;
    }
    const result = this.base.upgradeWallHealth(this.player);
    this.addToast(result.message);
  }

  rebuildWalls() {
    if (!this.isPlayerNearCore()) {
      this.addToast("Destroyed walls can be rebuilt only near your core.");
      return;
    }
    if (this.isEnemyInsideBaseLayers(this.base, this.player.id)) {
      this.addToast("Cannot rebuild missing walls while an enemy player is inside your wall layers.");
      return;
    }
    const result = this.base.rebuildDestroyedWalls(this.player);
    this.addToast(result.message);
  }

  placeWardAtNearestSite() {
    if (this.player.wards <= 0) {
      this.addToast("No wards in inventory. Buy one near your core.");
      return;
    }
    if (this.player.wardCooldown > 0) {
      this.addToast(`Ward placement cooling down (${this.player.wardCooldown.toFixed(1)}s).`);
      return;
    }
    const site = this.getNearestWardSite();
    if (!site || distance(this.player, site) > site.radius + this.player.radius) {
      this.addToast("Stand on a ward site to place a ward.");
      return;
    }
    if (this.placedWards.some((ward) => ward.siteId === site.id)) {
      this.addToast("This ward site is already active.");
      return;
    }
    this.player.wards -= 1;
    this.player.wardCooldown = CONFIG.shop.ward.cooldown;
    this.placedWards.push({
      id: `ward-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      siteId: site.id,
      x: site.x,
      y: site.y,
      radius: 18,
      visionRadius: 760,
      maxHealth: 120,
      health: 120,
      alive: true,
      ward: true,
      team: "player",
      takeDamage(amount) {
        const applied = Math.min(this.health, amount);
        this.health -= applied;
        if (this.health <= 0) {
          this.health = 0;
          this.alive = false;
        }
        return applied;
      },
      get healthRatio() {
        return this.health / Math.max(1, this.maxHealth);
      }
    });
    this.addToast("Ward placed. New vision added to the map.");
  }

  getNearestWardSite() {
    let best = null;
    let bestDistance = Infinity;
    for (const site of this.wardSites || CONFIG.wardSites) {
      const currentDistance = distance(this.player, site);
      if (currentDistance < bestDistance) {
        best = site;
        bestDistance = currentDistance;
      }
    }
    return best;
  }

  isPlayerInSafeZone() {
    return false;
  }

  isPointInSafeZone(point, padding = 0) {
    return false;
  }

  debugAdvancePhase() {
    const result = this.match.advancePhase();
    if (result === "match_complete") {
      this.win("Debug advanced through the final phase.");
    } else {
      this.handlePhaseChanged();
      this.updateMidBossSpawn();
      this.addToast(`Debug: advanced to ${this.match.currentPhase.label}.`);
    }
  }

  getWorldScalingLevel() {
    const remoteLevels = Array.from(this.remotePlayers.values()).map((player) => player.level || 1);
    const aiLevels = (this.aiPlayers || []).map((ai) => ai.player.level || 1);
    return Math.max(this.player.level, ...remoteLevels, ...aiLevels, 1);
  }

  getAveragePlayerLevel() {
    const levels = [
      this.player.level || 1,
      ...Array.from(this.remotePlayers.values()).map((player) => player.level || 1),
      ...(this.aiPlayers || []).map((ai) => ai.player.level || 1)
    ];
    const total = levels.reduce((sum, level) => sum + level, 0);
    return Math.max(1, total / Math.max(1, levels.length));
  }

  addFloatingText(x, y, label, color = "#f6f2e8") {
    const config = CONFIG.combat?.damageNumbers || {};
    this.claimFloatingText({
      id: `float-${this.floatingTextSerial++}`,
      x,
      y,
      baseY: y,
      label,
      color,
      life: config.life || 1.15,
      maxLife: config.life || 1.15,
      vx: randRange(-(config.spread || 18), config.spread || 18) * 0.18,
      riseSpeed: config.riseSpeed || 30,
      kind: "text"
    });
  }

  addDamageNumber(target, amount, kind = "damage", source = {}) {
    if (!target || !Number.isFinite(amount) || amount <= 0) {
      return;
    }
    const rounded = Math.max(1, Math.round(amount));
    const styles = {
      damage: { prefix: "-", color: "#fff3d8" },
      tower: { prefix: "-", color: "#ffb26a" },
      structure: { prefix: "-", color: "#e7bd58" },
      shield: { prefix: "-", color: "#72d8e8", suffix: " SH" },
      heal: { prefix: "+", color: "#63d46b" },
      critical: { prefix: "-", color: "#ff5f55" }
    };
    const style = styles[kind] || styles.damage;
    const config = CONFIG.combat?.damageNumbers || {};
    this.claimFloatingText({
      id: `hit-${this.floatingTextSerial++}`,
      x: target.x + randRange(-(config.spread || 18), config.spread || 18),
      y: target.y - (target.radius || 22) - 34,
      baseY: target.y - (target.radius || 22) - 34,
      label: `${style.prefix}${rounded}${style.suffix || ""}`,
      color: style.color,
      life: config.life || 1.05,
      maxLife: config.life || 1.05,
      vx: randRange(-8, 8),
      riseSpeed: config.riseSpeed || 34,
      kind,
      sourceKind: source.sourceKind
    });
  }

  claimFloatingText(data) {
    const max = CONFIG.combat?.damageNumbers?.max || 90;
    const text = this.floatingTextPool.pop() || {};
    Object.assign(text, data);
    this.floatingTexts.push(text);
    while (this.floatingTexts.length > max) {
      this.releaseFloatingText(this.floatingTexts.shift());
    }
  }

  releaseFloatingText(text) {
    if (!text) {
      return;
    }
    text.life = 0;
    text.label = "";
    if (this.floatingTextPool.length < (CONFIG.combat?.damageNumbers?.max || 90)) {
      this.floatingTextPool.push(text);
    }
  }

  addToast(message) {
    this.toasts.push({
      message,
      life: 4.2
    });
    this.toasts = this.toasts.slice(-4);
  }

  eliminate(reason) {
    if (this.multiplayer) {
      this.enterSpectatorMode(reason || "You have been eliminated from the online match.");
      return;
    }
    this.gameOver = true;
    this.player.eliminated = true;
    this.match.matchLost = true;
    this.ui.showMessage("Eliminated", "Game Over", reason);
  }

  win(reason) {
    if (this.gameWon) {
      return;
    }
    this.gameWon = true;
    this.match.matchWon = true;
    this.ui.showMessage("Victory", "Basebound Secured", reason);
  }

  draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewWidth, this.viewHeight);
    this.updateCamera();

    if (this.lowPolyRenderer?.render(this)) {
      ctx.save();
      ctx.translate(-this.camera.x, -this.camera.y);
      this.drawFog(ctx);
      ctx.restore();
      this.drawToasts(ctx);
      this.drawMinimap();
      this.drawDebugOverlay(ctx);
      return;
    }

    ctx.save();
    ctx.translate(-this.camera.x, -this.camera.y);
    this.map.draw(ctx);
    this.drawCamps(ctx);
    this.drawRoamingEncounters(ctx);
    this.drawExplorationChests(ctx);
    this.drawWardSites(ctx);
    this.drawObjectives(ctx);
    this.drawNeutralTowers(ctx);
    this.drawVillages(ctx);
    this.drawBasePreview(ctx);
    this.drawBase(ctx);
    this.drawBaseDefenders(ctx);
    this.drawBaseEffects(ctx);
    this.drawAreaEffects(ctx);
    this.drawDroppedLoot(ctx);
    this.drawMobs(ctx);
    this.drawProjectiles(ctx);
    this.drawTargetIndicators(ctx);
    this.drawAIBases(ctx);
    this.drawAIPlayers(ctx);
    this.drawRemoteBases(ctx);
    this.drawRemotePlayers(ctx);
    this.drawFog(ctx);
    this.drawRevealedBaseMarkers(ctx);
    this.drawPlayer(ctx);
    this.drawFloatingTexts(ctx);
    ctx.restore();

    this.drawToasts(ctx);
    this.drawMinimap();
    this.drawDebugOverlay(ctx);
  }

  updateCamera() {
    const followTarget = this.spectating ? this.getSpectatorFocus() || this.player : this.player.alive ? this.player : this.base.core || this.player;
    const focus = this.cameraLocked ? followTarget : this.cameraLookTarget || followTarget;
    const targetX = clamp(focus.x - this.viewWidth / 2, 0, Math.max(0, CONFIG.world.width - this.viewWidth));
    const targetY = clamp(focus.y - this.viewHeight / 2, 0, Math.max(0, CONFIG.world.height - this.viewHeight));
    const follow = this.cameraLocked ? 0.16 : 0.28;
    this.camera.x += (targetX - this.camera.x) * follow;
    this.camera.y += (targetY - this.camera.y) * follow;
    this.input.mouseWorld = this.screenToWorld(this.input.mouseScreen);
  }

  getSpectatorFocus() {
    if (this.spectatorFocusId) {
      const remote = this.remotePlayers.get(this.spectatorFocusId);
      if (remote?.alive) {
        return remote;
      }
    }
    const livingRemote = Array.from(this.remotePlayers.values()).find((remote) => remote.alive);
    if (livingRemote) {
      return livingRemote;
    }
    for (const remoteBase of this.remoteBases.values()) {
      const core = (remoteBase.buildings || []).find((building) => building.type === "core" && building.alive !== false);
      if (core) {
        return core;
      }
    }
    return this.base.core || this.player;
  }

  drawCamps(ctx) {
    for (const camp of this.campStates) {
      const campRadius = camp.minor ? 54 : 96;
      ctx.save();
      ctx.strokeStyle = camp.minor ? "rgba(99,212,107,0.42)" : camp.tier >= 3 ? "#e85b58" : camp.tier === 2 ? "#e7bd58" : "#63d46b";
      ctx.lineWidth = camp.minor ? 2 : 3;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(camp.x, camp.y, campRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(0,0,0,0.24)";
      ctx.fillRect(camp.x - 28, camp.y + 18, 56, 10);
      ctx.fillStyle = "#6b4a2f";
      ctx.fillRect(camp.x - 30, camp.y + 10, camp.minor ? 22 : 28, 8);
      ctx.fillRect(camp.x + 2, camp.y + 10, camp.minor ? 22 : 28, 8);
      ctx.fillStyle = camp.tier >= 3 ? "#e85b58" : camp.tier === 2 ? "#e7bd58" : "#ffb26a";
      ctx.fillRect(camp.x - 6, camp.y - (camp.minor ? 12 : 16), 12, camp.minor ? 16 : 22);
      ctx.fillStyle = "#f6f2e8";
      ctx.fillRect(camp.x - 3, camp.y - 8, 6, 8);
      ctx.restore();
      const campLevel = camp.level || (camp.tier === "elite" ? 6 : Number(camp.tier || 1) * 2);
      drawLevelBadge(ctx, camp.x, camp.y - campRadius - 16, `${camp.minor ? "Minor" : "Camp"} L${campLevel}`, riskColor(this.player.level, campLevel));
    }
  }

  drawTargetIndicators(ctx) {
    const targets = [
      { target: this.hoverTarget, color: "rgba(255,123,92,0.48)", width: 2 },
      { target: this.selectedTarget, color: "rgba(255,77,77,0.92)", width: 4 }
    ];
    for (const { target, color, width } of targets) {
      if (!target || !this.isAutoAttackTargetValid(target)) {
        continue;
      }
      const point = this.getTargetPoint(target);
      if (!this.isPointCurrentlyVisible(point, this.getTargetRadius(target) + 24)) {
        continue;
      }
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(target === this.hoverTarget && target !== this.selectedTarget ? [8, 6] : []);
      ctx.beginPath();
      ctx.arc(point.x, point.y, this.getTargetRadius(target) + 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawRoamingEncounters(ctx) {
    for (const encounter of this.roamingEncounters) {
      if (encounter.triggered || !this.isPointCurrentlyVisible(encounter, encounter.triggerRadius)) {
        continue;
      }
      ctx.save();
      const clueRadius = CONFIG.mapGeneration?.ambushClueRadius || 58;
      ctx.translate(encounter.x, encounter.y);
      ctx.fillStyle = encounter.tier >= 3 ? "rgba(232,91,88,0.34)" : "rgba(231,189,88,0.26)";
      ctx.fillRect(-clueRadius * 0.45, -6, clueRadius * 0.9, 12);
      ctx.fillRect(-8, -clueRadius * 0.35, 16, clueRadius * 0.7);
      ctx.fillStyle = "rgba(50,35,27,0.62)";
      ctx.fillRect(-34, 18, 22, 8);
      ctx.fillRect(14, -26, 28, 7);
      ctx.strokeStyle = "rgba(255,248,232,0.2)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, clueRadius * 0.34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawExplorationChests(ctx) {
    for (const chest of this.explorationChests) {
      if (chest.opened || !this.isPointCurrentlyVisible(chest, 80)) {
        continue;
      }
      const bob = Math.sin(chest.pulse) * 3;
      ctx.save();
      ctx.translate(chest.x, chest.y + bob);
      ctx.fillStyle = "#d2a547";
      ctx.strokeStyle = "#fff8e8";
      ctx.lineWidth = 2;
      ctx.fillRect(-24, -18, 48, 36);
      ctx.strokeRect(-24, -18, 48, 36);
      ctx.fillStyle = "rgba(0,0,0,0.24)";
      ctx.fillRect(-20, -4, 40, 8);
      ctx.fillStyle = "#101711";
      ctx.font = "900 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`T${chest.displayTier || chest.tier}`, 0, 5);
      ctx.restore();
    }
  }

  drawWardSites(ctx) {
    for (const site of this.wardSites || CONFIG.wardSites) {
      const ward = this.placedWards.find((placedWard) => placedWard.alive && placedWard.siteId === site.id);
      const active = Boolean(ward);
      ctx.save();
      if (ward) {
        ctx.fillStyle = "rgba(114,216,232,0.055)";
        ctx.strokeStyle = "rgba(114,216,232,0.22)";
        ctx.lineWidth = 3;
        ctx.setLineDash([16, 12]);
        ctx.beginPath();
        ctx.arc(ward.x, ward.y, ward.visionRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = active ? "#72d8e8" : "rgba(114,216,232,0.34)";
      ctx.fillStyle = active ? "rgba(114,216,232,0.16)" : "rgba(114,216,232,0.055)";
      ctx.lineWidth = active ? 3 : 2;
      ctx.setLineDash(active ? [] : [8, 9]);
      ctx.beginPath();
      ctx.arc(site.x, site.y, site.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = active ? "#72d8e8" : "rgba(246,242,232,0.42)";
      ctx.font = "900 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(active ? "WARD" : "WARD SITE", site.x, site.y + 4);
      ctx.restore();

      if (ward) {
        ctx.save();
        ctx.fillStyle = "#72d8e8";
        ctx.strokeStyle = "#fff8e8";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ward.x, ward.y, ward.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#101711";
        ctx.font = "900 10px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("W", ward.x, ward.y + 4);
        ctx.restore();
        drawHealthBar(ctx, ward.x, ward.y - 30, 42, ward.healthRatio, "#72d8e8");
      }
    }
  }

  drawObjectives(ctx) {
    const colors = {
      shrine: "#e7bd58",
      mine: "#63d46b",
      watchtower: "#6ec7d6",
      forge: "#ff8a5a",
      relic: "#b391f0",
      boss: "#e85b58"
    };

    for (const objective of this.objectives) {
      const owner = objective.ownerId ? this.getPlayerVisualById(objective.ownerId) : null;
      const color = owner?.color || colors[objective.type];
      ctx.save();
      ctx.globalAlpha = objective.captured ? 0.86 : 1;
      if (objective.guardianBounds && objective.alive && !objective.captured) {
        const bounds = objective.guardianBounds;
        ctx.save();
        ctx.globalAlpha = 0.52;
        ctx.setLineDash([18, 14]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
        ctx.fillStyle = objective.type === "boss" ? "rgba(232,91,88,0.045)" : "rgba(240,200,93,0.035)";
        ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
        ctx.setLineDash([]);
        ctx.restore();
      }
      const captureRadius = objective.radius + (!objective.alive && !objective.captured ? CONFIG.objectiveRules?.captureRadiusBonus || 0 : 0);
      ctx.fillStyle = objective.captured ? "rgba(92, 72, 45, 0.22)" : !objective.alive ? "rgba(99,212,107,0.08)" : "rgba(246,242,232,0.06)";
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(objective.x, objective.y, captureRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (!objective.captured && objective.progress > 0) {
        ctx.strokeStyle = "#f6f2e8";
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.arc(objective.x, objective.y, captureRadius + 8, -Math.PI / 2, -Math.PI / 2 + objective.progressRatio * Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = "#f6f2e8";
      ctx.font = "800 15px system-ui, sans-serif";
      ctx.textAlign = "center";
      const objectiveText =
        objective.type === "boss" && !this.bossSpawned && !this.bossDefeated
          ? `BOSS ${formatTime(this.getMidBossTimeRemaining())}`
          : objective.alive
            ? objective.captured
              ? "CLAIMED"
              : `GUARD L${objective.scaleLevel}`
            : objective.captureReady
              ? "CAPTURE"
              : objective.type.toUpperCase();
      ctx.fillText(objectiveText, objective.x, objective.y + 5);
      ctx.restore();
      if (objective.alive) {
        ctx.save();
        ctx.fillStyle = (objective.guardianKind === "melee" || objective.guardianKind === "charger") && !objective.captured ? "#b391f0" : color;
        if (objective.guardianKind === "hybrid") {
          drawShrineGuardian(ctx, objective.guardianPoint, color);
        } else if (objective.guardianKind === "melee" || objective.guardianKind === "charger") {
          const guardianMob = {
            x: objective.guardianPoint.x,
            y: objective.guardianPoint.y,
            radius: objective.guardianKind === "charger" ? 30 : 24,
            archetype: objective.guardianKind === "charger" ? "tank" : "brute",
            tier: objective.scaleLevel,
            isBoss: false,
            targetBase: false,
            facing: { x: 0, y: 1 },
            walkTime: performance.now() / 1000,
            castTimer: objective.attackTimer < 0.35 ? 0.16 : 0
          };
          drawMobShape(ctx, guardianMob);
        } else if (objective.guardianKind === "volley") {
          drawObjectiveTower(ctx, objective.guardianPoint.x, objective.guardianPoint.y, color);
          ctx.strokeStyle = "rgba(255,138,90,0.5)";
          ctx.lineWidth = 2;
        } else {
          drawObjectiveTower(ctx, objective.x, objective.y, color);
          ctx.strokeStyle = "rgba(246,242,232,0.5)";
          ctx.lineWidth = 2;
        }
        ctx.restore();
        const healthPoint = objective.guardianKind === "tower" ? objective : objective.guardianPoint;
        drawHealthBar(ctx, healthPoint.x, healthPoint.y - 42, 78, objective.healthRatio, "#e85b58");
        const levelText = `${difficultyLabel(this.player.level, objective.scaleLevel || 1)} L${objective.scaleLevel || 1}`;
        drawLevelBadge(ctx, healthPoint.x, healthPoint.y - 62, levelText, riskColor(this.player.level, objective.scaleLevel || 1));
      }
    }
  }

  drawNeutralTowers(ctx) {
    for (const tower of this.neutralTowers || []) {
      if (!this.isPointCurrentlyVisible(tower, 120)) {
        continue;
      }
      ctx.save();
      ctx.translate(tower.x, tower.y);
      ctx.globalAlpha = tower.alive ? 1 : 0.38;
      ctx.fillStyle = tower.captured ? "#63d46b" : tower.color || "#e7bd58";
      ctx.strokeStyle = "#fff8e8";
      ctx.lineWidth = 3;
      ctx.fillRect(-20, -42, 40, 72);
      ctx.strokeRect(-20, -42, 40, 72);
      ctx.fillStyle = tower.type === "vision" ? "#72d8e8" : "#ff8a5a";
      ctx.fillRect(-28, -52, 56, 16);
      ctx.fillStyle = "#101711";
      ctx.font = "900 10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(tower.type === "vision" ? "VISION" : "TURRET", 0, -40);
      ctx.restore();
      drawHealthBar(ctx, tower.x, tower.y - 62, 58, tower.healthRatio ?? 0, tower.color || "#e7bd58");
      drawLevelBadge(ctx, tower.x, tower.y - 82, `L${tower.level}`, riskColor(this.player.level, tower.level));
      if (tower.type === "vision" && tower.captured) {
        ctx.save();
        ctx.strokeStyle = tower.ownerId === this.player.id ? "rgba(114,216,232,0.22)" : "rgba(255,128,104,0.18)";
        ctx.setLineDash([12, 10]);
        ctx.beginPath();
        ctx.arc(tower.x, tower.y, tower.config?.visionRadius || 1100, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  drawVillages(ctx) {
    for (const village of this.villages || []) {
      if (!this.isPointCurrentlyVisible(village, 160)) {
        continue;
      }
      ctx.save();
      ctx.fillStyle = village.looted ? "rgba(255,248,232,0.38)" : "#fff8e8";
      ctx.font = "900 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(village.looted ? "Village cleared" : village.label, village.x, village.y - village.radius * 0.72);
      ctx.restore();
    }
  }

  drawBasePreview(ctx) {
    if (!this.basePlacementPreviewActive || !this.canArmBasePlacementPreview()) {
      return;
    }
    const placement = this.isBaseClaimLocationAllowed(this.player);
    const preview = this.base.getLayoutPreview(this.player.x, this.player.y, this.selectedBaseLayoutId);
    ctx.save();
    ctx.globalAlpha = placement.ok ? 0.38 : 0.2;
    ctx.strokeStyle = placement.ok ? "#72d8e8" : "#e85b58";
    ctx.fillStyle = placement.ok ? "rgba(114,216,232,0.08)" : "rgba(232,91,88,0.08)";
    for (const item of preview) {
      ctx.save();
      ctx.translate(item.x, item.y);
      if (item.type === "wall") {
        ctx.fillRect(-(item.width || 20) / 2, -(item.height || 20) / 2, item.width || 20, item.height || 20);
        ctx.strokeRect(-(item.width || 20) / 2, -(item.height || 20) / 2, item.width || 20, item.height || 20);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, item.radius || 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.fillStyle = placement.ok ? "#72d8e8" : "#e85b58";
    ctx.font = "900 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    const layout = CONFIG.base.layouts[this.selectedBaseLayoutId] || CONFIG.base.layouts.outpost;
    ctx.fillText(`${layout.label} preview`, this.player.x, this.player.y - 330);
    ctx.restore();
  }

  drawBase(ctx) {
    for (const building of this.base.buildings) {
      if (!building.alive) {
        continue;
      }
      const isHovered = building === this.hoveredBaseBuilding;
      if (isHovered) {
        ctx.save();
        ctx.strokeStyle = "rgba(114, 216, 232, 0.95)";
        ctx.fillStyle = "rgba(114, 216, 232, 0.12)";
        ctx.lineWidth = 5;
        ctx.setLineDash([14, 8]);
        if (building.type === "wall") {
          const pad = 13;
          roundRect(
            ctx,
            building.x - (building.width || 34) / 2 - pad,
            building.y - (building.height || 34) / 2 - pad,
            (building.width || 34) + pad * 2,
            (building.height || 34) + pad * 2,
            8
          );
          ctx.fill();
          ctx.stroke();
        } else {
          const radius = (building.radius || 28) + 18;
          ctx.beginPath();
          ctx.arc(building.x, building.y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.fillStyle = "#dffcff";
        ctx.strokeStyle = "rgba(0,0,0,0.72)";
        ctx.lineWidth = 4;
        ctx.font = "950 16px ui-monospace, SFMono-Regular, Consolas, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeText("B Upgrade", building.x, building.y - (building.radius || 30) - 34);
        ctx.fillText("B Upgrade", building.x, building.y - (building.radius || 30) - 34);
        ctx.restore();
      }
      ctx.save();
      ctx.translate(building.x, building.y);
      if (building.type === "core") {
        drawPixelCore(ctx);
      } else if (building.type === "tower") {
        drawPixelTower(ctx, "#4f8d54");
      } else if (building.type === "ballista") {
        drawPixelBallista(ctx);
      } else if (building.type === "pulseTower") {
        drawPixelTower(ctx, "#7d63c7");
      } else if (building.type === "barracks") {
        drawPixelBarracks(ctx);
      } else if (building.type === "generator") {
        drawPixelGenerator(ctx);
      } else {
        drawWallSegment(ctx, building.width, building.height);
      }
      ctx.fillStyle = "#111611";
      ctx.font = building.type === "wall" ? "900 8px system-ui, sans-serif" : "800 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`L${building.level}`, 0, building.type === "wall" ? 3 : 5);
      ctx.restore();
      if (building.type !== "wall" || building.healthRatio < 0.98) {
        drawHealthBar(ctx, building.x, building.y - building.radius - 15, building.type === "wall" ? 44 : 58, building.healthRatio, "#e7bd58");
      }
    }
  }

  drawBaseEffects(ctx) {
    for (const effect of this.baseEffects) {
      const alpha = Math.max(0, effect.life / Math.max(0.01, effect.maxLife || effect.life));
      ctx.save();
      ctx.globalAlpha = alpha;
      if (effect.type === "beam") {
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(effect.x, effect.y);
        ctx.lineTo(effect.targetX, effect.targetY);
        ctx.stroke();
        ctx.strokeStyle = "rgba(246,242,232,0.72)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (effect.type === "pulse") {
        const progress = 1 - alpha;
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.radius + progress * 54, 0, Math.PI * 2);
        ctx.stroke();
      } else if (effect.type === "shockwave") {
        const progress = 1 - alpha;
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, Math.max(12, effect.radius * progress), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = alpha * 0.18;
        ctx.fillStyle = effect.color;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
        ctx.fill();
      } else if (effect.type === "warning" || effect.type === "repairField" || effect.type === "overclock") {
        const progress = 1 - alpha;
        ctx.strokeStyle = effect.color;
        ctx.fillStyle = effect.type === "repairField" ? "rgba(99,212,107,0.1)" : effect.type === "overclock" ? "rgba(240,200,93,0.1)" : "rgba(255,207,90,0.08)";
        ctx.lineWidth = effect.type === "warning" ? 3 : 4;
        ctx.setLineDash(effect.type === "warning" ? [10, 8] : [14, 10]);
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.radius * (effect.type === "warning" ? 0.88 + progress * 0.12 : 1), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
  }

  drawBaseDefenders(ctx) {
    for (const defender of this.baseDefenders || []) {
      if (!defender.alive || !this.isPointCurrentlyVisible(defender, 80)) {
        continue;
      }
      ctx.save();
      ctx.translate(defender.x, defender.y);
      ctx.fillStyle = defender.color || "#72d8e8";
      ctx.strokeStyle = "#fff8e8";
      ctx.lineWidth = 2;
      if (defender.kind === "hound") {
        ctx.fillRect(-14, -9, 28, 18);
        ctx.fillRect(8, -14, 10, 10);
      } else if (defender.kind === "ent") {
        ctx.fillRect(-18, -22, 36, 44);
        ctx.fillStyle = "#2f5b2e";
        ctx.fillRect(-24, -34, 48, 18);
      } else if (defender.kind === "imp") {
        ctx.beginPath();
        ctx.moveTo(0, -15);
        ctx.lineTo(15, 12);
        ctx.lineTo(-15, 12);
        ctx.closePath();
        ctx.fill();
      } else if (defender.kind === "builder") {
        ctx.fillRect(-13, -13, 26, 26);
        ctx.fillStyle = "#e7bd58";
        ctx.fillRect(-5, -20, 10, 7);
      } else if (defender.kind === "mage") {
        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.lineTo(16, 12);
        ctx.lineTo(-16, 12);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, defender.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.stroke();
      ctx.fillStyle = "#101711";
      ctx.font = "900 9px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(defender.kind.slice(0, 1).toUpperCase(), 0, 3);
      ctx.restore();
      drawHealthBar(ctx, defender.x, defender.y - defender.radius - 12, 34, defender.healthRatio, defender.color || "#72d8e8");
    }
  }

  drawDroppedLoot(ctx) {
    for (const item of this.droppedLoot) {
      if (!this.isPointCurrentlyVisible(item, 30)) {
        continue;
      }
      item.pulse += 0.05;
      const bob = Math.sin(item.pulse) * 3;
      ctx.save();
      ctx.translate(item.x, item.y + bob);
      ctx.fillStyle = item.color || (item.tier >= 3 ? "#b997f4" : "#72d8e8");
      ctx.strokeStyle = "#fff8e8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(14, 0);
      ctx.lineTo(0, 14);
      ctx.lineTo(-14, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#101711";
      ctx.font = "900 10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`T${item.tier}`, 0, 4);
      ctx.restore();

      if (distance(this.player, item) <= 190) {
        ctx.save();
        ctx.fillStyle = "#fff8e8";
        ctx.font = "900 12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${item.label} (${item.rarityLabel || "Loot"})`, item.x, item.y - 24);
        ctx.restore();
      }
    }
  }

  drawAreaEffects(ctx) {
    for (const effect of this.areaEffects) {
      const alpha = 1 - effect.elapsed / effect.duration;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha) * 0.55;
      ctx.fillStyle = effect.color;
      ctx.strokeStyle = "#f6f2e8";
      if (effect.shape === "wall") {
        ctx.lineCap = "round";
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = effect.width || 52;
        ctx.beginPath();
        ctx.moveTo(effect.x1, effect.y1);
        ctx.lineTo(effect.x2, effect.y2);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,248,232,0.72)";
        ctx.lineWidth = 3;
        ctx.stroke();
      } else if (effect.shape === "cone") {
        const originX = Number.isFinite(effect.sourceX) ? effect.sourceX : effect.x;
        const originY = Number.isFinite(effect.sourceY) ? effect.sourceY : effect.y;
        const angle = Math.atan2(effect.dirY || 1, effect.dirX || 0);
        const halfAngle = (effect.coneAngle || CONFIG.combat?.melee?.defaultConeAngle || 1.72) * 0.5;
        const length = effect.length || effect.radius || 90;
        ctx.beginPath();
        ctx.moveTo(originX, originY);
        ctx.arc(originX, originY, length, angle - halfAngle, angle + halfAngle);
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha *= 0.72;
        ctx.beginPath();
        ctx.arc(originX, originY, effect.closeRadius || CONFIG.combat?.melee?.defaultCloseRadius || 52, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawProjectiles(ctx) {
    for (const projectile of this.projectiles) {
      ctx.save();
      ctx.translate(projectile.x, projectile.y);
      ctx.rotate(Math.atan2(projectile.vy, projectile.vx));
      ctx.fillStyle = projectile.color;
      roundRect(ctx, -projectile.radius * 1.7, -projectile.radius * 0.55, projectile.radius * 3.4, projectile.radius * 1.1, 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,248,232,0.72)";
      ctx.fillRect(projectile.radius * 0.1, -1, projectile.radius * 1.2, 2);
      ctx.restore();
    }
  }

  drawMobs(ctx) {
    for (const mob of this.mobs) {
      if (!mob.alive || !this.isPointCurrentlyVisible(mob, mob.radius)) {
        continue;
      }
      ctx.save();
      drawMobShape(ctx, mob);
      ctx.restore();
      drawHealthBar(ctx, mob.x, mob.y - mob.radius - 12, mob.isBoss ? 88 : 42, mob.healthRatio, "#e85b58");
      const mobLevel = mob.isBoss ? mob.objectiveScaleLevel || 5 : mob.scaledLevel || mob.tier || 1;
      drawLevelBadge(
        ctx,
        mob.x,
        mob.y - mob.radius - 30,
        mob.isBoss ? `${difficultyLabel(this.player.level, mobLevel)} L${mobLevel}` : `L${mobLevel}`,
        riskColor(this.player.level, mobLevel)
      );
    }
  }

  drawAIBases(ctx) {
    for (const ai of this.aiPlayers || []) {
      const ownerColor = ai.color || "#ff8068";
      for (const building of ai.base.livingBuildings) {
        if (!this.isPointCurrentlyVisible(building, building.radius || 40)) {
          continue;
        }
        ctx.save();
        ctx.globalAlpha = 0.86;
        ctx.translate(building.x, building.y);
        if (building.type === "core") {
          ctx.fillStyle = ownerColor;
          ctx.fillRect(-34, -34, 68, 68);
          ctx.strokeStyle = "#fff8e8";
          ctx.lineWidth = 3;
          ctx.strokeRect(-34, -34, 68, 68);
        } else if (building.type === "wall") {
          drawRemoteWallSegment(ctx, building.width, building.height);
        } else {
          ctx.fillStyle = building.type === "pulseTower" ? "#d69cff" : building.type === "ballista" ? "#ffb26a" : ownerColor;
          ctx.beginPath();
          ctx.arc(0, 0, building.radius || 24, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(255,248,232,0.42)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.fillStyle = "#151511";
        ctx.font = "900 10px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`AI L${building.level || 1}`, 0, 4);
        ctx.restore();
        drawHealthBar(ctx, building.x, building.y - (building.radius || 24) - 14, 46, building.healthRatio ?? 1, "#ffb26a");
      }
    }
  }

  drawRevealedBaseMarkers(ctx) {
    if (!this.areRivalBasesRevealed()) {
      return;
    }
    for (const ai of this.aiPlayers || []) {
      const core = ai.base.core;
      if (!core) {
        continue;
      }
      const color = ai.color || "#ff8068";
      ctx.save();
      ctx.globalAlpha = this.isPointCurrentlyVisible(core, 120) ? 0.88 : 0.72;
      ctx.strokeStyle = color;
      ctx.fillStyle = "rgba(16, 19, 24, 0.66)";
      ctx.lineWidth = 4;
      ctx.setLineDash([12, 8]);
      ctx.beginPath();
      ctx.arc(core.x, core.y, 118 + Math.sin(performance.now() / 420) * 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.fillRect(core.x - 16, core.y - 16, 32, 32);
      ctx.strokeStyle = "#fff8e8";
      ctx.lineWidth = 2;
      ctx.strokeRect(core.x - 16, core.y - 16, 32, 32);
      ctx.fillStyle = "#fff8e8";
      ctx.font = "900 13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${ai.name} Core`, core.x, core.y - 138);
      ctx.restore();
    }
  }

  drawAIPlayers(ctx) {
    for (const ai of this.aiPlayers || []) {
      const remote = ai.snapshot();
      if (!remote?.alive || !this.isPointCurrentlyVisible(remote, 90)) {
        continue;
      }
      const color = remote.color || ai.color || "#ff8068";
      ctx.save();
      drawHeroShape(ctx, remote, color, remote.level || 1);
      ctx.fillStyle = "#fff8e8";
      ctx.font = "900 12px system-ui, sans-serif";
      ctx.fillText(remote.name || "AI Rival", remote.x, remote.y - 46);
      ctx.fillStyle = "#ffcf5a";
      ctx.font = "800 10px system-ui, sans-serif";
      ctx.fillText(remote.intent || "scout", remote.x, remote.y - 34);
      ctx.restore();
      drawHealthBar(ctx, remote.x, remote.y - 28, 56, remote.healthRatio ?? 1, color);
      drawLevelBadge(ctx, remote.x, remote.y - 62, `${ai.characterClass?.shortLabel || "AI"} L${remote.level || 1}`, riskColor(this.player.level, remote.level || 1));
    }
  }

  drawRemoteBases(ctx) {
    for (const remoteBase of this.remoteBases.values()) {
      for (const building of remoteBase.buildings || []) {
        if (!this.isPointCurrentlyVisible(building, building.radius || 40)) {
          continue;
        }
        ctx.save();
        ctx.globalAlpha = 0.72;
        ctx.translate(building.x, building.y);
        if (building.type === "core") {
          ctx.fillStyle = "#d49a62";
          ctx.fillRect(-34, -34, 68, 68);
          ctx.strokeStyle = "#ffd3a1";
          ctx.lineWidth = 3;
          ctx.strokeRect(-34, -34, 68, 68);
        } else if (building.type === "wall") {
          drawRemoteWallSegment(ctx, building.width, building.height);
        } else {
          ctx.fillStyle = building.type === "pulseTower" ? "#d69cff" : building.type === "ballista" ? "#ffb26a" : "#d49a62";
          ctx.beginPath();
          ctx.arc(0, 0, building.radius || 24, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(255,248,232,0.42)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.fillStyle = "#151511";
        ctx.font = "900 10px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`P2 L${building.level || 1}`, 0, 4);
        ctx.restore();
        drawHealthBar(ctx, building.x, building.y - (building.radius || 24) - 14, 46, building.healthRatio ?? 1, "#ffb26a");
      }
    }
  }

  drawRemotePlayers(ctx) {
    for (const remote of this.remotePlayers.values()) {
      if (!remote?.alive || this.isEntityStealthed(remote) || !this.isPointCurrentlyVisible(remote, 90)) {
        continue;
      }
      ctx.save();
      drawHeroShape(ctx, remote, "#ffb26a", remote.level || 1);
      ctx.fillStyle = "#fff8e8";
      ctx.font = "900 12px system-ui, sans-serif";
      ctx.fillText(remote.name || "Player 2", remote.x, remote.y - 42);
      ctx.restore();
      drawHealthBar(ctx, remote.x, remote.y - 34, 56, remote.healthRatio ?? 1, "#ffb26a");
    }
  }

  drawPlayer(ctx) {
    if (!this.player.alive) {
      return;
    }

    ctx.save();
    this.drawQueuedAbilityPreview(ctx);
    if (this.player.isStealthed) {
      ctx.globalAlpha = 0.48;
      ctx.strokeStyle = "rgba(179,145,240,0.88)";
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.arc(this.player.x, this.player.y, this.player.radius + 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawHeroShape(ctx, this.player, this.player.color || this.player.characterClass?.color || "#3e8f9a", this.player.level);
    ctx.restore();
    drawHealthBar(ctx, this.player.x, this.player.y - 34, 56, this.player.healthRatio, "#63d46b");
    if ((this.player.shield || 0) > 0) {
      drawHealthBar(ctx, this.player.x, this.player.y - 44, 56, this.player.shieldRatio, "#72d8e8");
    }
    drawLevelBadge(ctx, this.player.x, this.player.y - 58, `${this.player.characterClass?.shortLabel || "Hero"} L${this.player.level}`, "#72d8e8");
    if (this.recall.active) {
      const progress = 1 - this.recall.timer / Math.max(0.01, this.recall.duration);
      ctx.save();
      ctx.strokeStyle = "#72d8e8";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(this.player.x, this.player.y, this.player.radius + 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.stroke();
      ctx.fillStyle = "#fff8e8";
      ctx.font = "900 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`Recall ${this.recall.timer.toFixed(1)}s`, this.player.x, this.player.y - 52);
      ctx.restore();
    }
  }

  drawQueuedAbilityPreview(ctx) {
    const abilityId = this.queuedAbilityId;
    if (!abilityId) {
      return;
    }
    const ability = this.player.abilityBook.abilities[abilityId];
    if (!ability) {
      return;
    }

    const aim = normalize(this.input.mouseWorld.x - this.player.x, this.input.mouseWorld.y - this.player.y);
    const target = clampPointToRange(this.player, this.input.mouseWorld, ability.range);
    const readyColor = hexToRgba(ability.config.color || "#72d8e8", 0.76);
    const fillColor = hexToRgba(ability.config.color || "#72d8e8", 0.1);
    const mutedColor = "rgba(185,197,175,0.34)";
    const color = ability.ready ? readyColor : mutedColor;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = fillColor;
    ctx.lineWidth = 3;
    if (ability.config.type === "flameWall") {
      const wallCenter = target;
      const side = { x: -aim.y, y: aim.x };
      const length = (ability.config.wallLength || 360) + Math.max(0, ability.level - 1) * 28;
      const width = (ability.config.wallWidth || 52) + Math.max(0, ability.level - 1) * 4;
      ctx.lineCap = "round";
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(wallCenter.x - side.x * length * 0.5, wallCenter.y - side.y * length * 0.5);
      ctx.lineTo(wallCenter.x + side.x * length * 0.5, wallCenter.y + side.y * length * 0.5);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255,248,232,0.76)";
      ctx.stroke();
    } else if (["projectile", "dash"].includes(ability.config.type)) {
      const indicatorEnd = {
        x: this.player.x + aim.x * ability.range,
        y: this.player.y + aim.y * ability.range
      };
      ctx.beginPath();
      ctx.moveTo(this.player.x, this.player.y);
      ctx.lineTo(indicatorEnd.x, indicatorEnd.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(indicatorEnd.x, indicatorEnd.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (["selfArea", "selfBuff", "stealth"].includes(ability.config.type)) {
      ctx.setLineDash([12, 10]);
      ctx.beginPath();
      ctx.arc(this.player.x, this.player.y, Math.max(ability.effectRadius || 72, this.player.radius + 36), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.setLineDash([12, 10]);
      ctx.beginPath();
      ctx.arc(this.player.x, this.player.y, ability.range, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(target.x, target.y, ability.effectRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  drawFloatingTexts(ctx) {
    const textConfig = CONFIG.combat?.damageNumbers || {};
    const textFontSize = textConfig.textFontSize || 20;
    const hitFontSize = textConfig.hitFontSize || 24;
    for (const text of this.floatingTexts) {
      ctx.save();
      const alpha = Math.max(0, Math.min(1, text.life / Math.max(0.01, text.maxLife || 1)));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = text.color;
      ctx.font = text.kind === "text"
        ? `900 ${textFontSize}px system-ui, sans-serif`
        : `950 ${hitFontSize}px ui-monospace, SFMono-Regular, Consolas, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (text.kind !== "text") {
        const boxHeight = Math.max(34, Math.ceil(hitFontSize * 1.48));
        const width = Math.max(48, ctx.measureText(text.label).width + 26);
        ctx.fillStyle = "rgba(39, 17, 8, 0.82)";
        roundRect(ctx, text.x - width / 2, text.y - boxHeight / 2, width, boxHeight, 8);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 248, 232, 0.28)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.fillStyle = text.color;
      ctx.strokeStyle = "rgba(0,0,0,0.72)";
      ctx.lineWidth = text.kind === "text" ? 3 : 4;
      ctx.strokeText(text.label, text.x, text.y);
      ctx.fillText(text.label, text.x, text.y);
      ctx.restore();
    }
  }

  drawFog(ctx) {
    if (!this.exploredCanvas || !this.fogViewCanvas) {
      return;
    }

    this.ensureFogViewSize();
    const fogCtx = this.fogViewCtx;
    const viewWidth = this.viewWidth;
    const viewHeight = this.viewHeight;
    const sourceX = this.camera.x * this.fogScale;
    const sourceY = this.camera.y * this.fogScale;
    const sourceWidth = viewWidth * this.fogScale;
    const sourceHeight = viewHeight * this.fogScale;

    fogCtx.clearRect(0, 0, viewWidth, viewHeight);
    fogCtx.fillStyle = "rgba(20, 21, 24, 0.96)";
    fogCtx.fillRect(0, 0, viewWidth, viewHeight);
    fogCtx.globalCompositeOperation = "destination-out";
    fogCtx.drawImage(this.exploredCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, viewWidth, viewHeight);
    fogCtx.globalCompositeOperation = "source-over";
    ctx.drawImage(this.fogViewCanvas, this.camera.x, this.camera.y, viewWidth, viewHeight);

    fogCtx.clearRect(0, 0, viewWidth, viewHeight);
    fogCtx.fillStyle = "rgba(42, 43, 47, 0.28)";
    fogCtx.fillRect(0, 0, viewWidth, viewHeight);
    fogCtx.globalCompositeOperation = "destination-in";
    fogCtx.drawImage(this.exploredCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, viewWidth, viewHeight);
    fogCtx.globalCompositeOperation = "destination-out";
    fogCtx.fillStyle = "#ffffff";
    for (const vision of this.getCurrentVisionSources()) {
      fogCtx.beginPath();
      fogCtx.arc(vision.x - this.camera.x, vision.y - this.camera.y, vision.radius, 0, Math.PI * 2);
      fogCtx.fill();
    }
    fogCtx.globalCompositeOperation = "source-over";
    ctx.drawImage(this.fogViewCanvas, this.camera.x, this.camera.y, viewWidth, viewHeight);
  }

  createFogOfWar() {
    this.fogScale = Math.min(0.25, 3600 / Math.max(CONFIG.world.width, CONFIG.world.height));
    this.exploredCanvas = document.createElement("canvas");
    this.exploredCanvas.width = Math.ceil(CONFIG.world.width * this.fogScale);
    this.exploredCanvas.height = Math.ceil(CONFIG.world.height * this.fogScale);
    this.exploredCtx = this.exploredCanvas.getContext("2d");
    this.exploredCtx.imageSmoothingEnabled = true;
    this.fogViewCanvas = document.createElement("canvas");
    this.fogViewCtx = this.fogViewCanvas.getContext("2d");
    this.ensureFogViewSize();
  }

  ensureFogViewSize() {
    if (!this.fogViewCanvas) {
      return;
    }
    const width = Math.max(1, Math.ceil(this.viewWidth));
    const height = Math.max(1, Math.ceil(this.viewHeight));
    if (this.fogViewCanvas.width !== width || this.fogViewCanvas.height !== height) {
      this.fogViewCanvas.width = width;
      this.fogViewCanvas.height = height;
      this.fogViewCtx = this.fogViewCanvas.getContext("2d");
    }
  }

  updateFogOfWar() {
    if (!this.exploredCtx) {
      return;
    }

    this.exploredCtx.save();
    this.exploredCtx.scale(this.fogScale, this.fogScale);
    this.exploredCtx.fillStyle = "#ffffff";
    for (const vision of this.getCurrentVisionSources()) {
      this.exploredCtx.beginPath();
      this.exploredCtx.arc(vision.x, vision.y, vision.radius, 0, Math.PI * 2);
      this.exploredCtx.fill();
    }
    this.exploredCtx.restore();
  }

  getCurrentVisionSources() {
    const sources = [];
    if (this.player?.alive) {
      sources.push({
        x: this.player.x,
        y: this.player.y,
        radius: CONFIG.world.playerVision + this.player.statBonuses.vision + (this.player.baseLayoutBonus?.vision || 0)
      });
    }

    const core = this.base?.core;
    if (core) {
      sources.push({
        x: core.x,
        y: core.y,
        radius: CONFIG.world.baseVision + (this.base.visionBonus || 0)
      });
    }

    for (const objective of this.objectives || []) {
      if (objective.type === "watchtower" && objective.captured && objective.ownerId === this.player.id) {
        sources.push({
          x: objective.x,
          y: objective.y,
          radius: CONFIG.world.watchtowerVision
        });
      }
    }
    for (const tower of this.neutralTowers || []) {
      if (tower.type === "vision" && tower.alive && tower.captured && tower.ownerId === this.player.id) {
        sources.push({
          x: tower.x,
          y: tower.y,
          radius: tower.config?.visionRadius || 1100
        });
      }
    }
    for (const ward of this.placedWards || []) {
      if (!ward.alive) {
        continue;
      }
      sources.push({
        x: ward.x,
        y: ward.y,
        radius: ward.visionRadius
      });
    }
    return sources;
  }

  isPointCurrentlyVisible(point, padding = 0) {
    return this.getCurrentVisionSources().some((vision) => distance(point, vision) <= vision.radius + padding);
  }

  areRivalBasesRevealed() {
    const revealIndex = this.match.phases.findIndex((phase) => phase.id === "reveal");
    return revealIndex >= 0 && this.match.phaseIndex >= revealIndex;
  }

  drawMinimap() {
    const canvas = this.minimapCanvas;
    const ctx = this.minimapCtx;
    if (!canvas || !ctx) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const scaleX = width / CONFIG.world.width;
    const scaleY = height / CONFIG.world.height;
    const mx = (x) => x * scaleX;
    const my = (y) => y * scaleY;

    ctx.fillStyle = "#203920";
    ctx.fillRect(0, 0, width, height);
    for (const zone of this.map.zones) {
      ctx.fillStyle = zone.color;
      ctx.globalAlpha = 0.52;
      ctx.fillRect(mx(zone.x), my(zone.y), zone.w * scaleX, zone.h * scaleY);
    }
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(95,76,48,0.72)";
    ctx.lineWidth = 4;
    for (const path of this.map.paths || []) {
      ctx.beginPath();
      path.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(mx(point.x), my(point.y));
        } else {
          ctx.lineTo(mx(point.x), my(point.y));
        }
      });
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(216,180,107,0.82)";
    ctx.lineWidth = 2.4;
    for (const path of this.map.paths || []) {
      ctx.beginPath();
      path.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(mx(point.x), my(point.y));
        } else {
          ctx.lineTo(mx(point.x), my(point.y));
        }
      });
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#6ec7d6";
    ctx.lineWidth = 3;
    ctx.beginPath();
    this.map.river.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(mx(point.x), my(point.y));
      } else {
        ctx.lineTo(mx(point.x), my(point.y));
      }
    });
    ctx.stroke();
    for (const branch of this.map.riverBranches || []) {
      ctx.beginPath();
      branch.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(mx(point.x), my(point.y));
        } else {
          ctx.lineTo(mx(point.x), my(point.y));
        }
      });
      ctx.stroke();
    }
    ctx.restore();

    for (const bridge of this.map.bridges || []) {
      ctx.fillStyle = "#d8b46b";
      ctx.fillRect(mx(bridge.x) - 4, my(bridge.y) - 3, 8, 6);
    }

    if (this.exploredCanvas) {
      if (!this.minimapFogCanvas) {
        this.minimapFogCanvas = document.createElement("canvas");
      }
      if (this.minimapFogCanvas.width !== width || this.minimapFogCanvas.height !== height) {
        this.minimapFogCanvas.width = width;
        this.minimapFogCanvas.height = height;
      }
      const fogCtx = this.minimapFogCanvas.getContext("2d");
      fogCtx.clearRect(0, 0, width, height);
      fogCtx.fillStyle = "rgba(16,19,24,0.62)";
      fogCtx.fillRect(0, 0, width, height);
      fogCtx.globalCompositeOperation = "destination-out";
      fogCtx.drawImage(this.exploredCanvas, 0, 0, width, height);
      fogCtx.globalCompositeOperation = "source-over";
      ctx.drawImage(this.minimapFogCanvas, 0, 0);
    }

    for (const objective of this.objectives) {
      ctx.fillStyle = objective.captured ? "#63d46b" : objective.type === "boss" ? "#e85b58" : "#f0c85d";
      ctx.beginPath();
      ctx.arc(mx(objective.x), my(objective.y), objective.type === "boss" ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const village of this.villages || []) {
      if (!village.looted && !this.isPointCurrentlyVisible(village, 180)) {
        continue;
      }
      ctx.fillStyle = village.looted ? "rgba(216,180,107,0.45)" : "#d8b46b";
      ctx.fillRect(mx(village.x) - 2.5, my(village.y) - 2.5, 5, 5);
    }

    for (const tower of this.neutralTowers || []) {
      if (!tower.captured && !this.isPointCurrentlyVisible(tower, 160)) {
        continue;
      }
      const x = mx(tower.x);
      const y = my(tower.y);
      ctx.fillStyle = tower.captured ? "#63d46b" : tower.type === "vision" ? "#72d8e8" : "#ff8a5a";
      ctx.beginPath();
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x + 4, y + 3);
      ctx.lineTo(x - 4, y + 3);
      ctx.closePath();
      ctx.fill();
    }

    const core = this.base.core;
    if (core) {
      ctx.fillStyle = "#f0c85d";
      ctx.fillRect(mx(core.x) - 3, my(core.y) - 3, 6, 6);
    }

    const rivalBasesRevealed = this.areRivalBasesRevealed();
    for (const ai of this.aiPlayers || []) {
      const aiCore = ai.base.core;
      if (aiCore && (rivalBasesRevealed || this.isPointCurrentlyVisible(aiCore, 120))) {
        const color = ai.color || "#ff8068";
        const x = mx(aiCore.x);
        const y = my(aiCore.y);
        ctx.fillStyle = color;
        ctx.fillRect(x - 4, y - 4, 8, 8);
        ctx.strokeStyle = "#fff8e8";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 5, y - 5, 10, 10);
        if (rivalBasesRevealed) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, 10, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    for (const remoteBase of this.remoteBases.values()) {
      const remoteCore = remoteBase.buildings?.find((building) => building.type === "core");
      if (!remoteCore) {
        continue;
      }
      ctx.fillStyle = "#ffb26a";
      ctx.fillRect(mx(remoteCore.x) - 3, my(remoteCore.y) - 3, 6, 6);
    }

    for (const ward of this.placedWards) {
      if (!ward.alive) {
        continue;
      }
      ctx.strokeStyle = "rgba(114,216,232,0.45)";
      ctx.beginPath();
      ctx.arc(mx(ward.x), my(ward.y), Math.max(3, ward.visionRadius * scaleX), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#72d8e8";
      ctx.fillRect(mx(ward.x) - 2, my(ward.y) - 2, 4, 4);
    }

    for (const mob of this.mobs) {
      if (!mob.alive || !this.isPointCurrentlyVisible(mob, mob.radius)) {
        continue;
      }
      ctx.fillStyle = mob.isBoss ? "#e85b58" : "#d87b4a";
      ctx.beginPath();
      ctx.arc(mx(mob.x), my(mob.y), mob.isBoss ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#72d8e8";
    ctx.beginPath();
    ctx.arc(mx(this.player.x), my(this.player.y), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff8e8";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    for (const remote of this.remotePlayers.values()) {
      // Only reveal rival players on the minimap when they are inside vision.
      if (!remote.alive || this.isEntityStealthed(remote) || !this.isPointCurrentlyVisible(remote, 0)) {
        continue;
      }
      ctx.fillStyle = "#ffb26a";
      ctx.beginPath();
      ctx.arc(mx(remote.x), my(remote.y), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff8e8";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    for (const ai of this.aiPlayers || []) {
      if (!ai.player.alive || !this.isPointCurrentlyVisible(ai.player, 90)) {
        continue;
      }
      ctx.fillStyle = ai.color || "#ff8068";
      ctx.beginPath();
      ctx.arc(mx(ai.player.x), my(ai.player.y), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff8e8";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.strokeStyle = this.cameraLookTarget ? "#72d8e8" : "#fff8e8";
    ctx.lineWidth = 2;
    ctx.strokeRect(mx(this.camera.x), my(this.camera.y), this.viewWidth * scaleX, this.viewHeight * scaleY);

    ctx.fillStyle = "rgba(255,248,232,0.76)";
    ctx.font = "800 10px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("MAP", 8, 14);
  }

  drawToasts(ctx) {
    if (this.toasts.length === 0) {
      return;
    }

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.textAlign = "center";
    ctx.font = "800 15px system-ui, sans-serif";
    this.toasts.forEach((toast, index) => {
      const y = 24 + index * 30;
      const width = Math.min(this.viewWidth - 32, 720);
      const x = this.viewWidth / 2;
      ctx.globalAlpha = Math.min(1, toast.life);
      ctx.fillStyle = "rgba(19,26,22,0.88)";
      roundRect(ctx, x - width / 2, y - 17, width, 24, 7);
      ctx.fill();
      ctx.fillStyle = "#f6f2e8";
      ctx.fillText(toast.message, x, y);
    });
    ctx.restore();
  }

  drawDebugOverlay(ctx) {
    if (!this.showDebugOverlay) {
      return;
    }
    const stats = this.performanceStats || {};
    const lines = [
      `FPS ${stats.fps || 0}`,
      `Entities ${(stats.mobs || 0) + (stats.ai || 0) + (stats.projectiles || 0) + (stats.towers || 0) + (this.baseDefenders?.length || 0)}`,
      `Mobs ${stats.mobs || 0} / Camps ${stats.camps || 0} / Bosses ${stats.bosses || 0}`,
      `AI ${stats.ai || 0} / Projectiles ${stats.projectiles || 0} / Towers ${stats.towers || 0}`,
      `Effects ${stats.effects || 0} / UI ${stats.uiHz || 10}hz`,
      `Map ${CONFIG.world.width}x${CONFIG.world.height}`
    ];
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const x = 12;
    const y = 82;
    ctx.fillStyle = "rgba(11, 16, 12, 0.86)";
    roundRect(ctx, x, y, 250, 142, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(114,216,232,0.28)";
    ctx.stroke();
    ctx.fillStyle = "#72d8e8";
    ctx.font = "900 12px system-ui, sans-serif";
    ctx.fillText("PERFORMANCE F9", x + 12, y + 20);
    ctx.fillStyle = "#fff8e8";
    ctx.font = "800 12px system-ui, sans-serif";
    lines.forEach((line, index) => ctx.fillText(line, x + 12, y + 42 + index * 16));
    ctx.restore();
  }
}

function drawPixelCore(ctx) {
  ctx.fillStyle = "#6b4a2f";
  ctx.fillRect(-42, -26, 84, 58);
  ctx.fillStyle = "#a85d42";
  ctx.fillRect(-34, -46, 68, 22);
  ctx.fillRect(-42, -34, 84, 16);
  ctx.fillStyle = "#d28a58";
  for (let x = -35; x <= 28; x += 14) {
    ctx.fillRect(x, -47 + Math.abs(x % 3), 12, 12);
  }
  ctx.fillStyle = "#2d1e17";
  ctx.fillRect(-14, -2, 28, 34);
  ctx.fillStyle = "#f0c85d";
  ctx.fillRect(-5, 10, 4, 4);
  ctx.strokeStyle = "rgba(255,248,232,0.45)";
  ctx.lineWidth = 3;
  ctx.strokeRect(-42, -26, 84, 58);
}

function drawPixelTower(ctx, roofColor) {
  ctx.fillStyle = "#6c6b68";
  ctx.fillRect(-23, -28, 46, 56);
  ctx.fillStyle = "#8b8985";
  for (let y = -22; y < 22; y += 13) {
    ctx.fillRect(-17, y, 8, 5);
    ctx.fillRect(8, y + 4, 8, 5);
  }
  ctx.fillStyle = roofColor;
  ctx.fillRect(-28, -40, 56, 14);
  ctx.fillRect(-20, -52, 40, 14);
  ctx.fillStyle = "#211711";
  ctx.fillRect(-6, -8, 12, 18);
  ctx.strokeStyle = "rgba(255,248,232,0.42)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-23, -28, 46, 56);
}

function drawPixelBallista(ctx) {
  ctx.fillStyle = "#6b4a2f";
  ctx.fillRect(-24, -18, 48, 36);
  ctx.fillStyle = "#bc823c";
  ctx.fillRect(-18, -24, 36, 12);
  ctx.fillStyle = "#f0c85d";
  ctx.fillRect(-5, -42, 10, 56);
  ctx.fillRect(-24, -34, 48, 8);
  ctx.strokeStyle = "rgba(255,248,232,0.48)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-24, -18, 48, 36);
}

function drawPixelGenerator(ctx) {
  ctx.fillStyle = "#435c5f";
  ctx.fillRect(-24, -20, 48, 42);
  ctx.fillStyle = "#6ec7d6";
  ctx.fillRect(-16, -30, 32, 14);
  ctx.fillRect(-8, -42, 16, 12);
  ctx.fillStyle = "#f0c85d";
  ctx.fillRect(-11, -4, 22, 12);
  ctx.strokeStyle = "rgba(255,248,232,0.42)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-24, -20, 48, 42);
}

function drawPixelBarracks(ctx) {
  ctx.fillStyle = "#6b4a2f";
  ctx.fillRect(-32, -22, 64, 48);
  ctx.fillStyle = "#8f4e38";
  ctx.fillRect(-38, -36, 76, 16);
  ctx.fillRect(-28, -48, 56, 14);
  ctx.fillStyle = "#2d1e17";
  ctx.fillRect(-9, 2, 18, 24);
  ctx.fillStyle = "#d8c59a";
  ctx.fillRect(-24, -10, 12, 10);
  ctx.fillRect(12, -10, 12, 10);
  ctx.strokeStyle = "rgba(255,248,232,0.42)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-32, -22, 64, 48);
}

function drawWallSegment(ctx, width, height) {
  const w = width || 36;
  const h = height || 18;
  ctx.fillStyle = "#8d8675";
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = "#b7ac98";
  const horizontal = w >= h;
  const blockSize = 18;
  if (horizontal) {
    for (let x = -w / 2 + 8; x < w / 2 - 6; x += blockSize) {
      ctx.fillRect(x, -h / 2 - 4, 10, 8);
      ctx.fillRect(x + 5, h / 2 - 4, 10, 8);
    }
  } else {
    for (let y = -h / 2 + 8; y < h / 2 - 6; y += blockSize) {
      ctx.fillRect(-w / 2 - 4, y, 8, 10);
      ctx.fillRect(w / 2 - 4, y + 5, 8, 10);
    }
  }
  ctx.strokeStyle = "rgba(246,242,232,0.32)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = "rgba(33,30,25,0.34)";
  ctx.lineWidth = 1;
  const count = Math.max(2, Math.floor((horizontal ? w : h) / 24));
  for (let index = 1; index < count; index += 1) {
    ctx.beginPath();
    if (horizontal) {
      const x = -w / 2 + (w / count) * index;
      ctx.moveTo(x, -h / 2 + 3);
      ctx.lineTo(x, h / 2 - 3);
    } else {
      const y = -h / 2 + (h / count) * index;
      ctx.moveTo(-w / 2 + 3, y);
      ctx.lineTo(w / 2 - 3, y);
    }
    ctx.stroke();
  }
}

function drawRemoteWallSegment(ctx, width, height) {
  const w = width || 36;
  const h = height || 18;
  ctx.fillStyle = "#8f5f4c";
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = "rgba(255,248,232,0.3)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
}

function drawObjectiveTower(ctx, x, y, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#6b6254";
  ctx.fillRect(-24, -24, 48, 48);
  ctx.strokeStyle = "rgba(246,242,232,0.48)";
  ctx.lineWidth = 3;
  ctx.strokeRect(-24, -24, 48, 48);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -48);
  ctx.lineTo(30, -18);
  ctx.lineTo(14, 14);
  ctx.lineTo(-14, 14);
  ctx.lineTo(-30, -18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#151511";
  ctx.fillRect(-7, -10, 14, 24);
  ctx.restore();
}

function drawShrineGuardian(ctx, point, color) {
  const radius = 25;
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -radius);
  ctx.lineTo(radius, 0);
  ctx.lineTo(0, radius);
  ctx.lineTo(-radius, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#fff8e8";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#151511";
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(240,200,93,0.75)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, radius + 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawHeroShape(ctx, entity, color, level) {
  const scale = 3;
  const facing = cardinalFacing(entity);
  const moving = Math.hypot(entity.vx || 0, entity.vy || 0) > 12;
  const frame = moving ? Math.floor((entity.walkTime || 0) * 7) % 2 : 0;
  const swing = frame === 0 ? -1 : 1;
  const cast = (entity.castTimer || 0) > 0;
  ctx.save();
  ctx.translate(Math.round(entity.x), Math.round(entity.y));
  drawPixelShadow(ctx, scale, 13, 7);

  const skin = "#d8b078";
  const hair = "#5a3420";
  const trim = "#f0c85d";
  const boot = "#3b2a1e";
  if (facing.axis === "x") {
    const side = facing.sign;
    p(ctx, -2, 4, 2, 5 + swing, boot, scale);
    p(ctx, 2, 4, 2, 5 - swing, boot, scale);
    p(ctx, -4, -4, 8, 9, color, scale);
    p(ctx, -5, 1, 10, 2, "#845f36", scale);
    p(ctx, -3, -9, 6, 5, skin, scale);
    p(ctx, -3, -11, 6, 2, hair, scale);
    p(ctx, side > 0 ? 4 : -7, -3, 3, 6, skin, scale);
    p(ctx, side > 0 ? 7 : -12, cast ? -5 : -3, 5, 2, trim, scale);
  } else {
    const down = facing.sign > 0;
    p(ctx, -4, 4, 3, 5 + swing, boot, scale);
    p(ctx, 1, 4, 3, 5 - swing, boot, scale);
    p(ctx, -5, -4, 10, 9, color, scale);
    p(ctx, -5, 1, 10, 2, "#845f36", scale);
    p(ctx, -3, -10, 6, 5, skin, scale);
    p(ctx, -3, -12, 6, 2, hair, scale);
    p(ctx, -7, -2 + swing, 3, 5, skin, scale);
    p(ctx, 4, -2 - swing, 3, 5, skin, scale);
    p(ctx, down ? 5 : -8, down ? -5 : -9, 2, 9, trim, scale);
  }

  p(ctx, -2, -2, 4, 3, "#f6f2e8", scale);
  p(ctx, -1, -1, 2, 1, "#151511", scale);
  ctx.fillStyle = "#151511";
  ctx.font = "900 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(String(level), 0, 5);
  ctx.restore();
}

function drawMobShape(ctx, mob) {
  const scale = mob.isBoss ? 4 : mob.archetype === "brute" ? 3.4 : 2.8;
  const facing = cardinalFacing(mob);
  const moving = Math.floor((mob.walkTime || 0) * 7) % 2;
  const swing = moving === 0 ? -1 : 1;
  const body = mobColor(mob);
  const hood =
    mob.archetype === "summoner"
      ? "#5b3c7a"
      : mob.archetype === "ranged"
        ? "#2f5b2e"
        : mob.archetype === "swift" || mob.archetype === "skitter"
          ? "#29323a"
          : "#4e3a2c";
  const skin = mob.isBoss ? "#c58b66" : "#b88962";
  const weapon = (mob.castTimer || 0) > 0 ? "#f0c85d" : "#c9d1c0";
  ctx.save();
  ctx.translate(Math.round(mob.x), Math.round(mob.y));
  drawPixelShadow(ctx, scale, mob.isBoss ? 15 : 11, mob.isBoss ? 8 : 6);

  if (mob.isBoss) {
    p(ctx, -6, -7, 12, 14, body, scale);
    p(ctx, -4, -13, 8, 6, "#4a2530", scale);
    p(ctx, -7, -2, 3, 7, "#d8c59a", scale);
    p(ctx, 4, -2, 3, 7, "#d8c59a", scale);
    p(ctx, -2, -10, 1, 2, "#151511", scale);
    p(ctx, 2, -10, 1, 2, "#151511", scale);
    ctx.restore();
    return;
  }

  if (facing.axis === "x") {
    const side = facing.sign;
    p(ctx, -3, 4, 2, 4 + swing, "#30251e", scale);
    p(ctx, 1, 4, 2, 4 - swing, "#30251e", scale);
    p(ctx, -4, -4, 8, 9, body, scale);
    p(ctx, -3, -9, 6, 5, skin, scale);
    p(ctx, -4, -10, 8, 3, hood, scale);
    p(ctx, side > 0 ? 4 : -7, -2, 3, 5, skin, scale);
    if (mob.archetype === "ranged" || mob.archetype === "summoner") {
      p(ctx, side > 0 ? 7 : -12, -5, 5, 2, weapon, scale);
      p(ctx, side > 0 ? 10 : -12, -6, 1, 5, "#6b4a2f", scale);
    } else {
      p(ctx, side > 0 ? 6 : -11, -5, 5, 2, weapon, scale);
    }
  } else {
    p(ctx, -3, 4, 2, 4 + swing, "#30251e", scale);
    p(ctx, 1, 4, 2, 4 - swing, "#30251e", scale);
    p(ctx, -4, -4, 8, 9, body, scale);
    p(ctx, -3, -9, 6, 5, skin, scale);
    p(ctx, -4, -10, 8, 3, hood, scale);
    p(ctx, -6, -1 + swing, 2, 5, skin, scale);
    p(ctx, 4, -1 - swing, 2, 5, skin, scale);
    if (mob.archetype === "brute" || mob.archetype === "tank") {
      p(ctx, -6, -5, 12, 3, "#70413b", scale);
    } else if (mob.archetype === "ranged" || mob.archetype === "summoner") {
      p(ctx, 4, -7, 2, 8, weapon, scale);
    }
  }
  p(ctx, -2, -8, 1, 1, "#151511", scale);
  p(ctx, 2, -8, 1, 1, "#151511", scale);
  ctx.restore();
}

function p(ctx, x, y, w, h, color, scale) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x * scale), Math.round(y * scale), Math.round(w * scale), Math.round(h * scale));
}

function drawPixelShadow(ctx, scale, w, h) {
  ctx.fillStyle = "rgba(17, 21, 13, 0.28)";
  ctx.fillRect(Math.round(-w * scale * 0.5), Math.round(5 * scale), Math.round(w * scale), Math.round(h * scale));
}

function cardinalFacing(entity) {
  const facing = entity.facing || { x: entity.vx || 0, y: entity.vy || 1 };
  if (Math.abs(facing.x) > Math.abs(facing.y)) {
    return { axis: "x", sign: facing.x >= 0 ? 1 : -1 };
  }
  return { axis: "y", sign: facing.y >= 0 ? 1 : -1 };
}

function mobColor(mob) {
  if (mob.isBoss) return "#a33f45";
  if (mob.archetype === "summoner") return "#744c8f";
  if (mob.archetype === "tank") return "#684f43";
  if (mob.archetype === "skitter") return "#c95771";
  if (mob.archetype === "ranged") return "#b66843";
  if (mob.archetype === "brute") return "#80413e";
  if (mob.archetype === "swift") return "#bd5a5d";
  return mob.tier >= 3 ? "#c5574b" : "#8f463c";
}

function hexToRgba(hex, alpha = 1) {
  const cleaned = String(hex || "").replace("#", "");
  if (cleaned.length !== 6) {
    return `rgba(114,216,232,${alpha})`;
  }
  const value = Number.parseInt(cleaned, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function barracksDefenderKind(level = 1) {
  if (level >= 5) return "mage";
  if (level >= 4) return "hound";
  if (level >= 3) return "builder";
  if (level >= 2) return "archer";
  return "guard";
}

function createBaseDefender({ x, y, kind, ownerId, color, barracksId, level }) {
  const profiles = {
    guard: { radius: 14, health: 72, damage: 13, speed: 150, range: 36, cooldown: 1.05 },
    archer: { radius: 13, health: 58, damage: 12, speed: 142, range: 300, cooldown: 1.25 },
    builder: { radius: 13, health: 62, damage: 7, speed: 132, range: 34, cooldown: 1.2 },
    hound: { radius: 12, health: 68, damage: 11, speed: 245, range: 34, cooldown: 0.72 },
    mage: { radius: 15, health: 64, damage: 14, speed: 118, range: 260, cooldown: 1.55 },
    ent: { radius: 26, health: 220, damage: 19, speed: 84, range: 46, cooldown: 1.2 },
    imp: { radius: 12, health: 82, damage: 10, speed: 154, range: 285, cooldown: 1.15 }
  };
  const profile = profiles[kind] || profiles.guard;
  const maxHealth = Math.round(profile.health * (1 + Math.max(0, level - 1) * 0.16));
  return {
    id: `defender-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    x,
    y,
    radius: profile.radius,
    kind,
    ownerId,
    color,
    barracksId,
    level,
    maxHealth,
    health: maxHealth,
    damage: Math.round(profile.damage * (1 + Math.max(0, level - 1) * 0.14)),
    speed: profile.speed,
    range: profile.range,
    cooldown: profile.cooldown,
    attackTimer: Math.random() * 0.6,
    alive: true,
    team: ownerId,
    defender: true,
    spawnPhase: Math.random() * Math.PI * 2,
    facing: { x: 0, y: 1 },
    takeDamage(amount) {
      const applied = Math.min(this.health, Math.max(0, amount));
      this.health -= applied;
      if (this.health <= 0) {
        this.health = 0;
        this.alive = false;
      }
      return applied;
    },
    get healthRatio() {
      return this.health / Math.max(1, this.maxHealth);
    }
  };
}

function clampPointToRange(origin, target, range) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length <= range) {
    return target;
  }
  const ratio = range / Math.max(1, length);
  return {
    x: origin.x + dx * ratio,
    y: origin.y + dy * ratio
  };
}

function pointLineDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0.0001) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq, 0, 1);
  const closestX = start.x + dx * t;
  const closestY = start.y + dy * t;
  return Math.hypot(point.x - closestX, point.y - closestY);
}

function resolveCircleRectCollision(entity, rectEntity) {
  const halfW = (rectEntity.width || rectEntity.radius * 2) / 2;
  const halfH = (rectEntity.height || rectEntity.radius * 2) / 2;
  const left = rectEntity.x - halfW;
  const right = rectEntity.x + halfW;
  const top = rectEntity.y - halfH;
  const bottom = rectEntity.y + halfH;
  const nearestX = clamp(entity.x, left, right);
  const nearestY = clamp(entity.y, top, bottom);
  const dx = entity.x - nearestX;
  const dy = entity.y - nearestY;
  const radius = entity.radius || 12;
  const distSq = dx * dx + dy * dy;
  if (distSq > radius * radius) {
    return false;
  }

  if (distSq > 0.0001) {
    const dist = Math.sqrt(distSq);
    const push = radius - dist + 0.5;
    const nx = dx / dist;
    const ny = dy / dist;
    entity.x += nx * push;
    entity.y += ny * push;
    if (Math.abs(nx) > Math.abs(ny)) {
      entity.vx = 0;
    } else {
      entity.vy = 0;
    }
    return true;
  }

  const distances = [
    { side: "left", value: Math.abs(entity.x - left) },
    { side: "right", value: Math.abs(right - entity.x) },
    { side: "top", value: Math.abs(entity.y - top) },
    { side: "bottom", value: Math.abs(bottom - entity.y) }
  ].sort((a, b) => a.value - b.value);
  const side = distances[0].side;
  if (side === "left") {
    entity.x = left - radius - 0.5;
    entity.vx = Math.min(0, entity.vx || 0);
  } else if (side === "right") {
    entity.x = right + radius + 0.5;
    entity.vx = Math.max(0, entity.vx || 0);
  } else if (side === "top") {
    entity.y = top - radius - 0.5;
    entity.vy = Math.min(0, entity.vy || 0);
  } else {
    entity.y = bottom + radius + 0.5;
    entity.vy = Math.max(0, entity.vy || 0);
  }
  return true;
}

function lineIntersectsBuildingRect(start, end, rectEntity) {
  const halfW = (rectEntity.width || rectEntity.radius * 2) / 2;
  const halfH = (rectEntity.height || rectEntity.radius * 2) / 2;
  const left = rectEntity.x - halfW;
  const right = rectEntity.x + halfW;
  const top = rectEntity.y - halfH;
  const bottom = rectEntity.y + halfH;
  if (pointInsideBounds(start, left, right, top, bottom)) {
    return true;
  }
  if (pointInsideBounds(end, left, right, top, bottom)) {
    return true;
  }
  return (
    segmentsIntersect(start, end, { x: left, y: top }, { x: right, y: top }) ||
    segmentsIntersect(start, end, { x: right, y: top }, { x: right, y: bottom }) ||
    segmentsIntersect(start, end, { x: right, y: bottom }, { x: left, y: bottom }) ||
    segmentsIntersect(start, end, { x: left, y: bottom }, { x: left, y: top })
  );
}

function pointInsideBounds(point, left, right, top, bottom) {
  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
}

function segmentsIntersect(a, b, c, d) {
  const ab = ccw(a, c, d) !== ccw(b, c, d);
  const cd = ccw(a, b, c) !== ccw(a, b, d);
  return ab && cd;
}

function ccw(a, b, c) {
  return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
}

function circleIntersectsBuilding(circle, building) {
  if (!building || (!Number.isFinite(building.width) && !Number.isFinite(building.height))) {
    return circleIntersects(circle, building);
  }
  const radius = circle.radius || 0;
  const halfW = (building.width || building.radius * 2 || 1) / 2;
  const halfH = (building.height || building.radius * 2 || 1) / 2;
  const nearestX = clamp(circle.x, building.x - halfW, building.x + halfW);
  const nearestY = clamp(circle.y, building.y - halfH, building.y + halfH);
  const dx = circle.x - nearestX;
  const dy = circle.y - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

function labelizeBuildingType(type = "structure") {
  return String(type)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pointInsideRect(point, rect, padding = 0) {
  return (
    point.x >= rect.x - padding &&
    point.x <= rect.x + rect.w + padding &&
    point.y >= rect.y - padding &&
    point.y <= rect.y + rect.h + padding
  );
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  const x = a.x + dx * t;
  const y = a.y + dy * t;
  return Math.hypot(point.x - x, point.y - y);
}

function withSeededRandom(seed, callback) {
  if (!seed) {
    return callback();
  }
  const previousRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    return callback();
  } finally {
    Math.random = previousRandom;
  }
}

function seededRandom(seed) {
  let state = 2166136261;
  const text = String(seed);
  for (let index = 0; index < text.length; index += 1) {
    state ^= text.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  state >>>= 0;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
}

function drawHealthBar(ctx, x, y, width, ratio, color) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.48)";
  ctx.fillRect(x - width / 2, y, width, 6);
  ctx.fillStyle = color;
  ctx.fillRect(x - width / 2, y, width * clamp(ratio, 0, 1), 6);
  ctx.strokeStyle = "rgba(246,242,232,0.22)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x - width / 2, y, width, 6);
  ctx.restore();
}

function riskColor(playerLevel = 1, targetLevel = 1) {
  const diff = targetLevel - playerLevel;
  if (diff >= (CONFIG.levelDisplay?.highRiskDelta || 3)) return "#e85b58";
  if (diff >= (CONFIG.levelDisplay?.dangerousDelta || 2)) return "#ffb26a";
  if (diff <= (CONFIG.levelDisplay?.safeDelta || -2)) return "#63d46b";
  return "#e7bd58";
}

function difficultyLabel(playerLevel = 1, targetLevel = 1) {
  const diff = targetLevel - playerLevel;
  if (diff >= 4) return "Boss";
  if (diff >= (CONFIG.levelDisplay?.highRiskDelta || 3)) return "High Risk";
  if (diff >= (CONFIG.levelDisplay?.dangerousDelta || 2)) return "Dangerous";
  if (diff <= (CONFIG.levelDisplay?.safeDelta || -2)) return "Easy";
  return "Moderate";
}

function drawLevelBadge(ctx, x, y, text, color = "#e7bd58") {
  if (!CONFIG.levelDisplay?.enabled) {
    return;
  }
  const fontSize = CONFIG.levelDisplay?.badgeFontSize || 13;
  const badgeHeight = CONFIG.levelDisplay?.badgeHeight || 24;
  const paddingX = CONFIG.levelDisplay?.badgePaddingX || 18;
  ctx.save();
  ctx.font = `950 ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = Math.max(40, ctx.measureText(text).width + paddingX);
  ctx.fillStyle = "rgba(13,19,14,0.88)";
  roundRect(ctx, x - width / 2, y - badgeHeight / 2, width, badgeHeight, 7);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0,0,0,0.58)";
  ctx.lineWidth = 3;
  ctx.strokeText(text, x, y + 1);
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
