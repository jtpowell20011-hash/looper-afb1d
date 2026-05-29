// @ts-check
import { CONFIG } from "./config.js?v=1.8.43";

const BASE_WORLD = { width: 16800, height: 12600 };

const ZONE_TEMPLATES = [
  { label: "Starter Grove", type: "forest", x: 70, y: 130, w: 2300, h: 1500, color: "#2b5a32" },
  { label: "North Forest", type: "forest", x: 2800, y: 520, w: 2500, h: 1680, color: "#2f6839" },
  { label: "High-Resource Danger", type: "danger", x: 7200, y: 500, w: 2300, h: 1550, color: "#7a4a3f" },
  { label: "Mountain Resource Zone", type: "mountain", x: 11200, y: 700, w: 3100, h: 2700, color: "#7b7465" },
  { label: "Western Watchlands", type: "forest", x: 600, y: 7900, w: 3200, h: 2400, color: "#285f3b" },
  { label: "River Flats", type: "river", x: 4500, y: 3800, w: 3100, h: 1700, color: "#356a79" },
  { label: "Central Boss Basin", type: "boss", x: 7600, y: 5600, w: 1700, h: 1700, color: "#55485d" },
  { label: "Hidden Ruins", type: "ruins", x: 12600, y: 6500, w: 2900, h: 2300, color: "#65566f" },
  { label: "Relic Lowlands", type: "relic", x: 9300, y: 9800, w: 3400, h: 1500, color: "#5f5370" },
  { label: "Eastern Scar", type: "danger", x: 14500, y: 9800, w: 1800, h: 1600, color: "#713f44" }
];

export class GameMap {
  constructor({ worldOptions = {} } = {}) {
    this.worldOptions = {
      bosses: true,
      towers: true,
      villages: true,
      ...worldOptions
    };
    this.sizeConfig = CONFIG.mapSizes?.[CONFIG.world.mapSize] || CONFIG.mapSizes?.large || {};
    this.zoneTemplates = ZONE_TEMPLATES.map(scaleZoneTemplate);
    this.zones = this.zoneTemplates.map((zone) => jitterZone(zone));
    this.river = createMainRiver();
    this.riverBranches = createRiverBranches(this.river);
    this.bridges = createBridges(this.river, this.riverBranches);
    this.paths = createPaths(this.zones, this.bridges);
    this.neutralTowers = this.worldOptions.towers ? this.createNeutralTowers() : [];
    this.villages = this.worldOptions.villages ? this.createVillages() : [];
    this.trees = filterDecorations([
      ...createDecorations(this.sizeConfig.treeCount || 180, 101, 220, CONFIG.world.width - 220, 220, CONFIG.world.height - 220),
      ...createPathDecorations(this.paths, Math.round((this.sizeConfig.treeCount || 180) * 0.35), 211, 120, 260)
    ], this);
    this.rocks = filterDecorations([
      ...createDecorations(this.sizeConfig.rockCount || 90, 707, 260, CONFIG.world.width - 260, 260, CONFIG.world.height - 260),
      ...createPathDecorations(this.paths, Math.round((this.sizeConfig.rockCount || 90) * 0.22), 907, 90, 190)
    ], this);
  }

  draw(ctx) {
    ctx.fillStyle = "#496f38";
    ctx.fillRect(0, 0, CONFIG.world.width, CONFIG.world.height);

    drawGrassTexture(ctx);

    for (const zone of this.zones) {
      ctx.fillStyle = zone.color;
      ctx.globalAlpha = zone.type === "mountain" ? 0.42 : 0.28;
      ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(42, 31, 20, 0.18)";
      ctx.lineWidth = 4;
      ctx.strokeRect(zone.x, zone.y, zone.w, zone.h);
      ctx.fillStyle = "rgba(255, 244, 207, 0.32)";
      ctx.font = "800 20px Georgia, serif";
      ctx.fillText(zone.label, zone.x + 18, zone.y + 34);
    }

    drawPaths(ctx, this.paths);

    this.drawRiver(ctx, this.river);
    for (const branch of this.riverBranches) {
      this.drawRiver(ctx, branch);
    }

    for (const bridge of this.bridges) {
      drawCrossing(ctx, bridge.x, bridge.y, bridge.angle || 0);
    }

    for (const village of this.villages) {
      drawVillage(ctx, village);
    }

    for (const tower of this.neutralTowers) {
      drawNeutralTower(ctx, tower);
    }

    for (const rock of this.rocks) {
      drawRock(ctx, rock.x, rock.y, rock.size);
    }
    for (const tree of this.trees) {
      drawTree(ctx, tree.x, tree.y, tree.size);
    }
  }

  offsetConfig(rawConfig) {
    const config = scaleConfig(rawConfig);
    if (Number.isFinite(config.xMin) && Number.isFinite(config.xMax) && Number.isFinite(config.yMin) && Number.isFinite(config.yMax)) {
      const center = this.offsetPoint({ x: (config.xMin + config.xMax) / 2, y: (config.yMin + config.yMax) / 2 });
      const width = config.xMax - config.xMin;
      const height = config.yMax - config.yMin;
      const xMin = clampNumber(center.x - width / 2, 160, CONFIG.world.width - width - 160);
      const yMin = clampNumber(center.y - height / 2, 160, CONFIG.world.height - height - 160);
      return {
        ...config,
        xMin,
        xMax: xMin + width,
        yMin,
        yMax: yMin + height
      };
    }
    const shifted = this.offsetPoint(config);
    return { ...config, x: shifted.x, y: shifted.y };
  }

  offsetConfigs(configs) {
    return configs.map((config) => this.offsetConfig(config));
  }

  createCampConfigs(configs) {
    const shifted = this.offsetConfigs(configs).map((camp) => {
      const zone = this.zoneForPoint(camp) || this.zones.find((entry) => entry.type === "forest");
      const campType = camp.campType || campTypeForZone(zone?.type || "forest", camp.tier || 1);
      return {
        ...camp,
        zoneType: zone?.type || "wild",
        zoneLabel: zone?.label || "Wildlands",
        campType,
        campLabel: CONFIG.campTypes[campType]?.label || "Wild Camp",
        level: campLevelFor(zone?.type || "forest", camp.tier || 1),
        variants: camp.variants || CONFIG.campTypes[campType]?.variants || ["melee"]
      };
    });
    const extraZones = this.zones.filter((zone) => zone.type !== "boss" && zone.type !== "river");
    const density = this.sizeConfig.campDensity || 1;
    const dynamicCampCount = Math.round((CONFIG.mapGeneration?.majorCampBaseCount || 18) * density);
    const extras = [];
    for (let index = 0; index < dynamicCampCount; index += 1) {
      const zone = extraZones[Math.floor(Math.random() * extraZones.length)];
      const tier = zone.type === "danger" || zone.type === "ruins" ? 3 : zone.type === "mountain" || zone.type === "relic" ? 2 : 1;
      const campType = campTypeForZone(zone.type, tier);
      let point = null;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const candidate = {
          x: zone.x + randomRange(zone.w * 0.18, zone.w * 0.82),
          y: zone.y + randomRange(zone.h * 0.18, zone.h * 0.82)
        };
        const tooCloseToBridge = this.bridges.some((bridge) => Math.hypot(candidate.x - bridge.x, candidate.y - bridge.y) < (CONFIG.mapGeneration?.bridgeCampExclusion || 520));
        const tooCloseToCamp = [...shifted, ...extras].some((camp) => Math.hypot(candidate.x - camp.x, candidate.y - camp.y) < (CONFIG.mapGeneration?.majorCampSpacing || 680));
        const inRiver = this.isRiverBlocked(candidate, 180);
        if (!tooCloseToBridge && !tooCloseToCamp && !inRiver) {
          point = candidate;
          break;
        }
      }
      point ||= {
        x: zone.x + randomRange(zone.w * 0.22, zone.w * 0.78),
        y: zone.y + randomRange(zone.h * 0.22, zone.h * 0.78)
      };
      const tierConfig = CONFIG.campTiers[tier] || CONFIG.campTiers[1];
      extras.push({
        id: `camp-dynamic-${index + 1}`,
        x: point.x,
        y: point.y,
        tier,
        zoneType: zone.type,
        zoneLabel: zone.label,
        campType,
        campLabel: CONFIG.campTypes[campType]?.label || "Wild Camp",
        level: campLevelFor(zone.type, tier),
        maxMobs: tierConfig.maxMobs,
        respawn: tierConfig.respawn,
        variants: CONFIG.campTypes[campType]?.variants || (tier >= 3 ? ["tank", "summoner", "ranged", "skitter"] : tier === 2 ? ["brute", "ranged", "swift", "summoner"] : ["melee", "ranged", "skitter", "swift"])
      });
    }
    const minorCamps = this.createMinorCampConfigs([...shifted, ...extras]);
    return [...shifted, ...extras, ...minorCamps];
  }

  createMinorCampConfigs(existingCamps) {
    const count = this.sizeConfig.minorCampCount || 0;
    const camps = [];
    const spacing = CONFIG.mapGeneration?.minorCampSpacing || 520;
    const candidateZones = this.zones.filter((zone) => zone.type !== "boss" && zone.type !== "danger");
    for (let index = 0; index < count; index += 1) {
      let point = null;
      let zone = candidateZones[Math.floor(Math.random() * candidateZones.length)] || this.zones[0];
      for (let attempt = 0; attempt < 45; attempt += 1) {
        zone = candidateZones[Math.floor(Math.random() * candidateZones.length)] || zone;
        const nearPath = this.paths[Math.floor(Math.random() * Math.max(1, this.paths.length))];
        const anchor = nearPath?.length ? pointOnPolyline(nearPath, Math.random()) : null;
        const candidate = anchor
          ? {
              x: anchor.x + randomRange(-520, 520),
              y: anchor.y + randomRange(-520, 520)
            }
          : {
              x: zone.x + randomRange(zone.w * 0.12, zone.w * 0.88),
              y: zone.y + randomRange(zone.h * 0.12, zone.h * 0.88)
            };
        candidate.x = clampNumber(candidate.x, 360, CONFIG.world.width - 360);
        candidate.y = clampNumber(candidate.y, 360, CONFIG.world.height - 360);
        const tooCloseToBridge = this.bridges.some((bridge) => Math.hypot(candidate.x - bridge.x, candidate.y - bridge.y) < 360);
        const tooCloseToCamp = [...existingCamps, ...camps].some((camp) => Math.hypot(candidate.x - camp.x, candidate.y - camp.y) < spacing);
        if (!tooCloseToBridge && !tooCloseToCamp && !this.isRiverBlocked(candidate, 180)) {
          point = candidate;
          break;
        }
      }
      if (!point) {
        continue;
      }
      const campType = Math.random() < 0.55 ? "goblin" : "rogue";
      camps.push({
        id: `camp-minor-${index + 1}`,
        x: point.x,
        y: point.y,
        tier: 1,
        minor: true,
        zoneType: this.zoneForPoint(point)?.type || "wild",
        zoneLabel: this.zoneForPoint(point)?.label || "Wild Road",
        campType,
        campLabel: `Minor ${CONFIG.campTypes[campType]?.label || "Camp"}`,
        level: 1,
        maxMobs: 2,
        respawn: 12,
        variants: campType === "rogue" ? ["swift", "ranged"] : ["melee", "skitter"]
      });
    }
    return camps;
  }

  createNeutralTowers() {
    const sizeId = CONFIG.world.mapSize || "large";
    const rules = CONFIG.neutralTowers?.spawnRules?.[sizeId] || CONFIG.neutralTowers?.spawnRules?.large || { vision: 4, turret: 4, minSpacing: 1600 };
    const towers = [];
    const counts = [
      ...Array.from({ length: rules.vision || 0 }, () => "vision"),
      ...Array.from({ length: rules.turret || 0 }, () => "turret")
    ];
    const towerZones = this.zones.filter((zone) => ["forest", "river", "mountain", "ruins", "relic", "danger"].includes(zone.type));
    counts.forEach((type, index) => {
      const config = CONFIG.neutralTowers.types[type];
      let point = null;
      for (let attempt = 0; attempt < 70; attempt += 1) {
        const zone = towerZones[Math.floor(Math.random() * towerZones.length)] || this.zones[0];
        const nearBridge = Math.random() < 0.34 && this.bridges.length > 0;
        const bridge = this.bridges[Math.floor(Math.random() * this.bridges.length)];
        const candidate = nearBridge
          ? {
              x: bridge.x + randomRange(-900, 900),
              y: bridge.y + randomRange(-900, 900)
            }
          : {
              x: zone.x + randomRange(zone.w * 0.18, zone.w * 0.82),
              y: zone.y + randomRange(zone.h * 0.18, zone.h * 0.82)
            };
        candidate.x = clampNumber(candidate.x, 640, CONFIG.world.width - 640);
        candidate.y = clampNumber(candidate.y, 640, CONFIG.world.height - 640);
        const tooCloseToTower = towers.some((tower) => Math.hypot(tower.x - candidate.x, tower.y - candidate.y) < rules.minSpacing);
        const tooCloseToBridge = this.bridges.some((bridgePoint) => Math.hypot(bridgePoint.x - candidate.x, bridgePoint.y - candidate.y) < 360);
        if (!tooCloseToTower && !tooCloseToBridge && !this.isRiverBlocked(candidate, 220)) {
          point = candidate;
          break;
        }
      }
      if (!point) {
        return;
      }
      const zone = this.zoneForPoint(point);
      const baseLevel = zone?.type === "danger" || zone?.type === "ruins" ? 4 : zone?.type === "mountain" ? 3 : 2;
      towers.push({
        id: `neutral-${type}-${index + 1}`,
        type,
        label: config.label,
        x: point.x,
        y: point.y,
        radius: 34,
        level: baseLevel + (config.levelOffset || 0),
        maxHealth: Math.round(config.health * (1 + baseLevel * 0.18)),
        health: Math.round(config.health * (1 + baseLevel * 0.18)),
        alive: true,
        captured: false,
        ownerId: null,
        progress: 0,
        fireTimer: Math.random(),
        color: config.color,
        config
      });
    });
    return towers;
  }

  createVillages() {
    const sizeId = CONFIG.world.mapSize || "large";
    const rules = CONFIG.villages?.spawnRules?.[sizeId] || CONFIG.villages?.spawnRules?.large || { count: 4, minSpacing: 1900 };
    const villages = [];
    const allowed = CONFIG.villages?.allowedZones || ["forest", "river"];
    const villageZones = this.zones.filter((zone) => allowed.includes(zone.type));
    for (let index = 0; index < rules.count; index += 1) {
      let point = null;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const path = this.paths[Math.floor(Math.random() * Math.max(1, this.paths.length))];
        const anchor = path?.length ? pointOnPolyline(path, Math.random()) : null;
        const zone = villageZones[Math.floor(Math.random() * villageZones.length)] || this.zones[0];
        const candidate = anchor
          ? {
              x: anchor.x + randomRange(-420, 420),
              y: anchor.y + randomRange(-420, 420)
            }
          : {
              x: zone.x + randomRange(zone.w * 0.2, zone.w * 0.8),
              y: zone.y + randomRange(zone.h * 0.2, zone.h * 0.8)
            };
        candidate.x = clampNumber(candidate.x, 520, CONFIG.world.width - 520);
        candidate.y = clampNumber(candidate.y, 520, CONFIG.world.height - 520);
        const tooClose = villages.some((village) => Math.hypot(village.x - candidate.x, village.y - candidate.y) < rules.minSpacing);
        const tooCloseToBridge = this.bridges.some((bridge) => Math.hypot(bridge.x - candidate.x, bridge.y - candidate.y) < 460);
        if (!tooClose && !tooCloseToBridge && !this.isRiverBlocked(candidate, 240)) {
          point = candidate;
          break;
        }
      }
      if (!point) {
        continue;
      }
      villages.push({
        id: `village-${index + 1}`,
        label: Math.random() < 0.35 ? "Abandoned Village" : "Roadside Village",
        x: point.x,
        y: point.y,
        radius: 150,
        looted: false,
        ambush: Math.random() < (CONFIG.villages?.ambushChance || 0.25),
        color: "#d8b46b"
      });
    }
    return villages;
  }

  zoneForPoint(point) {
    return this.zones.find((zone) => point.x >= zone.x && point.x <= zone.x + zone.w && point.y >= zone.y && point.y <= zone.y + zone.h) || null;
  }

  createObjectiveConfig(config) {
    const zone = this.objectiveZone(config);
    if (!zone) {
      return this.offsetConfig(config);
    }
    const anchors = {
      "shrine-north": { x: 0.48, y: 0.5 },
      "mine-east": { x: 0.48, y: 0.52 },
      "watchtower-west": { x: 0.5, y: 0.5 },
      "relic-south": { x: 0.5, y: 0.48 },
      "storm-spire": { x: 0.52, y: 0.58 },
      "ember-forge": { x: 0.55, y: 0.44 },
      "beast-den": { x: 0.48, y: 0.54 },
      "boss-center": { x: 0.5, y: 0.5 }
    };
    const anchor = anchors[config.id] || { x: 0.5, y: 0.5 };
    const x = zone.x + zone.w * anchor.x + randomRange(-zone.w * 0.12, zone.w * 0.12);
    const y = zone.y + zone.h * anchor.y + randomRange(-zone.h * 0.12, zone.h * 0.12);
    return {
      ...config,
      x: clampNumber(x, zone.x + 140, zone.x + zone.w - 140),
      y: clampNumber(y, zone.y + 140, zone.y + zone.h - 140),
      guardianBounds: { x: zone.x + 80, y: zone.y + 80, w: zone.w - 160, h: zone.h - 160 }
    };
  }

  objectiveZone(config) {
    const labelByObjective = {
      "shrine-north": "North Forest",
      "watchtower-west": "Western Watchlands",
      "storm-spire": "Starter Grove",
      "ember-forge": "High-Resource Danger",
      "beast-den": "Eastern Scar"
    };
    const desiredLabel = labelByObjective[config.id];
    if (desiredLabel) {
      const byLabel = this.zones.find((zone) => zone.label === desiredLabel);
      if (byLabel) {
        return byLabel;
      }
    }
    const typeByObjective = {
      "shrine-north": "forest",
      "mine-east": "mountain",
      "watchtower-west": "forest",
      "relic-south": "relic",
      "storm-spire": "forest",
      "ember-forge": "danger",
      "beast-den": "danger",
      "boss-center": "boss"
    };
    const desiredType = typeByObjective[config.id] || config.type;
    const candidates = this.zones.filter((zone) => zone.type === desiredType);
    return candidates[Math.floor(Math.random() * candidates.length)] || this.zones.find((zone) => zone.type === desiredType) || null;
  }

  offsetPoint(point) {
    let bestTemplate = this.zoneTemplates[0];
    let bestZone = this.zones[0];
    let bestDistance = Infinity;
    for (let index = 0; index < this.zoneTemplates.length; index += 1) {
      const template = this.zoneTemplates[index];
      const cx = template.x + template.w / 2;
      const cy = template.y + template.h / 2;
      const distanceSq = (point.x - cx) ** 2 + (point.y - cy) ** 2;
      if (distanceSq < bestDistance) {
        bestDistance = distanceSq;
        bestTemplate = template;
        bestZone = this.zones[index];
      }
    }
    return {
      x: clampNumber(point.x + (bestZone.x - bestTemplate.x), 220, CONFIG.world.width - 220),
      y: clampNumber(point.y + (bestZone.y - bestTemplate.y), 220, CONFIG.world.height - 220)
    };
  }

  riverYAt(x) {
    for (let index = 0; index < this.river.length - 1; index += 1) {
      const a = this.river[index];
      const b = this.river[index + 1];
      if (x >= a.x && x <= b.x) {
        const ratio = (x - a.x) / Math.max(1, b.x - a.x);
        return a.y + (b.y - a.y) * ratio;
      }
    }
    return this.river[this.river.length - 1].y;
  }

  isOnBridge(point) {
    return this.bridges.some((bridge) => Math.hypot(point.x - bridge.x, point.y - bridge.y) <= bridge.radius);
  }

  isRiverBlocked(point, radius = 0) {
    if (this.isOnBridge(point)) {
      return false;
    }
    return this.riverDistance(point) < 58 + radius;
  }

  resolveRiverCollision(entity) {
    if (!this.isRiverBlocked(entity, entity.radius || 0)) {
      return false;
    }
    const nearest = this.nearestRiverPoint(entity);
    const dx = entity.x - nearest.x;
    const dy = entity.y - nearest.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const push = 64 + (entity.radius || 0) - Math.min(58, nearest.distance);
    entity.x += (dx / length) * push;
    entity.y += (dy / length) * push;
    entity.vx = 0;
    entity.vy = 0;
    return true;
  }

  drawRiver(ctx, river) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#2e5664";
    ctx.lineWidth = 116;
    drawPolyline(ctx, river);
    ctx.strokeStyle = "#5fabc1";
    ctx.lineWidth = 76;
    drawPolyline(ctx, river);
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 9;
    drawPolyline(ctx, river);
    ctx.restore();
  }

  riverDistance(point) {
    return this.nearestRiverPoint(point).distance;
  }

  nearestRiverPoint(point) {
    const rivers = [this.river, ...(this.riverBranches || [])];
    let best = { x: this.river[0].x, y: this.river[0].y, distance: Infinity };
    for (const river of rivers) {
      for (let index = 0; index < river.length - 1; index += 1) {
        const current = closestPointOnSegment(point, river[index], river[index + 1]);
        if (current.distance < best.distance) {
          best = current;
        }
      }
    }
    return best;
  }
}

function scaleX(value) {
  return (value / BASE_WORLD.width) * CONFIG.world.width;
}

function scaleY(value) {
  return (value / BASE_WORLD.height) * CONFIG.world.height;
}

function scalePoint(point) {
  return {
    x: scaleX(point.x),
    y: scaleY(point.y)
  };
}

function scaleZoneTemplate(zone) {
  return {
    ...zone,
    x: scaleX(zone.x),
    y: scaleY(zone.y),
    w: scaleX(zone.w),
    h: scaleY(zone.h)
  };
}

function scaleConfig(config) {
  const next = { ...config };
  if (Number.isFinite(next.x)) next.x = scaleX(next.x);
  if (Number.isFinite(next.y)) next.y = scaleY(next.y);
  if (Number.isFinite(next.xMin)) next.xMin = scaleX(next.xMin);
  if (Number.isFinite(next.xMax)) next.xMax = scaleX(next.xMax);
  if (Number.isFinite(next.yMin)) next.yMin = scaleY(next.yMin);
  if (Number.isFinite(next.yMax)) next.yMax = scaleY(next.yMax);
  return next;
}

function createMainRiver() {
  const width = CONFIG.world.width;
  const height = CONFIG.world.height;
  const baseY = height * randomRange(0.28, 0.54);
  const slope = height * randomRange(-0.12, 0.12);
  const points = [0, 0.14, 0.3, 0.46, 0.62, 0.79, 1].map((ratio, index) => {
    const y =
      baseY +
      slope * (ratio - 0.5) +
      Math.sin(ratio * Math.PI * 2 + randomRange(-0.7, 0.7)) * height * 0.035 +
      randomRange(-height * 0.035, height * 0.035);
    return {
      x: ratio * width,
      y: clampNumber(y, height * 0.18, height * 0.76)
    };
  });
  points[0].x = 0;
  points[points.length - 1].x = width;
  return points;
}

function createRiverBranches(mainRiver) {
  const width = CONFIG.world.width;
  const height = CONFIG.world.height;
  const count = Math.random() < 0.42 ? 1 : Math.random() < 0.72 ? 2 : 3;
  const usedStarts = [];
  const branches = [];
  for (let index = 0; index < count; index += 1) {
    let startX = width * randomRange(0.18, 0.84);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (usedStarts.every((x) => Math.abs(x - startX) > width * 0.12)) {
        break;
      }
      startX = width * randomRange(0.18, 0.84);
    }
    usedStarts.push(startX);
    const start = { x: startX, y: riverYAt(mainRiver, startX) };
    const exitsBottom = Math.random() < 0.55;
    const exit = {
      x: clampNumber(startX + width * randomRange(-0.22, 0.22), 0, width),
      y: exitsBottom ? height : 0
    };
    const mid = {
      x: clampNumber((start.x + exit.x) / 2 + width * randomRange(-0.08, 0.08), 0, width),
      y: clampNumber((start.y + exit.y) / 2 + height * randomRange(-0.08, 0.08), height * 0.08, height * 0.92)
    };
    branches.push([start, mid, exit]);
  }
  return branches;
}

function createBridges(mainRiver, branches) {
  const width = CONFIG.world.width;
  const mainFractions = [0.16, 0.34, 0.52, 0.7, 0.88]
    .sort(() => Math.random() - 0.5)
    .slice(0, 4)
    .sort((a, b) => a - b);
  const bridges = mainFractions.map((ratio) => {
    const x = clampNumber(width * (ratio + randomRange(-0.035, 0.035)), 360, width - 360);
    return {
      x,
      y: riverYAt(mainRiver, x),
      radius: 320,
      angle: randomRange(-0.28, 0.28)
    };
  });
  for (const branch of branches) {
    const bridgeCount = Math.random() < 0.65 ? 1 : 2;
    for (let index = 0; index < bridgeCount; index += 1) {
      const point = pointOnPolyline(branch, bridgeCount === 1 ? randomRange(0.38, 0.66) : index === 0 ? randomRange(0.26, 0.42) : randomRange(0.58, 0.76));
      bridges.push({
        x: point.x,
        y: point.y,
        radius: 320,
        angle: Math.PI / 2 + randomRange(-0.35, 0.35)
      });
    }
  }
  return bridges;
}

function createPaths(zones = [], bridges = []) {
  const main = [
    { x: 900, y: 900 },
    { x: 3300, y: 1800 },
    { x: 5600, y: 4700 },
    { x: 8400, y: 6300 },
    { x: 11800, y: 10100 }
  ].map(scalePoint);
  const flank = [
    { x: 2300, y: 8800 },
    { x: 5200, y: 7100 },
    { x: 8400, y: 6300 },
    { x: 12400, y: 2700 }
  ].map(scalePoint);
  const bridgeRoad = bridges
    .slice()
    .sort((a, b) => a.x - b.x)
    .map((bridge) => ({ x: bridge.x, y: bridge.y }));
  const zoneSpine = zones
    .filter((zone) => ["forest", "mountain", "ruins", "relic", "danger"].includes(zone.type))
    .slice(0, 6)
    .map((zone) => ({ x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 }));
  return [main, flank, bridgeRoad, zoneSpine].filter((path) => path.length >= 2);
}

function riverYAt(river, x) {
  for (let index = 0; index < river.length - 1; index += 1) {
    const a = river[index];
    const b = river[index + 1];
    if (x >= a.x && x <= b.x) {
      const ratio = (x - a.x) / Math.max(1, b.x - a.x);
      return a.y + (b.y - a.y) * ratio;
    }
  }
  return river[river.length - 1].y;
}

function pointOnPolyline(polyline, ratio) {
  const segments = [];
  let total = 0;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const a = polyline[index];
    const b = polyline[index + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    segments.push({ a, b, length });
    total += length;
  }
  let target = total * ratio;
  for (const segment of segments) {
    if (target <= segment.length) {
      const t = target / Math.max(1, segment.length);
      return {
        x: segment.a.x + (segment.b.x - segment.a.x) * t,
        y: segment.a.y + (segment.b.y - segment.a.y) * t
      };
    }
    target -= segment.length;
  }
  return polyline[polyline.length - 1];
}

function jitterZone(zone) {
  const maxJitter = zone.type === "boss" ? scaleX(380) : scaleX(620);
  const x = clampNumber(zone.x + randomRange(-maxJitter, maxJitter), 40, CONFIG.world.width - zone.w - 40);
  const y = clampNumber(zone.y + randomRange(-maxJitter, maxJitter), 80, CONFIG.world.height - zone.h - 80);
  return { ...zone, x, y };
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function drawGrassTexture(ctx) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,244,207,0.035)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= CONFIG.world.width; x += 240) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CONFIG.world.height);
    ctx.stroke();
  }
  for (let y = 0; y <= CONFIG.world.height; y += 240) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CONFIG.world.width, y);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(31, 57, 27, 0.12)";
  for (let x = 120; x < CONFIG.world.width; x += 360) {
    for (let y = 90; y < CONFIG.world.height; y += 320) {
      ctx.fillRect(x + ((x * 17 + y) % 90), y + ((y * 13 + x) % 70), 30, 8);
    }
  }
  ctx.restore();
}

function drawPaths(ctx, paths) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const path of paths) {
    ctx.strokeStyle = "#7b684e";
    ctx.lineWidth = 70;
    drawPolyline(ctx, path);
    ctx.strokeStyle = "#9a815d";
    ctx.lineWidth = 48;
    drawPolyline(ctx, path);
  }
  ctx.restore();
}

function drawPolyline(ctx, points) {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.stroke();
}

function drawCrossing(ctx, x, y, angle = -0.12) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "#9d7b4d";
  ctx.fillRect(-156, -38, 312, 76);
  ctx.fillStyle = "#6b4a2f";
  for (let xOffset = -132; xOffset <= 132; xOffset += 44) {
    ctx.fillRect(xOffset - 5, -44, 10, 88);
  }
  ctx.strokeStyle = "rgba(0,0,0,0.34)";
  ctx.lineWidth = 6;
  ctx.strokeRect(-156, -38, 312, 76);
  ctx.fillStyle = "#fff8e8";
  ctx.font = "900 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("BRIDGE", 0, 5);
  ctx.restore();
}

function closestPointOnSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  const x = a.x + dx * t;
  const y = a.y + dy * t;
  return {
    x,
    y,
    distance: Math.hypot(point.x - x, point.y - y)
  };
}

function campTypeForZone(zoneType, tier = 1) {
  if (tier >= 3 && (zoneType === "danger" || zoneType === "boss")) return "wraith";
  if (zoneType === "mountain") return tier >= 3 ? "brute" : "skeleton";
  if (zoneType === "ruins") return tier >= 3 ? "wraith" : "cultist";
  if (zoneType === "danger") return tier >= 3 ? "wraith" : "brute";
  if (zoneType === "relic") return "rogue";
  if (zoneType === "river") return "rogue";
  return "goblin";
}

function campLevelFor(zoneType, tier = 1) {
  const tierValue = tier === "elite" ? 4 : Number(tier || 1);
  const zoneBonus = zoneType === "danger" || zoneType === "boss" ? 3 : zoneType === "ruins" || zoneType === "mountain" ? 2 : zoneType === "relic" ? 1 : 0;
  return Math.max(1, tierValue * 2 - 1 + zoneBonus);
}

function drawTree(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  const s = size / 44;
  ctx.fillStyle = "rgba(25,35,19,0.22)";
  ctx.fillRect(-14 * s, 14 * s, 28 * s, 7 * s);
  ctx.fillStyle = "#5b3921";
  ctx.fillRect(-4 * s, -2 * s, 8 * s, 22 * s);
  ctx.fillStyle = "#2f5b2e";
  ctx.fillRect(-18 * s, -26 * s, 36 * s, 18 * s);
  ctx.fillRect(-24 * s, -12 * s, 48 * s, 20 * s);
  ctx.fillStyle = "#4f8d3f";
  ctx.fillRect(-10 * s, -36 * s, 20 * s, 12 * s);
  ctx.fillRect(-18 * s, -22 * s, 36 * s, 10 * s);
  ctx.restore();
}

function drawRock(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  const s = size / 34;
  ctx.fillStyle = "#7f7a69";
  ctx.fillRect(-14 * s, -8 * s, 28 * s, 18 * s);
  ctx.fillStyle = "#a29a85";
  ctx.fillRect(-6 * s, -14 * s, 18 * s, 8 * s);
  ctx.fillStyle = "#5f5a50";
  ctx.fillRect(-14 * s, 4 * s, 10 * s, 8 * s);
  ctx.fillRect(6 * s, 0, 10 * s, 9 * s);
  ctx.restore();
}

function drawNeutralTower(ctx, tower) {
  ctx.save();
  ctx.translate(tower.x, tower.y);
  ctx.fillStyle = tower.type === "vision" ? "#2e5664" : "#6b4a2f";
  ctx.fillRect(-18, -40, 36, 70);
  ctx.fillStyle = tower.color || "#e7bd58";
  ctx.fillRect(-26, -48, 52, 16);
  ctx.fillRect(-10, -62, 20, 14);
  ctx.strokeStyle = "rgba(255,248,232,0.62)";
  ctx.lineWidth = 3;
  ctx.strokeRect(-18, -40, 36, 70);
  ctx.fillStyle = "#101711";
  ctx.font = "900 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(tower.type === "vision" ? "EYE" : "TUR", 0, -37);
  ctx.restore();
}

function drawVillage(ctx, village) {
  ctx.save();
  ctx.translate(village.x, village.y);
  ctx.fillStyle = "rgba(107,74,47,0.22)";
  ctx.beginPath();
  ctx.ellipse(0, 0, village.radius * 0.95, village.radius * 0.58, 0.2, 0, Math.PI * 2);
  ctx.fill();
  const props = CONFIG.villages?.propDensity || 7;
  for (let index = 0; index < props; index += 1) {
    const angle = (Math.PI * 2 * index) / props;
    const px = Math.cos(angle) * (48 + (index % 3) * 18);
    const py = Math.sin(angle) * (34 + (index % 2) * 22);
    ctx.fillStyle = index % 3 === 0 ? "#b56b43" : "#d8b46b";
    ctx.fillRect(px - 18, py - 12, 36, 24);
    ctx.fillStyle = "#6b4a2f";
    ctx.fillRect(px - 22, py - 18, 44, 9);
  }
  ctx.fillStyle = village.ambush ? "#7a4a3f" : "#63d46b";
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function createDecorations(count, seed, minX, maxX, minY, maxY) {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    x: minX + next() * (maxX - minX),
    y: minY + next() * (maxY - minY),
    size: 28 + next() * 34
  }));
}

function filterDecorations(decorations, map) {
  const riverPadding = CONFIG.mapGeneration?.propRiverExclusion || 180;
  const pathPadding = CONFIG.mapGeneration?.propPathExclusion || 92;
  return decorations.filter((decoration) => {
    if (map.isRiverBlocked?.(decoration, riverPadding)) {
      return false;
    }
    if ((map.bridges || []).some((bridge) => Math.hypot(decoration.x - bridge.x, decoration.y - bridge.y) < bridge.radius + 160)) {
      return false;
    }
    if (distanceToPathNetwork(decoration, map.paths || []) < pathPadding) {
      return false;
    }
    if ((map.neutralTowers || []).some((tower) => Math.hypot(decoration.x - tower.x, decoration.y - tower.y) < tower.radius + 180)) {
      return false;
    }
    if ((map.villages || []).some((village) => Math.hypot(decoration.x - village.x, decoration.y - village.y) < village.radius + 130)) {
      return false;
    }
    const zone = map.zoneForPoint?.(decoration);
    if (zone?.type === "boss" && pointInsideZone(decoration, zone, 180)) {
      return false;
    }
    return true;
  });
}

function distanceToPathNetwork(point, paths) {
  let best = Infinity;
  for (const path of paths || []) {
    for (let index = 0; index < path.length - 1; index += 1) {
      best = Math.min(best, closestPointOnSegment(point, path[index], path[index + 1]).distance);
    }
  }
  return best;
}

function pointInsideZone(point, zone, padding = 0) {
  return point.x >= zone.x - padding && point.x <= zone.x + zone.w + padding && point.y >= zone.y - padding && point.y <= zone.y + zone.h + padding;
}

function createPathDecorations(paths, count, seed, minOffset, maxOffset) {
  if (!paths?.length || count <= 0) {
    return [];
  }
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const decorations = [];
  for (let index = 0; index < count; index += 1) {
    const path = paths[Math.floor(next() * paths.length)];
    const anchor = pointOnPolyline(path, next());
    const angle = next() * Math.PI * 2;
    const offset = minOffset + next() * Math.max(1, maxOffset - minOffset);
    const x = clampNumber(anchor.x + Math.cos(angle) * offset, 260, CONFIG.world.width - 260);
    const y = clampNumber(anchor.y + Math.sin(angle) * offset, 260, CONFIG.world.height - 260);
    decorations.push({
      x,
      y,
      size: 26 + next() * 30
    });
  }
  return decorations;
}










