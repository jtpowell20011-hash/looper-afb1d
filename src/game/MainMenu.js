// @ts-check
import { CHARACTER_CLASS_IDS, getCharacterClass, randomCharacterClassId } from "./CharacterClasses.js?v=1.8.59";
import { CONFIG } from "./config.js?v=1.8.59";
import { MultiplayerRoomClient } from "./MultiplayerRoomClient.js?v=1.8.59";

const DEFAULT_WORLD_OPTIONS = Object.freeze({
  bosses: true,
  towers: true,
  villages: true
});

const MAP_SIZE_DETAILS = Object.freeze({
  small: {
    detail: "Compact map for fast tests and short bot matches.",
    accent: "#66dd73"
  },
  medium: {
    detail: "Balanced space for roaming, objectives, and several AI rivals.",
    accent: "#f0c85d"
  },
  large: {
    detail: "Full Wildlands scale with all zones, routes, camps, and bosses.",
    accent: "#ef7d58"
  }
});

const LOADING_MESSAGES = [
  "Preparing the Wildlands...",
  "Scouting river crossings...",
  "Seeding camps and villages...",
  "Raising neutral towers...",
  "Assigning AI rivals...",
  "Synchronizing player load gates..."
];

const MATCH_LOAD_GATE_MS = 2200;

const HOW_TO_PLAY_STEPS = [
  ["Choose Your Hero", "Pick from nine classes. Each has different strengths, weaknesses, abilities, and scaling."],
  ["Explore the Map", "Search roads, villages, camps, towers, bridges, and objective zones for ways to grow stronger."],
  ["Fight and Level", "Defeat mobs and AI rivals for XP, currency, resources, and rare loot."],
  ["Place Your Core", "Use the opening phase to preview and plant a base layout before relocation locks."],
  ["Build and Upgrade", "Spend gold and build resources on core levels, towers, walls, generators, and defenses."],
  ["Control Objectives", "Bosses, shrines, towers, villages, and map control points create strategic pressure."],
  ["Defend and Raid", "Protect your own core while finding openings to break rival walls and attack enemy bases."],
  ["Win the Match", "Survive, defeat rivals, or control the full objective map as the prototype rules expand."]
];

const CONTROL_HELP = [
  ["WASD", "Move"],
  ["Mouse 1", "Basic attack or confirm preview"],
  ["Q / E / R", "Preview and cast abilities"],
  ["B", "Build menu and base preview"],
  ["Tab", "Inventory and loadout"],
  ["1 / 2", "Potion and ward hotbar"],
  ["Escape", "Settings or back"],
  ["F9", "Performance debug overlay"]
];

export class MainMenu {
  constructor({ settingsManager, onStart }) {
    this.settingsManager = settingsManager;
    this.onStart = onStart;
    this.roomClient = null;
    this.room = null;
    this.pollId = null;
    this.loadingTimer = null;
    this.started = false;
    this.shareOrigin = location.origin;
    this.inviteCode = inviteCodeFromLocation();
    this.inviteHandled = false;
    this.selectedMode = "solo";
    this.selectedCharacterId = "ranger";
    this.selectedMapSize = CONFIG.world.mapSize || "large";
    this.worldOptions = { ...DEFAULT_WORLD_OPTIONS };
    this.pendingWorldSeed = makeWorldSeed();
    this.pendingAIClassAssignments = [];
    this.galleryMode = false;
    this.futureLobbyState = {
      players: [
        {
          displayName: "Basebound Scout",
          selectedCharacter: this.selectedCharacterId,
          isReady: false,
          connectionStatus: "local"
        }
      ],
      settings: {
        mapSize: this.selectedMapSize,
        worldOptions: { ...this.worldOptions }
      },
      // TODO(multiplayer): hydrate ready-state from the authoritative room service.
      allReady: false
    };

    this.els = {
      overlay: byId("mainMenu"),
      breadcrumb: byId("menuBreadcrumb"),
      screenName: byId("menuScreenName"),
      menuStatusText: byId("menuStatusText"),
      playButton: byId("menuPlayButton"),
      galleryButton: byId("menuGalleryButton"),
      howToPlayButton: byId("menuHowToPlayButton"),
      modeBackButton: byId("modeBackButton"),
      setupBackButton: byId("setupBackButton"),
      characterBackButton: byId("characterBackButton"),
      readyBackButton: byId("readyBackButton"),
      howToPlayBackButton: byId("howToPlayBackButton"),
      setupContinueButton: byId("setupContinueButton"),
      characterReadyButton: byId("characterReadyButton"),
      soloModeButton: byId("soloModeButton"),
      multiplayerModeButton: byId("multiplayerModeButton"),
      playerNameInput: byId("playerNameInput"),
      aiCountSelect: byId("aiCountSelect"),
      aiCountButtonList: byId("aiCountButtonList"),
      selectedAiCountText: byId("selectedAiCountText"),
      mapSizeSelect: byId("mapSizeSelect"),
      mapSizeCardList: byId("mapSizeCardList"),
      selectedMapSizeText: byId("selectedMapSizeText"),
      worldRuleSummaryText: byId("worldRuleSummaryText"),
      toggleBossesButton: byId("toggleBossesButton"),
      toggleTowersButton: byId("toggleTowersButton"),
      toggleVillagesButton: byId("toggleVillagesButton"),
      createButton: byId("createRoomButton"),
      joinButton: byId("joinRoomButton"),
      roomCodeInput: byId("roomCodeInput"),
      soloButton: byId("soloButton"),
      startButton: byId("startRoomButton"),
      readyButton: byId("readyButton"),
      roomPanel: byId("roomPanel"),
      roomCodeText: byId("roomCodeText"),
      roomTransportText: byId("roomTransportText"),
      roomStatusText: byId("roomStatusText"),
      roomPlayerList: byId("roomPlayerList"),
      shareUrlText: byId("shareUrlText"),
      networkHintText: byId("networkHintText"),
      refreshNetworkButton: byId("refreshNetworkButton"),
      inviteUrlText: byId("inviteUrlText"),
      copyInviteButton: byId("copyInviteButton"),
      characterScreenTitle: byId("characterScreenTitle"),
      characterScreenSubtitle: byId("characterScreenSubtitle"),
      characterCardList: byId("characterCardList"),
      selectedCharacterPill: byId("selectedCharacterPill"),
      characterNameText: byId("characterNameText"),
      characterRoleText: byId("characterRoleText"),
      characterDifficultyText: byId("characterDifficultyText"),
      characterSummaryText: byId("characterSummaryText"),
      characterTagList: byId("characterTagList"),
      characterStatBars: byId("characterStatBars"),
      characterStrengthList: byId("characterStrengthList"),
      characterWeaknessList: byId("characterWeaknessList"),
      characterAbilityList: byId("characterAbilityList"),
      readyHeroText: byId("readyHeroText"),
      readyHeroSummary: byId("readyHeroSummary"),
      readyMapText: byId("readyMapText"),
      readySettingList: byId("readySettingList"),
      matchSetupPanel: byId("matchSetupPanel"),
      matchSetupText: byId("matchSetupText"),
      matchSetupRoster: byId("matchSetupRoster"),
      loadingMessageText: byId("loadingMessageText"),
      loadingHeroSummary: byId("loadingHeroSummary"),
      loadingProgressBar: byId("loadingProgressBar"),
      loadingProgressText: byId("loadingProgressText"),
      howToPlayList: byId("howToPlayList"),
      controlsHelpList: byId("controlsHelpList")
    };
    this.screenEls = {
      main: byId("menuScreenMain"),
      mode: byId("menuScreenMode"),
      setup: byId("menuScreenSetup"),
      character: byId("menuScreenCharacter"),
      ready: byId("menuScreenReady"),
      loading: byId("menuScreenLoading"),
      howToPlay: byId("menuScreenHowToPlay")
    };

    this.bind();
    this.renderSetup();
    this.renderCharacterSelection();
    this.renderHowToPlay();
    this.renderIdle();
    this.loadNetworkInfo();
    this.showScreen("main");
    this.handleInviteUrl();
  }

  bind() {
    this.els.playButton.addEventListener("click", () => this.showScreen("mode"));
    this.els.galleryButton.addEventListener("click", () => this.showCharacterScreen(true));
    this.els.howToPlayButton.addEventListener("click", () => this.showScreen("howToPlay"));
    this.els.modeBackButton.addEventListener("click", () => this.showScreen("main"));
    this.els.setupBackButton.addEventListener("click", () => this.showScreen("mode"));
    this.els.characterBackButton.addEventListener("click", () => this.showScreen(this.galleryMode ? "main" : "setup"));
    this.els.readyBackButton.addEventListener("click", () => this.showCharacterScreen(false));
    this.els.howToPlayBackButton.addEventListener("click", () => this.showScreen("main"));
    this.els.setupContinueButton.addEventListener("click", () => this.showCharacterScreen(false));
    this.els.characterReadyButton.addEventListener("click", () => this.onCharacterPrimaryAction());
    this.els.soloModeButton.addEventListener("click", () => {
      this.setMode("solo");
      this.showScreen("setup");
    });
    this.els.multiplayerModeButton.addEventListener("click", () => {
      this.setMode("multiplayer");
      this.showScreen("setup");
      this.loadNetworkInfo();
    });
    this.els.characterCardList.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-character-id]");
      if (!button) {
        return;
      }
      this.selectCharacter(button.dataset.characterId);
    });
    this.els.mapSizeCardList.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-map-size]");
      if (!button) {
        return;
      }
      this.setMapSize(button.dataset.mapSize);
    });
    this.els.aiCountButtonList.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-ai-count]");
      if (!button) {
        return;
      }
      this.setAiCount(Number(button.dataset.aiCount || 0));
    });
    this.els.mapSizeSelect.addEventListener("change", () => this.setMapSize(this.els.mapSizeSelect.value));
    this.els.aiCountSelect.addEventListener("change", () => this.setAiCount(Number(this.els.aiCountSelect.value || 0)));
    for (const button of [this.els.toggleBossesButton, this.els.toggleTowersButton, this.els.toggleVillagesButton]) {
      button.addEventListener("click", () => this.toggleWorldOption(button.dataset.worldOption));
    }
    this.els.createButton.addEventListener("click", () => this.createRoom());
    this.els.joinButton.addEventListener("click", () => this.joinRoom());
    this.els.startButton.addEventListener("click", () => this.startRoom());
    this.els.readyButton?.addEventListener("click", () => this.toggleReady());
    this.els.soloButton.addEventListener("click", () => this.startSolo());
    this.els.roomCodeInput.addEventListener("input", () => {
      this.els.roomCodeInput.value = normalizeRoomCode(this.els.roomCodeInput.value);
    });
    this.els.refreshNetworkButton.addEventListener("click", () => this.loadNetworkInfo());
    this.els.copyInviteButton.addEventListener("click", () => this.copyInviteLink());
  }

  showScreen(screen) {
    this.clearLoadingTimer();
    for (const [id, element] of Object.entries(this.screenEls)) {
      element.hidden = id !== screen;
      element.classList.toggle("is-active", id === screen);
    }
    const labels = {
      main: "",
      mode: "Mode Select",
      setup: "Match Setup",
      character: this.galleryMode ? "Character Gallery" : "Character Select",
      ready: "Ready",
      loading: "Loading",
      howToPlay: "How to Play"
    };
    this.els.breadcrumb.hidden = screen === "main";
    this.els.screenName.textContent = labels[screen] || "Menu";
    if (screen === "main") {
      this.galleryMode = false;
      this.setStatus("Choose a mode to enter the Wildlands.");
    } else if (screen === "setup") {
      this.renderSetup();
      this.setStatus(
        this.selectedMode === "multiplayer"
          ? "Create a room, share the invite link, then choose your hero before the host starts."
          : "Configure your solo bot match."
      );
    } else if (screen === "howToPlay") {
      this.setStatus("Review the core loop, controls, and objectives.");
    }
  }

  showCharacterScreen(galleryMode) {
    this.galleryMode = Boolean(galleryMode);
    this.els.characterScreenTitle.textContent = this.galleryMode ? "Character Gallery" : "Choose Your Hero";
    this.els.characterScreenSubtitle.textContent = this.galleryMode
      ? "Review the current roster, ability kits, stat profiles, and role identities."
      : "Pick a class whose strengths match the match you want to play.";
    this.els.characterReadyButton.hidden = this.galleryMode;
    this.renderCharacterSelection();
    this.updateCharacterPrimaryButton(this.room);
    this.showScreen("character");
  }

  setMapSize(mapSizeId) {
    this.selectedMapSize = CONFIG.mapSizes?.[mapSizeId] ? mapSizeId : "large";
    this.els.mapSizeSelect.value = this.selectedMapSize;
    this.futureLobbyState.settings.mapSize = this.selectedMapSize;
    this.renderSetup();
    this.setStatus(`${CONFIG.mapSizes[this.selectedMapSize].label} map selected.`);
  }

  setAiCount(count) {
    const value = Math.max(0, Math.min(7, Number(count || 0)));
    this.els.aiCountSelect.value = String(value);
    this.renderSetup();
    this.setStatus(`${value} AI rival${value === 1 ? "" : "s"} selected.`);
  }

  toggleWorldOption(option) {
    if (!Object.prototype.hasOwnProperty.call(this.worldOptions, option)) {
      return;
    }
    this.worldOptions[option] = !this.worldOptions[option];
    this.futureLobbyState.settings.worldOptions = { ...this.worldOptions };
    this.renderSetup();
    this.setStatus(`${labelForWorldOption(option)} ${this.worldOptions[option] ? "enabled" : "disabled"} for the next match.`);
  }

  setMode(mode) {
    this.selectedMode = mode === "multiplayer" ? "multiplayer" : "solo";
    this.els.soloModeButton.classList.toggle("is-active", this.selectedMode === "solo");
    this.els.multiplayerModeButton.classList.toggle("is-active", this.selectedMode === "multiplayer");
    if (this.selectedMode === "multiplayer") {
      this.setAiCount(0);
      this.setStatus("Online room testing is enabled. Create a room or paste a room code to join.");
    } else {
      this.setStatus("Choose a character, pick AI opponents, then ready up.");
    }
  }

  selectCharacter(characterId) {
    this.selectedCharacterId = getCharacterClass(characterId).id;
    this.futureLobbyState.players[0] = {
      displayName: this.playerName,
      selectedCharacter: this.selectedCharacterId,
      isReady: false,
      connectionStatus: "local"
    };
    this.futureLobbyState.settings.mapSize = this.selectedMapSize;
    this.futureLobbyState.settings.worldOptions = { ...this.worldOptions };
    this.renderCharacterSelection();
    this.updateCharacterPrimaryButton(this.room);
  }

  showReady() {
    this.pendingAIClassAssignments = Array.from({ length: this.aiCount }, () => randomCharacterClassId());
    this.futureLobbyState.players = [
      {
        displayName: this.playerName,
        selectedCharacter: this.selectedCharacterId,
        isReady: true,
        connectionStatus: "local"
      },
      ...this.pendingAIClassAssignments.map((characterId, index) => ({
        displayName: `AI Rival ${index + 1}`,
        selectedCharacter: characterId,
        isReady: true,
        connectionStatus: "bot"
      }))
    ];
    this.futureLobbyState.settings.mapSize = this.selectedMapSize;
    this.futureLobbyState.settings.worldOptions = { ...this.worldOptions };
    this.futureLobbyState.allReady = true;
    this.renderReady();
    this.showScreen("ready");
    this.setStatus("Ready check complete. Start when you are set.");
  }

  startSolo() {
    if (!this.pendingAIClassAssignments.length && this.aiCount > 0) {
      this.pendingAIClassAssignments = Array.from({ length: this.aiCount }, () => randomCharacterClassId());
    }
    this.showLoadingThenStart();
  }

  showLoadingThenStart() {
    this.showScreen("loading");
    const character = getCharacterClass(this.selectedCharacterId);
    const mapSize = CONFIG.mapSizes[this.selectedMapSize]?.label || "Large";
    this.els.loadingMessageText.textContent = LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)];
    this.els.loadingHeroSummary.innerHTML = `<span class="character-token" style="background:${character.color}"></span><strong>${escapeHtml(
      character.label
    )}</strong><em>${escapeHtml(character.role)} / ${escapeHtml(mapSize)} Map</em>`;
    this.els.loadingProgressBar.style.width = "0%";
    this.els.loadingProgressText.textContent = "0%";
    const startTime = performance.now();
    this.loadingTimer = window.setInterval(() => {
      const elapsed = performance.now() - startTime;
      const rawProgress = Math.min(1, elapsed / MATCH_LOAD_GATE_MS);
      const progress = Math.min(100, Math.round(100 * (1 - Math.pow(1 - rawProgress, 1.8))));
      this.els.loadingProgressBar.style.width = `${progress}%`;
      this.els.loadingProgressText.textContent = `${progress}%`;
      if (progress >= 100) {
        this.clearLoadingTimer();
        window.setTimeout(() => this.startConfiguredMatch(), 220);
      }
    }, 80);
  }

  startConfiguredMatch() {
    this.stopPolling();
    this.els.overlay.hidden = true;
    this.els.roomPanel.hidden = true;
    this.onStart({
      mode: "solo",
      displayName: this.playerName,
      keybindings: this.settingsManager.keybindings,
      aiCount: this.aiCount,
      mapSize: this.selectedMapSize,
      characterId: this.selectedCharacterId,
      aiClassAssignments: this.pendingAIClassAssignments,
      worldOptions: { ...this.worldOptions }
    });
  }

  show() {
    this.started = false;
    this.clearLoadingTimer();
    this.roomClient?.subscribe?.(null);
    this.roomClient = null;
    this.room = null;
    this.pendingAIClassAssignments = [];
    this.stopPolling();
    this.els.overlay.hidden = false;
    this.renderIdle();
    this.showScreen("main");
  }

  async createRoom() {
    try {
      this.setBusy(true, "Creating room...");
      const client = new MultiplayerRoomClient(this.playerName);
      const room = await client.createRoom(this.roomSettingsPayload());
      this.setRoom(client, room);
      this.showCharacterScreen(false);
      this.setStatus(
        client.isRemote
          ? `Room ${room.code} created. Copy the invite link, pick your hero, and Start when everyone is ready.`
          : `Room ${room.code} created in local-tab mode. Start or deploy the Node server for internet invite links.`
      );
    } catch (error) {
      this.setStatus(error.message || "Could not create room.");
    } finally {
      this.setBusy(false);
    }
  }

  async joinRoom() {
    const code = normalizeRoomCode(this.els.roomCodeInput.value);
    if (!code) {
      this.setStatus("Enter a room code to join.");
      return;
    }
    try {
      this.setBusy(true, "Joining room...");
      const client = new MultiplayerRoomClient(this.playerName);
      const room = await client.joinRoom(code);
      this.setRoom(client, room);
      this.showCharacterScreen(false);
      this.setStatus(`Joined ${room.code}. Pick your hero and Ready Up for the host.`);
    } catch (error) {
      this.setStatus(error.message || "Could not join room.");
    } finally {
      this.setBusy(false);
    }
  }

  async handleInviteUrl() {
    if (!this.inviteCode || this.inviteHandled) {
      return;
    }
    this.inviteHandled = true;
    this.els.roomCodeInput.value = this.inviteCode;
    this.setMode("multiplayer");
    this.showScreen("setup");
    this.setStatus(`Invite ${this.inviteCode} detected. Joining the room now.`);
    window.setTimeout(() => this.joinRoom(), 180);
  }

  async startRoom() {
    if (!this.roomClient?.isHost) {
      this.setStatus("Only the host can start the room.");
      return;
    }
    try {
      this.setBusy(true, "Starting room...");
      const room = await this.roomClient.startRoom(this.roomSettingsPayload());
      this.setRoom(this.roomClient, room);
      this.maybeStart(room);
    } catch (error) {
      this.setStatus(error.message || "Could not start room.");
    } finally {
      this.setBusy(false);
    }
  }

  async toggleReady() {
    if (!this.roomClient || this.roomClient.isHost) {
      return;
    }
    this.localReady = !this.localReady;
    this.renderReadyButton();
    try {
      const room = await this.roomClient.setReady(this.localReady);
      if (room) {
        this.room = room;
        this.renderRoom(room);
      }
    } catch (error) {
      this.localReady = !this.localReady;
      this.renderReadyButton();
      this.setStatus(error.message || "Could not update ready state.");
    }
  }

  renderReadyButton() {
    const btn = this.els.readyButton;
    if (!btn) {
      return;
    }
    const inRoom = Boolean(this.roomClient) && !this.started;
    const isHost = Boolean(this.roomClient?.isHost);
    btn.hidden = !inRoom || isHost;
    btn.textContent = this.localReady ? "Ready ✓ (tap to cancel)" : "Ready Up";
    btn.classList.toggle("is-ready", Boolean(this.localReady));
    this.updateCharacterPrimaryButton(this.room);
  }

  isInMultiplayerRoom() {
    return Boolean(this.roomClient && this.roomClient.roomCode);
  }

  // The character screen's primary button doubles as the multiplayer lobby
  // control so the host can Start (and guests can Ready) without leaving the
  // hero picker. In solo it stays the normal "Ready Up" -> review flow.
  onCharacterPrimaryAction() {
    if (!this.isInMultiplayerRoom()) {
      this.showReady();
      return;
    }
    if (this.roomClient?.isHost) {
      this.startRoom();
    } else {
      this.toggleReady();
    }
  }

  updateCharacterPrimaryButton(room = this.room) {
    const btn = this.els.characterReadyButton;
    if (!btn || this.galleryMode) {
      return;
    }
    btn.hidden = false;
    btn.classList.remove("is-ready");
    if (!this.isInMultiplayerRoom()) {
      btn.disabled = false;
      btn.textContent = "Ready Up";
      return;
    }
    const isHost = Boolean(this.roomClient?.isHost);
    if (isHost) {
      const players = room?.players || [];
      const nonHost = players.filter((player) => player.id !== room?.hostId);
      const everyoneReady = nonHost.length > 0 && nonHost.every((player) => player.ready);
      const soloRoom = players.length < 2;
      const canStart = Boolean(room) && room.status !== "started" && (soloRoom || everyoneReady);
      btn.disabled = !canStart;
      btn.textContent = soloRoom ? "Start Solo Room" : everyoneReady ? "Start Game" : "Waiting for players to ready up…";
    } else {
      btn.disabled = false;
      btn.textContent = this.localReady ? "Ready ✓ (tap to cancel)" : "Ready Up";
      btn.classList.toggle("is-ready", Boolean(this.localReady));
    }
  }

  setRoom(client, room) {
    this.roomClient = client;
    this.localReady = false;
    this.room = room;
    this.applyRoomSettings(room);
    this.renderRoom(room);
    this.roomClient.subscribe?.((nextRoom) => {
      this.room = nextRoom;
      this.applyRoomSettings(nextRoom);
      this.renderRoom(nextRoom);
      this.maybeStart(nextRoom);
    });
    this.startPolling();
  }

  applyRoomSettings(room) {
    if (!room?.settings) {
      return;
    }
    if (CONFIG.mapSizes?.[room.settings.mapSize]) {
      this.selectedMapSize = room.settings.mapSize;
      this.els.mapSizeSelect.value = this.selectedMapSize;
    }
    if (room.settings.worldOptions) {
      this.worldOptions = { ...DEFAULT_WORLD_OPTIONS, ...room.settings.worldOptions };
    }
    if (room.settings.worldSeed) {
      this.pendingWorldSeed = room.settings.worldSeed;
    }
    this.futureLobbyState.settings = {
      mapSize: this.selectedMapSize,
      worldOptions: { ...this.worldOptions },
      worldSeed: this.pendingWorldSeed
    };
  }

  startPolling() {
    this.stopPolling();
    this.pollId = window.setInterval(() => this.pollRoom(), 850);
  }

  stopPolling() {
    if (this.pollId) {
      window.clearInterval(this.pollId);
      this.pollId = null;
    }
  }

  clearLoadingTimer() {
    if (this.loadingTimer) {
      window.clearInterval(this.loadingTimer);
      this.loadingTimer = null;
    }
  }

  async pollRoom() {
    if (!this.roomClient || this.started) {
      return;
    }
    try {
      const room = await this.roomClient.getRoom();
      this.room = room;
      this.applyRoomSettings(room);
      this.renderRoom(room);
      this.maybeStart(room);
    } catch (error) {
      this.setStatus(error.message || "Room disconnected.");
    }
  }

  maybeStart(room) {
    if (!room || room.status !== "started" || this.started) {
      return;
    }
    this.started = true;
    this.stopPolling();
    this.roomClient.subscribe?.(null);
    this.els.overlay.hidden = true;
    this.onStart({
      mode: "multiplayer",
      roomClient: this.roomClient,
      room,
      displayName: this.playerName,
      keybindings: this.settingsManager.keybindings,
      mapSize: room.settings?.mapSize || this.selectedMapSize,
      characterId: this.selectedCharacterId,
      worldOptions: room.settings?.worldOptions || this.worldOptions,
      worldSeed: room.settings?.worldSeed || this.pendingWorldSeed,
      isHost: this.roomClient.isHost,
      startAt: room.startAt || 0
    });
  }

  renderIdle() {
    this.els.roomPanel.hidden = true;
    this.els.inviteUrlText.textContent = "Create a room to generate a link.";
    this.els.copyInviteButton.disabled = true;
    this.setStatus("Choose a mode to enter the Wildlands.");
  }

  renderSetup() {
    const mapEntries = Object.entries(CONFIG.mapSizes || {});
    this.els.mapSizeCardList.innerHTML = mapEntries
      .map(([id, size]) => {
        const meta = MAP_SIZE_DETAILS[id] || MAP_SIZE_DETAILS.large;
        const active = id === this.selectedMapSize;
        return `<button type="button" class="map-size-card ${active ? "is-active" : ""}" data-map-size="${escapeHtml(id)}" style="--map-accent:${meta.accent}">
          <strong>${escapeHtml(size.label || id)}</strong>
          <span>${escapeHtml(`${shortNumber(size.width)} x ${shortNumber(size.height)}`)}</span>
          <em>${escapeHtml(meta.detail)}</em>
        </button>`;
      })
      .join("");
    const selectedSize = CONFIG.mapSizes[this.selectedMapSize] || CONFIG.mapSizes.large;
    this.els.selectedMapSizeText.textContent = selectedSize?.label || "Large";
    this.els.mapSizeSelect.value = this.selectedMapSize;

    this.els.aiCountButtonList.innerHTML = Array.from({ length: 8 }, (_, count) => {
      const active = count === this.aiCount;
      return `<button type="button" class="${active ? "is-active" : ""}" data-ai-count="${count}">${count}</button>`;
    }).join("");
    this.els.selectedAiCountText.textContent = `${this.aiCount} AI`;
    this.els.aiCountSelect.value = String(this.aiCount);
    this.renderWorldOptions();
  }

  renderWorldOptions() {
    const activeCount = Object.values(this.worldOptions).filter(Boolean).length;
    this.els.worldRuleSummaryText.textContent = activeCount === 3 ? "All On" : `${activeCount} / 3 On`;
    for (const button of [this.els.toggleBossesButton, this.els.toggleTowersButton, this.els.toggleVillagesButton]) {
      const option = button.dataset.worldOption;
      const enabled = Boolean(this.worldOptions[option]);
      button.classList.toggle("is-active", enabled);
      button.textContent = `${enabled ? "On" : "Off"} - ${labelForWorldOption(option)}`;
    }
  }

  renderCharacterSelection() {
    const selected = getCharacterClass(this.selectedCharacterId);
    this.els.selectedCharacterPill.textContent = selected.label;
    this.els.characterCardList.innerHTML = CHARACTER_CLASS_IDS.map((id) => {
      const character = getCharacterClass(id);
      const roleTag = shortRoleTag(character);
      return `<button type="button" class="character-card ${id === selected.id ? "is-active" : ""}" data-character-id="${id}">
        <span class="character-token" style="background:${character.color}"></span>
        <span><strong>${escapeHtml(character.label)}</strong><span class="character-role-tag">${escapeHtml(roleTag)}</span></span>
      </button>`;
    }).join("");
    this.els.characterNameText.textContent = selected.label;
    this.els.characterRoleText.textContent = selected.role;
    this.els.characterDifficultyText.textContent = `Difficulty ${selected.difficulty}/5`;
    this.els.characterSummaryText.textContent = selected.summary;
    this.els.characterTagList.innerHTML = selected.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
    this.els.characterStrengthList.innerHTML = selected.strengths.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    this.els.characterWeaknessList.innerHTML = selected.weaknesses.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    this.els.characterStatBars.innerHTML = Object.entries(selected.bars)
      .map(([label, value]) => `<div class="character-stat"><span>${escapeHtml(label)}</span><i><b style="width:${Math.min(100, value * 20)}%"></b></i></div>`)
      .join("");
    this.els.characterAbilityList.innerHTML = Object.values(selected.abilities)
      .map(
        (ability) =>
          `<div class="character-ability"><strong>${escapeHtml(ability.input)}: ${escapeHtml(ability.label)}</strong><span>${escapeHtml(
            ability.type
          )} / ${ability.cooldown}s cd / ${ability.range || ability.radius || ability.wallLength || "self"} range</span><em>${escapeHtml(ability.description)}</em></div>`
      )
      .join("");
  }

  renderReady() {
    const character = getCharacterClass(this.selectedCharacterId);
    const mapSize = CONFIG.mapSizes[this.selectedMapSize]?.label || "Large";
    this.els.readyHeroText.textContent = character.label;
    this.els.readyHeroSummary.innerHTML = `<span class="character-token" style="background:${character.color}"></span>
      <div><strong>${escapeHtml(character.label)}</strong><em>${escapeHtml(character.role)}</em><small>Difficulty ${character.difficulty}/5</small></div>`;
    this.els.readyMapText.textContent = `${mapSize} Map`;
    this.els.readySettingList.innerHTML = [
      ["Map Size", `${mapSize}`],
      ["AI Rivals", String(this.aiCount)],
      ["Boss Objectives", this.worldOptions.bosses ? "On" : "Off"],
      ["Neutral Towers", this.worldOptions.towers ? "On" : "Off"],
      ["Villages", this.worldOptions.villages ? "On" : "Off"]
    ]
      .map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
      .join("");
    this.showMatchSetup(this.pendingAIClassAssignments);
  }

  showMatchSetup(aiClassAssignments) {
    const character = getCharacterClass(this.selectedCharacterId);
    const mapSize = CONFIG.mapSizes[this.selectedMapSize]?.label || "Large";
    this.els.matchSetupText.textContent = `${character.label} selected. ${this.aiCount} AI rival${this.aiCount === 1 ? "" : "s"}. ${mapSize} map.`;
    this.els.matchSetupRoster.innerHTML = [
      `<span>You: ${escapeHtml(character.label)}</span>`,
      ...aiClassAssignments.map((id, index) => `<span>AI ${index + 1}: ${escapeHtml(getCharacterClass(id).label)}</span>`)
    ].join("");
  }

  renderHowToPlay() {
    this.els.howToPlayList.innerHTML = HOW_TO_PLAY_STEPS.map(
      ([title, body]) => `<article><strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span></article>`
    ).join("");
    this.els.controlsHelpList.innerHTML = CONTROL_HELP.map(
      ([key, action]) => `<div><kbd>${escapeHtml(key)}</kbd><span>${escapeHtml(action)}</span></div>`
    ).join("");
  }

  renderRoom(room) {
    if (!room) {
      return;
    }
    this.els.roomPanel.hidden = false;
    this.els.roomCodeText.textContent = room.code;
    this.els.roomTransportText.textContent = this.roomClient?.transportLabel || "Local";
    const maxPlayers = room.maxPlayers || room.settings?.maxPlayers || 8;
    const me = room.players.find((player) => player.id === this.roomClient?.playerId);
    if (me) {
      this.localReady = Boolean(me.ready);
    }
    const nonHostPlayers = room.players.filter((player) => player.id !== room.hostId);
    const everyoneReady = nonHostPlayers.length > 0 && nonHostPlayers.every((player) => player.ready);
    const soloRoom = room.players.length < 2;
    this.els.roomStatusText.textContent = room.status === "started" ? "Starting" : `Lobby ${room.players.length}/${maxPlayers}`;
    this.els.inviteUrlText.textContent = this.roomClient?.isRemote
      ? this.getInviteUrl(room.code)
      : "Local-tab room only. Use the Node server or a public deployment for shareable links.";
    this.els.copyInviteButton.disabled = !this.roomClient?.isHost || !this.roomClient?.isRemote;
    this.els.startButton.hidden = !this.roomClient?.isHost;
    const canStart = room.status !== "started" && (soloRoom || everyoneReady);
    this.els.startButton.disabled = !canStart;
    this.els.startButton.textContent = soloRoom
      ? "Start Solo Room"
      : everyoneReady
        ? "Start Game"
        : "Waiting for players to ready up…";
    this.els.roomPlayerList.innerHTML = room.players
      .map((player) => {
        const isHost = player.id === room.hostId;
        const tag = isHost ? "Host" : player.ready ? "Ready" : "Not ready";
        const cls = isHost ? "is-host" : player.ready ? "is-ready" : "is-waiting";
        return `<div class="room-player ${cls}"><span>${escapeHtml(player.name || "Player")}</span><strong>${tag}</strong></div>`;
      })
      .join("");
    this.renderReadyButton();
  }

  async loadNetworkInfo() {
    this.els.shareUrlText.textContent = "Checking...";
    this.els.networkHintText.textContent = "Checking whether this page can host multiplayer rooms.";
    try {
      const response = await fetch("/api/network", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Network helper unavailable.");
      }
      const info = await response.json();
      const isLocal = info.isLocalOnlyUrl || ["localhost", "127.0.0.1"].includes(location.hostname);
      const bestUrl = isLocal ? info.lanUrls?.[0] || info.origin : info.origin;
      this.shareOrigin = bestUrl || location.origin;
      this.els.shareUrlText.textContent = bestUrl || location.origin;
      this.els.networkHintText.textContent = isLocal
        ? "Localhost links only work on this computer. Deploy this Node app to share rooms over the internet."
        : `Shareable room service online. Supports up to ${info.multiplayer?.maxPlayers || 8} players per room.`;
      this.els.createButton.disabled = false;
      this.els.joinButton.disabled = false;
      this.els.roomCodeInput.disabled = false;
    } catch {
      this.shareOrigin = location.origin;
      this.els.shareUrlText.textContent = location.href;
      this.els.networkHintText.textContent =
        "This preview is static/local only. Start the multiplayer server or deploy the Node app before sharing rooms.";
      this.els.createButton.disabled = false;
      this.els.joinButton.disabled = false;
      this.els.roomCodeInput.disabled = false;
    }
    if (this.room?.code && this.roomClient?.isRemote) {
      this.els.inviteUrlText.textContent = this.getInviteUrl(this.room.code);
    }
  }

  renderMultiplayerPaused() {
    this.loadNetworkInfo();
  }

  showPausedMultiplayerMessage() {
    this.setMode("multiplayer");
    this.showScreen("setup");
  }

  getInviteUrl(code) {
    const url = new URL(this.shareOrigin || location.origin);
    url.searchParams.set("room", normalizeRoomCode(code));
    return url.toString();
  }

  async copyInviteLink() {
    if (!this.room?.code) {
      this.setStatus("Create a room before copying an invite link.");
      return;
    }
    if (!this.roomClient?.isRemote) {
      this.setStatus("This is a local-tab room. Start or deploy the Node server to create internet invite links.");
      return;
    }
    const inviteUrl = this.getInviteUrl(this.room.code);
    try {
      await navigator.clipboard.writeText(inviteUrl);
      this.setStatus("Invite link copied. Anyone opening it on the public hosted site can join this room.");
    } catch {
      this.setStatus(`Copy blocked by the browser. Share this link: ${inviteUrl}`);
    }
  }

  setBusy(busy, message = null) {
    this.els.createButton.disabled = busy;
    this.els.joinButton.disabled = busy;
    this.els.roomCodeInput.disabled = busy;
    this.els.soloButton.disabled = busy;
    this.els.startButton.disabled = busy || this.room?.status === "started";
    if (message) {
      this.setStatus(message);
    }
  }

  setStatus(message) {
    this.els.menuStatusText.textContent = message;
  }

  get playerName() {
    return this.els.playerNameInput.value.trim() || "Basebound Scout";
  }

  get aiCount() {
    return Math.max(0, Math.min(7, Number(this.els.aiCountSelect.value || 0)));
  }

  roomSettingsPayload() {
    if (!this.pendingWorldSeed) {
      this.pendingWorldSeed = makeWorldSeed();
    }
    return {
      mapSize: this.selectedMapSize,
      worldSeed: this.room?.settings?.worldSeed || this.pendingWorldSeed,
      worldOptions: { ...this.worldOptions },
      maxPlayers: 8
    };
  }
}

function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing menu element #${id}`);
  return element;
}

function normalizeRoomCode(code) {
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function inviteCodeFromLocation() {
  const params = new URLSearchParams(location.search);
  return normalizeRoomCode(params.get("room") || params.get("join") || "");
}

function makeWorldSeed() {
  return `bb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function labelForWorldOption(option) {
  const labels = {
    bosses: "Boss Objectives",
    towers: "Neutral Towers",
    villages: "Villages"
  };
  return labels[option] || option;
}

function shortNumber(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function shortRoleTag(character) {
  const tags = character?.tags || [];
  const role = String(character?.role || "").toLowerCase();
  const preferred = [
    ["assassin", "Assassin"],
    ["tank", "Tank"],
    ["builder", "Utility"],
    ["engineer", "Utility"],
    ["support", "Support"],
    ["control", "Control"],
    ["mage", "Mage"],
    ["arcanist", "Mage"],
    ["bruiser", "Bruiser"],
    ["caster", "Caster"],
    ["ranged", "Ranged"],
    ["ranger", "Ranged"],
    ["melee", "Melee"]
  ];
  for (const [needle, label] of preferred) {
    if (role.includes(needle) || tags.some((tag) => String(tag).toLowerCase().includes(needle))) {
      return label;
    }
  }
  return tags[0] || "Hero";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return entities[char];
  });
}







