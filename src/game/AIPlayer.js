// @ts-check
import { BaseController } from "./Base.js?v=1.8.65";
import { getCharacterClass, randomCharacterClassId } from "./CharacterClasses.js?v=1.8.65";
import { CONFIG } from "./config.js?v=1.8.65";
import { Player } from "./Player.js?v=1.8.65";
import { clamp, distance, distanceSq, normalize, randRange } from "./math.js?v=1.8.65";

const AI_NAMES = ["Ash Vane", "Mira Core", "Dax Hollow", "Rune Vale", "Kira Forge", "Sol Warden", "Nyx Cairn"];
const AI_COLORS = ["#ff8068", "#b391f0", "#ffb26a", "#e85b58", "#63d46b", "#f0c85d", "#6ec7d6"];
const AI_PERSONALITIES = ["Raider", "Farmer", "Objective Controller", "Turtler", "Boss Hunter"];

export class AIPlayerController {
  constructor(index, spawnPoint, options = {}) {
    this.id = `ai-player-${index + 1}`;
    this.name = AI_NAMES[index % AI_NAMES.length];
    this.characterId = getCharacterClass(options.characterId || randomCharacterClassId()).id;
    this.characterClass = getCharacterClass(this.characterId);
    this.personality = options.personality || AI_PERSONALITIES[index % AI_PERSONALITIES.length];
    this.color = options.color || this.characterClass.color || AI_COLORS[index % AI_COLORS.length];
    this.player = new Player(spawnPoint.x, spawnPoint.y, this.characterId);
    this.player.id = this.id;
    this.player.displayName = this.name;
    this.player.team = "ai";
    this.player.color = this.color;
    this.player.currency = 120 + index * 20;
    this.player.resources = 90 + index * 16;
    this.base = new BaseController();
    this.intent = "scout";
    this.goal = { x: spawnPoint.x + randRange(-280, 280), y: spawnPoint.y + randRange(-280, 280) };
    this.homePoint = { x: spawnPoint.x, y: spawnPoint.y };
    this.thinkTimer = randRange(0.2, 0.9);
    this.baseActionTimer = randRange(1.4, 2.8);
    this.captureTargetId = null;
    this.eliminated = false;
    this.baseNoticeShown = false;
  }

  get alive() {
    return this.player.alive && !this.eliminated;
  }

  update(dt, scene) {
    if (this.eliminated) {
      return;
    }

    this.player.abilityBook.update(dt);
    this.player.tickStatuses?.(dt);
    this.player.tickRecovery?.(dt);
    this.updateBase(dt, scene);

    if (!this.player.alive) {
      this.player.respawnTimer = Math.max(0, this.player.respawnTimer - dt);
      if (this.player.respawnTimer <= 0) {
        const core = this.base.core;
        if (core) {
          this.player.respawnAt(core.x + randRange(-90, 90), core.y + randRange(-90, 90));
        } else {
          this.eliminated = true;
        }
      }
      return;
    }

    this.pickupNearbyLoot(scene);
    this.autoEquipLoot();
    this.manageBase(dt, scene);
    if (this.player.stunTimer > 0) {
      this.player.vx *= Math.max(0, 1 - 12 * dt);
      this.player.vy *= Math.max(0, 1 - 12 * dt);
      this.player.updateVisual(dt);
      return;
    }

    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = randRange(CONFIG.ai?.thinkIntervalMin || 0.55, CONFIG.ai?.thinkIntervalMax || 1.35);
      this.chooseIntent(scene);
    }

    this.act(dt, scene);
    this.player.updateVisual(dt);
  }

  chooseIntent(scene) {
    if (this.base.displaced && this.base.emergencyTimer > 0) {
      this.intent = "settle";
      this.goal = this.player;
      return;
    }

    if (!this.base.active && scene.match.canPlaceBase) {
      this.intent = "settle";
      this.goal = this.homePoint;
      return;
    }

    const canSeeHuman = scene.canTargetEntity?.(scene.player, "ai") ?? scene.player.alive;
    const playerDistance = canSeeHuman ? distance(this.player, scene.player) : Infinity;
    const wantsFight = ["guardian", "shadowblade", "berserker", "sentinel"].includes(this.characterId) || this.personality === "Raider";
    if (playerDistance < (wantsFight ? 1120 : 760) && this.player.healthRatio > 0.28) {
      this.intent = "duel";
      this.goal = scene.player;
      return;
    }

    if (this.player.healthRatio < 0.32 && this.base.core) {
      this.intent = "retreat";
      this.goal = this.base.core;
      return;
    }

    const looseLoot = this.findNearbyUsefulLoot(scene, 520);
    if (looseLoot) {
      this.intent = "loot";
      this.goal = looseLoot;
      return;
    }

    const bossTarget = this.findBossTarget(scene);
    if (bossTarget && this.personality === "Boss Hunter" && this.player.level >= Math.max(4, scene.getAveragePlayerLevel() - 1) && this.player.healthRatio > 0.55) {
      this.intent = "boss";
      this.goal = bossTarget;
      return;
    }

    const claimable = this.findClaimableObjective(scene);
    const objectiveClass = ["druid", "sentinel", "warlock", "arcanist"].includes(this.characterId);
    if (claimable && (objectiveClass || this.personality !== "Farmer" || this.player.level >= 3)) {
      this.intent = claimable.alive ? "objective" : "capture";
      this.goal = claimable;
      this.captureTargetId = claimable.id;
      return;
    }

    const mob = this.findBestMob(scene);
    if (mob) {
      this.intent = "farm";
      this.goal = mob;
      return;
    }

    const chest = this.findUnopenedChest(scene);
    if (chest) {
      this.intent = "chest";
      this.goal = chest;
      return;
    }

    if (!this.goal || distance(this.player, this.goal) < 120) {
      this.intent = "scout";
      this.goal = {
        x: randRange(700, CONFIG.world.width - 700),
        y: randRange(700, CONFIG.world.height - 700)
      };
    }
  }

  act(dt, scene) {
    if (this.intent === "settle") {
      this.moveToward(this.goal, dt, 60, scene);
      if (distance(this.player, this.goal) < 120) {
        const placementCheck = scene.isBaseClaimLocationAllowed?.(this.player) || { ok: true };
        if (!placementCheck.ok) {
          this.homePoint = scene.selectRandomSpawnPoint();
          this.goal = this.homePoint;
          return;
        }
        const emergency = this.base.displaced;
        this.base.placeAt(this.player.x, this.player.y, { emergency });
        this.baseNoticeShown = true;
        scene.addToast(`${this.name} ${emergency ? "rebuilt" : "placed"} a rival core.`);
      }
      return;
    }

    const combatTarget = this.getCombatTarget(scene);
    if (combatTarget) {
      this.fightTarget(scene, combatTarget);
      const stop = combatTarget.type === "core" || combatTarget.type === "wall" ? 430 : 360;
      this.moveToward(combatTarget, dt, stop, scene);
      return;
    }

    if (this.intent === "capture" && this.goal && distance(this.player, this.goal) < this.goal.radius + 18) {
      this.player.vx *= 0.65;
      this.player.vy *= 0.65;
      return;
    }

    this.moveToward(this.goal, dt, this.intent === "retreat" ? 70 : 90, scene);
  }

  getCombatTarget(scene) {
    if (this.intent === "duel" && (scene.canTargetEntity?.(scene.player, "ai") ?? scene.player.alive)) {
      return scene.player;
    }
    if ((this.intent === "objective" || this.intent === "capture") && this.goal?.alive) {
      return this.goal;
    }
    if (this.intent === "boss" && this.goal?.alive) {
      return this.goal;
    }
    if (this.intent === "farm" && this.goal?.alive) {
      return this.goal;
    }

    const closePlayer = (scene.canTargetEntity?.(scene.player, "ai") ?? scene.player.alive) && distance(this.player, scene.player) < 760 ? scene.player : null;
    if (closePlayer && this.player.healthRatio > 0.25) {
      return closePlayer;
    }
    return null;
  }

  fightTarget(scene, target) {
    const player = this.player;
    const targetPoint = target.combatPoint || { x: target.x, y: target.y };
    const dist = distance(player, targetPoint);
    const abilities = player.abilityBook.abilities;
    if (abilities.ultimate.ready && dist <= Math.max(abilities.ultimate.range, abilities.ultimate.effectRadius) && (target === scene.player || target.type === "core" || target.maxHealth > 260)) {
      player.abilityBook.castUltimate(scene, player, targetPoint);
      return;
    }
    if (abilities.area.ready && dist <= Math.max(abilities.area.range, abilities.area.effectRadius) + 30) {
      player.abilityBook.castArea(scene, player, targetPoint);
    }
    if (abilities.skillshot.ready && dist <= abilities.skillshot.range) {
      player.abilityBook.castSkillshot(scene, player, targetPoint);
      return;
    }
    if (dist <= abilities.basic.range) {
      player.abilityBook.castBasic(scene, player, targetPoint);
    }
  }

  moveToward(target, dt, stopRadius = 80, scene = null) {
    if (!target) {
      return;
    }
    const routeTarget = this.bridgeAwareTarget(target, scene) || target;
    const dx = routeTarget.x - this.player.x;
    const dy = routeTarget.y - this.player.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= stopRadius) {
      this.player.vx *= 0.7;
      this.player.vy *= 0.7;
      this.player.updateVisual(dt);
      return;
    }
    const direction = normalize(dx, dy);
    const speed = this.player.effectiveSpeed * (this.intent === "retreat" ? 1.08 : 0.94);
    this.player.vx = direction.x * speed;
    this.player.vy = direction.y * speed;
    this.player.x = clamp(this.player.x + this.player.vx * dt, this.player.radius, CONFIG.world.width - this.player.radius);
    this.player.y = clamp(this.player.y + this.player.vy * dt, this.player.radius, CONFIG.world.height - this.player.radius);
    scene?.resolveWallCollisions?.(this.player);
  }

  bridgeAwareTarget(target, scene) {
    if (!scene?.map?.bridges?.length || scene.map.isOnBridge?.(this.player)) {
      return target;
    }
    const nearRiver = scene.map.riverDistance?.(this.player) < 620;
    const targetNearRiver = scene.map.riverDistance?.(target) < 620;
    if (!nearRiver && !targetNearRiver) {
      return target;
    }
    const bridges = scene.map.bridges.slice().sort((a, b) => distanceSq(this.player, a) + distanceSq(a, target) * 0.35 - (distanceSq(this.player, b) + distanceSq(b, target) * 0.35));
    const bridge = bridges[0];
    return bridge && distance(this.player, bridge) > bridge.radius * 0.55 ? bridge : target;
  }

  manageBase(dt, scene) {
    this.baseActionTimer -= dt;
    if (this.baseActionTimer > 0 || !this.base.core) {
      return;
    }
    this.baseActionTimer = randRange(1.8, 3.4);

    if (distance(this.player, this.base.core) > 380) {
      return;
    }

    if (this.base.getDestroyedWallInfo().canRebuild && this.player.currency > 260) {
      this.base.rebuildDestroyedWalls(this.player);
      return;
    }
    if (this.base.getWallRepairInfo().canRepair && this.player.currency > 220) {
      this.base.repairWalls(this.player);
      return;
    }

    const type = this.base.core.level < 10 ? "core" : Math.random() < 0.55 ? "tower" : "generator";
    const result = this.base.upgrade(type, this.player);
    if (!result.ok && this.player.currency > 420 && this.player.resources > 220) {
      const roll = Math.random();
      const defenseType = this.base.core.level >= 15 && roll < 0.34 ? "pulseTower" : this.base.core.level >= 10 && roll < 0.67 ? "barracks" : "ballista";
      this.base.purchaseDefense(defenseType, this.player);
    }
  }

  updateBase(dt, scene) {
    if (this.base.displaced) {
      this.base.emergencyTimer = Math.max(0, this.base.emergencyTimer - dt);
    }

    if (!this.base.active) {
      return;
    }
    this.base.updatePassiveRepairs(dt, scene);

    if (!this.base.core) {
      this.base.active = false;
      this.base.buildings = [];
      this.player.applyCoreDebuff();
      if (this.player.alive && this.base.emergencyCount < CONFIG.base.maxEmergencyRebuilds) {
        this.base.emergencyCount += 1;
        this.base.displaced = true;
        this.base.emergencyTimer = CONFIG.base.emergencyWindow;
      } else {
        this.eliminated = true;
      }
      scene.addToast(`${this.name}'s core was destroyed.`);
      return;
    }

    this.base.generatorTickTimer += dt;
    if (this.base.generatorTickTimer >= CONFIG.base.generatorTick) {
      this.base.generatorTickTimer = 0;
      for (const generator of this.base.livingBuildings.filter((building) => building.type === "generator")) {
        const yieldValue = generator.generatorYield;
        this.player.currency += yieldValue.gold;
        this.player.resources += yieldValue.resources;
      }
    }

    for (const tower of this.base.livingBuildings.filter((building) => ["tower", "ballista", "pulseTower"].includes(building.type))) {
      tower.fireTimer = Math.max(0, tower.fireTimer - dt);
      if (tower.fireTimer > 0) {
        continue;
      }
      const target = scene.findNearestTargetForAIBase(this, tower, tower.towerRange);
      if (!target) {
        continue;
      }
      const overclock = scene.getDefenseOverclock?.(this.id, tower) || { damage: 1, fireRate: 1 };
      tower.fireTimer = tower.fireRate / Math.max(0.1, overclock.fireRate || 1);
      const length = Math.max(1, distance(tower, target));
      const color = tower.type === "ballista" ? "#ffb26a" : tower.type === "pulseTower" ? "#d69cff" : "#f0c85d";
      scene.spawnBaseEffect({
        type: "beam",
        x: tower.x,
        y: tower.y,
        targetX: target.x,
        targetY: target.y,
        color,
        life: 0.18,
        maxLife: 0.18
      });
      scene.spawnProjectile({
        x: tower.x,
        y: tower.y,
        vx: ((target.x - tower.x) / length) * (CONFIG.combat?.towerProjectiles?.baseSpeed || 610),
        vy: ((target.y - tower.y) / length) * (CONFIG.combat?.towerProjectiles?.baseSpeed || 610),
        radius: tower.type === "ballista" ? 7 : 5,
        range: tower.towerRange + 80,
        damage: Math.round(tower.towerDamage * (overclock.damage || 1)),
        color,
        pierce: false,
        sourceId: tower.id,
        sourceOwnerId: this.id,
        sourceX: tower.x,
        sourceY: tower.y,
        sourceKind: "tower",
        towerLevel: tower.level,
        towerType: tower.type,
        team: "ai"
      });
    }

    for (const barracks of this.base.livingBuildings.filter((building) => building.type === "barracks")) {
      scene.updateBarracks?.(barracks, this.base, dt);
    }
  }

  pickupNearbyLoot(scene) {
    if (this.player.carriedLootFull && this.base.core && distance(this.player, this.base.core) < 380) {
      this.player.depositLootToCore();
    }
    if (this.player.carriedLootFull) {
      return;
    }
    for (const item of [...scene.droppedLoot]) {
      if (distance(this.player, item) > CONFIG.loot.pickupRadius) {
        continue;
      }
      const index = scene.droppedLoot.findIndex((drop) => drop.id === item.id);
      if (index < 0) {
        continue;
      }
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
        return;
      }
      scene.droppedLoot.splice(index, 1);
    }
  }

  autoEquipLoot() {
    for (const item of [...this.player.allLoot]) {
      const slot = this.player.resolveEquipmentSlot(item);
      if (!slot) {
        continue;
      }
      const equipped = this.player.equipment[slot];
      if (!equipped || scoreItem(item) > scoreItem(equipped)) {
        this.player.equipLoot(item.id, slot);
      }
    }

    const sellable = this.player.allLoot.filter((item) => !Object.values(this.player.equipment).some((equipped) => equipped?.id === item.id));
    if (sellable.length > 10 && this.base.core && distance(this.player, this.base.core) < 380) {
      sellable.sort((a, b) => scoreItem(a) - scoreItem(b));
      this.player.sellLoot(sellable[0].id);
    }
  }

  findNearbyUsefulLoot(scene, range) {
    let best = null;
    let bestDistance = range * range;
    for (const item of scene.droppedLoot) {
      const current = distanceSq(this.player, item);
      if (current < bestDistance) {
        best = item;
        bestDistance = current;
      }
    }
    return best;
  }

  findClaimableObjective(scene) {
    const objectives = scene.objectives.filter((objective) => objective.type !== "boss" && (!objective.captured || objective.ownerId !== this.id));
    objectives.sort((a, b) => {
      const aScore = distanceSq(this.player, a) + (a.alive ? 160000 : 0);
      const bScore = distanceSq(this.player, b) + (b.alive ? 160000 : 0);
      return aScore - bScore;
    });
    return objectives[0] || null;
  }

  findBestMob(scene) {
    const mobs = scene.mobs.filter((mob) => mob.alive && !mob.isBoss);
    mobs.sort((a, b) => distanceSq(this.player, a) - distanceSq(this.player, b));
    return mobs[0] || null;
  }

  findUnopenedChest(scene) {
    const chests = scene.explorationChests.filter((chest) => !chest.opened);
    chests.sort((a, b) => distanceSq(this.player, a) - distanceSq(this.player, b));
    return chests[0] || null;
  }

  findBossTarget(scene) {
    return (scene.mobs || []).find((mob) => mob.isBoss && mob.alive) || null;
  }

  snapshot() {
    return {
      id: this.id,
      name: this.name,
      x: this.player.x,
      y: this.player.y,
      level: this.player.level,
      healthRatio: this.player.healthRatio,
      alive: this.player.alive,
      eliminated: this.eliminated,
      intent: this.intent,
      characterId: this.characterId,
      characterLabel: this.characterClass.label,
      personality: this.personality,
      vx: this.player.vx,
      vy: this.player.vy,
      facing: this.player.facing,
      walkTime: this.player.walkTime,
      castTimer: this.player.castTimer,
      color: this.color
    };
  }
}

function scoreItem(item) {
  if (!item?.stats) {
    return 0;
  }
  return Object.entries(item.stats).reduce((sum, [stat, value]) => {
    const weight = stat === "health" ? 0.55 : stat === "speed" ? 1.35 : stat === "vision" ? 0.35 : stat === "armor" ? 0.9 : 1;
    return sum + value * weight;
  }, item.tier || 1);
}










