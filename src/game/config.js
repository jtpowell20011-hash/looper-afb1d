// @ts-check
export const CONFIG = Object.freeze({
  world: {
    mapSize: "large",
    width: 33600,
    height: 25200,
    playerVision: 980,
    baseVision: 820,
    watchtowerVision: 720,
    spawnPoint: {
      x: 650,
      y: 520
    }
  },
  mapSizes: {
    small: {
      label: "Small",
      width: 8400,
      height: 6300,
      campDensity: 0.7,
      minorCampCount: 28,
      treeCount: 72,
      rockCount: 34
    },
    medium: {
      label: "Medium",
      width: 16800,
      height: 12600,
      campDensity: 1.25,
      minorCampCount: 62,
      treeCount: 138,
      rockCount: 66
    },
    large: {
      label: "Large",
      width: 33600,
      height: 25200,
      campDensity: 2.05,
      minorCampCount: 130,
      treeCount: 300,
      rockCount: 140
    }
  },
  player: {
    radius: 18,
    maxHealth: 140,
    moveSpeed: 252,
    acceleration: 2050,
    friction: 9.5,
    statTuning: {
      moveSpeedMultiplier: 1.07,
      healthMultiplier: 1.65
    },
    baseRegenDelay: 20,
    baseRegenPercentPerSecond: 0.045,
    respawnBaseSeconds: 5,
    xpBase: 100
  },
  phases: [
    {
      id: "exploration",
      label: "Exploration",
      duration: 600,
      canPlaceBase: true,
      description: "Scout terrain, farm early camps, and claim an opening base site."
    },
    {
      id: "base_claim",
      label: "Build Up",
      duration: 300,
      canPlaceBase: false,
      description: "Base sites are locked. Level up, fortify, and prepare for pressure."
    },
    {
      id: "power_growth",
      label: "Base Defense",
      duration: 300,
      canPlaceBase: false,
      description: "Upgrade, capture objectives, and withstand base pressure before reveals."
    },
    {
      id: "reveal",
      label: "Reveal",
      duration: 300,
      canPlaceBase: false,
      description: "Rival base cores are revealed on the map."
    },
    {
      id: "endgame",
      label: "Endgame",
      duration: 300,
      canPlaceBase: false,
      description: "Force final conflicts around bases and objectives."
    }
  ],
  abilities: {
    basic: {
      id: "basic",
      label: "Basic Shot",
      key: "Click",
      cooldown: 0.42,
      damage: 13,
      range: 520,
      speed: 760,
      radius: 5,
      color: "#f1d06b"
    },
    skillshot: {
      id: "skillshot",
      label: "Piercing Line",
      key: "Q",
      cooldown: 2.8,
      damage: 32,
      range: 760,
      speed: 860,
      radius: 7,
      color: "#6ec7d6"
    },
    area: {
      id: "area",
      label: "Anchor Field",
      key: "E",
      cooldown: 6.5,
      damage: 24,
      range: 360,
      radius: 122,
      duration: 0.35,
      color: "#b391f0"
    },
    ultimate: {
      id: "ultimate",
      label: "Corebreaker",
      key: "R",
      cooldown: 34,
      damage: 105,
      range: 680,
      radius: 210,
      duration: 0.75,
      color: "#ffcf5a"
    }
  },
  mobs: {
    baseSpawnInterval: 18,
    campMax: 3,
    chaseRadius: 480,
    attackRange: 32,
    attackCooldown: 1.15,
    waveInterval: 20
  },
  economy: {
    mobRewards: {
      xpMultiplier: 1.12,
      goldMultiplier: 1.65,
      resourceMultiplier: 2.05,
      tierGoldBonus: 6,
      tierResourceBonus: 5,
      levelXpScale: 0.035,
      levelGoldScale: 0.055,
      levelResourceScale: 0.065,
      minorCampRewardMultiplier: 0.82,
      zoneMultipliers: {
        forest: 1,
        river: 1.08,
        mountain: 1.18,
        relic: 1.22,
        ruins: 1.32,
        danger: 1.45,
        boss: 1.5,
        wild: 1
      }
    }
  },
  ai: {
    thinkIntervalMin: 0.6,
    thinkIntervalMax: 1.6,
    personalities: ["Raider", "Farmer", "Objective Controller", "Turtler", "Boss Hunter"],
    objectiveLevelBuffer: 2
  },
  performance: {
    activeCampRadius: 2400,
    debugKey: "F9",
    hudUpdateHz: 10
  },
  multiplayer: {
    maxSyncedMobs: 360
  },
  recall: {
    duration: 8,
    cancelOnMove: true,
    cancelOnDamage: true,
    cancelOnAbility: true
  },
  combat: {
    autoAttack: {
      clickRadius: 140,
      hoverRadius: 108,
      outOfRangeBuffer: 14,
      targetPanelHz: 8,
      outOfRangeToastCooldown: 0.85,
      highlightColor: "#ff4d4d"
    },
    damageNumbers: {
      max: 90,
      life: 1.05,
      riseSpeed: 34,
      spread: 22,
      textFontSize: 20,
      hitFontSize: 24,
      labelScale: 1.18
    },
    meleeStructure: {
      guardian: { structureDamage: 1.45, closeTowerDamageTaken: 0.72 },
      berserker: { structureDamage: 1.32, frenzyStructureDamage: 1.18, closeTowerDamageTaken: 0.82 },
      shadowblade: { structureDamage: 1.24, closeTowerDamageTaken: 0.88 },
      sentinel: { structureDamage: 1.28, holdLineStructureDamage: 1.12, closeTowerDamageTaken: 0.76 },
      closeRange: 170,
      closeRangeTowerMitigation: 0.9
    },
    towerProjectiles: {
      baseSpeed: 610,
      closeRangeDamageMultiplier: 0.82,
      playerDamageMin: 0.1,
      playerDamageMax: 0.52
    },
    pvp: {
      enabled: true,
      remoteDamageEvents: true,
      playerKillXP: 180,
      playerKillXPPerLevel: 42,
      playerKillGold: 160,
      playerKillGoldPerLevel: 28,
      playerKillResources: 110,
      playerKillResourcesPerLevel: 18,
      coreDestroyXP: 220,
      coreDestroyGold: 220,
      coreDestroyResources: 180
    }
  },
  abilityScaling: {
    defaultDamagePerLevel: 2.6,
    defaultDamagePerAbilityLevel: 5,
    basicDamagePerLevel: 1.45,
    basicDamagePerAbilityLevel: 3,
    ultimateDamagePerLevel: 7.5,
    ultimateDamagePerAbilityLevel: 18,
    turretDamagePerLevel: 1.8,
    repairPerLevel: 1.8,
    guardianShieldBase: 80,
    guardianShieldPerLevel: 13,
    guardianShieldPerAbilityLevel: 34,
    guardianChargeImpactRadius: 118,
    guardianChargeImpactMultiplier: 0.75
  },
  classPassives: {
    guardian: {
      mobKillHealPercent: 0.055
    },
    berserker: {
      maxRage: 12,
      rageDamageBonusPerStack: 0.75,
      rageOnDamage: 1,
      mobKillHealPercent: 0.045,
      playerKillHealPercent: 0.12
    },
    warlock: {
      maxSoulStacks: 18,
      damageBonusPerSoul: 0.75,
      resetOnDeathPercent: 0.5
    },
    druid: {
      forestBondSpeedBonus: 16,
      forestBondHealMultiplier: 1.08
    },
    sentinel: {
      holdStillSeconds: 1.2,
      holdDamageReduction: 0.14
    }
  },
  mapGeneration: {
    majorCampBaseCount: 24,
    minorCampSpacing: 440,
    openFieldCampRatio: 0.54,
    minorCampRespawn: 26,
    minorCampClearRespawn: 46,
    majorCampSpacing: 680,
    bridgeCampExclusion: 520,
    roadWidth: 92,
    ambushClueRadius: 58,
    neutralTowerBaseExclusion: 860,
    villageBaseExclusion: 520,
    pathClaimExclusion: 150,
    propClearRadius: 620,
    propRiverExclusion: 180,
    propPathExclusion: 92
  },
  levelDisplay: {
    enabled: true,
    highRiskDelta: 3,
    dangerousDelta: 2,
    safeDelta: -2,
    updateHz: 4,
    badgeFontSize: 13,
    badgeHeight: 24,
    badgePaddingX: 18
  },
  neutralTowers: {
    basePlacementExclusion: 860,
    spawnRules: {
      small: { vision: 2, turret: 2, minSpacing: 1350 },
      medium: { vision: 4, turret: 4, minSpacing: 1550 },
      large: { vision: 7, turret: 7, minSpacing: 1850 }
    },
    types: {
      vision: {
        label: "Vision Tower",
        health: 620,
        levelOffset: 1,
        damage: 0,
        captureSeconds: 8,
        visionRadius: 1250,
        rewardGold: 75,
        rewardXP: 90,
        color: "#72d8e8"
      },
      turret: {
        label: "Turret Tower",
        health: 760,
        levelOffset: 2,
        damage: 28,
        projectileSpeed: 560,
        fireRate: 1.55,
        targetingRadius: 620,
        rewardGold: 110,
        rewardXP: 120,
        color: "#ff8a5a"
      }
    }
  },
  villages: {
    spawnRules: {
      small: { count: 2, minSpacing: 1650 },
      medium: { count: 4, minSpacing: 1900 },
      large: { count: 7, minSpacing: 2300 }
    },
    allowedZones: ["forest", "river", "mountain", "relic"],
    rewardGold: 38,
    rewardResources: 32,
    ambushChance: 0.28,
    propDensity: 7
  },
  campTiers: {
    1: { label: "Tier 1", maxMobs: 3, respawn: 30, clearRespawn: 48, rewardScale: 1 },
    2: { label: "Tier 2", maxMobs: 4, respawn: 40, clearRespawn: 64, rewardScale: 1.35 },
    3: { label: "Tier 3", maxMobs: 5, respawn: 52, clearRespawn: 84, rewardScale: 1.75 },
    elite: { label: "Elite", maxMobs: 6, respawn: 68, clearRespawn: 104, rewardScale: 2.2 }
  },
  campTypes: {
    goblin: { label: "Goblin Camp", zones: ["forest", "river"], variants: ["melee", "swift", "ranged"], reward: "building resources" },
    rogue: { label: "Rogue Camp", zones: ["river", "relic"], variants: ["swift", "ranged", "skitter"], reward: "gold and utility loot" },
    skeleton: { label: "Skeleton Camp", zones: ["mountain", "ruins"], variants: ["melee", "tank", "ranged"], reward: "XP and combat progress" },
    cultist: { label: "Cultist Camp", zones: ["ruins", "danger"], variants: ["summoner", "ranged", "skitter"], reward: "essence and ability loot" },
    brute: { label: "Brute Camp", zones: ["mountain", "danger"], variants: ["brute", "tank", "melee"], reward: "defensive gear" },
    wraith: { label: "Wraith Camp", zones: ["danger", "boss"], variants: ["summoner", "skitter", "ranged", "tank"], reward: "rare vision rewards" }
  },
  bossTemplates: {
    riverGuardian: {
      label: "River Guardian",
      zoneTypes: ["river"],
      attackPattern: "projectile bursts near bridges",
      reward: "temporary movement and crossing-control buff"
    },
    stonebreakerBrute: {
      label: "Stonebreaker Brute",
      zoneTypes: ["mountain"],
      attackPattern: "charged melee slams",
      reward: "structure damage and wall material boost"
    },
    wraithLord: {
      label: "Wraith Lord",
      zoneTypes: ["ruins", "danger"],
      attackPattern: "summon and fog reveal pulses",
      reward: "vision reveal and stealth detection"
    },
    arcaneProphet: {
      label: "Arcane Cultist Prophet",
      zoneTypes: ["ruins"],
      attackPattern: "delayed AoE circles",
      reward: "temporary cooldown reduction"
    },
    forestAncient: {
      label: "Forest Ancient",
      zoneTypes: ["forest"],
      attackPattern: "rooting melee and healing phases",
      reward: "healing and defensive base growth"
    }
  },
  loot: {
    carryLimit: 10,
    baseStorageLimit: 80,
    dropDespawnSeconds: 70,
    deathDropDespawnSeconds: 180,
    maxWorldDrops: 90,
    pickupRadius: 210,
    rarities: {
      common: { label: "Common", color: "#c9d1c0", multiplier: 1, sell: 18 },
      uncommon: { label: "Uncommon", color: "#63d46b", multiplier: 1.25, sell: 34 },
      rare: { label: "Rare", color: "#6ec7d6", multiplier: 1.6, sell: 62 },
      epic: { label: "Epic", color: "#b391f0", multiplier: 2.1, sell: 112 },
      legendary: { label: "Legendary", color: "#e7bd58", multiplier: 2.8, sell: 190 }
    },
    equipmentSlots: [
      { id: "primary", label: "Primary Weapon" },
      { id: "helmet", label: "Helmet" },
      { id: "gloves", label: "Gloves" },
      { id: "chest", label: "Chest" },
      { id: "boots", label: "Boots" },
      { id: "relic1", label: "Relic I", accepts: ["relic"] },
      { id: "relic2", label: "Relic II", accepts: ["relic"] }
    ]
  },
  base: {
    maxEmergencyRebuilds: 2,
    emergencyWindow: 45,
    originalEnergyCap: 34,
    firstEmergencyEnergyCap: 26,
    secondEmergencyEnergyCap: 20,
    firstCoreLossHealthPenalty: 0.8,
    secondCoreLossHealthPenalty: 0.62,
    firstCoreLossDefenseMultiplier: 0.9,
    secondCoreLossDefenseMultiplier: 0.72,
    relocationRadius: 90,
    generatorTick: 4,
    expansionEnergyBonus: 7,
    objectiveClaimExclusion: 780,
    riverClaimExclusion: 560,
    neutralTowerClaimExclusion: 860,
    villageClaimExclusion: 520,
    edgeClaimExclusion: 900,
    maxReplots: 3,
    passiveRepairDelay: 60,
    passiveRepairPercentPerSecond: 0.015,
    recovery: {
      enabled: true,
      noDamageSeconds: 30,
      underAttackGraceSeconds: 8,
      restoreInterval: 2.5,
      maxRestoredPerPulse: 1,
      restoredHealthRatio: 0.68,
      eligibleTypes: ["wall", "tower", "ballista", "pulseTower", "generator", "barracks"]
    },
    wallSpacing: {
      starterRadiusX: 356,
      starterRadiusY: 292,
      expansionRings: [
        { x: 590, y: 488 },
        { x: 800, y: 660 },
        { x: 1030, y: 846 },
        { x: 1280, y: 1050 }
      ],
      interiorBounds: [
        { x: 286, y: 230 },
        { x: 474, y: 386 },
        { x: 668, y: 544 },
        { x: 884, y: 716 },
        { x: 1120, y: 922 }
      ],
      wallThickness: 16,
      buildingWallPadding: 54,
      buildingSlotPadding: 74,
      towerSlotRatios: [
        { x: -1, y: -0.62 },
        { x: 1, y: -0.62 },
        { x: -1, y: 0.62 },
        { x: 1, y: 0.62 },
        { x: -0.42, y: -1 },
        { x: 0.42, y: -1 },
        { x: -0.42, y: 1 },
        { x: 0.42, y: 1 }
      ],
      generatorSlotRatios: [
        { x: 0, y: 0.76 },
        { x: 0.62, y: 0 },
        { x: -0.62, y: 0 },
        { x: 0, y: -0.76 }
      ],
      barracksSlotRatios: [
        { x: 0, y: -0.56 },
        { x: 0, y: 0.56 },
        { x: -0.48, y: 0 },
        { x: 0.48, y: 0 }
      ]
    },
    wallHealthUpgrade: {
      maxLevel: 8,
      gold: 520,
      resources: 360,
      costGrowth: 1.58,
      healthBonus: 0.22,
      repairCostBonus: 0.18
    },
    buildings: {
      core: {
        label: "Core",
        maxHealth: 580,
        energy: 0,
        upgradeGold: 90,
        upgradeBuild: 60
      },
      wall: {
        label: "Wall",
        maxHealth: 460,
        energy: 0
      },
      tower: {
        label: "Basic Tower",
        maxHealth: 250,
        energy: 2,
        damage: 16,
        range: 360,
        fireRate: 1.15,
        upgradeGold: 75,
        upgradeBuild: 45
      },
      ballista: {
        label: "Ballista",
        maxHealth: 310,
        energy: 4,
        damage: 38,
        range: 520,
        fireRate: 1.85,
        upgradeGold: 120,
        upgradeBuild: 95,
        shopGold: 360,
        shopBuild: 170,
        unlockCoreLevel: 5
      },
      pulseTower: {
        label: "Pulse Tower",
        maxHealth: 280,
        energy: 3,
        damage: 23,
        range: 410,
        fireRate: 0.78,
        upgradeGold: 110,
        upgradeBuild: 85,
        shopGold: 295,
        shopBuild: 140,
        unlockCoreLevel: 15
      },
      barracks: {
        label: "Barracks",
        maxHealth: 360,
        energy: 4,
        upgradeGold: 150,
        upgradeBuild: 125,
        shopGold: 520,
        shopBuild: 260,
        unlockCoreLevel: 10
      },
      generator: {
        label: "Resource Generator",
        maxHealth: 190,
        energy: 2,
        goldPerTick: 8,
        buildPerTick: 6,
        upgradeGold: 65,
        upgradeBuild: 55
      }
    },
    layouts: {
      fortress: {
        label: "Fortress",
        summary: "Strong walls and four towers, slower economy.",
        wallScale: 1.12,
        towers: [
          { ox: -194, oy: -158 },
          { ox: 194, oy: -158 },
          { ox: -194, oy: 158 },
          { ox: 194, oy: 158 }
        ],
        generators: [{ ox: 0, oy: 176 }],
        wallLevel: 2,
        heroBonus: { health: 24 }
      },
      outpost: {
        label: "Outpost",
        summary: "Balanced starter base with steady income.",
        wallScale: 1,
        towers: [
          { ox: -166, oy: -136 },
          { ox: 166, oy: -136 }
        ],
        generators: [{ ox: 142, oy: 136 }],
        heroBonus: {}
      },
      raider: {
        label: "Raider",
        summary: "Weak base, stronger hero combat pressure.",
        wallScale: 0.9,
        towers: [{ ox: 0, oy: -152 }],
        generators: [{ ox: 142, oy: 132 }],
        wallLevel: 1,
        heroBonus: { damage: 10, speed: 18 }
      },
      resource: {
        label: "Resource",
        summary: "Extra generators, weaker opening defenses.",
        wallScale: 0.94,
        towers: [{ ox: -174, oy: -142 }],
        generators: [
          { ox: 154, oy: -112 },
          { ox: 154, oy: 126 },
          { ox: -116, oy: 150 }
        ],
        heroBonus: {}
      },
      scout: {
        label: "Scout",
        summary: "Superior base vision and early warning, with lighter defenses.",
        wallScale: 0.98,
        towers: [
          { ox: -166, oy: -136 },
          { ox: 166, oy: 136 }
        ],
        generators: [{ ox: 142, oy: -136 }],
        heroBonus: { vision: 320, speed: 8 },
        baseVisionBonus: 1450,
        stats: { defense: 2, economy: 2, vision: 5 }
      }
    }
  },
  shop: {
    equipmentTiers: {
      standard: { label: "Standard Gear", cost: 120, tier: 1, rarity: "common" },
      uncommon: { label: "Uncommon Gear", cost: 260, tier: 2, rarity: "uncommon" },
      rare: { label: "Rare Gear", cost: 560, tier: 3, rarity: "rare" },
      epic: { label: "Epic Gear", cost: 1120, tier: 4, rarity: "epic" }
    },
    healthPotion: {
      baseGold: 135,
      perLevelGold: 26,
      healthCostFactor: 0.42,
      healRatio: 0.42,
      perLevelHeal: 7,
      maxHeld: 2,
      cooldown: 30
    },
    ward: {
      cost: 55,
      maxHeld: 2,
      cooldown: 30
    }
  },
  objectives: [
    {
      id: "shrine-north",
      type: "shrine",
      label: "North Shrine",
      x: 3300,
      y: 1640,
      radius: 104,
      captureSeconds: 11,
      reward: "Passive gold",
      guardianKind: "hybrid",
      guardianHealth: 980,
      guardianDamage: 34
    },
    {
      id: "mine-east",
      type: "mine",
      label: "Iron Mine",
      x: 12400,
      y: 2700,
      radius: 112,
      captureSeconds: 12,
      reward: "Build income",
      guardianKind: "tower",
      guardianHealth: 850,
      guardianDamage: 29
    },
    {
      id: "watchtower-west",
      type: "watchtower",
      label: "Old Watchtower",
      x: 2300,
      y: 8800,
      radius: 102,
      captureSeconds: 10,
      reward: "Vision radius",
      guardianKind: "tower",
      guardianHealth: 760,
      guardianDamage: 26
    },
    {
      id: "relic-south",
      type: "relic",
      label: "Sunken Relic",
      x: 11800,
      y: 10100,
      radius: 108,
      captureSeconds: 13,
      reward: "Base defense buff",
      guardianKind: "melee",
      guardianHealth: 1020,
      guardianDamage: 33
    },
    {
      id: "storm-spire",
      type: "watchtower",
      label: "Storm Spire",
      x: 4300,
      y: 10300,
      radius: 112,
      captureSeconds: 13,
      reward: "Vision and ward",
      guardianKind: "volley",
      guardianHealth: 1220,
      guardianDamage: 37
    },
    {
      id: "ember-forge",
      type: "forge",
      label: "Ember Forge",
      x: 8050,
      y: 1300,
      radius: 118,
      captureSeconds: 14,
      reward: "Hero damage",
      guardianKind: "volley",
      guardianHealth: 1350,
      guardianDamage: 39
    },
    {
      id: "beast-den",
      type: "relic",
      label: "Beast Den",
      x: 14700,
      y: 10400,
      radius: 118,
      captureSeconds: 14,
      reward: "Hero speed",
      guardianKind: "charger",
      guardianHealth: 1480,
      guardianDamage: 42
    },
    {
      id: "boss-center",
      type: "boss",
      label: "Central Boss",
      x: 8400,
      y: 6300,
      radius: 120,
      captureSeconds: 0,
      reward: "Boss blessing"
    }
  ],
  objectiveRules: {
    captureRadiusBonus: 92,
    leash: {
      engagePadding: 92,
      returnSpeed: 310,
      healingPercentPerSecond: 0.08,
      resetDistance: 42,
      fullResetAtHome: false,
      arenaDamagePadding: 0,
      damageGracePadding: 120,
      guardianMoveSpeedScale: 0.72,
      guardianOrbitSpeedScale: 0.74,
      bossMoveSpeedScale: 0.84
    }
  },
  camps: [
    { id: "camp-forest-a", x: 2450, y: 1880, tier: 1, variants: ["melee", "ranged"] },
    { id: "camp-forest-b", x: 4300, y: 1280, tier: 1, variants: ["melee", "swift"] },
    { id: "camp-grove-south", x: 1900, y: 3180, tier: 1, variants: ["melee", "swift"] },
    { id: "camp-north-pine", x: 5200, y: 2320, tier: 1, variants: ["ranged", "melee"] },
    { id: "camp-river-a", x: 5600, y: 4800, tier: 1, variants: ["ranged", "melee"] },
    { id: "camp-river-east", x: 7060, y: 5200, tier: 2, variants: ["swift", "ranged", "melee", "summoner"] },
    { id: "camp-crossroads", x: 7200, y: 8200, tier: 2, variants: ["melee", "ranged"] },
    { id: "camp-west-watch", x: 2200, y: 9600, tier: 2, variants: ["ranged", "brute", "skitter"] },
    { id: "camp-mountain-a", x: 12400, y: 3400, tier: 2, variants: ["brute", "ranged", "tank"] },
    { id: "camp-mountain-ridge", x: 14200, y: 1880, tier: 3, variants: ["tank", "ranged", "summoner"] },
    { id: "camp-ruins-west", x: 12100, y: 8200, tier: 2, variants: ["swift", "melee", "summoner"] },
    { id: "camp-ruins-a", x: 13500, y: 7300, tier: 2, variants: ["swift", "ranged", "skitter"] },
    { id: "camp-lowland-west", x: 8600, y: 10400, tier: 2, variants: ["brute", "melee", "tank"] },
    { id: "camp-south-relic", x: 9600, y: 10600, tier: 2, variants: ["brute", "melee", "summoner"] },
    { id: "camp-danger-a", x: 8200, y: 1600, tier: 3, variants: ["tank", "ranged", "summoner"] },
    { id: "camp-east-scar-north", x: 15100, y: 9000, tier: 3, variants: ["skitter", "ranged", "summoner"] },
    { id: "camp-east-danger", x: 15100, y: 10400, tier: 3, variants: ["skitter", "tank", "ranged", "summoner"] }
  ],
  explorationChests: [
    { id: "chest-grove-cache", x: 1620, y: 1120, tier: 1, kind: "loot" },
    { id: "chest-river-bait", x: 5200, y: 3600, tier: 1, kind: "bait" },
    { id: "chest-mine-cache", x: 11100, y: 3340, tier: 2, kind: "loot" },
    { id: "chest-watch-cache", x: 2850, y: 8280, tier: 2, kind: "loot" },
    { id: "chest-ruins-bait", x: 13250, y: 6650, tier: 2, kind: "bait" },
    { id: "chest-relic-cache", x: 10600, y: 10450, tier: 3, kind: "loot" },
    { id: "chest-danger-bait", x: 14850, y: 9800, tier: 3, kind: "bait" }
  ],
  roamingEncounters: [
    { id: "ambush-river-ford", x: 6100, y: 4550, tier: 1, triggerRadius: 280, count: 4, variants: ["swift", "melee"] },
    { id: "ambush-mountain-pass", x: 11800, y: 2420, tier: 2, triggerRadius: 320, count: 5, variants: ["ranged", "brute"] },
    { id: "ambush-old-road", x: 7200, y: 8600, tier: 2, triggerRadius: 320, count: 5, variants: ["melee", "ranged", "swift"] },
    { id: "ambush-east-lowlands", x: 14500, y: 11200, tier: 3, triggerRadius: 360, count: 6, variants: ["swift", "brute", "ranged"] }
  ],
  randomExplorationChests: [
    { id: "north-forest-roll", count: 5, xMin: 1200, xMax: 5200, yMin: 760, yMax: 2300, minTier: 1, maxTier: 2, baitChance: 0.18 },
    { id: "river-roll", count: 4, xMin: 4400, xMax: 7800, yMin: 3400, yMax: 5600, minTier: 1, maxTier: 2, baitChance: 0.28 },
    { id: "mountain-roll", count: 5, xMin: 10800, xMax: 14500, yMin: 850, yMax: 3700, minTier: 2, maxTier: 3, baitChance: 0.26 },
    { id: "ruins-roll", count: 5, xMin: 12100, xMax: 15800, yMin: 6100, yMax: 9050, minTier: 2, maxTier: 3, baitChance: 0.34 },
    { id: "south-roll", count: 5, xMin: 8200, xMax: 15600, yMin: 9000, yMax: 11650, minTier: 2, maxTier: 3, baitChance: 0.3 }
  ],
  wardSites: [
    { id: "ward-starter-north", x: 2100, y: 900, radius: 90 },
    { id: "ward-river-west", x: 5000, y: 3900, radius: 90 },
    { id: "ward-mid-basin", x: 8000, y: 5200, radius: 90 },
    { id: "ward-mountain-pass", x: 11600, y: 2500, radius: 90 },
    { id: "ward-ruins-entry", x: 13000, y: 6500, radius: 90 },
    { id: "ward-south-relic", x: 10800, y: 9800, radius: 90 },
    { id: "ward-east-lowlands", x: 15000, y: 10800, radius: 90 }
  ]
});

export const HERO_CLASSES = Object.freeze({
  guardianScout: {
    id: "guardianScout",
    label: "Guardian Scout",
    archetype: "Warrior / Ranger hybrid",
    maxHealthBonus: 0,
    speedBonus: 0,
    abilityIds: ["basic", "skillshot", "area"],
    futureRoleNotes:
      "Prototype hero. Future classes can swap stats, ability definitions, build discounts, scouting ranges, and PvP reward modifiers."
  }
});







