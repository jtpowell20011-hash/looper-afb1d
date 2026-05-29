// @ts-check
import { CONFIG } from "./config.js?v=1.8.57";
export class DamageTracker {
  constructor() {
    this.contributions = new Map();
  }

  record(sourceId, sourceKind, damage) {
    if (!sourceId || damage <= 0) {
      return;
    }
    const current = this.contributions.get(sourceId) || { sourceId, sourceKind, damage: 0 };
    current.damage += damage;
    this.contributions.set(sourceId, current);
  }

  shares() {
    const entries = Array.from(this.contributions.values());
    const total = entries.reduce((sum, entry) => sum + entry.damage, 0);
    if (total <= 0) {
      return [];
    }
    return entries.map((entry) => ({
      ...entry,
      share: entry.damage / total
    }));
  }
}

export class RewardSystem {
  grantMobReward(player, mob) {
    const tier = mob.tier || 1;
    const lootItem = Math.random() < Math.min(0.16, 0.045 + tier * 0.025) ? createLootItem(tier, mob.archetype) : null;
    const reward = {
      xp: mob.xpReward || 24 * tier,
      gold: mob.goldReward || 18 * tier,
      resources: mob.resourceReward || 8 * tier,
      loot: lootItem ? 1 : 0,
      lootItem
    };

    player.addXP(reward.xp);
    player.currency += reward.gold;
    player.resources += reward.resources;

    return reward;
  }

  grantObjectiveReward(player, objective) {
    if (objective.type === "shrine") {
      player.currency += 60;
      player.addXP(35);
      return "+60 gold, +35 XP";
    }
    if (objective.type === "mine") {
      player.resources += 75;
      player.addXP(30);
      return "+75 build, +30 XP";
    }
    if (objective.type === "watchtower") {
      player.currency += 30;
      player.addXP(25);
      return "+vision, +25 XP";
    }
    if (objective.type === "relic") {
      player.currency += 50;
      player.resources += 45;
      player.addXP(45);
      return "+base buff, +45 XP";
    }
    if (objective.type === "forge") {
      player.currency += 55;
      player.addXP(55);
      player.attributes.power += 1;
      return "+power, +55 XP";
    }
    return "+objective";
  }

  grantObjectiveGuardianReward(player, objective) {
    player.addXP(objective.type === "relic" || objective.type === "forge" ? 70 : 45);
    player.currency += objective.type === "mine" ? 45 : objective.type === "forge" ? 55 : 30;
    if (objective.type === "mine") {
      player.resources += 65;
    }
    if (objective.type === "watchtower") {
      player.wards += 1;
    }
    return objective.type === "watchtower" ? "+vision ward" : "+first clear bonus";
  }

  createObjectiveLoot(objective) {
    const tier = objective.type === "relic" || objective.type === "forge" ? 4 : objective.type === "mine" ? 3 : 2;
    const slot = objective.type === "relic" ? "relic" : objective.type === "forge" ? "primary" : undefined;
    return createLootItem(tier, "objective", { slot, rarity: tier >= 4 ? "epic" : "rare" });
  }

  createShopLoot(playerLevel, tierKey = "standard") {
    const shopTier = CONFIG.shop.equipmentTiers?.[tierKey] || CONFIG.shop.equipmentTiers?.standard;
    const tier = shopTier ? Math.max(shopTier.tier, Math.min(5, Math.ceil(playerLevel / 3) + shopTier.tier - 1)) : Math.max(1, Math.min(4, Math.ceil(playerLevel / 2)));
    return createLootItem(tier, "shop", { rarity: shopTier?.rarity || (tier >= 3 ? "rare" : "uncommon") });
  }

  createExplorationLoot(tier, sourceKind = "chest") {
    const rarity = tier >= 3 ? "epic" : tier >= 2 ? "rare" : undefined;
    return createLootItem(tier, sourceKind, rarity ? { rarity } : {});
  }

  grantBossReward(player) {
    player.currency += 260;
    player.resources += 220;
    player.addXP(180);
    player.applyBossBuff?.();
    return createLootItem(5, "boss", { slot: "relic", label: "Boss Relic Core", rarity: "legendary" });
  }

  grantPlayerKillReward(player, victimSnapshot = {}) {
    const pvp = CONFIG.combat?.pvp || {};
    const victimLevel = Math.max(1, victimSnapshot.level || victimSnapshot.victimLevel || 1);
    const reward = {
      xp: Math.round((pvp.playerKillXP || 180) + victimLevel * (pvp.playerKillXPPerLevel || 42)),
      gold: Math.round((pvp.playerKillGold || 160) + victimLevel * (pvp.playerKillGoldPerLevel || 28)),
      resources: Math.round((pvp.playerKillResources || 110) + victimLevel * (pvp.playerKillResourcesPerLevel || 18))
    };
    player.addXP(reward.xp);
    player.currency += reward.gold;
    player.resources += reward.resources;
    return reward;
  }

  grantSyncedMobReward(player, event = {}) {
    const reward = {
      xp: Math.max(0, Math.round(Number(event.rewardXP || 0))),
      gold: Math.max(0, Math.round(Number(event.rewardGold || 0))),
      resources: Math.max(0, Math.round(Number(event.rewardResources || 0)))
    };
    player.addXP(reward.xp);
    player.currency += reward.gold;
    player.resources += reward.resources;
    if (event.bossBuff) {
      player.applyBossBuff?.();
    }
    return reward;
  }

  grantCoreDestroyReward(player) {
    const pvp = CONFIG.combat?.pvp || {};
    const reward = {
      xp: pvp.coreDestroyXP || 220,
      gold: pvp.coreDestroyGold || 220,
      resources: pvp.coreDestroyResources || 180
    };
    player.addXP(reward.xp);
    player.currency += reward.gold;
    player.resources += reward.resources;
    return reward;
  }

  distributeFuturePlayerKillReward(_victimSnapshot, _damageTracker) {
    // TODO multiplayer: split XP/currency/resources by player damage contribution.
    // Last hits should not decide rewards. Server authority should own this call.
    return [];
  }
}

const SLOT_LABELS = {
  primary: ["Wayfinder Spear", "Runed Bow", "Impact Scepter"],
  helmet: ["Scout Helm", "Iron Visor", "Focus Hood"],
  gloves: ["Grip Wraps", "Striker Gloves", "Builder Bracers"],
  chest: ["Field Vest", "Stoneplate", "Aegis Coat"],
  boots: ["Trail Boots", "River Steps", "Swift Greaves"],
  relic: ["Sun Shard", "Wardstone", "Ancient Sigil"]
};

const SLOT_STATS = {
  primary: "damage",
  helmet: "vision",
  gloves: "attackSpeed",
  chest: "health",
  boots: "speed",
  relic: "armor"
};

function createLootItem(tier, archetype = "melee", overrides = {}) {
  const slot = overrides.slot || randomSlot(tier);
  const rarity = overrides.rarity || rarityForTier(tier);
  const rarityConfig = CONFIG.loot.rarities[rarity];
  const names = SLOT_LABELS[slot] || SLOT_LABELS.primary;
  const label = overrides.label || names[Math.floor(Math.random() * names.length)];
  const statKey = SLOT_STATS[slot] || "damage";
  const statScale = statKey === "health" ? 9 : statKey === "speed" ? 3.4 : 2;
  const amount = Math.max(1, Math.round((tier + 1) * rarityConfig.multiplier * statScale + (statKey === "speed" ? tier * 2 : 0)));
  const stats = { [statKey]: amount };
  if (archetype === "ranged" && slot !== "primary") {
    stats.vision = (stats.vision || 0) + tier * 8;
  }
  if (archetype === "brute" && slot !== "chest") {
    stats.health = (stats.health || 0) + tier * 7;
  }
  return {
    id: `loot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label,
    tier,
    slot,
    rarity,
    rarityLabel: rarityConfig.label,
    color: rarityConfig.color,
    stats,
    description: `${rarityConfig.label} ${slotLabel(slot)}. ${statDescription(stats)}.`,
    value: tier * 18
  };
}

function randomSlot(tier) {
  const slots = ["primary", "helmet", "gloves", "chest", "boots"];
  if (tier >= 2) {
    slots.push("relic");
  }
  return slots[Math.floor(Math.random() * slots.length)];
}

function rarityForTier(tier) {
  const roll = Math.random();
  if (tier >= 5 || roll > 0.97) return "legendary";
  if (tier >= 3 && roll > 0.74) return "epic";
  if (tier >= 2 && roll > 0.48) return "rare";
  if (roll > 0.26) return "uncommon";
  return "common";
}

function slotLabel(slot) {
  return CONFIG.loot.equipmentSlots.find((entry) => entry.id === slot)?.label || (slot === "relic" ? "Relic" : slot);
}

function statDescription(stats) {
  return Object.entries(stats)
    .map(([key, value]) => `+${value} ${key}`)
    .join(", ");
}










