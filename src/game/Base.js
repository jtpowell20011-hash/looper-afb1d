// @ts-check
import { CONFIG } from "./config.js?v=1.8.43";
import { Entity } from "./Entity.js?v=1.8.43";
import { distance, randRange } from "./math.js?v=1.8.43";

const BUILDING_RADIUS = {
  core: 34,
  wall: 18,
  tower: 25,
  ballista: 28,
  pulseTower: 26,
  barracks: 27,
  generator: 24
};

export class Building extends Entity {
  constructor({ type, x, y, ox = 0, oy = 0, level = 1, penalty = 1, width = null, height = null, layer = 1 }) {
    const config = CONFIG.base.buildings[type];
    super({
      id: `building-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      x,
      y,
      radius: BUILDING_RADIUS[type] || 24,
      maxHealth: Math.round(config.maxHealth * (1 + (level - 1) * 0.28) * penalty),
      team: "player"
    });
    this.type = type;
    this.label = config.label;
    this.level = level;
    this.ox = ox;
    this.oy = oy;
    this.layer = layer;
    this.energy = config.energy;
    this.fireTimer = randRange(0, 0.8);
    this.generatorTimer = 0;
    this.timeSinceDamage = CONFIG.base.passiveRepairDelay;
    this.width = width || this.radius * 2;
    this.height = height || this.radius * 2;
  }

  get upgradeCost() {
    const config = CONFIG.base.buildings[this.type];
    return {
      gold: Math.round((config.upgradeGold || 0) * (1 + this.level * 0.48)),
      resources: Math.round((config.upgradeBuild || 0) * (1 + this.level * 0.48))
    };
  }

  get towerDamage() {
    const config = CONFIG.base.buildings[this.type] || CONFIG.base.buildings.tower;
    return Math.round((config.damage + this.level * 7) * (this.defenseMultiplier || 1));
  }

  get towerRange() {
    const config = CONFIG.base.buildings[this.type] || CONFIG.base.buildings.tower;
    return config.range + this.level * 34;
  }

  get fireRate() {
    const config = CONFIG.base.buildings[this.type] || CONFIG.base.buildings.tower;
    return Math.max(0.36, config.fireRate - this.level * 0.09);
  }

  get generatorYield() {
    const config = CONFIG.base.buildings.generator;
    return {
      gold: config.goldPerTick + (this.level - 1) * 5,
      resources: config.buildPerTick + (this.level - 1) * 4
    };
  }

  upgrade() {
    this.level += 1;
    this.maxHealth = Math.round(this.maxHealth * 1.24);
    this.health = this.maxHealth;
    if ((isEnergyScalingType(this.type) || this.type === "generator") && this.level % 2 === 0) {
      this.energy += 1;
    }
  }

  takeDamage(amount) {
    const applied = super.takeDamage(amount);
    if (applied > 0) {
      this.timeSinceDamage = 0;
    }
    return applied;
  }
}

export class BaseController {
  constructor() {
    this.active = false;
    this.displaced = false;
    this.emergencyCount = 0;
    this.emergencyTimer = 0;
    this.energyCap = 0;
    this.buildings = [];
    this.upgradeCostMultiplier = 1;
    this.defenseMultiplier = 1;
    this.relicBuffTimer = 0;
    this.generatorTickTimer = 0;
    this.origin = { x: 0, y: 0 };
    this.expandedCoreLevels = new Set();
    this.wallHealthLevel = 1;
    this.layoutId = "outpost";
    this.visionBonus = 0;
  }

  get core() {
    return this.buildings.find((building) => building.type === "core" && building.alive) || null;
  }

  get energyUsed() {
    return this.buildings
      .filter((building) => building.alive)
      .reduce((sum, building) => sum + building.energy, 0);
  }

  get hasActiveCore() {
    return this.active && Boolean(this.core);
  }

  get livingBuildings() {
    return this.buildings.filter((building) => building.alive);
  }

  placeAt(x, y, { emergency = false, layoutId = this.layoutId, preserveSnapshot = null } = {}) {
    const emergencyLevel = emergency ? this.emergencyCount : 0;
    const nextLayoutId = CONFIG.base.layouts[layoutId] ? layoutId : "outpost";
    this.active = true;
    this.displaced = false;
    this.emergencyTimer = 0;
    this.origin = { x, y };
    this.layoutId = nextLayoutId;
    this.expandedCoreLevels = new Set();
    this.wallHealthLevel = preserveSnapshot?.wallHealthLevel || 1;
    this.visionBonus = CONFIG.base.layouts[nextLayoutId]?.baseVisionBonus || 0;
    this.energyCap =
      emergencyLevel === 0
        ? CONFIG.base.originalEnergyCap
        : emergencyLevel === 1
          ? CONFIG.base.firstEmergencyEnergyCap
          : CONFIG.base.secondEmergencyEnergyCap;
    this.upgradeCostMultiplier = emergencyLevel === 0 ? 1 : emergencyLevel === 1 ? 1.2 : 1.45;
    this.defenseMultiplier =
      emergencyLevel === 0
        ? 1
        : emergencyLevel === 1
          ? CONFIG.base.firstCoreLossDefenseMultiplier
          : CONFIG.base.secondCoreLossDefenseMultiplier;

    const penalty =
      emergencyLevel === 0
        ? 1
        : emergencyLevel === 1
          ? CONFIG.base.firstCoreLossHealthPenalty
          : CONFIG.base.secondCoreLossHealthPenalty;
    this.buildings = createStarterLayout(emergency, nextLayoutId, preserveSnapshot).map((item) => this.createBuilding(item, penalty));
    if (preserveSnapshot?.coreLevel > 1) {
      for (let level = 10; level <= Math.min(40, preserveSnapshot.coreLevel); level += 10) {
        this.addExpansionForCoreLevel(level);
      }
    }
    if (preserveSnapshot?.energyCap) {
      this.energyCap = Math.max(this.energyCap, preserveSnapshot.energyCap);
    }
    this.resolveInvalidBuildingPlacements();
  }

  relocateTo(x, y) {
    const dx = x - this.origin.x;
    const dy = y - this.origin.y;
    this.origin = { x, y };
    for (const building of this.buildings) {
      building.x += dx;
      building.y += dy;
    }
  }

  replotTo(x, y, layoutId = this.layoutId) {
    const nextLayoutId = CONFIG.base.layouts[layoutId] ? layoutId : this.layoutId;
    if (nextLayoutId === this.layoutId) {
      this.relocateTo(x, y);
      return;
    }
    const snapshot = this.createReplotSnapshot();
    this.placeAt(x, y, { emergency: false, layoutId: nextLayoutId, preserveSnapshot: snapshot });
  }

  createReplotSnapshot() {
    const typeLevels = {};
    const typeHealthRatios = {};
    for (const type of ["core", "tower", "ballista", "pulseTower", "generator", "barracks", "wall"]) {
      const buildings = this.buildings.filter((building) => building.type === type);
      if (buildings.length === 0) {
        continue;
      }
      typeLevels[type] = Math.max(1, Math.round(buildings.reduce((sum, building) => sum + building.level, 0) / buildings.length));
      typeHealthRatios[type] = Math.max(
        0.15,
        Math.min(1, buildings.reduce((sum, building) => sum + (building.healthRatio || 0), 0) / buildings.length)
      );
    }
    return {
      coreLevel: this.core?.level || 1,
      energyCap: this.energyCap,
      wallHealthLevel: this.wallHealthLevel,
      expandedCoreLevels: [...this.expandedCoreLevels],
      typeLevels,
      typeHealthRatios
    };
  }

  createBuilding(item, penalty = 1) {
    const building = new Building({
      type: item.type,
      x: this.origin.x + item.ox,
      y: this.origin.y + item.oy,
      ox: item.ox,
      oy: item.oy,
      level: item.level || 1,
      penalty,
      width: item.width,
      height: item.height,
      layer: item.layer || 1
    });
    if (building.type === "wall") {
      const multiplier = this.wallHealthMultiplier;
      building.maxHealth = Math.round(building.maxHealth * multiplier);
      building.health = building.maxHealth;
      building.wallHealthLevel = this.wallHealthLevel;
    }
    if (Number.isFinite(item.healthRatio)) {
      building.health = Math.max(building.alive ? 1 : 0, Math.round(building.maxHealth * clamp01(item.healthRatio)));
    }
    building.defenseMultiplier = this.defenseMultiplier;
    return building;
  }

  getHeroBonus() {
    return CONFIG.base.layouts[this.layoutId]?.heroBonus || {};
  }

  getLayoutPreview(x, y, layoutId = this.layoutId) {
    const nextLayoutId = CONFIG.base.layouts[layoutId] ? layoutId : "outpost";
    return createStarterLayout(false, nextLayoutId).map((item) => ({
      ...item,
      x: x + item.ox,
      y: y + item.oy,
      radius: BUILDING_RADIUS[item.type] || 24,
      label: CONFIG.base.buildings[item.type]?.label || item.type
    }));
  }

  get wallHealthMultiplier() {
    return 1 + (this.wallHealthLevel - 1) * CONFIG.base.wallHealthUpgrade.healthBonus;
  }

  addExpansionForCoreLevel(coreLevel) {
    const layer = Math.floor(coreLevel / 10);
    if (layer < 1 || layer > 4 || this.expandedCoreLevels.has(layer)) {
      return [];
    }
    const expansion = createExpansionLayout(layer, this.getBalancedDefenseLevel());
    if (expansion.length === 0) {
      return [];
    }
    this.expandedCoreLevels.add(layer);
    const created = expansion.map((item) => this.createBuilding(item, 1));
    this.buildings.push(...created);
    this.resolveInvalidBuildingPlacements();
    this.energyCap += CONFIG.base.expansionEnergyBonus;
    return created;
  }

  destroyBase() {
    this.active = false;
    this.buildings = [];
    this.displaced = true;
    this.emergencyTimer = CONFIG.base.emergencyWindow;
  }

  update(dt, scene) {
    if (this.displaced) {
      this.emergencyTimer = Math.max(0, this.emergencyTimer - dt);
    }

    if (!this.active) {
      return;
    }

    this.relicBuffTimer = Math.max(0, this.relicBuffTimer - dt);
    const buffMultiplier = this.relicBuffTimer > 0 ? 1.35 : 1;

    for (const building of this.livingBuildings) {
      if (isDefenseType(building.type)) {
        building.defenseMultiplier = this.defenseMultiplier * buffMultiplier;
        this.updateTower(building, dt, scene);
      } else if (building.type === "barracks") {
        building.defenseMultiplier = this.defenseMultiplier * buffMultiplier;
        scene.updateBarracks?.(building, this, dt);
      }
    }
    this.updatePassiveRepairs(dt, scene);

    this.generatorTickTimer += dt;
    if (this.generatorTickTimer >= CONFIG.base.generatorTick) {
      this.generatorTickTimer = 0;
      for (const generator of this.livingBuildings.filter((building) => building.type === "generator")) {
        const yieldValue = generator.generatorYield;
        scene.player.currency += yieldValue.gold;
        scene.player.resources += yieldValue.resources;
        scene.spawnBaseEffect({
          type: "pulse",
          x: generator.x,
          y: generator.y,
          color: "#72d8e8",
          radius: 34,
          life: 0.75,
          maxLife: 0.75
        });
        scene.addFloatingText(generator.x, generator.y - 28, `+${yieldValue.gold}g +${yieldValue.resources}b`, "#e7bd58");
      }
    }

    if (!this.core) {
      this.active = false;
      this.buildings = [];
      scene.applyCoreDestroyedPenalty();
      if (scene.player.alive && this.emergencyCount < CONFIG.base.maxEmergencyRebuilds) {
        this.emergencyCount += 1;
        this.displaced = true;
        this.emergencyTimer = CONFIG.base.emergencyWindow;
        scene.addToast(`Core destroyed. Emergency rebuild ${this.emergencyCount}/2 available for ${CONFIG.base.emergencyWindow}s.`);
      } else {
        this.displaced = true;
        this.emergencyTimer = 0;
        scene.addToast("Core destroyed. No rebuilds remain.");
      }
    }
  }

  updateTower(tower, dt, scene) {
    tower.fireTimer = Math.max(0, tower.fireTimer - dt);
    if (tower.fireTimer > 0) {
      return;
    }

    const target = scene.findNearestEnemyForPlayerBase?.(tower, tower.towerRange) || scene.findNearestMob(tower, tower.towerRange);
    if (!target) {
      return;
    }

    const overclock = scene.getDefenseOverclock?.(scene.player.id, tower) || { damage: 1, fireRate: 1 };
    tower.fireTimer = tower.fireRate / Math.max(0.1, overclock.fireRate || 1);
    const projectileColor = tower.type === "ballista" ? "#e7bd58" : tower.type === "pulseTower" ? "#b391f0" : "#63d46b";
    scene.spawnBaseEffect({
      type: "beam",
      x: tower.x,
      y: tower.y,
      targetX: target.x,
      targetY: target.y,
      color: projectileColor,
      life: 0.18,
      maxLife: 0.18
    });
    scene.spawnProjectile({
      x: tower.x,
      y: tower.y,
      vx: ((target.x - tower.x) / Math.max(1, distance(tower, target))) * (CONFIG.combat?.towerProjectiles?.baseSpeed || 610),
      vy: ((target.y - tower.y) / Math.max(1, distance(tower, target))) * (CONFIG.combat?.towerProjectiles?.baseSpeed || 610),
      radius: tower.type === "ballista" ? 7 : tower.type === "pulseTower" ? 8 : 5,
      range: tower.towerRange + 80,
      damage: Math.round(tower.towerDamage * (overclock.damage || 1)),
      color: projectileColor,
      pierce: false,
      sourceId: tower.id,
      sourceOwnerId: scene.player.id,
      sourceX: tower.x,
      sourceY: tower.y,
      sourceKind: "tower",
      towerLevel: tower.level,
      towerType: tower.type,
      team: "player"
    });
  }

  updatePassiveRepairs(dt, scene = null) {
    for (const building of this.livingBuildings) {
      if (!isDefenseType(building.type)) {
        continue;
      }
      building.timeSinceDamage = Math.min(CONFIG.base.passiveRepairDelay + 10, (building.timeSinceDamage || 0) + dt);
      if (building.timeSinceDamage < CONFIG.base.passiveRepairDelay || building.health >= building.maxHealth) {
        continue;
      }
      const repairPerSecond = Math.max(2, building.maxHealth * CONFIG.base.passiveRepairPercentPerSecond);
      const previousHealth = building.health;
      building.health = Math.min(building.maxHealth, building.health + repairPerSecond * dt);
      if (scene && Math.floor(previousHealth) < Math.floor(building.health) && Math.random() < 0.015) {
        scene.spawnBaseEffect?.({
          type: "pulse",
          x: building.x,
          y: building.y,
          color: "#63d46b",
          radius: building.radius + 8,
          life: 0.45,
          maxLife: 0.45
        });
      }
    }
  }

  getNearestLivingBuilding(source) {
    let best = null;
    let bestDistance = Infinity;
    for (const building of this.livingBuildings) {
      const currentDistance = building.type === "wall" ? distanceToRect(source, building) : distance(source, building);
      if (currentDistance < bestDistance) {
        best = building;
        bestDistance = currentDistance;
      }
    }
    return best;
  }

  getUpgradeTarget(type) {
    const candidates = this.livingBuildings.filter((building) => building.type === type);
    candidates.sort((a, b) => a.level - b.level);
    return candidates[0] || null;
  }

  getUpgradeCandidates(type = null) {
    const types =
      type === "tower"
        ? ["tower", "ballista", "pulseTower"]
        : type
          ? [type]
          : ["core", "tower", "ballista", "pulseTower", "barracks", "generator"];
    return this.livingBuildings
      .filter((building) => types.includes(building.type) && CONFIG.base.buildings[building.type]?.upgradeGold)
      .sort((a, b) => a.level - b.level || a.type.localeCompare(b.type));
  }

  getUpgradeInfoById(id) {
    const building = this.livingBuildings.find((candidate) => candidate.id === id);
    if (!building) {
      return null;
    }
    const cost = building.upgradeCost;
    const finalCost = {
      gold: Math.round(cost.gold * this.upgradeCostMultiplier),
      resources: Math.round(cost.resources * this.upgradeCostMultiplier)
    };
    const addedEnergy = (isEnergyScalingType(building.type) || building.type === "generator") && (building.level + 1) % 2 === 0 ? 1 : 0;
    const core = this.core;
    const levelCapped = building.type !== "core" && core && building.level >= core.level;
    return {
      building,
      cost: finalCost,
      addedEnergy,
      canFitEnergy: this.energyUsed + addedEnergy <= this.energyCap,
      levelCapped,
      coreLevel: core?.level || 0
    };
  }

  getBalancedDefenseLevel() {
    const towers = this.livingBuildings.filter((building) => building.type === "tower");
    if (towers.length === 0) {
      return 1;
    }
    const total = towers.reduce((sum, building) => sum + building.level, 0);
    return Math.max(1, Math.round(total / towers.length));
  }

  getCurrentLayer() {
    const core = this.core;
    if (!core) {
      return 0;
    }
    return Math.min(4, Math.max(1, Math.floor(core.level / 10) + 1));
  }

  getDefenseShopInfo(type) {
    const config = CONFIG.base.buildings[type];
    const core = this.core;
    if (!config || !core || !isPurchasableDefenseType(type)) {
      return null;
    }
    const purchasedSame = this.livingBuildings.filter((building) => building.type === type && building.purchasedDefense).length;
    const purchasedPairs = Math.floor(purchasedSame / 2);
    const layer = this.getCurrentLayer();
    const unlockCoreLevel = config.unlockCoreLevel || 1;
    const lockedByCore = core.level < unlockCoreLevel;
    const maxCount =
      type === "barracks"
        ? core.level >= 20
          ? 2
          : core.level >= 10
            ? 1
            : 0
        : Infinity;
    const count = type === "barracks" ? 1 : 2;
    const countCapped = type === "barracks" && purchasedSame >= maxCount;
    const cost = {
      gold: Math.round(((config.shopGold || 0) + layer * 48 + core.level * 14 + purchasedPairs * 72) * 1.35),
      resources: Math.round(((config.shopBuild || 0) + layer * 28 + core.level * 9 + purchasedPairs * 48) * 1.35)
    };
    const level = 1;
    return {
      type,
      label: type === "barracks" ? config.label : `${config.label} Pair`,
      cost,
      level,
      energy: config.energy * count,
      count,
      unlockCoreLevel,
      lockedByCore,
      countCapped,
      canPurchase: !lockedByCore && !countCapped,
      canFitEnergy: this.energyUsed + config.energy * count <= this.energyCap
    };
  }

  purchaseDefense(type, player) {
    const info = this.getDefenseShopInfo(type);
    if (!info) {
      return { ok: false, message: "No active core for defense purchases." };
    }
    if (info.lockedByCore) {
      return { ok: false, message: `${info.label} unlocks at core level ${info.unlockCoreLevel}.` };
    }
    if (info.countCapped) {
      return { ok: false, message: `${info.label} purchase cap reached. Upgrade the core to unlock more.` };
    }
    if (player.currency < info.cost.gold || player.resources < info.cost.resources) {
      return { ok: false, message: `Need ${info.cost.gold} gold and ${info.cost.resources} build.` };
    }
    if (!info.canFitEnergy) {
      return { ok: false, message: `${info.label} would exceed base energy.` };
    }

    player.currency -= info.cost.gold;
    player.resources -= info.cost.resources;
    const purchasedSame = this.livingBuildings.filter((building) => building.type === type && building.purchasedDefense).length;
    const pairIndex = Math.floor(purchasedSame / 2);
    const positions =
      type === "barracks"
        ? purchasedBarracksPositions(purchasedSame, this.getCurrentLayer())
        : purchasedDefensePairPositions(type, pairIndex, this.getCurrentLayer());
    const created = positions.map((position) => {
      const building = this.createBuilding({
        type,
        ox: position.ox,
        oy: position.oy,
        level: info.level,
        layer: this.getCurrentLayer()
      });
      building.purchasedDefense = true;
      return building;
    });
    this.buildings.push(...created);
    this.resolveInvalidBuildingPlacements(created);
    return { ok: true, message: `${info.label} L${info.level} added symmetrically.` };
  }

  upgrade(type, player) {
    const target = this.getUpgradeTarget(type);
    if (!target) {
      return { ok: false, message: "No matching building." };
    }

    const cost = target.upgradeCost;
    const finalCost = {
      gold: Math.round(cost.gold * this.upgradeCostMultiplier),
      resources: Math.round(cost.resources * this.upgradeCostMultiplier)
    };

    if (player.currency < finalCost.gold || player.resources < finalCost.resources) {
      return { ok: false, message: `Need ${finalCost.gold} gold and ${finalCost.resources} build.` };
    }
    if (target.type !== "core" && this.core && target.level >= this.core.level) {
      return { ok: false, message: `${target.label} cannot exceed core level ${this.core.level}.` };
    }

    const addedEnergy = (isEnergyScalingType(type) || type === "generator") && (target.level + 1) % 2 === 0 ? 1 : 0;
    if (this.energyUsed + addedEnergy > this.energyCap) {
      return { ok: false, message: "Base energy cap would be exceeded." };
    }

    player.currency -= finalCost.gold;
    player.resources -= finalCost.resources;
    target.upgrade();
    if (type === "core") {
      this.energyCap += 2;
      const created = this.addExpansionForCoreLevel(target.level);
      if (created.length > 0) {
        return {
          ok: true,
          message: `Core upgraded to level ${target.level}. New wall layer and defenses deployed.`
        };
      }
    }
    return { ok: true, message: `${target.label} upgraded to level ${target.level}.` };
  }

  upgradeById(id, player) {
    const info = this.getUpgradeInfoById(id);
    if (!info) {
      return { ok: false, message: "No matching building." };
    }
    const target = info.building;

    if (player.currency < info.cost.gold || player.resources < info.cost.resources) {
      return { ok: false, message: `Need ${info.cost.gold} gold and ${info.cost.resources} build.` };
    }

    if (info.levelCapped) {
      return { ok: false, message: `${target.label} cannot exceed core level ${info.coreLevel}.` };
    }

    if (!info.canFitEnergy) {
      return { ok: false, message: "Base energy cap would be exceeded." };
    }

    player.currency -= info.cost.gold;
    player.resources -= info.cost.resources;
    target.upgrade();
    if (target.type === "core") {
      this.energyCap += 2;
      const created = this.addExpansionForCoreLevel(target.level);
      if (created.length > 0) {
        return { ok: true, message: `Core upgraded to level ${target.level}. New wall layer and defenses deployed.` };
      }
    }
    return { ok: true, message: `${target.label} upgraded to level ${target.level}.` };
  }

  getWallRepairInfo() {
    const walls = this.livingBuildings.filter((building) => building.type === "wall");
    const missingHealth = walls.reduce((sum, wall) => sum + Math.max(0, wall.maxHealth - wall.health), 0);
    const costMultiplier = this.upgradeCostMultiplier * this.wallCostMultiplier;
    const cost = {
      gold: Math.ceil(missingHealth * 0.72 * costMultiplier),
      resources: Math.ceil(missingHealth * 0.58 * costMultiplier)
    };
    return {
      missingHealth: Math.ceil(missingHealth),
      wallCount: walls.length,
      cost,
      canRepair: missingHealth > 0
    };
  }

  getDestroyedWallInfo() {
    const destroyedWalls = this.buildings.filter((building) => building.type === "wall" && !building.alive);
    const wallCount = destroyedWalls.length;
    const averageLevel =
      wallCount > 0 ? destroyedWalls.reduce((sum, wall) => sum + (wall.level || 1), 0) / Math.max(1, wallCount) : 1;
    const costMultiplier = this.upgradeCostMultiplier * this.wallCostMultiplier;
    const cost = {
      gold: Math.ceil(wallCount * (120 + averageLevel * 28) * costMultiplier),
      resources: Math.ceil(wallCount * (85 + averageLevel * 20) * costMultiplier)
    };
    return {
      wallCount,
      cost,
      canRebuild: wallCount > 0
    };
  }

  rebuildDestroyedWalls(player) {
    const info = this.getDestroyedWallInfo();
    if (!info.canRebuild) {
      return { ok: false, message: "No destroyed walls to rebuild." };
    }
    if (player.currency < info.cost.gold || player.resources < info.cost.resources) {
      return { ok: false, message: `Need ${info.cost.gold} gold and ${info.cost.resources} build to rebuild walls.` };
    }
    player.currency -= info.cost.gold;
    player.resources -= info.cost.resources;
    for (const wall of this.buildings.filter((building) => building.type === "wall" && !building.alive)) {
      wall.alive = true;
      wall.health = wall.maxHealth;
    }
    return { ok: true, message: `${info.wallCount} destroyed wall${info.wallCount === 1 ? "" : "s"} rebuilt.` };
  }

  repairWalls(player) {
    const info = this.getWallRepairInfo();
    if (!info.canRepair) {
      return { ok: false, message: "Walls are already fully repaired." };
    }
    if (player.currency < info.cost.gold || player.resources < info.cost.resources) {
      return { ok: false, message: `Need ${info.cost.gold} gold and ${info.cost.resources} build to repair walls.` };
    }
    player.currency -= info.cost.gold;
    player.resources -= info.cost.resources;
    for (const wall of this.livingBuildings.filter((building) => building.type === "wall")) {
      wall.health = wall.maxHealth;
    }
    return { ok: true, message: `Walls repaired for ${info.cost.gold}g/${info.cost.resources}b.` };
  }

  get wallCostMultiplier() {
    return 1 + (this.wallHealthLevel - 1) * CONFIG.base.wallHealthUpgrade.repairCostBonus;
  }

  getWallHealthUpgradeInfo() {
    const config = CONFIG.base.wallHealthUpgrade;
    const nextLevel = this.wallHealthLevel + 1;
    const cost = {
      gold: Math.round(config.gold * Math.pow(config.costGrowth, this.wallHealthLevel - 1) * this.upgradeCostMultiplier),
      resources: Math.round(config.resources * Math.pow(config.costGrowth, this.wallHealthLevel - 1) * this.upgradeCostMultiplier)
    };
    return {
      level: this.wallHealthLevel,
      nextLevel,
      maxLevel: config.maxLevel,
      cost,
      healthBonus: config.healthBonus,
      canUpgrade: this.active && this.wallHealthLevel < config.maxLevel
    };
  }

  upgradeWallHealth(player) {
    const info = this.getWallHealthUpgradeInfo();
    if (!info.canUpgrade) {
      return { ok: false, message: "Wall health is already at the current cap." };
    }
    if (player.currency < info.cost.gold || player.resources < info.cost.resources) {
      return { ok: false, message: `Need ${info.cost.gold} gold and ${info.cost.resources} build for wall health.` };
    }
    player.currency -= info.cost.gold;
    player.resources -= info.cost.resources;
    const oldMultiplier = this.wallHealthMultiplier;
    this.wallHealthLevel += 1;
    const ratio = this.wallHealthMultiplier / oldMultiplier;
    for (const wall of this.buildings.filter((building) => building.type === "wall")) {
      const oldMax = wall.maxHealth;
      wall.maxHealth = Math.round(wall.maxHealth * ratio);
      wall.health = wall.alive ? Math.min(wall.maxHealth, wall.health + Math.max(0, wall.maxHealth - oldMax)) : 0;
      wall.wallHealthLevel = this.wallHealthLevel;
    }
    return { ok: true, message: `Wall health upgraded to tier ${this.wallHealthLevel}. Repairs and rebuilds now cost more.` };
  }

  isPointInsideAnyWallLayer(point) {
    const maxBounds = this.getWallBounds();
    if (!maxBounds) {
      return false;
    }
    const wallLayers = this.getWallLayerBounds();
    for (const bounds of wallLayers.values()) {
      if (
        point.x >= this.origin.x - bounds.x &&
        point.x <= this.origin.x + bounds.x &&
        point.y >= this.origin.y - bounds.y &&
        point.y <= this.origin.y + bounds.y
      ) {
        return true;
      }
    }
    return false;
  }

  getWallBounds() {
    const layers = this.getWallLayerBounds();
    let bounds = null;
    for (const layerBounds of layers.values()) {
      bounds = {
        x: Math.max(bounds?.x || 0, layerBounds.x),
        y: Math.max(bounds?.y || 0, layerBounds.y)
      };
    }
    return bounds;
  }

  getWallLayerBounds() {
    const wallLayers = new Map();
    for (const wall of this.buildings.filter((building) => building.type === "wall")) {
      const layer = wall.layer || 1;
      const current = wallLayers.get(layer) || { x: 0, y: 0 };
      wallLayers.set(layer, {
        x: Math.max(current.x, Math.abs(wall.ox || 0) + (wall.width || 0) / 2),
        y: Math.max(current.y, Math.abs(wall.oy || 0) + (wall.height || 0) / 2)
      });
    }
    return wallLayers;
  }

  resolveInvalidBuildingPlacements(targetBuildings = null) {
    const movableTypes = new Set(["tower", "ballista", "pulseTower", "generator", "barracks"]);
    const targets = (targetBuildings || this.buildings).filter((building) => building.alive && movableTypes.has(building.type));
    if (targets.length === 0) {
      return;
    }
    const occupied = this.livingBuildings
      .filter((building) => building.type !== "wall" && building.type !== "core" && !targets.includes(building))
      .map((building) => ({ ox: building.ox || 0, oy: building.oy || 0, radius: building.radius || 24, id: building.id }));
    for (const building of targets) {
      const localOccupied = occupied.filter((entry) => entry.id !== building.id);
      if (!this.isBuildingSlotValid(building, building.ox || 0, building.oy || 0, localOccupied)) {
        const slot = this.findNearestValidBuildingSlot(building, localOccupied);
        if (slot) {
          building.ox = slot.ox;
          building.oy = slot.oy;
          building.x = this.origin.x + slot.ox;
          building.y = this.origin.y + slot.oy;
        }
      }
      occupied.push({ ox: building.ox || 0, oy: building.oy || 0, radius: building.radius || 24, id: building.id });
    }
  }

  findNearestValidBuildingSlot(building, occupied) {
    const slots = this.getBuildingSlots(building);
    const origin = { ox: building.ox || 0, oy: building.oy || 0 };
    slots.sort((a, b) => Math.hypot(a.ox - origin.ox, a.oy - origin.oy) - Math.hypot(b.ox - origin.ox, b.oy - origin.oy));
    return slots.find((slot) => this.isBuildingSlotValid(building, slot.ox, slot.oy, occupied)) || null;
  }

  getBuildingSlots(building) {
    const spacing = CONFIG.base.wallSpacing || {};
    const type = building.type;
    const ratios =
      type === "generator"
        ? spacing.generatorSlotRatios || []
        : type === "barracks"
          ? spacing.barracksSlotRatios || []
          : spacing.towerSlotRatios || [];
    const layer = Math.max(1, building.layer || 1);
    const bounds = this.getSlotBoundsForLayer(layer);
    const slots = [];
    for (const ratio of ratios) {
      slots.push({
        ox: Math.round(bounds.x * ratio.x),
        oy: Math.round(bounds.y * ratio.y)
      });
    }
    if (type === "tower" || type === "ballista" || type === "pulseTower") {
      slots.push(
        { ox: -Math.round(bounds.x * 0.74), oy: 0 },
        { ox: Math.round(bounds.x * 0.74), oy: 0 },
        { ox: 0, oy: -Math.round(bounds.y * 0.74) },
        { ox: 0, oy: Math.round(bounds.y * 0.74) }
      );
    }
    return slots;
  }

  getSlotBoundsForLayer(layer) {
    if (layer <= 1) {
      return interiorBounds(1);
    }
    const wallLayers = this.getWallLayerBounds();
    const previous = wallLayers.get(layer - 1) || interiorBounds(layer - 1);
    const current = wallLayers.get(layer) || interiorBounds(layer);
    return {
      x: Math.max(80, (previous.x + current.x) / 2),
      y: Math.max(80, (previous.y + current.y) / 2)
    };
  }

  isBuildingSlotValid(building, ox, oy, occupied = []) {
    const padding = CONFIG.base.wallSpacing?.buildingWallPadding || 42;
    const test = {
      x: this.origin.x + ox,
      y: this.origin.y + oy,
      radius: building.radius || 24
    };
    for (const wall of this.livingBuildings.filter((candidate) => candidate.type === "wall")) {
      if (distanceToRect(test, wall) < test.radius + padding) {
        return false;
      }
    }
    const slotPadding = CONFIG.base.wallSpacing?.buildingSlotPadding || 64;
    for (const other of occupied) {
      if (Math.hypot(ox - other.ox, oy - other.oy) < test.radius + (other.radius || 24) + slotPadding) {
        return false;
      }
    }
    return true;
  }

  applyRelicBuff(seconds) {
    this.relicBuffTimer = Math.max(this.relicBuffTimer, seconds);
  }
}

function createStarterLayout(emergency, layoutId = "outpost", snapshot = null) {
  const layout = CONFIG.base.layouts[layoutId] || CONFIG.base.layouts.outpost;
  const typeLevels = snapshot?.typeLevels || {};
  const typeHealthRatios = snapshot?.typeHealthRatios || {};
  const wallScale = layout.wallScale || 1;
  const spacing = CONFIG.base.wallSpacing || {};
  const radiusX = Math.round((spacing.starterRadiusX || 292) * wallScale);
  const radiusY = Math.round((spacing.starterRadiusY || 236) * wallScale);
  const wallLevel = typeLevels.wall || layout.wallLevel || 1;
  const coreLevel = emergency ? 1 : snapshot?.coreLevel || 2;
  const entries = [
    {
      type: "core",
      ox: 0,
      oy: 0,
      level: coreLevel,
      layer: 1,
      healthRatio: typeHealthRatios.core || 1
    }
  ];
  for (const tower of layout.towers || []) {
    entries.push({
      type: "tower",
      ox: tower.ox,
      oy: tower.oy,
      level: typeLevels.tower || tower.level || 1,
      layer: 1,
      healthRatio: typeHealthRatios.tower || 1
    });
  }
  for (const generator of layout.generators || []) {
    entries.push({
      type: "generator",
      ox: generator.ox,
      oy: generator.oy,
      level: typeLevels.generator || generator.level || 1,
      layer: 1,
      healthRatio: typeHealthRatios.generator || 1
    });
  }
  entries.push(...createWallRing(radiusX, radiusY, 1, wallLevel, typeHealthRatios.wall || 1));
  return entries;
}

function createExpansionLayout(layer, defenseLevel) {
  const buildingLayer = layer + 1;
  const rings = CONFIG.base.wallSpacing?.expansionRings || [
    { x: 420, y: 348 },
    { x: 552, y: 464 },
    { x: 690, y: 584 },
    { x: 830, y: 708 }
  ];
  const ring = rings[Math.max(0, Math.min(rings.length - 1, layer - 1))];
  if (layer === 1) {
    return [
      ...createWallRing(ring.x, ring.y, buildingLayer),
      { type: "tower", ox: -Math.round(ring.x * 0.62), oy: Math.round(ring.y * 0.72), level: defenseLevel, layer: buildingLayer },
      { type: "generator", ox: Math.round(ring.x * 0.62), oy: Math.round(ring.y * 0.72), layer: buildingLayer }
    ];
  }
  if (layer === 2) {
    return [
      ...createWallRing(ring.x, ring.y, buildingLayer),
      { type: "tower", ox: -Math.round(ring.x * 0.72), oy: -Math.round(ring.y * 0.72), level: defenseLevel, layer: buildingLayer },
      { type: "tower", ox: Math.round(ring.x * 0.72), oy: -Math.round(ring.y * 0.72), level: defenseLevel, layer: buildingLayer }
    ];
  }
  if (layer === 3) {
    return [
      ...createWallRing(ring.x, ring.y, buildingLayer),
      { type: "tower", ox: -Math.round(ring.x * 0.72), oy: 0, level: defenseLevel, layer: buildingLayer },
      { type: "tower", ox: Math.round(ring.x * 0.72), oy: 0, level: defenseLevel, layer: buildingLayer },
      { type: "generator", ox: 0, oy: Math.round(ring.y * 0.74), layer: buildingLayer }
    ];
  }
  if (layer === 4) {
    return [
      ...createWallRing(ring.x, ring.y, buildingLayer),
      { type: "tower", ox: -Math.round(ring.x * 0.7), oy: -Math.round(ring.y * 0.72), level: defenseLevel, layer: buildingLayer },
      { type: "tower", ox: Math.round(ring.x * 0.7), oy: -Math.round(ring.y * 0.72), level: defenseLevel, layer: buildingLayer },
      { type: "generator", ox: 0, oy: -Math.round(ring.y * 0.74), layer: buildingLayer }
    ];
  }
  return [];
}

function createWallRing(radiusX, radiusY, layer, level = 1, healthRatio = 1) {
  const thickness = CONFIG.base.wallSpacing?.wallThickness || 14;
  return [
    { type: "wall", ox: 0, oy: -radiusY, width: radiusX * 2 + thickness, height: thickness, layer, level, healthRatio },
    { type: "wall", ox: 0, oy: radiusY, width: radiusX * 2 + thickness, height: thickness, layer, level, healthRatio },
    { type: "wall", ox: -radiusX, oy: 0, width: thickness, height: radiusY * 2 + thickness, layer, level, healthRatio },
    { type: "wall", ox: radiusX, oy: 0, width: thickness, height: radiusY * 2 + thickness, layer, level, healthRatio }
  ];
}

function purchasedDefensePairPositions(type, pairIndex, layer) {
  const bounds = interiorBounds(layer);
  const ballistaSlots = [
    { x: 0.9, y: 0 },
    { x: 0.38, y: 0.84 },
    { x: 0.38, y: -0.84 },
    { x: 0.72, y: 0.42 },
    { x: 0.72, y: -0.42 }
  ];
  const pulseSlots = [
    { x: 0.38, y: 0 },
    { x: 0.58, y: -0.34 },
    { x: 0.58, y: 0.34 },
    { x: 0.24, y: -0.62 },
    { x: 0.24, y: 0.62 }
  ];
  const slots = type === "pulseTower" ? pulseSlots : ballistaSlots;
  const slot = slots[pairIndex % slots.length];
  const band = Math.floor(pairIndex / slots.length);
  const shrink = Math.max(0.74, 1 - band * 0.08);
  const x = Math.round(bounds.x * slot.x * shrink);
  const y = Math.round(bounds.y * slot.y * shrink);
  return [
    { ox: -x, oy: y },
    { ox: x, oy: y }
  ];
}

function purchasedBarracksPositions(index, layer) {
  const bounds = interiorBounds(layer);
  const y = index % 2 === 0 ? -Math.round(bounds.y * 0.52) : Math.round(bounds.y * 0.52);
  return [{ ox: 0, oy: y }];
}

function interiorBounds(layer) {
  const ringBounds = CONFIG.base.wallSpacing?.interiorBounds || [
    { x: 232, y: 176 },
    { x: 352, y: 276 },
    { x: 484, y: 392 },
    { x: 622, y: 512 },
    { x: 762, y: 636 }
  ];
  return ringBounds[Math.max(0, Math.min(ringBounds.length - 1, layer - 1))];
}

function isDefenseType(type) {
  return type === "tower" || type === "ballista" || type === "pulseTower";
}

function isPurchasableDefenseType(type) {
  return type === "ballista" || type === "pulseTower" || type === "barracks";
}

function isEnergyScalingType(type) {
  return isDefenseType(type) || type === "barracks";
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function distanceToRect(source, rectEntity) {
  const halfW = (rectEntity.width || rectEntity.radius * 2) / 2;
  const halfH = (rectEntity.height || rectEntity.radius * 2) / 2;
  const nearestX = Math.max(rectEntity.x - halfW, Math.min(rectEntity.x + halfW, source.x));
  const nearestY = Math.max(rectEntity.y - halfH, Math.min(rectEntity.y + halfH, source.y));
  return Math.hypot(source.x - nearestX, source.y - nearestY);
}










