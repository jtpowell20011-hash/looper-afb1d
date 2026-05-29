// @ts-check
import { CONFIG } from "./config.js?v=1.8.50";
import { labelForKeyCode } from "./InputBindings.js?v=1.8.50";
import { formatTime } from "./math.js?v=1.8.50";

export class UIManager {
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.activeTab = "loadout";
    this.draggedLootId = null;
    this.upgradeFilter = null;
    this.quickBuildingId = null;
    this.selectedSlotId = CONFIG.loot.equipmentSlots[0]?.id || null;
    this.els = {
      lootPanelButton: byId("lootPanelButton"),
      shopPanelButton: byId("shopPanelButton"),
      basePanelButton: byId("basePanelButton"),
      cameraLockButton: byId("cameraLockButton"),
      drawerToggleButton: byId("drawerToggleButton"),
      drawerCloseButton: byId("drawerCloseButton"),
      sideDrawer: byId("sideDrawer"),
      drawerEyebrow: byId("drawerEyebrow"),
      drawerTitle: byId("drawerTitle"),
      healthText: byId("healthText"),
      healthBar: byId("healthBar"),
      shieldLine: byId("shieldLine"),
      shieldText: byId("shieldText"),
      shieldBar: byId("shieldBar"),
      xpText: byId("xpText"),
      xpBar: byId("xpBar"),
      classText: byId("classText"),
      levelText: byId("levelText"),
      currencyText: byId("currencyText"),
      resourceText: byId("resourceText"),
      abilityPointText: byId("abilityPointText"),
      attributePointText: byId("attributePointText"),
      statusEffectText: byId("statusEffectText"),
      phaseText: byId("phaseText"),
      phaseTimerText: byId("phaseTimerText"),
      baseStatusText: byId("baseStatusText"),
      placeBaseButton: byId("placeBaseButton"),
      coreHealthText: byId("coreHealthText"),
      coreHealthBar: byId("coreHealthBar"),
      baseEnergyText: byId("baseEnergyText"),
      baseLayoutSelect: byId("baseLayoutSelect"),
      baseReplotText: byId("baseReplotText"),
      rebuildText: byId("rebuildText"),
      upgradeCoreButton: byId("upgradeCoreButton"),
      upgradeTowerButton: byId("upgradeTowerButton"),
      upgradeGeneratorButton: byId("upgradeGeneratorButton"),
      baseHintText: byId("baseHintText"),
      objectiveList: byId("objectiveList"),
      nearbyLootText: byId("nearbyLootText"),
      nearbyLootList: byId("nearbyLootList"),
      pickupAllLootButton: byId("pickupAllLootButton"),
      carryCapacityText: byId("carryCapacityText"),
      depositLootButton: byId("depositLootButton"),
      inventoryList: byId("inventoryList"),
      coreStorageText: byId("coreStorageText"),
      coreStorageList: byId("coreStorageList"),
      equipmentSlots: byId("equipmentSlots"),
      selectedSlotText: byId("selectedSlotText"),
      slotChoiceList: byId("slotChoiceList"),
      equippedLootText: byId("equippedLootText"),
      statsList: byId("statsList"),
      pointsText: byId("pointsText"),
      loadoutAbilityPointText: byId("loadoutAbilityPointText"),
      loadoutAttributePointText: byId("loadoutAttributePointText"),
      skillUpgradeList: byId("skillUpgradeList"),
      attributeUpgradeList: byId("attributeUpgradeList"),
      shopStatusText: byId("shopStatusText"),
      baseUpgradeStatusText: byId("baseUpgradeStatusText"),
      buyWardButton: byId("buyWardButton"),
      buyEquipmentButton: byId("buyEquipmentButton"),
      buyUncommonEquipmentButton: byId("buyUncommonEquipmentButton"),
      buyRareEquipmentButton: byId("buyRareEquipmentButton"),
      buyEpicEquipmentButton: byId("buyEpicEquipmentButton"),
      buyPotionButton: byId("buyPotionButton"),
      usePotionButton: byId("usePotionButton"),
      buyBallistaButton: byId("buyBallistaButton"),
      buyBarracksButton: byId("buyBarracksButton"),
      buyPulseTowerButton: byId("buyPulseTowerButton"),
      upgradeBallistaButton: byId("upgradeBallistaButton"),
      upgradeBarracksButton: byId("upgradeBarracksButton"),
      upgradePulseTowerButton: byId("upgradePulseTowerButton"),
      upgradeWallHealthButton: byId("upgradeWallHealthButton"),
      repairWallsButton: byId("repairWallsButton"),
      rebuildWallsButton: byId("rebuildWallsButton"),
      upgradeListFilterText: byId("upgradeListFilterText"),
      buildingUpgradeList: byId("buildingUpgradeList"),
      wardCountText: byId("wardCountText"),
      potionCountText: byId("potionCountText"),
      hotbarPotionButton: byId("hotbarPotionButton"),
      hotbarWardButton: byId("hotbarWardButton"),
      hotbarPotionText: byId("hotbarPotionText"),
      hotbarWardText: byId("hotbarWardText"),
      sellInventoryList: byId("sellInventoryList"),
      abilityBasic: byId("abilityBasic"),
      abilitySkillshot: byId("abilitySkillshot"),
      abilityArea: byId("abilityArea"),
      abilityUltimate: byId("abilityUltimate"),
      targetInfoPanel: byId("targetInfoPanel"),
      targetInfoName: byId("targetInfoName"),
      targetInfoMeta: byId("targetInfoMeta"),
      targetInfoHealthBar: byId("targetInfoHealthBar"),
      targetInfoHealthText: byId("targetInfoHealthText"),
      baseQuickMenu: byId("baseQuickMenu"),
      quickBuildingTitle: byId("quickBuildingTitle"),
      quickBuildingMeta: byId("quickBuildingMeta"),
      quickBuildingHealthBar: byId("quickBuildingHealthBar"),
      quickBuildingCostText: byId("quickBuildingCostText"),
      quickBuildingUpgradeButton: byId("quickBuildingUpgradeButton"),
      quickBuildingOpenButton: byId("quickBuildingOpenButton"),
      quickBuildingCloseButton: byId("quickBuildingCloseButton"),
      recallCastPanel: byId("recallCastPanel"),
      recallCastBar: byId("recallCastBar"),
      recallCastText: byId("recallCastText"),
      debugCurrencyButton: byId("debugCurrencyButton"),
      debugXpButton: byId("debugXpButton"),
      debugCoreButton: byId("debugCoreButton"),
      debugMobButton: byId("debugMobButton"),
      debugPhaseButton: byId("debugPhaseButton"),
      resetButton: byId("resetButton"),
      messageOverlay: byId("messageOverlay"),
      messageEyebrow: byId("messageEyebrow"),
      messageTitle: byId("messageTitle"),
      messageBody: byId("messageBody"),
      overlayResetButton: byId("overlayResetButton")
    };
    this.tabButtons = Array.from(document.querySelectorAll("[data-drawer-tab]"));
    this.pages = Array.from(document.querySelectorAll(".drawer-page"));
    this.bind();
  }

  bind() {
    this.els.lootPanelButton.addEventListener("click", () => this.open("loadout"));
    this.els.shopPanelButton.addEventListener("click", () => this.open("shop"));
    this.els.basePanelButton.addEventListener("click", () => this.open("base"));
    this.els.cameraLockButton.addEventListener("click", this.callbacks.toggleCameraLock);
    this.els.drawerToggleButton.addEventListener("click", () => {
      if (this.els.sideDrawer.classList.contains("is-open")) {
        this.setDrawer(false);
      } else {
        this.open("inventory");
      }
    });
    this.els.drawerCloseButton.addEventListener("click", () => this.setDrawer(false));
    for (const button of this.tabButtons) {
      button.addEventListener("click", () => this.openTab(button.dataset.drawerTab));
    }
    this.els.placeBaseButton.addEventListener("click", this.callbacks.placeBase);
    this.els.baseLayoutSelect.addEventListener("change", () => {
      this.callbacks.setBaseLayout(this.els.baseLayoutSelect.value);
      this.els.baseLayoutSelect.blur();
      document.activeElement?.blur?.();
    });
    this.els.upgradeCoreButton.addEventListener("click", () => this.callbacks.upgrade("core"));
    this.els.upgradeTowerButton.addEventListener("click", () => this.openUpgradeList("tower"));
    this.els.upgradeGeneratorButton.addEventListener("click", () => this.openUpgradeList("generator"));
    this.els.pickupAllLootButton.addEventListener("click", this.callbacks.pickupAllLoot);
    this.els.depositLootButton.addEventListener("click", this.callbacks.depositLoot);
    this.els.buyWardButton.addEventListener("click", this.callbacks.buyWard);
    this.els.buyEquipmentButton.addEventListener("click", () => this.callbacks.buyShopItem("standard"));
    this.els.buyUncommonEquipmentButton.addEventListener("click", () => this.callbacks.buyShopItem("uncommon"));
    this.els.buyRareEquipmentButton.addEventListener("click", () => this.callbacks.buyShopItem("rare"));
    this.els.buyEpicEquipmentButton.addEventListener("click", () => this.callbacks.buyShopItem("epic"));
    this.els.buyPotionButton.addEventListener("click", this.callbacks.buyPotion);
    this.els.usePotionButton.addEventListener("click", this.callbacks.usePotion);
    this.els.hotbarPotionButton.addEventListener("click", this.callbacks.usePotion);
    this.els.hotbarWardButton.addEventListener("click", this.callbacks.placeWard);
    this.els.buyBallistaButton.addEventListener("click", () => this.callbacks.buyDefense("ballista"));
    this.els.buyBarracksButton.addEventListener("click", () => this.callbacks.buyDefense("barracks"));
    this.els.buyPulseTowerButton.addEventListener("click", () => this.callbacks.buyDefense("pulseTower"));
    this.els.upgradeBallistaButton.addEventListener("click", () => this.openUpgradeList("ballista"));
    this.els.upgradeBarracksButton.addEventListener("click", () => this.openUpgradeList("barracks"));
    this.els.upgradePulseTowerButton.addEventListener("click", () => this.openUpgradeList("pulseTower"));
    this.els.upgradeWallHealthButton.addEventListener("click", this.callbacks.upgradeWallHealth);
    this.els.repairWallsButton.addEventListener("click", this.callbacks.repairWalls);
    this.els.rebuildWallsButton.addEventListener("click", this.callbacks.rebuildWalls);
    this.els.abilityBasic.addEventListener("click", this.callbacks.basicAttack);
    this.els.abilitySkillshot.addEventListener("click", () => this.callbacks.toggleAbility("skillshot"));
    this.els.abilityArea.addEventListener("click", () => this.callbacks.toggleAbility("area"));
    this.els.abilityUltimate.addEventListener("click", () => this.callbacks.toggleAbility("ultimate"));
    this.els.quickBuildingUpgradeButton.addEventListener("click", () => {
      if (this.quickBuildingId) {
        this.callbacks.quickUpgradeBuilding(this.quickBuildingId);
      }
    });
    this.els.quickBuildingOpenButton.addEventListener("click", () => {
      if (this.quickBuildingId) {
        this.callbacks.openBuildingUpgradeList(this.quickBuildingId);
      }
    });
    this.els.quickBuildingCloseButton.addEventListener("click", () => this.closeBuildingQuickMenu());
    this.els.buildingUpgradeList.addEventListener("click", (event) => {
      const target = event.target.closest("[data-upgrade-building-id]");
      if (target) {
        consumePointer(event);
        this.callbacks.upgradeBuildingById(target.dataset.upgradeBuildingId);
      }
    });
    this.els.debugCurrencyButton.addEventListener("click", this.callbacks.addCurrency);
    this.els.debugXpButton.addEventListener("click", this.callbacks.addXP);
    this.els.debugCoreButton.addEventListener("click", this.callbacks.damageCore);
    this.els.debugMobButton.addEventListener("click", this.callbacks.spawnMobs);
    this.els.debugPhaseButton.addEventListener("click", this.callbacks.advancePhase);
    this.els.resetButton.addEventListener("click", this.callbacks.reset);
    this.els.overlayResetButton.addEventListener("click", this.callbacks.reset);

    this.els.inventoryList.addEventListener("click", (event) => {
      const equipTarget = event.target.closest("[data-equip-id]");
      const sellTarget = event.target.closest("[data-sell-id]");
      if (equipTarget) {
        consumePointer(event);
        this.callbacks.equipLoot(equipTarget.dataset.equipId);
      }
      if (sellTarget) {
        consumePointer(event);
        this.callbacks.sellLoot(sellTarget.dataset.sellId);
      }
    });
    this.els.coreStorageList.addEventListener("click", (event) => {
      const equipTarget = event.target.closest("[data-equip-id]");
      const sellTarget = event.target.closest("[data-sell-id]");
      if (equipTarget) {
        consumePointer(event);
        this.callbacks.equipLoot(equipTarget.dataset.equipId);
      }
      if (sellTarget) {
        consumePointer(event);
        this.callbacks.sellLoot(sellTarget.dataset.sellId);
      }
    });
    this.els.sellInventoryList.addEventListener("click", (event) => {
      const sellTarget = event.target.closest("[data-sell-id]");
      if (sellTarget) {
        consumePointer(event);
        this.callbacks.sellLoot(sellTarget.dataset.sellId);
      }
    });
    this.els.inventoryList.addEventListener("dragstart", (event) => {
      const target = event.target.closest("[data-drag-loot-id]");
      this.draggedLootId = target?.dataset.dragLootId || null;
    });
    this.els.coreStorageList.addEventListener("dragstart", (event) => {
      const target = event.target.closest("[data-drag-loot-id]");
      this.draggedLootId = target?.dataset.dragLootId || null;
    });
    this.els.nearbyLootList.addEventListener("click", (event) => {
      const target = event.target.closest("[data-pickup-id]");
      if (target) {
        consumePointer(event);
        this.callbacks.pickupLoot(target.dataset.pickupId);
      }
    });
    this.els.equipmentSlots.addEventListener("dragover", (event) => {
      if (event.target.closest("[data-slot-id]")) event.preventDefault();
    });
    this.els.equipmentSlots.addEventListener("click", (event) => {
      const slot = event.target.closest("[data-slot-id]");
      if (!slot) return;
      consumePointer(event);
      this.selectedSlotId = slot.dataset.slotId;
      this.open("loadout");
    });
    this.els.equipmentSlots.addEventListener("drop", (event) => {
      const slot = event.target.closest("[data-slot-id]");
      if (!slot || !this.draggedLootId) return;
      event.preventDefault();
      this.callbacks.equipLoot(this.draggedLootId, slot.dataset.slotId);
      this.draggedLootId = null;
    });
    this.els.slotChoiceList.addEventListener("click", (event) => {
      const target = event.target.closest("[data-equip-slot-id]");
      if (target) {
        consumePointer(event);
        this.callbacks.equipLoot(target.dataset.equipSlotItemId, target.dataset.equipSlotId);
      }
    });
    this.els.skillUpgradeList.addEventListener("click", (event) => {
      const target = event.target.closest("[data-skill-id]");
      if (target) {
        consumePointer(event);
        this.callbacks.upgradeAbility(target.dataset.skillId);
      }
    });
    this.els.attributeUpgradeList.addEventListener("click", (event) => {
      const target = event.target.closest("[data-attribute-id]");
      if (target) {
        consumePointer(event);
        this.callbacks.upgradeAttribute(target.dataset.attributeId);
      }
    });
  }

  open(tab) {
    this.openTab(tab);
    this.setDrawer(true);
  }

  openUpgradeList(type = null) {
    this.upgradeFilter = type;
    this.open("base");
  }

  toggleDrawer() {
    this.setDrawer(!this.els.sideDrawer.classList.contains("is-open"));
  }

  setDrawer(open) {
    this.els.sideDrawer.classList.toggle("is-open", open);
    this.els.sideDrawer.setAttribute("aria-hidden", open ? "false" : "true");
    this.els.drawerToggleButton.textContent = open ? "Close" : "Inventory";
  }

  openTab(tab) {
    this.activeTab = tab || "loadout";
    for (const button of this.tabButtons) {
      button.classList.toggle("is-active", button.dataset.drawerTab === this.activeTab);
    }
    for (const page of this.pages) {
      page.classList.toggle("is-active", page.id === `${this.activeTab}Panel`);
    }
    const labels = {
      loadout: ["Loadout", "Loadout"],
      inventory: ["Inventory", "Storage"],
      shop: ["Core Shop", "Items"],
      base: ["Shop", "Base Upgrades"],
      match: ["Match", "Objectives"]
    };
    const [eyebrow, title] = labels[this.activeTab] || labels.loadout;
    this.els.drawerEyebrow.textContent = eyebrow;
    this.els.drawerTitle.textContent = title;
  }

  render(scene) {
    const player = scene.player;
    const match = scene.match;
    const base = scene.base;
    const core = base.core;

    this.els.healthText.textContent = player.alive
      ? `${Math.ceil(player.health)} / ${player.effectiveMaxHealth}`
      : `Respawn ${formatTime(player.respawnTimer)}`;
    this.els.healthBar.style.width = `${player.healthRatio * 100}%`;
    const activeShield = Math.ceil(player.shield || 0);
    this.els.shieldLine.hidden = activeShield <= 0;
    this.els.shieldText.textContent = String(activeShield);
    this.els.shieldBar.style.width = `${(player.shieldRatio || 0) * 100}%`;
    this.els.xpText.textContent = `${Math.floor(player.xp)} / ${player.xpToNext}`;
    this.els.xpBar.style.width = `${Math.min(100, (player.xp / player.xpToNext) * 100)}%`;
    this.els.levelText.textContent = String(player.level);
    this.els.classText.textContent = player.characterClass?.shortLabel || player.characterClass?.label || "Ranger";
    this.els.currencyText.textContent = String(Math.floor(player.currency));
    this.els.resourceText.textContent = String(Math.floor(player.resources));
    this.els.abilityPointText.textContent = String(player.skillPoints);
    this.els.attributePointText.textContent = String(player.attributePoints);
    this.els.statusEffectText.textContent = statusEffectSummary(player);
    this.els.phaseText.textContent = match.currentPhase.label;
    this.els.phaseTimerText.textContent = formatTime(match.timeRemaining);
    this.els.cameraLockButton.textContent = scene.cameraLocked ? "Unlock" : "Lock";
    this.renderItemHotbar(scene);

    if (core) {
      this.els.baseStatusText.textContent = `Core L${core.level}`;
      this.els.coreHealthText.textContent = `${Math.ceil(core.health)} / ${core.maxHealth} HP`;
      this.els.coreHealthBar.style.width = `${core.healthRatio * 100}%`;
    } else if (base.displaced) {
      this.els.baseStatusText.textContent = "Displaced";
      this.els.coreHealthText.textContent = `Rebuild ${formatTime(base.emergencyTimer)}`;
      this.els.coreHealthBar.style.width = `${Math.max(0, (base.emergencyTimer / CONFIG.base.emergencyWindow) * 100)}%`;
    } else {
      this.els.baseStatusText.textContent = "No Core";
      this.els.coreHealthText.textContent = "Core not placed";
      this.els.coreHealthBar.style.width = "0%";
    }

    this.els.baseEnergyText.textContent = `${base.energyUsed} / ${base.energyCap} Energy`;
    this.els.rebuildText.textContent = `${base.emergencyCount} / ${CONFIG.base.maxEmergencyRebuilds} rebuilds`;
    if (this.els.baseLayoutSelect.value !== scene.selectedBaseLayoutId) {
      this.els.baseLayoutSelect.value = scene.selectedBaseLayoutId;
    }
    this.els.baseLayoutSelect.disabled = !match.canPlaceBase || scene.gameOver || scene.gameWon || player.nomadMode;
    this.els.baseReplotText.textContent = base.active && match.canPlaceBase ? `${scene.baseReplotsRemaining} replots` : match.canPlaceBase ? "Choose layout" : "Locked";

    const emergencyAvailable =
      base.displaced && base.emergencyTimer > 0 && base.emergencyCount <= CONFIG.base.maxEmergencyRebuilds;
    const placementAllowed = match.canPlaceBase || emergencyAvailable;
    this.els.placeBaseButton.disabled = scene.gameOver || scene.gameWon || !placementAllowed || !player.alive;
    const placeKey = labelForKeyCode(scene.keybindings.placeBase);
    this.els.placeBaseButton.innerHTML = scene.basePlacementPreviewActive
      ? `<kbd>${placeKey}</kbd> Cancel`
      : emergencyAvailable
        ? `<kbd>${placeKey}</kbd> Preview Rebuild`
        : base.active
          ? `<kbd>${placeKey}</kbd> Preview Replot`
          : `<kbd>${placeKey}</kbd> Preview Core`;
    this.els.baseHintText.textContent = baseHint(scene);

    const canUpgrade = base.active && scene.isPlayerNearCore() && !scene.gameOver && !scene.gameWon;
    this.els.upgradeCoreButton.disabled = !canUpgrade;
    this.els.upgradeTowerButton.disabled = !canUpgrade;
    this.els.upgradeGeneratorButton.disabled = !canUpgrade;
    this.els.upgradeCoreButton.textContent = upgradeLabel(base, "core", "Core +");
    this.els.upgradeTowerButton.textContent = upgradeLabel(base, "tower", "Tower +");
    this.els.upgradeGeneratorButton.textContent = upgradeLabel(base, "generator", "Gen +");

    this.renderAbilities(scene);
    this.renderTargetInfo(scene);
    this.renderRecall(scene);
    this.renderObjectives(scene);
    this.renderInventory(player, scene);
    this.renderLoadout(player, scene);
    this.renderProgression(player);
    this.renderShop(scene);
    this.renderBuildingQuickMenu(scene);
  }

  openBuildingQuickMenu(building, scene) {
    if (!building) {
      return;
    }
    this.quickBuildingId = building.id;
    this.quickBuildingAnchor = {
      x: scene.input?.mouseScreen?.x || window.innerWidth * 0.5,
      y: scene.input?.mouseScreen?.y || window.innerHeight * 0.5
    };
    this.els.baseQuickMenu.hidden = false;
    this.renderBuildingQuickMenu(scene);
  }

  closeBuildingQuickMenu() {
    this.quickBuildingId = null;
    this.quickBuildingAnchor = null;
    this.els.baseQuickMenu.hidden = true;
  }

  renderBuildingQuickMenu(scene) {
    if (this.els.baseQuickMenu.hidden || !this.quickBuildingId) {
      return;
    }
    const building = scene.base.livingBuildings.find((candidate) => candidate.id === this.quickBuildingId);
    if (!building) {
      this.closeBuildingQuickMenu();
      return;
    }
    const info = scene.base.getUpgradeInfoById(building.id);
    const nearCore = scene.isPlayerNearCore();
    const isWall = building.type === "wall";
    const wallInfo = isWall ? scene.base.getWallHealthUpgradeInfo() : null;
    const healthRatio = Math.max(0, Math.min(1, building.healthRatio || 0));
    this.els.quickBuildingTitle.textContent = `${building.label || labelize(building.type)} L${building.level}`;
    this.els.quickBuildingMeta.textContent = `${labelize(building.type)} / ${Math.ceil(building.health)} of ${building.maxHealth} HP`;
    this.els.quickBuildingHealthBar.style.width = `${healthRatio * 100}%`;
    if (isWall) {
      this.els.quickBuildingCostText.textContent = wallInfo?.canUpgrade
        ? `Wall Health T${wallInfo.nextLevel}: ${wallInfo.cost.gold}g/${wallInfo.cost.resources}b`
        : `Wall Health T${wallInfo?.level || 1}: maxed`;
      this.els.quickBuildingUpgradeButton.textContent = "Wall Health +";
      this.els.quickBuildingUpgradeButton.disabled =
        !nearCore ||
        !wallInfo?.canUpgrade ||
        scene.player.currency < wallInfo.cost.gold ||
        scene.player.resources < wallInfo.cost.resources;
    } else if (info) {
      this.els.quickBuildingCostText.textContent = info.levelCapped
        ? `Requires Core above L${building.level}`
        : info.canFitEnergy
          ? `Upgrade: ${info.cost.gold}g/${info.cost.resources}b${info.addedEnergy ? ` / +${info.addedEnergy} energy` : ""}`
          : "Upgrade would exceed base energy";
      this.els.quickBuildingUpgradeButton.textContent = `${building.type === "core" ? "Core" : building.label} +`;
      this.els.quickBuildingUpgradeButton.disabled =
        !nearCore ||
        info.levelCapped ||
        !info.canFitEnergy ||
        scene.player.currency < info.cost.gold ||
        scene.player.resources < info.cost.resources;
    } else {
      this.els.quickBuildingCostText.textContent = "No direct upgrade available.";
      this.els.quickBuildingUpgradeButton.textContent = "Upgrade";
      this.els.quickBuildingUpgradeButton.disabled = true;
    }
    this.els.quickBuildingOpenButton.disabled = !scene.base.active;
    this.positionBaseQuickMenu(scene);
  }

  positionBaseQuickMenu(scene) {
    const menu = this.els.baseQuickMenu;
    const margin = 14;
    const width = menu.offsetWidth || 286;
    const height = menu.offsetHeight || 150;
    const anchor = this.quickBuildingAnchor || scene.input.mouseScreen || { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
    const x = Math.max(margin, Math.min(window.innerWidth - width - margin, anchor.x + 18));
    const y = Math.max(78, Math.min(window.innerHeight - height - margin, anchor.y + 18));
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }

  renderRecall(scene) {
    const recall = scene.recall || {};
    if (!recall.active) {
      this.els.recallCastPanel.hidden = true;
      return;
    }
    const progress = 1 - recall.timer / Math.max(0.01, recall.duration || 8);
    this.els.recallCastPanel.hidden = false;
    this.els.recallCastBar.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
    this.els.recallCastText.textContent = `${Math.max(0, recall.timer || 0).toFixed(1)}s`;
  }

  renderTargetInfo(scene) {
    const target = scene.selectedTarget || scene.hoverTarget;
    if (!target || !scene.isAutoAttackTargetValid?.(target)) {
      this.els.targetInfoPanel.hidden = true;
      return;
    }
    const point = scene.getTargetPoint?.(target) || target;
    if (!scene.isPointCurrentlyVisible?.(point, (scene.getTargetRadius?.(target) || 24) + 24)) {
      this.els.targetInfoPanel.hidden = true;
      return;
    }
    const health = Math.max(0, Math.ceil(target.health || 0));
    const maxHealth = Math.max(1, Math.ceil(target.maxHealth || 1));
    const ratio = health / maxHealth;
    this.els.targetInfoPanel.hidden = false;
    this.els.targetInfoPanel.classList.toggle("is-selected", target === scene.selectedTarget);
    this.els.targetInfoName.textContent = scene.getTargetName?.(target) || target.label || "Target";
    this.els.targetInfoMeta.textContent = `L${scene.getTargetLevel?.(target) || 1} ${scene.getTargetType?.(target) || "Enemy"}`;
    this.els.targetInfoHealthBar.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
    this.els.targetInfoHealthText.textContent = `${health} / ${maxHealth} HP (${Math.round(ratio * 100)}%)`;
  }

  renderAbilities(scene) {
    const player = scene.player;
    this.renderAbility(this.els.abilityBasic, player.abilityBook.abilities.basic, false, player);
    this.renderAbility(this.els.abilitySkillshot, player.abilityBook.abilities.skillshot, scene.queuedAbilityId === "skillshot", player);
    this.renderAbility(this.els.abilityArea, player.abilityBook.abilities.area, scene.queuedAbilityId === "area", player);
    this.renderAbility(this.els.abilityUltimate, player.abilityBook.abilities.ultimate, scene.queuedAbilityId === "ultimate", player);
    this.els.abilityBasic.querySelector("kbd").textContent = labelForKeyCode(scene.keybindings.basicAttack);
    this.els.abilitySkillshot.querySelector("kbd").textContent = labelForKeyCode(scene.keybindings.skillshot);
    this.els.abilityArea.querySelector("kbd").textContent = labelForKeyCode(scene.keybindings.area);
    this.els.abilityUltimate.querySelector("kbd").textContent = labelForKeyCode(scene.keybindings.ultimate);
  }

  renderItemHotbar(scene) {
    const potionKey = labelForKeyCode(scene.keybindings.usePotion);
    const wardKey = labelForKeyCode(scene.keybindings.quickWard);
    this.els.hotbarPotionButton.querySelector("kbd").textContent = potionKey;
    this.els.hotbarWardButton.querySelector("kbd").textContent = wardKey;
    this.els.hotbarPotionText.textContent =
      scene.player.potionCooldown > 0 ? `${scene.player.potionCooldown.toFixed(0)}s` : `${scene.player.healthPotions}/${CONFIG.shop.healthPotion.maxHeld}`;
    this.els.hotbarWardText.textContent =
      scene.player.wardCooldown > 0 ? `${scene.player.wardCooldown.toFixed(0)}s` : `${scene.player.wards}/${CONFIG.shop.ward.maxHeld}`;
    this.els.hotbarPotionButton.disabled =
      scene.player.healthPotions <= 0 ||
      scene.player.potionCooldown > 0 ||
      !scene.player.alive ||
      scene.player.health >= scene.player.effectiveMaxHealth;
    this.els.hotbarWardButton.disabled = scene.player.wards <= 0 || scene.player.wardCooldown > 0 || !scene.player.alive;
  }

  renderAbility(element, ability, armed = false, player = null) {
    const ratio = ability.cooldownRemaining / Math.max(0.01, ability.cooldown);
    element.classList.toggle("is-cooling", ratio > 0);
    element.classList.toggle("is-armed", armed);
    element.style.setProperty("--cooldown-fill", `${(1 - ratio) * 100}%`);
    const strong = element.querySelector("strong");
    const status = element.querySelector("span");
    strong.textContent = `${ability.config.label} L${ability.level}`;
    const statusPrefix = player?.isStealthed && ability.config.type === "stealth" ? "Active" : null;
    status.textContent = statusPrefix || (armed ? "Aim, click to cast" : ratio > 0 ? `${ability.cooldownRemaining.toFixed(1)}s` : ability.evolved ? "Evolved" : "Ready");
    const damage = ability.previewDamage?.(player) || 0;
    const damageText = damage > 0 ? `Damage ${damage}. ` : "";
    element.title = `${ability.config.label} L${ability.level}. ${damageText}Cooldown ${ability.cooldown.toFixed(1)}s. ${ability.config.description || ""}`;
  }

  renderObjectives(scene) {
    const towerItems = (scene.neutralTowers || [])
      .filter((tower) => scene.isPointCurrentlyVisible?.(tower, 160) || tower.ownerId === scene.player.id)
      .map((tower) => {
        const owner = tower.ownerId === scene.player.id ? "Owned" : tower.ownerId ? "Enemy" : tower.type === "vision" ? `${Math.round(((tower.progress || 0) / Math.max(1, tower.config?.captureSeconds || 8)) * 100)}%` : "Hostile";
        const level = tower.level || 1;
        return `<div class="objective-item objective-item-poi"><div><strong>${tower.label}</strong><span>${tower.type === "vision" ? "Area vision" : "Hazard turret"} / L${level}</span></div><em style="color:${riskColorText(scene.player.level, level)}">${owner}</em></div>`;
      });
    const villageItems = (scene.villages || [])
      .filter((village) => scene.isPointCurrentlyVisible?.(village, 180) || village.looted)
      .slice(0, 5)
      .map(
        (village) =>
          `<div class="objective-item objective-item-poi"><div><strong>${village.label}</strong><span>${village.ambush ? "Ambush risk" : "Supplies"} / village</span></div><em>${village.looted ? "Cleared" : "Scout"}</em></div>`
      );
    setHtmlIfChanged(
      this.els.objectiveList,
      [
        ...scene.objectives
        .map((objective) => {
        const visible = scene.isPointCurrentlyVisible?.(objective.combatPoint || objective, 180) || objective.ownerId === scene.player.id;
        const targetLevel = objective.scaleLevel || (objective.type === "boss" ? Math.max(5, Math.round(scene.getAveragePlayerLevel?.() || 1) + 2) : 1);
        const danger = difficultyLabelText(scene.player.level, targetLevel);
        const status =
          objective.type === "boss"
            ? scene.bossDefeated
              ? "Defeated"
              : scene.bossSpawned
                ? visible
                  ? `${danger} L${targetLevel}`
                  : "Spawned"
                : `Spawns ${formatTime(scene.getMidBossTimeRemaining())}`
            : !visible
              ? "Scouting needed"
              : objective.alive
              ? `${danger} L${targetLevel}`
              : objective.captured
                ? objective.ownerId === scene.player.id
                  ? "Owned"
                  : "Enemy"
                : objective.progress > 0
                  ? `${Math.round(objective.progressRatio * 100)}%`
                  : objective.captureReady
                    ? "Capture Ready"
                    : "Claim";
        return `<div class="objective-item"><div><strong>${objective.label}</strong><span>${objective.reward}</span></div><em style="color:${riskColorText(scene.player.level, targetLevel)}">${status}</em></div>`;
        }),
        ...towerItems,
        ...villageItems
      ].join("")
    );
  }

  renderInventory(player, scene) {
    const nearbyLoot = scene.getNearbyLoot();
    const backpackLoot = player.backpackLoot || player.loot.filter((item) => !player.isEquipped(item.id));
    const carryText = `${player.carriedLootCount} / ${player.carryLimit}`;
    this.els.nearbyLootText.textContent = nearbyLoot.length === 0 ? "None" : `${nearbyLoot.length} item${nearbyLoot.length === 1 ? "" : "s"}`;
    this.els.pickupAllLootButton.textContent = player.carriedLootFull ? "Backpack Full" : "Pick Up Nearby";
    this.els.pickupAllLootButton.disabled = nearbyLoot.length === 0 || player.carriedLootFull;
    this.els.carryCapacityText.textContent = carryText;
    this.els.depositLootButton.textContent = scene.isPlayerNearCore()
      ? `Store Backpack (${player.carriedLootCount})`
      : "Store Backpack - Near Core";
    this.els.depositLootButton.disabled = !scene.isPlayerNearCore() || player.carriedLootCount === 0;
    this.els.coreStorageText.textContent = `${player.coreStorage.length} / ${CONFIG.loot.baseStorageLimit}`;
    setHtmlIfChanged(
      this.els.nearbyLootList,
      nearbyLoot.length === 0
        ? `<div class="empty-list">No loot in pickup range.</div>`
        : nearbyLoot.map((item) => lootDropMarkup(item)).join("")
    );

    setHtmlIfChanged(
      this.els.inventoryList,
      backpackLoot.length === 0
        ? `<div class="empty-list">Backpack is empty. Pick up drops until full, then return to the core.</div>`
        : backpackLoot.map((item) => storageItemMarkup(item, player, scene.isPlayerNearCore(), "Backpack")).join("")
    );
    setHtmlIfChanged(
      this.els.coreStorageList,
      player.coreStorage.length === 0
        ? `<div class="empty-list">Core storage is empty. Store backpack loot while near your core.</div>`
        : player.coreStorage.map((item) => storageItemMarkup(item, player, scene.isPlayerNearCore(), "Core Storage")).join("")
    );
  }

  renderLoadout(player, scene) {
    const equippedCount = Object.values(player.equipment).filter(Boolean).length;
    const selectedSlot = getSlotConfig(this.selectedSlotId) || CONFIG.loot.equipmentSlots[0];
    if (!getSlotConfig(this.selectedSlotId)) {
      this.selectedSlotId = selectedSlot?.id || null;
    }
    this.els.equippedLootText.textContent = `${equippedCount} / ${CONFIG.loot.equipmentSlots.length} slots`;
    setHtmlIfChanged(
      this.els.equipmentSlots,
      CONFIG.loot.equipmentSlots
        .map((slot) => {
        const item = player.equipment[slot.id];
        return `<button class="equipment-slot ${slot.id === this.selectedSlotId ? "is-selected" : ""}" type="button" data-slot-id="${slot.id}"><span>${slot.label}</span>${
          item
            ? `<strong style="color:${item.color || "#fff8e8"}">${item.label}</strong><em>${item.description}</em>`
            : `<strong>Empty</strong><em>Click to choose compatible gear.</em>`
        }</button>`;
        })
        .join("")
    );

    this.els.selectedSlotText.textContent = selectedSlot ? selectedSlot.label : "Select a slot";
    const compatibleItems = selectedSlot
      ? player.allLoot.filter((item) => slotAcceptsItem(selectedSlot, item) && (player.getLootSource(item.id) !== "core" || scene.isPlayerNearCore()))
      : [];
    setHtmlIfChanged(
      this.els.slotChoiceList,
      compatibleItems.length === 0
        ? `<div class="empty-list">No compatible carried items. Stand near your core to equip stored gear.</div>`
        : compatibleItems.map((item) => slotChoiceMarkup(item, selectedSlot.id, player)).join("")
    );

    const stats = player.displayStats;
    this.els.pointsText.textContent = `${player.skillPoints} ability / ${player.attributePoints} attr`;
    this.els.loadoutAbilityPointText.textContent = String(player.skillPoints);
    this.els.loadoutAttributePointText.textContent = String(player.attributePoints);
    setHtmlIfChanged(
      this.els.statsList,
      Object.entries(stats)
        .map(([key, value]) => `<div class="stat-row"><span>${labelize(key)}</span><strong>${value}</strong></div>`)
        .join("")
    );
  }

  renderProgression(player) {
    setHtmlIfChanged(
      this.els.skillUpgradeList,
      Object.values(player.abilityBook.abilities)
        .map((ability) => {
        const preview = player.abilityBook.getUpgradePreview(ability.id);
        return `<div class="upgrade-item upgrade-item-wide"><div><strong>${ability.config.label}</strong><span>Level ${ability.level}/5${
          ability.evolved ? " / evolved" : ""
        }</span><em>${preview}</em></div><button type="button" data-skill-id="${ability.id}" ${
          player.skillPoints <= 0 || ability.level >= 5 ? "disabled" : ""
        }>Upgrade</button></div>`;
        })
        .join("")
    );

    setHtmlIfChanged(
      this.els.attributeUpgradeList,
      ["power", "vitality", "mobility"]
        .map(
          (attribute) =>
          `<div class="upgrade-item"><div><strong>${labelize(attribute)}</strong><span>Rank ${player.attributes[attribute]}</span><em>${attributePreview(
            attribute
          )}</em></div><button type="button" data-attribute-id="${attribute}" ${
            player.attributePoints <= 0 ? "disabled" : ""
          }>Add Point</button></div>`
        )
        .join("")
    );
  }

  renderShop(scene) {
    const nearCore = scene.isPlayerNearCore();
    const shopOpen = scene.canUseShop();
    this.els.shopStatusText.textContent = scene.player.nomadMode ? "Nomad Open" : nearCore ? "Open" : "Near core only";
    this.els.baseUpgradeStatusText.textContent = scene.base.active ? (nearCore ? "Open" : "Near core only") : "No core";
    this.els.buyWardButton.textContent =
      scene.player.wards >= CONFIG.shop.ward.maxHeld ? `Ward Pouch Full (${CONFIG.shop.ward.maxHeld})` : `Buy Ward - ${CONFIG.shop.ward.cost}g`;
    this.els.buyWardButton.disabled =
      !shopOpen || scene.player.currency < CONFIG.shop.ward.cost || scene.player.wards >= CONFIG.shop.ward.maxHeld;
    this.renderEquipmentShopButton(this.els.buyEquipmentButton, scene, "standard");
    this.renderEquipmentShopButton(this.els.buyUncommonEquipmentButton, scene, "uncommon");
    this.renderEquipmentShopButton(this.els.buyRareEquipmentButton, scene, "rare");
    this.renderEquipmentShopButton(this.els.buyEpicEquipmentButton, scene, "epic");
    this.els.wardCountText.textContent = String(scene.player.wards);
    this.els.potionCountText.textContent = String(scene.player.healthPotions);
    const potion = scene.getHealthPotionInfo();
    this.els.buyPotionButton.textContent =
      scene.player.healthPotions >= CONFIG.shop.healthPotion.maxHeld
        ? `Potion Pouch Full (${CONFIG.shop.healthPotion.maxHeld})`
        : `Buy Potion - ${potion.cost}g (${potion.heal} HP)`;
    this.els.buyPotionButton.disabled =
      !shopOpen || scene.player.currency < potion.cost || scene.player.healthPotions >= CONFIG.shop.healthPotion.maxHeld;
    this.els.usePotionButton.textContent =
      scene.player.potionCooldown > 0 ? `Potion Cooldown ${scene.player.potionCooldown.toFixed(0)}s` : `Use Potion (${scene.player.healthPotions})`;
    this.els.usePotionButton.disabled =
      scene.player.healthPotions <= 0 ||
      scene.player.potionCooldown > 0 ||
      !scene.player.alive ||
      scene.player.health >= scene.player.effectiveMaxHealth;
    this.renderDefenseButton(this.els.buyBallistaButton, scene, "ballista");
    this.renderDefenseButton(this.els.buyBarracksButton, scene, "barracks");
    this.renderDefenseButton(this.els.buyPulseTowerButton, scene, "pulseTower");
    this.renderDefenseUpgradeButton(this.els.upgradeBallistaButton, scene, "ballista", "Ballista +");
    this.renderDefenseUpgradeButton(this.els.upgradeBarracksButton, scene, "barracks", "Barracks +");
    this.renderDefenseUpgradeButton(this.els.upgradePulseTowerButton, scene, "pulseTower", "Pulse +");
    this.renderWallHealthButton(scene);
    this.renderBuildingUpgradeList(scene);
    const repair = scene.base.getWallRepairInfo();
    this.els.repairWallsButton.textContent = repair.canRepair
      ? `Repair Walls - ${repair.cost.gold}g/${repair.cost.resources}b`
      : "Repair Walls - Full";
    this.els.repairWallsButton.disabled =
      !nearCore || !repair.canRepair || scene.player.currency < repair.cost.gold || scene.player.resources < repair.cost.resources;
    const rebuild = scene.base.getDestroyedWallInfo();
    const blockedByEnemy = scene.isEnemyInsideBaseLayers(scene.base, scene.player.id);
    this.els.rebuildWallsButton.textContent = rebuild.canRebuild
      ? blockedByEnemy
        ? "Rebuild Blocked - Enemy Inside"
        : `Rebuild ${rebuild.wallCount} Walls - ${rebuild.cost.gold}g/${rebuild.cost.resources}b`
      : "Rebuild Destroyed Walls - None";
    this.els.rebuildWallsButton.disabled =
      !nearCore ||
      blockedByEnemy ||
      !rebuild.canRebuild ||
      scene.player.currency < rebuild.cost.gold ||
      scene.player.resources < rebuild.cost.resources;
    setHtmlIfChanged(
      this.els.sellInventoryList,
      scene.player.allLoot.length === 0
        ? `<div class="empty-list">Inventory is empty.</div>`
        : scene.player.allLoot.map((item) => sellItemMarkup(item, scene.canUseShop(), scene.player.getLootSource(item.id))).join("")
    );
  }

  renderDefenseButton(button, scene, type) {
    const info = scene.base.getDefenseShopInfo(type);
    if (!info) {
      const label = defenseLabel(type);
      button.textContent = `${label} - Core needed`;
      button.disabled = true;
      return;
    }
    if (info.lockedByCore) {
      button.textContent = `${info.label} - Core L${info.unlockCoreLevel}`;
    } else if (info.countCapped) {
      button.textContent = `${info.label} - Cap reached`;
    } else {
      button.textContent = `${info.label} L${info.level} - ${info.cost.gold}g/${info.cost.resources}b`;
    }
    button.disabled =
      !scene.isPlayerNearCore() ||
      scene.player.currency < info.cost.gold ||
      scene.player.resources < info.cost.resources ||
      !info.canPurchase ||
      !info.canFitEnergy;
  }

  renderEquipmentShopButton(button, scene, tierKey) {
    const info = scene.getEquipmentShopInfo(tierKey);
    button.textContent = `${info.label} - ${info.cost}g`;
    button.disabled = !scene.canUseShop() || scene.player.currency < info.cost;
  }

  renderDefenseUpgradeButton(button, scene, type, fallback) {
    const target = scene.base.getUpgradeTarget(type);
    const nearCore = scene.isPlayerNearCore();
    button.textContent = upgradeLabel(scene.base, type, fallback);
    if (!target) {
      button.disabled = true;
      return;
    }
    const cost = target.upgradeCost;
    const finalGold = Math.round(cost.gold * scene.base.upgradeCostMultiplier);
    const finalBuild = Math.round(cost.resources * scene.base.upgradeCostMultiplier);
    const addedEnergy = (target.level + 1) % 2 === 0 ? 1 : 0;
    button.disabled =
      !nearCore ||
      (target.type !== "core" && scene.base.core && target.level >= scene.base.core.level) ||
      scene.player.currency < finalGold ||
      scene.player.resources < finalBuild ||
      scene.base.energyUsed + addedEnergy > scene.base.energyCap;
  }

  renderWallHealthButton(scene) {
    const nearCore = scene.isPlayerNearCore();
    const info = scene.base.getWallHealthUpgradeInfo();
    if (!scene.base.active) {
      this.els.upgradeWallHealthButton.textContent = "Wall Health - Core needed";
      this.els.upgradeWallHealthButton.disabled = true;
      return;
    }
    this.els.upgradeWallHealthButton.textContent = info.canUpgrade
      ? `Wall Health T${info.nextLevel} - ${info.cost.gold}g/${info.cost.resources}b`
      : `Wall Health T${info.level} - Max`;
    this.els.upgradeWallHealthButton.disabled =
      !nearCore || !info.canUpgrade || scene.player.currency < info.cost.gold || scene.player.resources < info.cost.resources;
  }

  renderBuildingUpgradeList(scene) {
    const candidates = scene.base.getUpgradeCandidates(this.upgradeFilter);
    const filterLabel = this.upgradeFilter ? upgradeFilterLabel(this.upgradeFilter) : "All";
    this.els.upgradeListFilterText.textContent = filterLabel;
    setHtmlIfChanged(
      this.els.buildingUpgradeList,
      candidates.length === 0
        ? `<div class="empty-list">No ${filterLabel.toLowerCase()} buildings available to upgrade.</div>`
        : candidates.map((building) => buildingUpgradeMarkup(scene, building)).join("")
    );
  }

  showMessage(eyebrow, title, body) {
    this.els.messageEyebrow.textContent = eyebrow;
    this.els.messageTitle.textContent = title;
    this.els.messageBody.textContent = body;
    this.els.messageOverlay.hidden = false;
  }

  hideMessage() {
    this.els.messageOverlay.hidden = true;
  }
}

function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element #${id}`);
  return element;
}

function consumePointer(event) {
  event.preventDefault();
  event.stopPropagation();
}

function setHtmlIfChanged(element, html) {
  if (element.__baseboundRenderedHtml === html) {
    return;
  }
  element.__baseboundRenderedHtml = html;
  element.innerHTML = html;
}

function baseHint(scene) {
  if (scene.player.nomadMode) {
    return "Nomad path: no core respawns. Shop access stays open for gear, wards, and potions.";
  }
  if (scene.basePlacementPreviewActive) {
    return "Preview active: left click on the map to place, or press B again to cancel.";
  }
  if (scene.base.displaced) {
    if (scene.base.emergencyTimer > 0) return `Emergency rebuild available for ${formatTime(scene.base.emergencyTimer)}.`;
    return "Emergency window expired. No more cores can be placed.";
  }
  const selectedLayout = CONFIG.base.layouts[scene.selectedBaseLayoutId];
  if (scene.match.canPlaceBase && !scene.base.active) return `${selectedLayout?.label || "Layout"}: ${selectedLayout?.summary || "Press B to preview, then left click to deploy."}`;
  if (scene.match.canPlaceBase && scene.base.active) return `${selectedLayout?.label || "Layout"} selected. Press B to preview a replot during grace.`;
  if (!scene.base.active) return "No active core. Dying now ends the run.";
  return scene.base.relicBuffTimer > 0
    ? `Relic defense buff ${formatTime(scene.base.relicBuffTimer)}.`
    : "Stand near the core to shop and upgrade the base.";
}

function upgradeLabel(base, type, fallback) {
  const target = base.getUpgradeTarget(type);
  if (!target) return fallback;
  const cost = target.upgradeCost;
  return `${fallback} ${Math.round(cost.gold * base.upgradeCostMultiplier)}g/${Math.round(cost.resources * base.upgradeCostMultiplier)}b`;
}

function lootDropMarkup(item) {
  return `<div class="inventory-item loot-drop-item"><div><strong style="color:${item.color || "#fff8e8"}">${item.label}</strong><span>${
    item.rarityLabel || "Loot"
  } / ${slotLabel(item.slot)} / ${item.description}</span></div><button type="button" data-pickup-id="${item.id}">Pick Up</button></div>`;
}

function storageItemMarkup(item, player, nearCore, sourceLabel = "Backpack") {
  const equipped = Object.values(player.equipment).some((equippedItem) => equippedItem?.id === item.id);
  const source = player.getLootSource?.(item.id);
  const equipDisabled = source === "core" && !nearCore;
  return `<div class="inventory-item item-card" draggable="true" data-drag-loot-id="${item.id}"><div><strong style="color:${item.color || "#fff8e8"}">${
    item.label
  }</strong><span>${sourceLabel} / ${item.rarityLabel || "Loot"} / ${slotLabel(item.slot)}</span><em>${item.description}</em><small>${statLine(
    item
  )}</small></div><div class="item-actions"><button type="button" data-equip-id="${item.id}" ${equipDisabled ? "disabled" : ""}>${
    equipped ? "Re-equip" : "Equip"
  }</button><button type="button" data-sell-id="${item.id}" ${nearCore ? "" : "disabled"}>Sell ${sellValue(item)}g</button></div></div>`;
}

function slotChoiceMarkup(item, slotId, player) {
  const equippedInSlot = player.equipment[slotId]?.id === item.id;
  return `<div class="inventory-item item-card compact"><div><strong style="color:${item.color || "#fff8e8"}">${
    item.label
  }</strong><span>${item.rarityLabel || "Loot"} / ${slotLabel(item.slot)}</span><em>${item.description}</em><small>${statLine(
    item
  )}</small></div><button type="button" data-equip-slot-id="${slotId}" data-equip-slot-item-id="${item.id}">${
    equippedInSlot ? "Equipped" : "Equip"
  }</button></div>`;
}

function sellItemMarkup(item, nearCore, source = null) {
  return `<div class="inventory-item item-card compact"><div><strong style="color:${item.color || "#fff8e8"}">${
    item.label
  }</strong><span>${source === "core" ? "Core Storage" : "Backpack"} / ${item.rarityLabel || "Loot"} / ${slotLabel(
    item.slot
  )}</span><em>${item.description}</em></div><button type="button" data-sell-id="${
    item.id
  }" ${nearCore ? "" : "disabled"}>Sell ${sellValue(item)}g</button></div>`;
}

function buildingUpgradeMarkup(scene, building) {
  const info = scene.base.getUpgradeInfoById(building.id);
  if (!info) {
    return "";
  }
  const canAfford = scene.player.currency >= info.cost.gold && scene.player.resources >= info.cost.resources;
  const nearCore = scene.isPlayerNearCore();
  const disabled = !nearCore || !canAfford || !info.canFitEnergy || info.levelCapped;
  const health = `${Math.ceil(building.health)} / ${building.maxHealth} HP`;
  const energyText = info.addedEnergy > 0 ? ` / +${info.addedEnergy} energy` : "";
  const detail = info.levelCapped ? `Capped by Core L${info.coreLevel}` : `${info.cost.gold}g/${info.cost.resources}b${energyText}`;
  return `<div class="inventory-item item-card compact"><div><strong>${building.label} L${building.level}</strong><span>${health}</span><em>${detail}</em></div><button type="button" data-upgrade-building-id="${
    building.id
  }" ${disabled ? "disabled" : ""}>Upgrade</button></div>`;
}

function upgradeFilterLabel(type) {
  if (type === "tower") return "Towers";
  if (type === "generator") return "Generators";
  if (type === "ballista") return "Ballistas";
  if (type === "pulseTower") return "Pulse Towers";
  if (type === "barracks") return "Barracks";
  if (type === "core") return "Core";
  return "All";
}

function defenseLabel(type) {
  if (type === "ballista") return "Ballista";
  if (type === "pulseTower") return "Pulse Tower";
  if (type === "barracks") return "Barracks";
  return "Defense";
}

function sellValue(item) {
  const rarityValue = CONFIG.loot.rarities[item.rarity]?.sell || 18;
  return Math.max(1, Math.round((item.value || item.tier * 18) + rarityValue + item.tier * 8));
}

function statLine(item) {
  if (!item.stats) {
    return "No stats";
  }
  return Object.entries(item.stats)
    .map(([key, value]) => `+${value} ${labelize(key)}`)
    .join(" / ");
}

function attributePreview(attribute) {
  if (attribute === "power") return "+3 hero damage per point.";
  if (attribute === "vitality") return "+22 max health per point.";
  if (attribute === "mobility") return "+7 movement speed per point.";
  return "Improves this attribute.";
}

function statusEffectSummary(player) {
  const statuses = [];
  if ((player.shield || 0) > 0) statuses.push(`Shield ${Math.ceil(player.shield)}`);
  if (player.isStealthed) statuses.push("Vanish");
  if ((player.speedMultiplierTimer || 0) > 0) statuses.push("Frenzy");
  if ((player.curseTimer || 0) > 0) statuses.push("Cursed");
  if (player.characterId === "berserker" && (player.rageStacks || 0) > 0) statuses.push(`Rage ${player.rageStacks}`);
  if (player.characterId === "warlock" && (player.soulStacks || 0) > 0) statuses.push(`Souls ${player.soulStacks}`);
  if (player.passiveStatusLabel) statuses.push(player.passiveStatusLabel);
  return statuses.slice(0, 3).join(" / ") || "Ready";
}

function riskColorText(playerLevel = 1, targetLevel = 1) {
  const diff = targetLevel - playerLevel;
  if (diff >= (CONFIG.levelDisplay?.highRiskDelta || 3)) return "#e85b58";
  if (diff >= (CONFIG.levelDisplay?.dangerousDelta || 2)) return "#ffb26a";
  if (diff <= (CONFIG.levelDisplay?.safeDelta || -2)) return "#63d46b";
  return "#e7bd58";
}

function difficultyLabelText(playerLevel = 1, targetLevel = 1) {
  const diff = targetLevel - playerLevel;
  if (diff >= (CONFIG.levelDisplay?.highRiskDelta || 3)) return "High Risk";
  if (diff >= (CONFIG.levelDisplay?.dangerousDelta || 2)) return "Danger";
  if (diff <= (CONFIG.levelDisplay?.safeDelta || -2)) return "Easy";
  return "Moderate";
}

function slotLabel(slot) {
  if (slot === "relic") return "Relic";
  return CONFIG.loot.equipmentSlots.find((entry) => entry.id === slot)?.label || "Loot";
}

function getSlotConfig(slotId) {
  return CONFIG.loot.equipmentSlots.find((slot) => slot.id === slotId) || null;
}

function slotAcceptsItem(slot, item) {
  if (slot.accepts) {
    return slot.accepts.includes(item.slot);
  }
  return item.slot === slot.id;
}

function labelize(value) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}










