// @ts-check
import { CONFIG } from "./config.js?v=1.8.57";
import { Entity } from "./Entity.js?v=1.8.57";
import { clamp, distance, normalize, randRange } from "./math.js?v=1.8.57";
import { DamageTracker } from "./RewardSystem.js?v=1.8.57";

export class Mob extends Entity {
  constructor({
    x,
    y,
    tier = 1,
    campId = "wild",
    isBoss = false,
    targetBase = false,
    archetype = "melee",
    summonerId = null,
    campType = "goblin",
    rewardScale = 1,
    arenaBounds = null
  }) {
    const profile = mobProfile(archetype, tier, isBoss);
    const maxHealth = isBoss ? 720 : profile.maxHealth;
    super({
      id: `${isBoss ? "boss" : "mob"}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      x,
      y,
      radius: isBoss ? 34 : profile.radius,
      maxHealth,
      team: "mob"
    });
    this.spawnX = x;
    this.spawnY = y;
    this.tier = tier;
    this.campId = campId;
    this.campType = campType;
    this.isBoss = isBoss;
    this.archetype = isBoss ? "boss" : archetype;
    this.baseMaxHealth = maxHealth;
    this.baseDamage = isBoss ? 28 : profile.damage;
    this.speed = isBoss ? 112 * (CONFIG.objectiveRules?.leash?.bossMoveSpeedScale || 1) : profile.speed;
    this.damage = this.baseDamage;
    this.attackRange = isBoss ? 56 : profile.attackRange;
    this.attackCooldown = profile.attackCooldown + (isBoss ? 0.35 : 0);
    this.attackTimer = randRange(0.1, 0.8);
    this.chaseRadius = isBoss ? 540 : CONFIG.mobs.chaseRadius + tier * 34;
    const rewardConfig = CONFIG.economy?.mobRewards || {};
    this.rewardBase = {
      xp: isBoss ? 0 : Math.round((26 + tier * 11) * rewardScale * (rewardConfig.xpMultiplier || 1)),
      gold: isBoss
        ? 0
        : Math.round((18 + tier * 9 + tier * (rewardConfig.tierGoldBonus || 0)) * rewardScale * campRewardWeight(campType, "gold") * (rewardConfig.goldMultiplier || 1)),
      resources: isBoss
        ? 0
        : Math.round((7 + tier * 6 + tier * (rewardConfig.tierResourceBonus || 0)) * rewardScale * campRewardWeight(campType, "resources") * (rewardConfig.resourceMultiplier || 1))
    };
    this.updateRewardsForLevel(1);
    this.targetBase = targetBase;
    this.damageTracker = new DamageTracker();
    this.facing = { x: 0, y: 1 };
    this.walkTime = randRange(0, Math.PI * 2);
    this.castTimer = 0;
    this.scaledLevel = 1;
    this.summonerId = summonerId;
    this.summonTimer = randRange(2.5, 5.5);
    this.slowTimer = 0;
    this.slowAmount = 0;
    this.stunTimer = 0;
    this.curseTimer = 0;
    this.curseDps = 0;
    this.curseSource = null;
    this.arenaBounds = arenaBounds;
  }

  updateRewardsForLevel(level = 1) {
    const rewardConfig = CONFIG.economy?.mobRewards || {};
    const levelDelta = Math.max(0, Math.floor(level || 1) - 1);
    this.xpReward = Math.round((this.rewardBase?.xp || 0) * (1 + levelDelta * (rewardConfig.levelXpScale || 0)));
    this.goldReward = Math.round((this.rewardBase?.gold || 0) * (1 + levelDelta * (rewardConfig.levelGoldScale || 0)));
    this.resourceReward = Math.round((this.rewardBase?.resources || 0) * (1 + levelDelta * (rewardConfig.levelResourceScale || 0)));
  }

  update(dt, scene) {
    if (!this.alive) {
      return;
    }

    this.tickStatuses(dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.castTimer = Math.max(0, this.castTimer - dt);
    this.summonTimer = Math.max(0, this.summonTimer - dt);
    this.scaleToWorldLevel(scene.getAveragePlayerLevel?.() || 1);
    if (this.stunTimer > 0) {
      return;
    }
    const target = this.chooseTarget(scene);

    if (target) {
      if (this.archetype === "summoner") {
        this.trySummon(scene);
      }
      const targetDistance = distanceToAttackTarget(this, target);
      if (targetDistance <= this.attackRange + (target.type === "wall" ? 0 : target.radius || 0)) {
        this.attack(target, scene);
      } else {
        this.moveToward(target, dt, 1, scene);
      }
      return;
    }

    const home = { x: this.spawnX, y: this.spawnY };
    if (distance(this, home) > 20) {
      this.moveToward(home, dt, 0.55, scene);
    }
    if (this.isBoss && this.health < this.maxHealth) {
      const rules = CONFIG.objectiveRules?.leash || {};
      this.health = Math.min(this.maxHealth, this.health + this.maxHealth * (rules.healingPercentPerSecond || 0.08) * dt);
      if (scene?.addFloatingText && Math.random() < dt * 0.12) {
        scene.addFloatingText(this.x, this.y - 54, "Disengaging", "#b9c5af");
      }
    }
  }

  chooseTarget(scene) {
    const candidates = [];
    const player = scene.player;
    const canAggro = (target) => {
      if (!this.isBoss || !this.arenaBounds) {
        return distance(this, target) <= this.chaseRadius;
      }
      return this.isPointInArena(target);
    };
    if (scene.canTargetEntity?.(player, "mob") && canAggro(player)) {
      candidates.push(player);
    }
    for (const ai of scene.aiPlayers || []) {
      if (scene.canTargetEntity?.(ai.player, "mob") && canAggro(ai.player)) {
        candidates.push(ai.player);
      }
    }
    for (const remote of scene.remotePlayers?.values?.() || []) {
      if (scene.canTargetEntity?.(remote, "mob") && canAggro(remote)) {
        candidates.push(remote);
      }
    }
    for (const defender of scene.baseDefenders || []) {
      if (defender.alive && canAggro(defender)) {
        candidates.push(defender);
      }
    }

    const baseTargets = [
      scene.base.getNearestLivingBuilding(this),
      ...(scene.aiPlayers || []).map((ai) => ai.base.getNearestLivingBuilding(this))
    ].filter(Boolean);
    for (const baseTarget of baseTargets) {
      if (this.isBoss && this.arenaBounds && !this.isPointInArena(baseTarget)) {
        continue;
      }
      if (this.targetBase || distance(this, baseTarget) <= this.chaseRadius + 180) {
        candidates.push(baseTarget);
      }
    }

    candidates.sort((a, b) => distanceToAttackTarget(this, a) - distanceToAttackTarget(this, b));
    if (candidates[0]) {
      return candidates[0];
    }

    const wardTarget = scene.findNearestWard?.(this, this.chaseRadius + 120);
    if (wardTarget && (!this.isBoss || this.isPointInArena(wardTarget))) {
      return wardTarget;
    }

    return null;
  }

  moveToward(target, dt, multiplier = 1, scene = null) {
    const direction = normalize(target.x - this.x, target.y - this.y);
    this.facing = direction;
    const slowMultiplier = this.slowTimer > 0 ? Math.max(0.35, 1 - (this.slowAmount || 0)) : 1;
    const moveSpeed = this.speed * multiplier * slowMultiplier;
    this.walkTime += dt * Math.max(2.5, moveSpeed / 48);
    let nextX = clamp(this.x + direction.x * moveSpeed * dt, this.radius, CONFIG.world.width - this.radius);
    let nextY = clamp(this.y + direction.y * moveSpeed * dt, this.radius, CONFIG.world.height - this.radius);
    if (this.isBoss && this.arenaBounds) {
      nextX = clamp(nextX, this.arenaBounds.x + this.radius, this.arenaBounds.x + this.arenaBounds.w - this.radius);
      nextY = clamp(nextY, this.arenaBounds.y + this.radius, this.arenaBounds.y + this.arenaBounds.h - this.radius);
    }
    this.x = clamp(nextX, this.radius, CONFIG.world.width - this.radius);
    this.y = clamp(nextY, this.radius, CONFIG.world.height - this.radius);
    scene?.resolveWallCollisions?.(this);
  }

  isPointInArena(point, padding = 0) {
    const bounds = this.arenaBounds;
    if (!bounds) {
      return true;
    }
    if (!point) {
      return false;
    }
    return (
      point.x >= bounds.x - padding &&
      point.x <= bounds.x + bounds.w + padding &&
      point.y >= bounds.y - padding &&
      point.y <= bounds.y + bounds.h + padding
    );
  }

  attack(target, scene) {
    if (this.attackTimer > 0) {
      return;
    }
    this.attackTimer = this.attackCooldown;
    const direction = normalize(target.x - this.x, target.y - this.y);
    this.facing = direction;
    this.castTimer = 0.2;
    if (this.archetype === "ranged" || this.archetype === "summoner") {
      scene.spawnProjectile({
        x: this.x + direction.x * (this.radius + 8),
        y: this.y + direction.y * (this.radius + 8),
        vx: direction.x * (430 + this.tier * 45),
        vy: direction.y * (430 + this.tier * 45),
        radius: this.archetype === "summoner" ? 7 : 6,
        range: 560,
        damage: this.archetype === "summoner" ? Math.round(this.damage * 0.72) : this.damage,
        color: this.archetype === "summoner" ? "#b391f0" : "#e68b4f",
        pierce: false,
        sourceId: this.id,
        sourceKind: "mob",
        team: "mob"
      });
      return;
    }
    scene.applyDamage(target, this.damage, {
      sourceId: this.id,
      sourceKind: "mob"
    });
  }

  trySummon(scene) {
    if (this.summonTimer > 0) {
      return;
    }
    const activeMinions = scene.mobs.filter((mob) => mob.alive && mob.summonerId === this.id).length;
    if (activeMinions >= 4) {
      this.summonTimer = 4.5;
      return;
    }
    this.summonTimer = Math.max(5.5, 8.5 - this.tier * 0.4);
    const count = this.tier >= 3 ? 2 : 1;
    for (let index = 0; index < count; index += 1) {
      const angle = randRange(0, Math.PI * 2);
      const spawnRadius = randRange(34, 74);
      scene.mobs.push(
        new Mob({
          x: clamp(this.x + Math.cos(angle) * spawnRadius, 40, CONFIG.world.width - 40),
          y: clamp(this.y + Math.sin(angle) * spawnRadius, 40, CONFIG.world.height - 40),
          tier: Math.max(1, this.tier - 1),
          campId: `${this.campId}-summon`,
          archetype: index % 2 === 0 ? "skitter" : "ranged",
          summonerId: this.id
        })
      );
    }
    scene.addFloatingText?.(this.x, this.y - 38, "Summon", "#b391f0");
  }

  scaleToWorldLevel(level) {
    if (this.isBoss) {
      return;
    }
    const nextLevel = Math.max(this.tier, Math.floor(level || 1));
    if (nextLevel === this.scaledLevel) {
      return;
    }
    const oldMax = this.maxHealth;
    this.scaledLevel = nextLevel;
    this.maxHealth = Math.round(this.baseMaxHealth * (1 + (nextLevel - 1) * 0.2));
    this.damage = Math.round(this.baseDamage * (1 + (nextLevel - 1) * 0.12));
    this.updateRewardsForLevel(nextLevel);
    if (this.alive) {
      this.health = Math.min(this.maxHealth, this.health + Math.max(0, this.maxHealth - oldMax));
    }
  }

  tickStatuses(dt) {
    this.slowTimer = Math.max(0, (this.slowTimer || 0) - dt);
    if (this.slowTimer <= 0) {
      this.slowAmount = 0;
    }
    this.stunTimer = Math.max(0, (this.stunTimer || 0) - dt);
    this.curseTimer = Math.max(0, (this.curseTimer || 0) - dt);
    if (this.curseTimer <= 0) {
      this.curseDps = 0;
      this.curseSource = null;
    }
  }
}

function distanceToAttackTarget(source, target) {
  if (target?.type === "wall" || (Number.isFinite(target?.width) && Number.isFinite(target?.height))) {
    const halfW = (target.width || target.radius * 2) / 2;
    const halfH = (target.height || target.radius * 2) / 2;
    const nearestX = Math.max(target.x - halfW, Math.min(target.x + halfW, source.x));
    const nearestY = Math.max(target.y - halfH, Math.min(target.y + halfH, source.y));
    return Math.hypot(source.x - nearestX, source.y - nearestY);
  }
  return distance(source, target);
}

function mobProfile(archetype, tier, isBoss) {
  if (isBoss) {
    return {
      maxHealth: 720,
      radius: 34,
      speed: 112,
      damage: 28,
      attackRange: 56,
      attackCooldown: CONFIG.mobs.attackCooldown + 0.35
    };
  }
  const base = {
    maxHealth: 58 + tier * 32,
    radius: 15 + tier * 2,
    speed: 118 + tier * 12,
    damage: 9 + tier * 5,
    attackRange: CONFIG.mobs.attackRange,
    attackCooldown: CONFIG.mobs.attackCooldown
  };
  if (archetype === "ranged") {
    return {
      ...base,
      maxHealth: Math.round(base.maxHealth * 0.82),
      speed: base.speed * 0.94,
      damage: base.damage + 2,
      attackRange: 280,
      attackCooldown: 1.45
    };
  }
  if (archetype === "brute" || archetype === "tank") {
    return {
      ...base,
      maxHealth: Math.round(base.maxHealth * (archetype === "tank" ? 2.15 : 1.6)),
      radius: base.radius + (archetype === "tank" ? 7 : 4),
      speed: base.speed * (archetype === "tank" ? 0.58 : 0.72),
      damage: base.damage + (archetype === "tank" ? 13 : 8),
      attackRange: CONFIG.mobs.attackRange + 8,
      attackCooldown: archetype === "tank" ? 2.05 : 1.7
    };
  }
  if (archetype === "swift" || archetype === "skitter") {
    return {
      ...base,
      maxHealth: Math.round(base.maxHealth * (archetype === "skitter" ? 0.52 : 0.74)),
      radius: Math.max(11, base.radius - (archetype === "skitter" ? 4 : 2)),
      speed: base.speed * (archetype === "skitter" ? 1.72 : 1.42),
      damage: base.damage + (archetype === "skitter" ? -1 : 1),
      attackCooldown: archetype === "skitter" ? 0.7 : 0.82
    };
  }
  if (archetype === "summoner") {
    return {
      ...base,
      maxHealth: Math.round(base.maxHealth * 1.18),
      radius: base.radius + 2,
      speed: base.speed * 0.86,
      damage: base.damage + 3,
      attackRange: 300,
      attackCooldown: 1.65
    };
  }
  return base;
}

function campRewardWeight(campType, reward) {
  const weights = {
    goblin: { gold: 0.9, resources: 1.55 },
    rogue: { gold: 1.55, resources: 0.75 },
    skeleton: { gold: 1, resources: 0.95 },
    cultist: { gold: 1.15, resources: 1.05 },
    brute: { gold: 1.05, resources: 1.35 },
    wraith: { gold: 1.4, resources: 1.15 }
  };
  return weights[campType]?.[reward] || 1;
}










