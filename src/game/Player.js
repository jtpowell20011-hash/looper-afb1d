// @ts-check
import { AbilityBook } from "./Ability.js?v=1.8.64";
import { getCharacterClass } from "./CharacterClasses.js?v=1.8.64";
import { CONFIG } from "./config.js?v=1.8.64";
import { Entity } from "./Entity.js?v=1.8.64";
import { clamp, normalize } from "./math.js?v=1.8.64";

export class Player extends Entity {
  constructor(x, y, characterId = "ranger") {
    const characterClass = getCharacterClass(characterId);
    super({
      id: "player-local",
      x,
      y,
      radius: CONFIG.player.radius,
      maxHealth: tunedHealth(characterClass.stats),
      team: "player"
    });
    this.characterId = characterClass.id;
    this.characterClass = characterClass;
    this.heroClass = characterClass;
    this.speed = tunedMoveSpeed(characterClass.stats);
    this.color = characterClass.color;
    this.vx = 0;
    this.vy = 0;
    this.level = 1;
    this.xp = 0;
    this.xpToNext = CONFIG.player.xpBase;
    this.currency = 80;
    this.resources = 60;
    this.loot = [];
    this.coreStorage = [];
    this.equipment = Object.fromEntries(CONFIG.loot.equipmentSlots.map((slot) => [slot.id, null]));
    this.skillPoints = 0;
    this.attributePoints = 0;
    this.attributes = {
      power: 0,
      vitality: 0,
      mobility: 0
    };
    this.wards = 0;
    this.healthPotions = 0;
    this.wardCooldown = 0;
    this.potionCooldown = 0;
    this.extraLives = 0;
    this.bossBlessing = false;
    this.nomadMode = false;
    this.baseLayoutBonus = {};
    this.baseDebuffStacks = 0;
    this.timeSinceDamage = CONFIG.player.baseRegenDelay;
    this.respawnTimer = 0;
    this.eliminated = false;
    this.abilityBook = new AbilityBook(characterClass.id);
    this.movementMode = "wasd";
    this.clickMoveTarget = null;
    this.facing = { x: 0, y: 1 };
    this.walkTime = 0;
    this.castTimer = 0;
    this.slowTimer = 0;
    this.slowAmount = 0;
    this.stunTimer = 0;
    this.damageReductionTimer = 0;
    this.damageReduction = 0;
    this.towerReduction = 0;
    this.stealthTimer = 0;
    this.stealthDamageBonus = 1;
    this.stealthMaxTimer = 0;
    this.stealthUntargetable = false;
    this.stealthUntargetableKinds = [];
    this.stealthBreakOnDamageAction = true;
    this.shield = 0;
    this.maxShield = 0;
    this.shieldTimer = 0;
    this.shieldMaxTimer = 0;
    this.speedMultiplier = 1;
    this.speedMultiplierTimer = 0;
    this.damageTakenMultiplier = 1;
    this.damageTakenMultiplierTimer = 0;
    this.passiveSpeedBonus = 0;
    this.passiveDamageReduction = 0;
    this.passiveStatusLabel = "";
    this.rageStacks = 0;
    this.soulStacks = 0;
    this.curseTimer = 0;
    this.curseDps = 0;
    this.curseSource = null;
    this.stationaryTimer = 0;
  }

  setCharacter(characterId) {
    const characterClass = getCharacterClass(characterId);
    const healthRatio = this.health / Math.max(1, this.effectiveMaxHealth);
    this.characterId = characterClass.id;
    this.characterClass = characterClass;
    this.heroClass = characterClass;
    this.maxHealth = tunedHealth(characterClass.stats);
    this.speed = tunedMoveSpeed(characterClass.stats);
    this.color = characterClass.color;
    this.abilityBook.setCharacter(characterClass.id);
    this.health = Math.max(1, Math.round(this.effectiveMaxHealth * Math.min(1, healthRatio)));
  }

  get damageBonus() {
    return (
      (this.characterClass?.stats?.damageBonus || 0) +
      this.statBonuses.damage +
      this.attributes.power * 3 +
      (this.rageStacks || 0) * (this.characterId === "berserker" ? CONFIG.classPassives?.berserker?.rageDamageBonusPerStack || 0 : 0) +
      (this.soulStacks || 0) * (this.characterId === "warlock" ? CONFIG.classPassives?.warlock?.damageBonusPerSoul || 0 : 0) +
      (this.baseLayoutBonus.damage || 0) +
      (this.nomadMode ? 62 : 0) +
      (this.bossBlessing ? 18 : 0)
    );
  }

  get statBonuses() {
    const bonuses = {
      damage: 0,
      health: 0,
      speed: 0,
      armor: 0,
      attackSpeed: 0,
      vision: 0
    };
    for (const item of Object.values(this.equipment)) {
      if (!item?.stats) {
        continue;
      }
      for (const [key, value] of Object.entries(item.stats)) {
        bonuses[key] = (bonuses[key] || 0) + value;
      }
    }
    return bonuses;
  }

  get effectiveMaxHealth() {
    return Math.round(
      this.maxHealth +
        this.attributes.vitality * 22 +
        this.statBonuses.health +
        (this.baseLayoutBonus.health || 0) +
        (this.nomadMode ? 520 : 0) +
        (this.bossBlessing ? 90 : 0) -
        this.baseDebuffStacks * 10
    );
  }

  get effectiveSpeed() {
    const speed = Math.max(
      165,
      this.speed +
        this.attributes.mobility * (CONFIG.player?.mobilityMoveSpeedPerPoint ?? 18) +
        this.statBonuses.speed +
        (this.baseLayoutBonus.speed || 0) +
        (this.passiveSpeedBonus || 0) +
        (this.nomadMode ? 42 : 0) +
        (this.bossBlessing ? 35 : 0) -
        this.baseDebuffStacks * 8
    );
    const buffMultiplier = this.speedMultiplierTimer > 0 ? this.speedMultiplier || 1 : 1;
    return Math.round(speed * buffMultiplier * (this.slowTimer > 0 ? Math.max(0.35, 1 - (this.slowAmount || 0)) : 1));
  }

  get displayStats() {
    const bonuses = this.statBonuses;
    const basicDamage = this.abilityBook?.abilities?.basic?.previewDamage?.(this) || this.abilityBook?.abilities?.basic?.config?.damage || 13;
    return {
      class: this.characterClass?.label || "Ranger",
      damage: Math.round(basicDamage),
      health: this.effectiveMaxHealth,
      movement: Math.round(this.effectiveSpeed),
      armor: Math.round(bonuses.armor + (this.characterClass?.stats?.defense || 0) * 100 + (this.bossBlessing ? 12 : 0) + this.baseDebuffStacks * -2),
      vision: Math.round(CONFIG.world.playerVision + bonuses.vision + (this.baseLayoutBonus.vision || 0) + (this.bossBlessing ? 180 : 0)),
      extraLives: this.extraLives,
      rage: this.rageStacks || 0,
      souls: this.soulStacks || 0
    };
  }

  get healthRatio() {
    return Math.max(0, this.health / Math.max(1, this.effectiveMaxHealth));
  }

  get carryLimit() {
    return CONFIG.loot.carryLimit;
  }

  get carriedLootCount() {
    return this.loot.filter((item) => !this.isEquipped(item.id)).length;
  }

  get backpackLoot() {
    return this.loot.filter((item) => !this.isEquipped(item.id));
  }

  get carriedLootFull() {
    return this.carriedLootCount >= this.carryLimit;
  }

  get allLoot() {
    return [...this.loot, ...this.coreStorage];
  }

  isEquipped(itemId) {
    return Object.values(this.equipment).some((item) => item?.id === itemId);
  }

  getLootSource(itemId) {
    if (this.loot.some((item) => item.id === itemId)) {
      return "backpack";
    }
    if (this.coreStorage.some((item) => item.id === itemId)) {
      return "core";
    }
    return null;
  }

  findLootItem(itemId) {
    return this.loot.find((item) => item.id === itemId) || this.coreStorage.find((item) => item.id === itemId) || null;
  }

  addXP(amount) {
    this.xp += amount;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level += 1;
      // Steeper, configurable curve so levels feel earned (each grants points).
      this.xpToNext = Math.round((CONFIG.player.xpBase || 120) * Math.pow(CONFIG.player.xpGrowth || 1.3, this.level - 1));
      this.maxHealth += CONFIG.player.healthPerLevel ?? 18;
      this.health = this.effectiveMaxHealth;
      this.speed += CONFIG.player.moveSpeedPerLevel ?? 1;
      // Every level grants ability + attribute points.
      this.skillPoints += CONFIG.player.apPerLevel ?? 1;
      this.attributePoints += CONFIG.player.attributePointsPerLevel ?? 2;
      this.pendingLevelUps = (this.pendingLevelUps || 0) + 1;
    }
  }

  tickRecovery(dt) {
    this.timeSinceDamage = Math.min(CONFIG.player.baseRegenDelay + 10, (this.timeSinceDamage || 0) + dt);
  }

  tickConsumables(dt) {
    this.potionCooldown = Math.max(0, (this.potionCooldown || 0) - dt);
    this.wardCooldown = Math.max(0, (this.wardCooldown || 0) - dt);
  }

  tickStatuses(dt) {
    this.slowTimer = Math.max(0, (this.slowTimer || 0) - dt);
    if (this.slowTimer <= 0) {
      this.slowAmount = 0;
    }
    this.stunTimer = Math.max(0, (this.stunTimer || 0) - dt);
    this.damageReductionTimer = Math.max(0, (this.damageReductionTimer || 0) - dt);
    if (this.damageReductionTimer <= 0) {
      this.damageReduction = 0;
      this.towerReduction = 0;
    }
    this.stealthTimer = Math.max(0, (this.stealthTimer || 0) - dt);
    if (this.stealthTimer <= 0) {
      this.breakStealth();
    }
    this.shieldTimer = Math.max(0, (this.shieldTimer || 0) - dt);
    if (this.shieldTimer <= 0 || this.shield <= 0) {
      this.shield = 0;
      this.maxShield = 0;
      this.shieldMaxTimer = 0;
    }
    this.speedMultiplierTimer = Math.max(0, (this.speedMultiplierTimer || 0) - dt);
    if (this.speedMultiplierTimer <= 0) {
      this.speedMultiplier = 1;
    }
    this.damageTakenMultiplierTimer = Math.max(0, (this.damageTakenMultiplierTimer || 0) - dt);
    if (this.damageTakenMultiplierTimer <= 0) {
      this.damageTakenMultiplier = 1;
    }
    this.curseTimer = Math.max(0, (this.curseTimer || 0) - dt);
    if (this.curseTimer <= 0) {
      this.curseDps = 0;
      this.curseSource = null;
    }
  }

  update(dt, input, keybindings = {}) {
    this.abilityBook.update(dt);
    this.tickStatuses(dt);
    this.tickRecovery(dt);
    if (!this.alive) {
      this.respawnTimer = Math.max(0, this.respawnTimer - dt);
      return;
    }

    if (this.stunTimer > 0) {
      this.vx *= Math.max(0, 1 - 12 * dt);
      this.vy *= Math.max(0, 1 - 12 * dt);
      this.x = clamp(this.x + this.vx * dt, this.radius, CONFIG.world.width - this.radius);
      this.y = clamp(this.y + this.vy * dt, this.radius, CONFIG.world.height - this.radius);
      this.updateVisual(dt);
      return;
    }

    let moveX = 0;
    let moveY = 0;

    if (this.movementMode === "wasd") {
      moveX += input.keys.has(keybindings.moveRight || "KeyD") ? 1 : 0;
      moveX -= input.keys.has(keybindings.moveLeft || "KeyA") ? 1 : 0;
      moveY += input.keys.has(keybindings.moveDown || "KeyS") ? 1 : 0;
      moveY -= input.keys.has(keybindings.moveUp || "KeyW") ? 1 : 0;
    } else if (this.clickMoveTarget) {
      const dx = this.clickMoveTarget.x - this.x;
      const dy = this.clickMoveTarget.y - this.y;
      if (Math.hypot(dx, dy) > 8) {
        const direction = normalize(dx, dy);
        moveX = direction.x;
        moveY = direction.y;
      } else {
        this.clickMoveTarget = null;
      }
    }

    if (moveX !== 0 || moveY !== 0) {
      const direction = normalize(moveX, moveY);
      this.vx += direction.x * CONFIG.player.acceleration * dt;
      this.vy += direction.y * CONFIG.player.acceleration * dt;
      this.stationaryTimer = 0;
    } else {
      this.stationaryTimer += dt;
    }

    const currentSpeed = Math.hypot(this.vx, this.vy);
    const speedLimit = this.effectiveSpeed;
    if (currentSpeed > speedLimit) {
      const limited = normalize(this.vx, this.vy);
      this.vx = limited.x * speedLimit;
      this.vy = limited.y * speedLimit;
    }

    const friction = Math.max(0, 1 - CONFIG.player.friction * dt);
    if (this.health > this.effectiveMaxHealth) {
      this.health = this.effectiveMaxHealth;
    }
    this.x = clamp(this.x + this.vx * dt, this.radius, CONFIG.world.width - this.radius);
    this.y = clamp(this.y + this.vy * dt, this.radius, CONFIG.world.height - this.radius);
    this.vx *= friction;
    this.vy *= friction;
    this.updateVisual(dt);
  }

  updateVisual(dt) {
    this.castTimer = Math.max(0, this.castTimer - dt);
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > 8) {
      const direction = normalize(this.vx, this.vy);
      this.facing = direction;
      this.walkTime += dt * Math.max(4, speed / 42);
    } else {
      this.walkTime += dt * 1.2;
    }
  }

  markCast(direction) {
    if (direction && (Math.abs(direction.x) > 0.001 || Math.abs(direction.y) > 0.001)) {
      this.facing = normalize(direction.x, direction.y);
    }
    this.castTimer = 0.22;
  }

  beginRespawn(seconds) {
    this.alive = false;
    this.health = 0;
    this.respawnTimer = seconds;
    if (this.characterId === "warlock") {
      this.soulStacks = Math.floor((this.soulStacks || 0) * (CONFIG.classPassives?.warlock?.resetOnDeathPercent ?? 0.5));
    }
  }

  respawnAt(x, y) {
    this.x = x;
    this.y = y;
    this.health = this.effectiveMaxHealth;
    this.alive = true;
    this.respawnTimer = 0;
    this.breakStealth();
    this.clearShield();
  }

  addLoot(item) {
    if (this.carriedLootFull) {
      return { ok: false, message: `Backpack full (${this.carriedLootCount}/${this.carryLimit}). Return to your core to store loot.` };
    }
    this.loot.push(item);
    return { ok: true, message: `${item.label} added to backpack.` };
  }

  equipLoot(itemId, preferredSlot = null) {
    const source = this.getLootSource(itemId);
    const item = this.findLootItem(itemId);
    if (!item) {
      return { ok: false, message: "That item is no longer in storage." };
    }

    const slot = this.resolveEquipmentSlot(item, preferredSlot);
    if (!slot) {
      return { ok: false, message: `${item.label} does not fit that slot.` };
    }
    for (const [currentSlot, equippedItem] of Object.entries(this.equipment)) {
      if (equippedItem?.id === item.id) {
        this.equipment[currentSlot] = null;
      }
    }
    if (source === "core") {
      this.coreStorage = this.coreStorage.filter((storedItem) => storedItem.id !== item.id);
      this.loot.push(item);
    }
    this.equipment[slot] = item;
    if (this.health > this.effectiveMaxHealth) {
      this.health = this.effectiveMaxHealth;
    }
    return { ok: true, message: `${item.label} equipped.` };
  }

  resolveEquipmentSlot(item, preferredSlot = null) {
    if (preferredSlot) {
      const slotConfig = CONFIG.loot.equipmentSlots.find((slot) => slot.id === preferredSlot);
      if (!slotConfig) {
        return null;
      }
      if (slotConfig.accepts && !slotConfig.accepts.includes(item.slot)) {
        return null;
      }
      if (!slotConfig.accepts && item.slot !== preferredSlot) {
        return null;
      }
      return preferredSlot;
    }
    if (item.slot === "relic") {
      return this.equipment.relic1 ? "relic2" : "relic1";
    }
    return CONFIG.loot.equipmentSlots.some((slot) => slot.id === item.slot) ? item.slot : null;
  }

  deleteLoot(itemId) {
    const index = this.loot.findIndex((item) => item.id === itemId);
    if (index < 0) {
      return { ok: false, message: "Item not found." };
    }
    const [removed] = this.loot.splice(index, 1);
    for (const [slot, item] of Object.entries(this.equipment)) {
      if (item?.id === itemId) {
        this.equipment[slot] = null;
      }
    }
    return { ok: true, message: `${removed.label} deleted.` };
  }

  sellLoot(itemId) {
    const source = this.getLootSource(itemId);
    const collection = source === "core" ? this.coreStorage : this.loot;
    const index = collection.findIndex((item) => item.id === itemId);
    if (index < 0) {
      return { ok: false, message: "Item not found." };
    }

    const [sold] = collection.splice(index, 1);
    for (const [slot, item] of Object.entries(this.equipment)) {
      if (item?.id === itemId) {
        this.equipment[slot] = null;
      }
    }
    this.health = Math.min(this.health, this.effectiveMaxHealth);
    const rarityValue = CONFIG.loot.rarities[sold.rarity]?.sell || 18;
    const value = Math.max(1, Math.round((sold.value || sold.tier * 18) + rarityValue + sold.tier * 8));
    this.currency += value;
    return { ok: true, message: `${sold.label} sold for ${value} gold.`, value };
  }

  depositLootToCore() {
    const movable = this.backpackLoot;
    if (movable.length === 0) {
      return { ok: false, message: "No backpack loot to store." };
    }
    const freeSlots = Math.max(0, CONFIG.loot.baseStorageLimit - this.coreStorage.length);
    if (freeSlots <= 0) {
      return { ok: false, message: "Core storage is full." };
    }
    const deposited = movable.slice(0, freeSlots);
    const depositedIds = new Set(deposited.map((item) => item.id));
    this.loot = this.loot.filter((item) => !depositedIds.has(item.id));
    this.coreStorage.push(...deposited);
    const remaining = movable.length - deposited.length;
    return {
      ok: true,
      message: `Stored ${deposited.length} item${deposited.length === 1 ? "" : "s"} in the core${remaining > 0 ? ` (${remaining} left in backpack)` : ""}.`
    };
  }

  dropCarriedAndEquippedLoot() {
    const dropMap = new Map();
    for (const item of this.loot) {
      dropMap.set(item.id, item);
    }
    for (const item of Object.values(this.equipment)) {
      if (item) {
        dropMap.set(item.id, item);
      }
    }
    const dropped = [...dropMap.values()];
    this.loot = [];
    this.equipment = Object.fromEntries(CONFIG.loot.equipmentSlots.map((slot) => [slot.id, null]));
    this.health = Math.min(this.health, this.effectiveMaxHealth);
    return dropped;
  }

  upgradeAbility(abilityId) {
    if (this.skillPoints <= 0) {
      return { ok: false, message: "No skill points available." };
    }
    const result = this.abilityBook.upgrade(abilityId);
    if (!result.ok) {
      return result;
    }
    this.skillPoints -= 1;
    return result;
  }

  upgradeAttribute(attribute) {
    if (this.attributePoints <= 0) {
      return { ok: false, message: "No attribute points available." };
    }
    if (!Object.prototype.hasOwnProperty.call(this.attributes, attribute)) {
      return { ok: false, message: "Unknown attribute." };
    }
    this.attributes[attribute] += 1;
    this.attributePoints -= 1;
    this.health = Math.min(this.effectiveMaxHealth, this.health + (attribute === "vitality" ? 22 : 0));
    return { ok: true, message: `${attribute} increased.` };
  }

  applyCoreDebuff() {
    this.baseDebuffStacks += 1;
    this.health = Math.min(this.health, this.effectiveMaxHealth);
    if (this.characterId === "warlock") {
      this.soulStacks = Math.floor((this.soulStacks || 0) * (CONFIG.classPassives?.warlock?.resetOnDeathPercent ?? 0.5));
    }
  }

  applyBaseLayoutBonus(bonus = {}) {
    this.baseLayoutBonus = { ...bonus };
    this.health = Math.min(this.health, this.effectiveMaxHealth);
  }

  applyNomadMode() {
    if (this.nomadMode) {
      return { ok: false, message: "Nomad path already active." };
    }
    this.nomadMode = true;
    this.baseLayoutBonus = {};
    this.health = this.effectiveMaxHealth;
    this.currency += 180;
    return { ok: true, message: "Nomad path active: major health and damage bonus, no core respawns." };
  }

  applyBossBuff() {
    this.bossBlessing = true;
    this.extraLives = Math.max(this.extraLives, 1);
    this.health = this.effectiveMaxHealth;
    return { ok: true, message: "Boss blessing gained: all stats increased and one extra life banked." };
  }

  consumeExtraLife() {
    if (this.extraLives <= 0) {
      return false;
    }
    this.extraLives -= 1;
    this.alive = true;
    this.respawnTimer = 0;
    this.health = Math.max(1, Math.round(this.effectiveMaxHealth * 0.72));
    return true;
  }

  takeDamage(amount) {
    const applied = super.takeDamage(amount);
    if (applied > 0) {
      this.timeSinceDamage = 0;
    }
    return applied;
  }

  grantShield(amount, duration) {
    if (!this.alive || amount <= 0 || duration <= 0) {
      return 0;
    }
    this.maxShield = Math.max(this.maxShield || 0, Math.round(amount));
    this.shield = Math.max(this.shield || 0, Math.round(amount));
    this.shieldTimer = Math.max(this.shieldTimer || 0, duration);
    this.shieldMaxTimer = Math.max(this.shieldMaxTimer || 0, duration);
    return this.shield;
  }

  absorbShieldDamage(amount) {
    if ((this.shield || 0) <= 0 || amount <= 0) {
      return amount;
    }
    const absorbed = Math.min(this.shield, amount);
    this.shield -= absorbed;
    if (this.shield <= 0) {
      this.clearShield();
    }
    return Math.max(0, amount - absorbed);
  }

  clearShield() {
    this.shield = 0;
    this.maxShield = 0;
    this.shieldTimer = 0;
    this.shieldMaxTimer = 0;
  }

  get shieldRatio() {
    return this.maxShield > 0 ? Math.max(0, this.shield / this.maxShield) : 0;
  }

  get isStealthed() {
    return (this.stealthTimer || 0) > 0;
  }

  breakStealth() {
    this.stealthTimer = 0;
    this.stealthMaxTimer = 0;
    this.stealthDamageBonus = 1;
    this.stealthUntargetable = false;
    this.stealthUntargetableKinds = [];
    this.stealthBreakOnDamageAction = true;
  }

  heal(amount) {
    if (!this.alive || amount <= 0) {
      return 0;
    }
    const missing = Math.max(0, this.effectiveMaxHealth - this.health);
    const healed = Math.min(missing, amount);
    this.health += healed;
    return healed;
  }
}

function tunedHealth(stats) {
  const tuning = CONFIG.player.statTuning || {};
  return Math.round((stats.health || CONFIG.player.maxHealth) * (tuning.healthMultiplier || 1) + (tuning.healthBonus || 0));
}

function tunedMoveSpeed(stats) {
  const tuning = CONFIG.player.statTuning || {};
  return Math.round((stats.moveSpeed || CONFIG.player.moveSpeed) * (tuning.moveSpeedMultiplier || 1) + (tuning.moveSpeedBonus || 0));
}










