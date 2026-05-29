// @ts-check
import { CONFIG } from "./config.js?v=1.8.43";
import { getCharacterClass } from "./CharacterClasses.js?v=1.8.43";
import { clamp, normalize } from "./math.js?v=1.8.43";

export class Ability {
  constructor(config) {
    this.config = config;
    this.cooldownRemaining = 0;
    this.level = 1;
  }

  get id() {
    return this.config.id;
  }

  get cooldown() {
    const reduction = this.config.cooldownReductionPerLevel ?? 0.12;
    const floor = this.config.minCooldown ?? 0.25;
    return Math.max(floor, this.config.cooldown - (this.level - 1) * reduction);
  }

  get evolved() {
    return this.level >= 3;
  }

  get range() {
    if (!Number.isFinite(this.config.range)) {
      return 0;
    }
    if (["area", "repairField", "meteor"].includes(this.config.type)) {
      return this.config.range + (this.level - 1) * 24;
    }
    if (this.id === "ultimate") {
      return this.config.range + (this.level - 1) * 30;
    }
    return this.config.range + (this.level - 1) * 35;
  }

  get effectRadius() {
    if (!Number.isFinite(this.config.radius)) {
      return 0;
    }
    if (["area", "repairField", "meteor", "selfArea"].includes(this.config.type)) {
      return this.config.radius + (this.level - 1) * 12;
    }
    if (this.id === "ultimate") {
      return this.config.radius + (this.level - 1) * 18;
    }
    return this.config.radius + Math.floor(this.level / 3);
  }

  get ready() {
    return this.cooldownRemaining <= 0;
  }

  update(dt) {
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
  }

  trigger() {
    this.cooldownRemaining = this.cooldown;
  }

  upgrade() {
    if (this.level >= 5) {
      return false;
    }
    this.level += 1;
    return true;
  }

  previewNextUpgrade() {
    if (this.level >= 5) {
      return "Max tier reached.";
    }
    const nextLevel = this.level + 1;
    const label = this.config.label || "Ability";
    const base = this.config.damage > 0 ? "damage" : this.config.type === "selfBuff" ? "duration" : "effect";
    return nextLevel === 3
      ? `Tier 3: ${label} gains an evolved ${base} bonus.`
      : `Tier ${nextLevel}: improves ${label} cooldown, range, duration, or impact.`;
  }

  previewDamage(caster) {
    return calculateScaledDamage(this, caster, 1);
  }
}

export class AbilityBook {
  constructor(characterId = "ranger") {
    this.characterId = characterId;
    const character = getCharacterClass(characterId);
    this.abilities = {
      basic: new Ability(character.abilities.basic),
      skillshot: new Ability(character.abilities.skillshot),
      area: new Ability(character.abilities.area),
      ultimate: new Ability(character.abilities.ultimate)
    };
  }

  setCharacter(characterId) {
    const previousLevels = Object.fromEntries(Object.entries(this.abilities).map(([id, ability]) => [id, ability.level]));
    this.characterId = characterId;
    const character = getCharacterClass(characterId);
    this.abilities = {
      basic: new Ability(character.abilities.basic),
      skillshot: new Ability(character.abilities.skillshot),
      area: new Ability(character.abilities.area),
      ultimate: new Ability(character.abilities.ultimate)
    };
    for (const [id, level] of Object.entries(previousLevels)) {
      if (this.abilities[id]) {
        this.abilities[id].level = level;
      }
    }
  }

  update(dt) {
    for (const ability of Object.values(this.abilities)) {
      ability.update(dt);
    }
  }

  castBasic(scene, caster, target) {
    return this.castConfigured(scene, caster, target, this.abilities.basic);
  }

  castSkillshot(scene, caster, target) {
    return this.castConfigured(scene, caster, target, this.abilities.skillshot);
  }

  castArea(scene, caster, target) {
    return this.castConfigured(scene, caster, target, this.abilities.area);
  }

  castUltimate(scene, caster, target) {
    return this.castConfigured(scene, caster, target, this.abilities.ultimate);
  }

  castConfigured(scene, caster, target, ability) {
    if (!ability?.ready || !caster.alive) {
      return false;
    }
    const type = ability.config.type || "projectile";
    if (type === "projectile") {
      return this.castProjectile(scene, caster, target, ability, Boolean(ability.config.pierce));
    }
    if (type === "melee") {
      return this.castMelee(scene, caster, target, ability);
    }
    if (type === "dash") {
      return this.castDash(scene, caster, target, ability);
    }
    if (type === "area") {
      return this.castAreaEffect(scene, caster, target, ability);
    }
    if (type === "flameWall") {
      return this.castFlameWall(scene, caster, target, ability);
    }
    if (type === "selfArea") {
      return this.castSelfArea(scene, caster, ability);
    }
    if (type === "selfBuff") {
      return this.castSelfBuff(scene, caster, ability);
    }
    if (type === "turret") {
      return this.castTurret(scene, caster, target, ability);
    }
    if (type === "repairField") {
      return this.castRepairField(scene, caster, target, ability);
    }
    if (type === "overclock") {
      return this.castOverclock(scene, caster, target, ability);
    }
    if (type === "stealth") {
      return this.castStealth(scene, caster, ability);
    }
    if (type === "execute") {
      return this.castExecute(scene, caster, target, ability);
    }
    if (type === "meteor") {
      return this.castMeteor(scene, caster, target, ability);
    }
    if (type === "summon") {
      return this.castSummon(scene, caster, target, ability);
    }
    return false;
  }

  castAreaEffect(scene, caster, target, ability) {
    if (!ability.ready || !caster.alive) {
      return false;
    }

    const clampedTarget = clampToRange(caster, target, ability.range);
    caster.markCast?.(normalize(clampedTarget.x - caster.x, clampedTarget.y - caster.y));
    ability.trigger();
    scene.spawnAreaEffect({
      x: clampedTarget.x,
      y: clampedTarget.y,
      radius: ability.effectRadius,
      damage: this.scaledDamage(ability, caster),
      duration: ability.evolved ? ability.config.duration + 0.45 : ability.config.duration,
      sourceId: caster.id,
      sourceOwnerId: caster.id,
      sourceX: caster.x,
      sourceY: caster.y,
      sourceKind: caster.team === "ai" ? "ai" : "player",
      team: caster.team,
      color: ability.evolved ? "#e7bd58" : ability.config.color,
      status: ability.config.status,
      tickRate: ability.config.tickRate,
      structureMultiplier: ability.config.structureMultiplier
    });
    return true;
  }

  castFlameWall(scene, caster, target, ability) {
    if (!ability.ready || !caster.alive) {
      return false;
    }
    const clampedTarget = clampToRange(caster, target, ability.range);
    const aim = normalize(clampedTarget.x - caster.x, clampedTarget.y - caster.y);
    const side = { x: -aim.y, y: aim.x };
    const length = (ability.config.wallLength || 360) + Math.max(0, ability.level - 1) * 28;
    const width = (ability.config.wallWidth || ability.effectRadius * 2 || 52) + Math.max(0, ability.level - 1) * 4;
    caster.markCast?.(aim);
    ability.trigger();
    scene.spawnAreaEffect?.({
      shape: "wall",
      x: clampedTarget.x,
      y: clampedTarget.y,
      x1: clampedTarget.x - side.x * length * 0.5,
      y1: clampedTarget.y - side.y * length * 0.5,
      x2: clampedTarget.x + side.x * length * 0.5,
      y2: clampedTarget.y + side.y * length * 0.5,
      width,
      radius: width * 0.5,
      damage: this.scaledDamage(ability, caster),
      duration: ability.config.duration + Math.max(0, ability.level - 1) * 0.25,
      tickRate: ability.config.tickRate || 0.55,
      sourceId: caster.id,
      sourceOwnerId: caster.id,
      sourceX: caster.x,
      sourceY: caster.y,
      sourceKind: caster.team === "ai" ? "ai" : "player",
      team: caster.team,
      color: ability.config.color,
      status: ability.config.status,
      structureMultiplier: ability.config.structureMultiplier
    });
    return true;
  }

  castSelfArea(scene, caster, ability) {
    if (!ability.ready || !caster.alive) {
      return false;
    }
    caster.markCast?.(caster.facing);
    ability.trigger();
    scene.spawnAreaEffect({
      x: caster.x,
      y: caster.y,
      radius: ability.effectRadius,
      damage: this.scaledDamage(ability, caster, 1.2),
      duration: ability.evolved ? ability.config.duration + 0.45 : ability.config.duration,
      sourceId: caster.id,
      sourceOwnerId: caster.id,
      sourceX: caster.x,
      sourceY: caster.y,
      sourceKind: caster.team === "ai" ? "ai" : "player",
      team: caster.team,
      color: ability.config.color,
      status: ability.config.status,
      tickRate: ability.config.tickRate,
      structureMultiplier: ability.config.structureMultiplier
    });
    scene.spawnBaseEffect({
      type: "shockwave",
      x: caster.x,
      y: caster.y,
      color: ability.config.color,
      radius: ability.effectRadius,
      life: 0.65,
      maxLife: 0.65
    });
    return true;
  }

  castSelfBuff(scene, caster, ability) {
    ability.trigger();
    caster.markCast?.(caster.facing);
    caster.damageReductionTimer = Math.max(caster.damageReductionTimer || 0, ability.config.duration + (ability.level - 1) * 0.35);
    caster.damageReduction = Math.max(caster.damageReduction || 0, ability.config.damageReduction || 0.35);
    caster.towerReduction = Math.max(caster.towerReduction || 0, ability.config.towerReduction || 0.2);
    if (Number.isFinite(ability.config.speedMultiplier)) {
      caster.speedMultiplierTimer = Math.max(caster.speedMultiplierTimer || 0, ability.config.duration + (ability.level - 1) * 0.25);
      caster.speedMultiplier = Math.max(caster.speedMultiplier || 1, ability.config.speedMultiplier);
    }
    if (Number.isFinite(ability.config.damageTakenMultiplier)) {
      caster.damageTakenMultiplierTimer = Math.max(caster.damageTakenMultiplierTimer || 0, ability.config.duration + (ability.level - 1) * 0.25);
      caster.damageTakenMultiplier = Math.max(caster.damageTakenMultiplier || 1, ability.config.damageTakenMultiplier);
    }
    if (Number.isFinite(ability.config.shieldBase) || caster.characterId === "guardian") {
      const shieldAmount = Math.round(
        (ability.config.shieldBase ?? CONFIG.abilityScaling.guardianShieldBase) +
          Math.max(0, (caster.level || 1) - 1) * (ability.config.shieldPerLevel ?? CONFIG.abilityScaling.guardianShieldPerLevel) +
          Math.max(0, ability.level - 1) * (ability.config.shieldPerAbilityLevel ?? CONFIG.abilityScaling.guardianShieldPerAbilityLevel)
      );
      caster.grantShield?.(shieldAmount, ability.config.duration + (ability.level - 1) * 0.35);
    }
    scene.addFloatingText?.(caster.x, caster.y - 44, ability.config.label, ability.config.color);
    scene.spawnBaseEffect?.({
      type: "pulse",
      x: caster.x,
      y: caster.y,
      color: ability.config.color,
      radius: 72,
      life: 0.7,
      maxLife: 0.7
    });
    return true;
  }

  castTurret(scene, caster, target, ability) {
    const clampedTarget = clampToRange(caster, target, ability.range);
    caster.markCast?.(normalize(clampedTarget.x - caster.x, clampedTarget.y - caster.y));
    ability.trigger();
    scene.deployTemporaryTurret?.(caster, clampedTarget, ability);
    return true;
  }

  castRepairField(scene, caster, target, ability) {
    const clampedTarget = clampToRange(caster, target, ability.range);
    caster.markCast?.(normalize(clampedTarget.x - caster.x, clampedTarget.y - caster.y));
    ability.trigger();
    scene.spawnRepairField?.(caster, clampedTarget, ability);
    return true;
  }

  castOverclock(scene, caster, target, ability) {
    const clampedTarget = clampToRange(caster, target, ability.range || 1);
    caster.markCast?.(normalize(clampedTarget.x - caster.x, clampedTarget.y - caster.y));
    ability.trigger();
    scene.spawnOverclockDefense?.(caster, clampedTarget, ability);
    return true;
  }

  castStealth(scene, caster, ability) {
    ability.trigger();
    caster.markCast?.(caster.facing);
    const duration = ability.config.duration + (ability.level - 1) * 0.25;
    caster.stealthTimer = Math.max(caster.stealthTimer || 0, duration);
    caster.stealthMaxTimer = Math.max(caster.stealthMaxTimer || 0, duration);
    caster.stealthUntargetable = true;
    caster.stealthBreakOnDamageAction = ability.config.breakOnDamageAction !== false;
    caster.stealthDamageBonus = 1.45 + ability.level * 0.08;
    scene.addFloatingText?.(caster.x, caster.y - 42, "Vanish", ability.config.color);
    scene.spawnBaseEffect?.({
      type: "pulse",
      x: caster.x,
      y: caster.y,
      color: ability.config.color,
      radius: 74 + ability.level * 8,
      life: 0.55,
      maxLife: 0.55
    });
    return true;
  }

  castExecute(scene, caster, target, ability) {
    const clampedTarget = clampToRange(caster, target, ability.range);
    caster.markCast?.(normalize(clampedTarget.x - caster.x, clampedTarget.y - caster.y));
    ability.trigger();
    const stealthMultiplier = this.consumeStealthMultiplier(caster, ability);
    const damage = this.scaledDamage(ability, caster, 1.35 * stealthMultiplier);
    scene.executeMarkedTarget?.(caster, clampedTarget, ability, damage);
    return true;
  }

  castMeteor(scene, caster, target, ability) {
    const clampedTarget = clampToRange(caster, target, ability.range);
    caster.markCast?.(normalize(clampedTarget.x - caster.x, clampedTarget.y - caster.y));
    ability.trigger();
    scene.spawnMeteorStorm?.(caster, clampedTarget, ability, this.scaledDamage(ability, caster, 1.05));
    return true;
  }

  castSummon(scene, caster, target, ability) {
    if (!ability.ready || !caster.alive) {
      return false;
    }
    const clampedTarget = clampToRange(caster, target, ability.range);
    caster.markCast?.(normalize(clampedTarget.x - caster.x, clampedTarget.y - caster.y));
    ability.trigger();
    scene.summonTemporaryUnit?.(caster, clampedTarget, ability, this.scaledDamage(ability, caster));
    return true;
  }

  castMelee(scene, caster, target, ability) {
    const direction = normalize(target.x - caster.x, target.y - caster.y);
    caster.markCast?.(direction);
    ability.trigger();
    const stealthMultiplier = this.consumeStealthMultiplier(caster, ability);
    const center = {
      x: caster.x + direction.x * Math.max(34, ability.range * 0.55),
      y: caster.y + direction.y * Math.max(34, ability.range * 0.55)
    };
    scene.spawnAreaEffect({
      x: center.x,
      y: center.y,
      radius: ability.effectRadius,
      damage: this.scaledDamage(ability, caster, stealthMultiplier),
      duration: 0.12,
      sourceId: caster.id,
      sourceOwnerId: caster.id,
      sourceX: caster.x,
      sourceY: caster.y,
      sourceKind: caster.team === "ai" ? "ai" : "player",
      team: caster.team,
      color: ability.config.color,
      status: ability.config.status,
      structureMultiplier: ability.config.structureMultiplier
    });
    return true;
  }

  castDash(scene, caster, target, ability) {
    const direction = normalize(target.x - caster.x, target.y - caster.y);
    caster.markCast?.(direction);
    ability.trigger();
    const start = { x: caster.x, y: caster.y };
    scene.dashEntity?.(caster, direction, ability.range);
    const stealthMultiplier = this.consumeStealthMultiplier(caster, ability);
    const source = {
      sourceId: caster.id,
      sourceOwnerId: caster.id,
      sourceX: start.x,
      sourceY: start.y,
      sourceKind: caster.team === "ai" ? "ai" : "player",
      team: caster.team,
      color: ability.config.color,
      status: ability.config.status,
      structureMultiplier: ability.config.structureMultiplier
    };
    const lineDamage = this.scaledDamage(ability, caster, stealthMultiplier);
    scene.damageLine?.(start, caster, ability.effectRadius, lineDamage, source);
    const impactRadius = ability.config.impactRadius || (caster.characterId === "guardian" ? CONFIG.abilityScaling.guardianChargeImpactRadius : 0);
    if (impactRadius > 0) {
      const impactDamage = Math.round(lineDamage * (ability.config.impactDamageMultiplier ?? CONFIG.abilityScaling.guardianChargeImpactMultiplier));
      scene.spawnAreaEffect?.({
        x: caster.x,
        y: caster.y,
        radius: impactRadius + Math.max(0, ability.level - 1) * 8,
        damage: impactDamage,
        duration: 0.14,
        sourceId: caster.id,
        sourceOwnerId: caster.id,
        sourceX: caster.x,
        sourceY: caster.y,
        sourceKind: caster.team === "ai" ? "ai" : "player",
        team: caster.team,
        color: ability.config.impactColor || ability.config.color,
        status: ability.config.status,
        structureMultiplier: ability.config.structureMultiplier
      });
      scene.spawnBaseEffect?.({
        type: "shockwave",
        x: caster.x,
        y: caster.y,
        color: ability.config.impactColor || ability.config.color,
        radius: impactRadius + Math.max(0, ability.level - 1) * 8,
        life: 0.5,
        maxLife: 0.5
      });
    }
    return true;
  }

  castProjectile(scene, caster, target, ability, pierce) {
    if (!ability.ready || !caster.alive) {
      return false;
    }

    const direction = normalize(target.x - caster.x, target.y - caster.y);
    caster.markCast?.(direction);
    ability.trigger();
    const stealthMultiplier = this.consumeStealthMultiplier(caster, ability);
    this.spawnAbilityProjectile(scene, caster, direction, ability, pierce, stealthMultiplier);

    if (ability.evolved && ability.id === "skillshot") {
      const spread = 0.16;
      this.spawnAbilityProjectile(scene, caster, rotate(direction, spread), ability, pierce, 0.55);
      this.spawnAbilityProjectile(scene, caster, rotate(direction, -spread), ability, pierce, 0.55);
    } else if (ability.evolved && ability.id === "basic") {
      this.spawnAbilityProjectile(scene, caster, rotate(direction, 0.12), ability, false, 0.6);
    }
    return true;
  }

  spawnAbilityProjectile(scene, caster, direction, ability, pierce, damageMultiplier) {
    scene.spawnProjectile({
      x: caster.x + direction.x * (caster.radius + 8),
      y: caster.y + direction.y * (caster.radius + 8),
      vx: direction.x * (ability.config.speed + (ability.level - 1) * 35),
      vy: direction.y * (ability.config.speed + (ability.level - 1) * 35),
      radius: ability.effectRadius,
      range: ability.range,
      damage: this.scaledDamage(ability, caster, damageMultiplier),
      color: ability.config.color,
      pierce,
      sourceId: caster.id,
      sourceOwnerId: caster.id,
      sourceX: caster.x,
      sourceY: caster.y,
      sourceKind: caster.team === "ai" ? "ai" : "player",
      team: caster.team,
      status: ability.config.status,
      structureMultiplier: ability.config.structureMultiplier
    });
  }

  scaledDamage(ability, caster, multiplier = 1) {
    return calculateScaledDamage(ability, caster, multiplier);
  }

  consumeStealthMultiplier(caster, ability) {
    if (!caster?.stealthTimer || caster.stealthTimer <= 0) {
      return 1;
    }
    const multiplier = ability.config.stealthBonusMultiplier || caster.stealthDamageBonus || 1.45;
    if (caster.stealthBreakOnDamageAction !== false) {
      caster.breakStealth?.();
    }
    return multiplier;
  }

  upgrade(abilityId) {
    const ability = this.abilities[abilityId];
    if (!ability) {
      return { ok: false, message: "Unknown ability." };
    }
    if (!ability.upgrade()) {
      return { ok: false, message: `${ability.config.label} is already maxed.` };
    }
    const evolved = ability.evolved ? " Evolved effect unlocked." : "";
    return { ok: true, message: `${ability.config.label} upgraded to level ${ability.level}.${evolved}` };
  }

  getUpgradePreview(abilityId) {
    const ability = this.abilities[abilityId];
    return ability ? ability.previewNextUpgrade() : "Unknown ability.";
  }
}

function calculateScaledDamage(ability, caster, multiplier = 1) {
  const base = ability?.config?.damage || 0;
  if (base <= 0) {
    return 0;
  }
  const scaling = ability.config.scaling || {};
  const levelIndex = Math.max(0, (caster?.level || 1) - 1);
  const abilityIndex = Math.max(0, (ability.level || 1) - 1);
  const perLevel =
    scaling.damagePerLevel ??
    (ability.id === "basic"
      ? CONFIG.abilityScaling.basicDamagePerLevel
      : ability.id === "ultimate"
        ? CONFIG.abilityScaling.ultimateDamagePerLevel
        : CONFIG.abilityScaling.defaultDamagePerLevel);
  const perAbilityLevel =
    scaling.damagePerAbilityLevel ??
    (ability.id === "basic"
      ? CONFIG.abilityScaling.basicDamagePerAbilityLevel
      : ability.id === "ultimate"
        ? CONFIG.abilityScaling.ultimateDamagePerAbilityLevel
        : CONFIG.abilityScaling.defaultDamagePerAbilityLevel);
  return Math.max(1, Math.round((base + levelIndex * perLevel + abilityIndex * perAbilityLevel + (caster?.damageBonus || 0)) * multiplier));
}

function clampToRange(origin, target, range) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length <= range) {
    return target;
  }
  const ratio = range / Math.max(1, length);
  return {
    x: clamp(origin.x + dx * ratio, 0, CONFIG.world.width),
    y: clamp(origin.y + dy * ratio, 0, CONFIG.world.height)
  };
}

function rotate(vector, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos
  };
}










