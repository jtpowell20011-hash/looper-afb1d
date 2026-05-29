// @ts-check
import { CONFIG } from "./config.js?v=1.8.50";

const SCALE = 1 / 80;
const TILE_WORLD_SIZE = 120;
const CHUNK_TILES = 16;
const CHUNK_WORLD_SIZE = TILE_WORLD_SIZE * CHUNK_TILES;
const CHUNK_RENDER_RADIUS = 5;
const MAX_INSTANCES = 2000;
const FAR_LOD_DISTANCE = 34;

const PALETTE = Object.freeze({
  grass: 0x4a8a3a,
  darkGrass: 0x2d6a25,
  water: 0x1e6090,
  path: 0x9a7a38,
  sand: 0xc8a84a,
  stone: 0x6a6a6a,
  wall: 0x3a2e1a,
  floor: 0x7a6040,
  bridge: 0x9a7030,
  wood: 0x5a3a1a,
  roof: 0x8a4329,
  gold: 0xf0c85d,
  hp: 0xdd3333,
  hpBack: 0x240b08,
  shield: 0x72d8e8,
  black: 0x17100d
});

const CLASS_PALETTE = Object.freeze({
  ranger: { torso: 0x2f7d3a, legs: 0x264f2f, weapon: 0x8b5a1a },
  guardian: { torso: 0x8da4b8, legs: 0x304c7a, weapon: 0xb9c9da },
  engineer: { torso: 0x8b5a2a, legs: 0x4b3521, weapon: 0xc49b3c },
  shadowblade: { torso: 0x3d244f, legs: 0x171022, weapon: 0xb997f4 },
  arcanist: { torso: 0x1f3d78, legs: 0x14244a, weapon: 0x72d8e8 },
  berserker: { torso: 0x9d332a, legs: 0x5a241d, weapon: 0xd4a23a },
  druid: { torso: 0x2d6a25, legs: 0x224b1f, weapon: 0x6b4a2f },
  sentinel: { torso: 0x167d7d, legs: 0x194f5c, weapon: 0xb8d8c8 },
  warlock: { torso: 0x171022, legs: 0x271833, weapon: 0x8e44ad }
});

// Mob faction look, keyed by camp type. Drives palette + head/body treatment.
const MOB_THEMES = Object.freeze({
  goblin:   { skin: 0x6f9a3e, cloth: 0x4a5a2a, accent: 0x35471f, weapon: 0xb8a06a },
  rogue:    { skin: 0xb89070, cloth: 0x2f2a22, accent: 0x6a4a2a, weapon: 0xcfd4dd, hooded: true },
  skeleton: { skin: 0xe6e0cf, cloth: 0x4a4640, accent: 0x26221c, weapon: 0xc9cdd4, bone: true },
  cultist:  { skin: 0xa07f92, cloth: 0x3a2030, accent: 0x8a2f5a, weapon: 0xc06bd0, hooded: true, robe: true, glow: 0xc06bd0 },
  brute:    { skin: 0x8a6a4a, cloth: 0x5a4632, accent: 0x3a2c1e, weapon: 0x9aa0a8, fur: true },
  wraith:   { skin: 0x9fd6e0, cloth: 0x3a5a6a, accent: 0x6fd0e0, weapon: 0x9fe0ec, ghost: true, glow: 0x7fe0f0 }
});

// Mob silhouette, keyed by archetype. Overall scale (hero base is ~1.8 tall) + body bulk.
const MOB_SHAPE = Object.freeze({
  melee:    { scale: 0.80, bulk: 1.00 },
  ranged:   { scale: 0.76, bulk: 0.92 },
  brute:    { scale: 0.95, bulk: 1.40 },
  tank:     { scale: 1.05, bulk: 1.65 },
  swift:    { scale: 0.74, bulk: 0.92 },
  skitter:  { scale: 0.52, bulk: 0.85 },
  summoner: { scale: 0.82, bulk: 1.00 },
  boss:     { scale: 1.35, bulk: 1.40 }
});

export class LowPolyRenderer {
  static isAvailable() {
    return Boolean(globalThis.THREE && document.getElementById("threeCanvas"));
  }

  constructor(canvas) {
    this.THREE = globalThis.THREE;
    this.canvas = canvas;
    this.enabled = Boolean(this.THREE && this.canvas);
    this.ready = false;
    this.frame = 0;
    this.materials = new Map();
    this.dynamicViews = new Map();
    this.helperViews = new Map();
    this.chunks = new Map();
    this.staticGroups = [];
    this.spatialHash = new SpatialHash(8);
    if (!this.enabled) {
      return;
    }

    this.renderer = new this.THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(1);
    this.renderer.sortObjects = false;
    this.renderer.info.autoReset = false;
    this.renderer.setClearColor(0x87b7c8);
    this.raycaster = new this.THREE.Raycaster();
    this.pickPlane = new this.THREE.Plane(new this.THREE.Vector3(0, 1, 0), 0);
    this.pickNdc = new this.THREE.Vector2();
    this.pickHit = new this.THREE.Vector3();
    this.projectPoint = new this.THREE.Vector3();
    this.projectilePool = this.createMeshPool(300, new this.THREE.BoxGeometry(0.08, 0.08, 0.72), this.mat(0xf4d36a));
    this.particlePool = this.createMeshPool(600, new this.THREE.BoxGeometry(0.12, 0.12, 0.12), this.mat(0xf0c85d));
    this.textPool = [];
  }

  reset(game, options = {}) {
    if (!this.enabled) {
      return;
    }
    const previousCamera = options.preserveCamera && this.camera
      ? {
          position: this.camera.position.clone(),
          quaternion: this.camera.quaternion.clone(),
          aspect: this.camera.aspect
        }
      : null;
    this.disposeScene();
    this.scene = new this.THREE.Scene();
    this.scene.fog = new this.THREE.Fog(0x87b7c8, 62, 104);
    this.camera = new this.THREE.PerspectiveCamera(40, 1, 0.1, 900);
    this.camera.rotation.order = "YXZ";
    if (previousCamera) {
      this.camera.position.copy(previousCamera.position);
      this.camera.quaternion.copy(previousCamera.quaternion);
      this.camera.aspect = previousCamera.aspect || this.camera.aspect;
      this.camera.updateProjectionMatrix();
    }

    const ambient = new this.THREE.AmbientLight(0xffe8c8, 0.82);
    const sun = new this.THREE.DirectionalLight(0xfff4cc, 0.66);
    sun.position.set(18, 30, 12);
    this.scene.add(ambient, sun);

    this.projectilePool.group = new this.THREE.Group();
    this.particlePool.group = new this.THREE.Group();
    for (const mesh of this.projectilePool.items) this.projectilePool.group.add(mesh);
    for (const mesh of this.particlePool.items) this.particlePool.group.add(mesh);
    this.scene.add(this.projectilePool.group, this.particlePool.group);

    this.buildStaticInstances(game);
    this.buildStaticPointsOfInterest(game);
    this.updateChunks(game, true);
    this.ready = true;
    this.canvas.hidden = false;
  }

  dispose() {
    this.disposeScene();
    if (this.renderer) {
      this.renderer.dispose();
    }
    if (this.canvas) {
      this.canvas.hidden = true;
    }
    this.ready = false;
  }

  disposeScene() {
    if (!this.scene) {
      return;
    }
    for (const [, chunk] of this.chunks) {
      chunk.geometry?.dispose?.();
      chunk.material?.dispose?.();
      this.scene.remove(chunk);
    }
    this.chunks.clear();
    this.dynamicViews.clear();
    for (const [, helper] of this.helperViews) {
      this.scene.remove(helper);
      disposeObject(helper);
    }
    this.helperViews.clear();
    this.staticGroups = [];
    this.scene.traverse((object) => {
      if (object.geometry && !object.userData?.pooled) object.geometry.dispose?.();
      if (object.material && !object.material?.userData?.sharedMaterial) {
        if (Array.isArray(object.material)) {
          for (const material of object.material) material.dispose?.();
        } else {
          object.material.dispose?.();
        }
      }
    });
    this.scene.clear();
  }

  resize(width, height) {
    if (!this.enabled || !this.renderer || !this.camera) {
      return;
    }
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.renderer.setSize(w, h, false);
    }
    const nextAspect = w / h;
    if (Math.abs((this.camera.aspect || 1) - nextAspect) > 0.0001) {
      this.camera.aspect = nextAspect;
      this.camera.updateProjectionMatrix();
    }
  }

  render(game) {
    if (!this.enabled) {
      return false;
    }
    if (!this.ready) {
      this.reset(game);
    }
    this.resize(game.viewWidth, game.viewHeight);
    this.frame += 1;
    this.updateCamera(game);
    this.updateFrustum();
    this.updateChunks(game, false);
    this.spatialHash.clear();
    this.syncDynamicEntities(game);
    this.syncProjectiles(game);
    this.syncHelperViews(game);
    this.animateViews(game);
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    return true;
  }

  mat(color, options = {}) {
    const key = `${color}-${options.vertexColors ? "v" : "m"}-${options.basic ? "b" : "l"}-${options.transparent ? "t" : "o"}`;
    if (this.materials.has(key)) {
      return this.materials.get(key);
    }
    const material = options.basic
      ? new this.THREE.MeshBasicMaterial({
          color,
          vertexColors: Boolean(options.vertexColors),
          transparent: Boolean(options.transparent),
          opacity: options.opacity ?? 1,
          depthWrite: options.depthWrite ?? true
        })
      : new this.THREE.MeshLambertMaterial({
          color,
          vertexColors: Boolean(options.vertexColors),
          flatShading: true,
          transparent: Boolean(options.transparent),
          opacity: options.opacity ?? 1,
          depthWrite: options.depthWrite ?? true
        });
    material.userData.sharedMaterial = true;
    this.materials.set(key, material);
    return material;
  }

  worldTo3(x, y, height = 0) {
    return new this.THREE.Vector3((x - CONFIG.world.width / 2) * SCALE, height, (y - CONFIG.world.height / 2) * SCALE);
  }

  screenToWorld(point, width, height) {
    if (!this.enabled || !this.camera || !this.raycaster || !width || !height) {
      return null;
    }
    this.pickNdc.set((point.x / width) * 2 - 1, -(point.y / height) * 2 + 1);
    this.raycaster.setFromCamera(this.pickNdc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.pickPlane, this.pickHit);
    if (!hit) {
      return null;
    }
    return {
      x: clampWorld(hit.x / SCALE + CONFIG.world.width / 2, CONFIG.world.width),
      y: clampWorld(hit.z / SCALE + CONFIG.world.height / 2, CONFIG.world.height)
    };
  }

  worldToScreen(x, y, height = 0, width = this.canvas?.clientWidth || 1, screenHeight = this.canvas?.clientHeight || 1) {
    if (!this.enabled || !this.camera || !width || !screenHeight) {
      return null;
    }
    this.projectPoint.copy(this.worldTo3(x, y, height));
    this.projectPoint.project(this.camera);
    return {
      x: (this.projectPoint.x * 0.5 + 0.5) * width,
      y: (-this.projectPoint.y * 0.5 + 0.5) * screenHeight
    };
  }

  setObjectPosition(object, x, y, height = 0) {
    object.position.copy(this.worldTo3(x, y, height));
  }

  updateCamera(game) {
    const focus = game.cameraLocked ? game.player : game.cameraLookTarget || game.player;
    const target = this.worldTo3(focus.x, focus.y, 0);
    const cameraTarget = new this.THREE.Vector3(target.x, 26, target.z + 21);
    if (!this.camera.position.lengthSq()) {
      this.camera.position.copy(cameraTarget);
    } else {
      this.camera.position.lerp(cameraTarget, 0.13);
    }
    this.camera.lookAt(target.x, 0, target.z);
  }

  updateFrustum() {
    const matrix = new this.THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum = new this.THREE.Frustum().setFromProjectionMatrix(matrix);
  }

  updateChunks(game, force) {
    const centerX = (game.camera.x + game.viewWidth / 2);
    const centerY = (game.camera.y + game.viewHeight / 2);
    const ccx = Math.floor(centerX / CHUNK_WORLD_SIZE);
    const ccz = Math.floor(centerY / CHUNK_WORLD_SIZE);
    const needed = new Set();

    for (let dz = -CHUNK_RENDER_RADIUS; dz <= CHUNK_RENDER_RADIUS; dz += 1) {
      for (let dx = -CHUNK_RENDER_RADIUS; dx <= CHUNK_RENDER_RADIUS; dx += 1) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        if (cx < 0 || cz < 0 || cx * CHUNK_WORLD_SIZE > CONFIG.world.width || cz * CHUNK_WORLD_SIZE > CONFIG.world.height) {
          continue;
        }
        const key = `${cx}_${cz}`;
        needed.add(key);
        if (!this.chunks.has(key) || force) {
          const old = this.chunks.get(key);
          if (old) {
            old.geometry.dispose();
            this.scene.remove(old);
          }
          const chunk = this.createTerrainChunk(game.map, cx, cz);
          this.chunks.set(key, chunk);
          this.scene.add(chunk);
        }
      }
    }

    for (const [key, chunk] of [...this.chunks]) {
      if (!needed.has(key)) {
        chunk.geometry.dispose();
        this.scene.remove(chunk);
        this.chunks.delete(key);
      }
    }
  }

  createTerrainChunk(map, cx, cz) {
    const positions = [];
    const normals = [];
    const colors = [];
    const color = new this.THREE.Color();
    const startX = cx * CHUNK_WORLD_SIZE;
    const startY = cz * CHUNK_WORLD_SIZE;
    for (let z = 0; z < CHUNK_TILES; z += 1) {
      for (let x = 0; x < CHUNK_TILES; x += 1) {
        const wx = startX + x * TILE_WORLD_SIZE;
        const wy = startY + z * TILE_WORLD_SIZE;
        const tile = this.sampleTile(map, wx + TILE_WORLD_SIZE / 2, wy + TILE_WORLD_SIZE / 2);
        color.setHex(tile.color);
        const x0 = (wx - CONFIG.world.width / 2) * SCALE;
        const x1 = (wx + TILE_WORLD_SIZE - CONFIG.world.width / 2) * SCALE;
        const z0 = (wy - CONFIG.world.height / 2) * SCALE;
        const z1 = (wy + TILE_WORLD_SIZE - CONFIG.world.height / 2) * SCALE;
        const y = tile.height;
        pushQuad(positions, normals, colors, color, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]);
      }
    }
    const geometry = new this.THREE.BufferGeometry();
    geometry.setAttribute("position", new this.THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new this.THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("color", new this.THREE.Float32BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    const mesh = new this.THREE.Mesh(geometry, this.mat(0xffffff, { vertexColors: true }));
    mesh.frustumCulled = true;
    return mesh;
  }

  sampleTile(map, x, y) {
    const bridge = (map.bridges || []).some((entry) => Math.hypot(entry.x - x, entry.y - y) < 330);
    const riverDistance = map.riverDistance ? map.riverDistance({ x, y }) : Infinity;
    if (bridge && riverDistance < 250) {
      return { color: PALETTE.bridge, height: 0.04 };
    }
    if (riverDistance < 84) {
      const ripple = (Math.floor(x / 260) + Math.floor(y / 180)) % 3;
      return { color: ripple === 0 ? 0x28729e : PALETTE.water, height: -0.08 };
    }
    if (riverDistance < 150) {
      const sandPatch = (Math.floor(x / 220) + Math.floor(y / 260)) % 4;
      return { color: sandPatch === 0 ? 0xd0b45a : PALETTE.sand, height: 0.02 };
    }
    const roadRadius = (CONFIG.mapGeneration?.roadWidth || 92) * 1.35;
    if ((map.paths || []).some((path) => distanceToPolyline({ x, y }, path) < roadRadius)) {
      const roadPatch = (Math.floor(x / 180) + Math.floor(y / 220)) % 5;
      return { color: roadPatch === 0 ? 0xae8a48 : PALETTE.path, height: -0.015 };
    }
    const zone = (map.zones || []).find((entry) => x >= entry.x && x <= entry.x + entry.w && y >= entry.y && y <= entry.y + entry.h);
    if (zone?.type === "mountain") return { color: PALETTE.stone, height: 0.055 };
    if (zone?.type === "ruins" || zone?.type === "boss") return { color: PALETTE.floor, height: 0.035 };
    if (zone?.type === "danger" || zone?.type === "relic") return { color: ((Math.floor(x / 360) + Math.floor(y / 360)) % 3) ? 0x3f7a32 : PALETTE.darkGrass, height: 0.008 };
    if (zone?.type === "forest") return { color: ((Math.floor(x / 360) + Math.floor(y / 360)) % 4 === 0) ? 0x3d7f31 : PALETTE.grass, height: 0 };
    return { color: ((Math.floor(x / 480) + Math.floor(y / 480)) % 7 === 0) ? 0x438336 : PALETTE.grass, height: 0 };
  }

  buildStaticInstances(game) {
    const ambientDecor = this.createAmbientDecor(game);
    const treeSource = [...(game.map.trees || []), ...ambientDecor.trees].slice(0, MAX_INSTANCES);
    const rockSource = [...(game.map.rocks || []), ...ambientDecor.rocks].slice(0, MAX_INSTANCES);
    const grassSource = ambientDecor.grass.slice(0, MAX_INSTANCES);
    const treeCount = treeSource.length;
    const rockCount = rockSource.length;
    const grassCount = grassSource.length;
    const bridgeCount = Math.min(MAX_INSTANCES, game.map.bridges?.length || 0);
    const trunk = new this.THREE.InstancedMesh(new this.THREE.CylinderGeometry(0.12, 0.16, 0.95, 5), this.mat(PALETTE.wood), treeCount);
    const canopyA = new this.THREE.InstancedMesh(new this.THREE.ConeGeometry(0.62, 1.05, 5), this.mat(0x2a6a22), treeCount);
    const canopyB = new this.THREE.InstancedMesh(new this.THREE.ConeGeometry(0.48, 0.92, 5), this.mat(0x3a8030), treeCount);
    const canopyC = new this.THREE.InstancedMesh(new this.THREE.ConeGeometry(0.34, 0.72, 5), this.mat(0x2d6a25), treeCount);
    const rockMesh = new this.THREE.InstancedMesh(new this.THREE.IcosahedronGeometry(0.42, 0), this.mat(PALETTE.stone), rockCount);
    const bridgeMesh = new this.THREE.InstancedMesh(new this.THREE.BoxGeometry(6.8, 0.18, 2.4), this.mat(PALETTE.bridge), bridgeCount);
    const grassMesh = new this.THREE.InstancedMesh(new this.THREE.ConeGeometry(0.08, 0.36, 4), this.mat(0x6fb548), grassCount);
    const dummy = new this.THREE.Object3D();

    for (let index = 0; index < treeCount; index += 1) {
      const tree = treeSource[index];
      const scale = Math.max(0.75, (tree.size || 22) / 24);
      const pos = this.worldTo3(tree.x, tree.y, 0);
      setInstancedTransform(dummy, trunk, index, pos, [scale, scale, scale], 0, 0.46);
      setInstancedTransform(dummy, canopyA, index, pos, [scale, scale, scale], 0.2, 1.16);
      setInstancedTransform(dummy, canopyB, index, pos, [scale, scale, scale], 0.85, 1.76);
      setInstancedTransform(dummy, canopyC, index, pos, [scale, scale, scale], 1.35, 2.25);
    }

    for (let index = 0; index < rockCount; index += 1) {
      const rock = rockSource[index];
      const scale = Math.max(0.5, (rock.size || 18) / 24);
      const pos = this.worldTo3(rock.x, rock.y, 0.14);
      setInstancedTransform(dummy, rockMesh, index, pos, [scale * 1.2, scale * 0.72, scale], index * 0.7, 0);
    }

    for (let index = 0; index < bridgeCount; index += 1) {
      const bridge = game.map.bridges[index];
      const pos = this.worldTo3(bridge.x, bridge.y, 0.08);
      setInstancedTransform(dummy, bridgeMesh, index, pos, [1.2, 1, 1], bridge.angle || 0, 0);
    }

    for (let index = 0; index < grassCount; index += 1) {
      const tuft = grassSource[index];
      const pos = this.worldTo3(tuft.x, tuft.y, 0.08);
      const scale = Math.max(0.65, (tuft.size || 8) / 8);
      setInstancedTransform(dummy, grassMesh, index, pos, [scale, scale, scale], tuft.angle || 0, 0);
    }

    for (const mesh of [trunk, canopyA, canopyB, canopyC, rockMesh, bridgeMesh, grassMesh]) {
      mesh.instanceMatrix.needsUpdate = true;
      // InstancedMesh bounds are not reliable after many scattered matrices in
      // older Three builds, so keep these cheap static batches always eligible.
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.staticGroups.push(mesh);
    }
  }

  createAmbientDecor(game) {
    const trees = [];
    const rocks = [];
    const grass = [];
    const random = seededRandom(Math.round((game.player?.x || 0) + (game.player?.y || 0) + CONFIG.world.width));
    const safePoint = game.player || { x: CONFIG.world.width * 0.5, y: CONFIG.world.height * 0.5 };
    for (let index = 0; index < 36; index += 1) {
      const angle = (index / 36) * Math.PI * 2 + random() * 0.28;
      const radius = 560 + random() * 940;
      const x = clampWorldX(safePoint.x + Math.cos(angle) * radius);
      const y = clampWorldY(safePoint.y + Math.sin(angle) * radius);
      if (!isWaterish(game.map, x, y) && !isBaseFootprintBlocked(game, x, y)) {
        trees.push({ x, y, size: 18 + random() * 12 });
      }
    }
    for (let index = 0; index < 24; index += 1) {
      const angle = random() * Math.PI * 2;
      const radius = 420 + random() * 1120;
      const x = clampWorldX(safePoint.x + Math.cos(angle) * radius);
      const y = clampWorldY(safePoint.y + Math.sin(angle) * radius);
      if (!isWaterish(game.map, x, y) && !isBaseFootprintBlocked(game, x, y)) {
        rocks.push({ x, y, size: 12 + random() * 10 });
      }
    }
    for (let index = 0; index < 900; index += 1) {
      const anchor = (game.map.paths || [null])[Math.floor(random() * Math.max(1, (game.map.paths || []).length))];
      let x;
      let y;
      if (anchor?.length > 1) {
        const point = anchor[Math.floor(random() * anchor.length)];
        const offset = 120 + random() * 480;
        const angle = random() * Math.PI * 2;
        x = point.x + Math.cos(angle) * offset;
        y = point.y + Math.sin(angle) * offset;
      } else {
        x = random() * CONFIG.world.width;
        y = random() * CONFIG.world.height;
      }
      x = clampWorldX(x);
      y = clampWorldY(y);
      if (!isWaterish(game.map, x, y) && !isBaseFootprintBlocked(game, x, y)) {
        grass.push({ x, y, size: 6 + random() * 6, angle: random() * Math.PI * 2 });
      }
    }
    return { trees, rocks, grass };
  }

  buildStaticPointsOfInterest(game) {
    this.buildRoadSegments(game);
    for (const village of game.villages || []) {
      const group = this.buildVillage(village);
      this.setObjectPosition(group, village.x, village.y, 0);
      this.scene.add(group);
    }
  }

  buildRoadSegments(game) {
    const material = this.mat(PALETTE.path);
    const roadGroup = new this.THREE.Group();
    const roadWidth = Math.max(3.35, (CONFIG.mapGeneration?.roadWidth || 92) * SCALE * 3);
    for (const path of game.map.paths || []) {
      for (let index = 0; index < path.length - 1; index += 1) {
        const a = path[index];
        const b = path[index + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy) * SCALE;
        if (length <= 0.1) {
          continue;
        }
        if (this.roadSegmentCrossesRiver(game.map, a, b)) {
          continue;
        }
        const road = new this.THREE.Mesh(new this.THREE.BoxGeometry(1, 0.028, roadWidth), material);
        road.position.copy(this.worldTo3((a.x + b.x) * 0.5, (a.y + b.y) * 0.045));
        road.scale.set(length, 1, 1);
        road.rotation.y = rotationForWorldVector(dx, dy);
        road.frustumCulled = true;
        roadGroup.add(road);
      }
    }
    this.scene.add(roadGroup);
    this.staticGroups.push(roadGroup);
  }

  roadSegmentCrossesRiver(map, a, b) {
    if (!map?.riverDistance) {
      return false;
    }
    const samples = 5;
    for (let index = 0; index <= samples; index += 1) {
      const t = index / samples;
      const point = {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t
      };
      const nearBridge = (map.bridges || []).some((bridge) => Math.hypot(bridge.x - point.x, bridge.y - point.y) < bridge.radius + 80);
      if (!nearBridge && map.riverDistance(point) < 150) {
        return true;
      }
    }
    return false;
  }

  syncDynamicEntities(game) {
    const liveIds = new Set();
    this.syncCharacter("player-local", game.player, game.player.characterId || "ranger", liveIds, true);
    for (const ai of game.aiPlayers || []) {
      const aiEntity = ai.player || ai;
      if (this.shouldRenderLiveEntity(game, aiEntity, 90)) {
        this.syncCharacter(ai.id, aiEntity, aiEntity.characterId || ai.characterId || "ranger", liveIds, false);
      }
    }
    for (const remote of game.remotePlayers?.values?.() || []) {
      if (this.shouldRenderLiveEntity(game, remote, 90)) {
        this.syncCharacter(remote.id, remote, remote.characterId || "ranger", liveIds, false);
      }
    }
    for (const mob of game.mobs || []) {
      if (!mob.alive) continue;
      if (!this.shouldRenderLiveEntity(game, mob, mob.radius || 24)) continue;
      this.syncMob(mob, liveIds);
    }
    for (const building of game.base?.buildings || []) {
      if (!building.alive) continue;
      this.syncBuilding(`building-${building.id}`, building, liveIds, "#63d46b");
    }
    for (const ai of game.aiPlayers || []) {
      for (const building of ai.base?.buildings || []) {
        if (!building.alive) continue;
        if (!this.shouldRenderLiveEntity(game, building, building.radius || 44)) continue;
        this.syncBuilding(`ai-${ai.id}-${building.id}`, building, liveIds, ai.color || "#ffb26a");
      }
    }
    for (const defender of game.baseDefenders || []) {
      if (!defender.alive) continue;
      if (defender.ownerId !== game.player?.id && !this.shouldRenderLiveEntity(game, defender, defender.radius || 18)) continue;
      this.syncDefender(defender, liveIds, defender.ownerId === game.player?.id ? "#72d8e8" : "#ff8068");
    }
    for (const objective of game.objectives || []) {
      if (!this.shouldRenderLiveEntity(game, objective.combatPoint || objective, objective.radius || 130)) continue;
      this.syncObjective(objective, liveIds);
    }
    for (const tower of game.neutralTowers || []) {
      if (!tower.alive) continue;
      if (!(tower.captured && tower.ownerId === game.player?.id) && !this.shouldRenderLiveEntity(game, tower, 140)) continue;
      this.syncNeutralTower(tower, liveIds);
    }
    for (const chest of game.explorationChests || []) {
      if (chest.opened) continue;
      if (!this.shouldRenderLiveEntity(game, chest, 80)) continue;
      this.syncSimpleProp(`chest-${chest.id}`, chest, "chest", liveIds);
    }
    for (const loot of game.droppedLoot || []) {
      if (!this.shouldRenderLiveEntity(game, loot, 40)) continue;
      this.syncSimpleProp(`loot-${loot.id}`, loot, "loot", liveIds);
    }
    for (const [id, view] of [...this.dynamicViews]) {
      if (!liveIds.has(id)) {
        this.scene.remove(view);
        disposeObject(view);
        this.dynamicViews.delete(id);
      }
    }
  }

  shouldRenderLiveEntity(game, entity, padding = 0) {
    if (!entity) {
      return false;
    }
    if (entity === game.player) {
      return true;
    }
    return Boolean(game.isPointCurrentlyVisible?.(entity.combatPoint || entity, padding));
  }

  syncCharacter(id, entity, classId, liveIds, isLocal) {
    if (!entity?.alive) {
      return;
    }
    liveIds.add(id);
    let view = this.dynamicViews.get(id);
    if (!view) {
      view = this.buildCharacterMesh(classId, isLocal);
      this.scene.add(view);
      this.dynamicViews.set(id, view);
    }
    this.setObjectPosition(view, entity.x, entity.y, 0);
    const facing = entity.facing || { x: entity.vx || 0, y: entity.vy || 1 };
    if (Math.abs(facing.x) + Math.abs(facing.y) > 0.01) {
      view.rotation.y = Math.atan2(facing.x, facing.y);
    }
    view.visible = this.isNearCamera(view.position, FAR_LOD_DISTANCE * 1.25);
    this.updateNameTag(view, entity.displayName || entity.name || (isLocal ? "You" : "AI Rival"));
    this.updateHpBar(view, entity.healthRatio ?? entity.health / Math.max(1, entity.maxHealth), entity.shieldRatio || 0);
    this.spatialHash.insert(id, view.position.x, view.position.z, entity);
  }

  syncMob(mob, liveIds) {
    const id = `mob-${mob.id}`;
    liveIds.add(id);
    let view = this.dynamicViews.get(id);
    if (!view) {
      view = this.buildMobView(mob);
      this.scene.add(view);
      this.dynamicViews.set(id, view);
    }
    this.setObjectPosition(view, mob.x, mob.y, 0);
    if (mob.vx || mob.vy) view.rotation.y = Math.atan2(mob.vx || 0, mob.vy || 1);
    view.visible = this.isNearCamera(view.position, FAR_LOD_DISTANCE);
    this.updateHpBar(view, mob.health / Math.max(1, mob.maxHealth), 0);
    if (this.frame % 3 === 0 && view.update) view.update(this.camera);
    this.spatialHash.insert(id, view.position.x, view.position.z, mob);
  }

  syncDefender(defender, liveIds, teamColor) {
    const id = `defender-${defender.id}`;
    liveIds.add(id);
    let view = this.dynamicViews.get(id);
    const key = defender.kind || "guard";
    if (!view || view.userData.defenderKind !== key) {
      if (view) {
        this.scene.remove(view);
        disposeObject(view);
      }
      view = this.buildMobView({
        ...defender,
        variant: defender.kind === "imp" ? "summoner" : defender.kind === "hound" ? "fast" : defender.kind === "ent" ? "brute" : "ranged",
        scaledLevel: defender.level || 1,
        isBoss: defender.kind === "ent"
      });
      view.userData.defenderKind = key;
      this.scene.add(view);
      this.dynamicViews.set(id, view);
    }
    this.setObjectPosition(view, defender.x, defender.y, 0);
    if (defender.facing) view.rotation.y = Math.atan2(defender.facing.x || 0, defender.facing.y || 1);
    view.visible = this.isNearCamera(view.position, FAR_LOD_DISTANCE);
    this.updateHpBar(view, defender.health / Math.max(1, defender.maxHealth), 0);
    this.updateLevelTag(view, `L${defender.level || 1}`);
    this.spatialHash.insert(id, view.position.x, view.position.z, defender);
  }

  syncBuilding(id, building, liveIds, teamColor) {
    liveIds.add(id);
    let view = this.dynamicViews.get(id);
    if (!view) {
      view = this.buildStructure(building.type, teamColor, building);
      this.scene.add(view);
      this.dynamicViews.set(id, view);
    }
    this.setObjectPosition(view, building.x, building.y, 0);
    view.rotation.y = 0;
    view.visible = this.isNearCamera(view.position, FAR_LOD_DISTANCE * 1.4);
    this.updateHpBar(view, building.health / Math.max(1, building.maxHealth), 0);
    this.updateLevelTag(view, `L${building.level || 1}`);
    this.spatialHash.insert(id, view.position.x, view.position.z, building);
  }

  syncObjective(objective, liveIds) {
    const zoneId = `objective-zone-${objective.id}`;
    liveIds.add(zoneId);
    let zoneView = this.dynamicViews.get(zoneId);
    const zoneKey = `${objective.type}-${objective.captured ? "captured" : "open"}-${objective.guardianBounds ? "arena" : "circle"}`;
    if (!zoneView || zoneView.userData.zoneKey !== zoneKey) {
      if (zoneView) {
        this.scene.remove(zoneView);
        disposeObject(zoneView);
      }
      zoneView = this.buildObjectiveZone(objective);
      zoneView.userData.zoneKey = zoneKey;
      this.scene.add(zoneView);
      this.dynamicViews.set(zoneId, zoneView);
    }
    this.setObjectPosition(zoneView, objective.x, objective.y, 0.03);
    zoneView.visible = this.isNearCamera(zoneView.position, FAR_LOD_DISTANCE * 1.8);
    this.updateLevelTag(zoneView, `${objective.difficultyLabel || "OBJ"} L${objective.level || objective.recommendedLevel || 1}`);

    if (!objective.alive) {
      return;
    }
    const guardianPoint = objective.combatPoint || objective.guardianPoint || objective;
    const guardianId = `objective-guardian-${objective.id}`;
    liveIds.add(guardianId);
    let guardianView = this.dynamicViews.get(guardianId);
    if (!guardianView || guardianView.userData.guardianKind !== objective.guardianKind) {
      if (guardianView) {
        this.scene.remove(guardianView);
        disposeObject(guardianView);
      }
      guardianView = this.buildObjectiveGuardian(objective);
      guardianView.userData.guardianKind = objective.guardianKind;
      this.scene.add(guardianView);
      this.dynamicViews.set(guardianId, guardianView);
    }
    this.setObjectPosition(guardianView, guardianPoint.x, guardianPoint.y, 0);
    guardianView.visible = this.isNearCamera(guardianView.position, FAR_LOD_DISTANCE * 1.8);
    this.updateHpBar(guardianView, objective.health / Math.max(1, objective.maxHealth), 0);
    this.updateLevelTag(guardianView, `L${objective.level || objective.recommendedLevel || objective.scaleLevel || 1}`);
  }

  syncNeutralTower(tower, liveIds) {
    const id = `neutral-tower-${tower.id}`;
    liveIds.add(id);
    let view = this.dynamicViews.get(id);
    if (!view) {
      view = this.buildNeutralTower(tower);
      this.scene.add(view);
      this.dynamicViews.set(id, view);
    }
    this.setObjectPosition(view, tower.x, tower.y, 0);
    view.visible = this.isNearCamera(view.position, FAR_LOD_DISTANCE * 1.7);
    this.updateHpBar(view, tower.health / Math.max(1, tower.maxHealth), 0);
    this.updateLevelTag(view, `L${tower.level || 1}`);
  }

  syncSimpleProp(id, entity, type, liveIds) {
    liveIds.add(id);
    let view = this.dynamicViews.get(id);
    if (!view) {
      view = type === "chest" ? this.buildChest() : this.buildLoot();
      this.scene.add(view);
      this.dynamicViews.set(id, view);
    }
    this.setObjectPosition(view, entity.x, entity.y, type === "loot" ? 0.2 : 0);
    view.rotation.y += 0.018;
    view.visible = this.isNearCamera(view.position, FAR_LOD_DISTANCE);
  }

  syncProjectiles(game) {
    for (const mesh of this.projectilePool.items) {
      mesh.visible = false;
    }
    const count = Math.min(this.projectilePool.items.length, game.projectiles?.length || 0);
    for (let index = 0; index < count; index += 1) {
      const projectile = game.projectiles[index];
      const mesh = this.projectilePool.items[index];
      if (!game.isPointCurrentlyVisible?.(projectile, (projectile.radius || 6) + 12)) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      this.setObjectPosition(mesh, projectile.x, projectile.y, 0.82);
      mesh.rotation.y = Math.atan2(projectile.vx || 0, projectile.vy || 1);
      const color = projectile.color ? cssToHex(projectile.color) : 0xf4d36a;
      if (mesh.userData.color !== color) {
        mesh.material = this.mat(color);
        mesh.userData.color = color;
      }
    }
  }

  animateViews(game) {
    const t = performance.now() / 1000;
    for (const view of this.dynamicViews.values()) {
      if (!view.visible) continue;
      if (view.userData.legL) {
        const speed = Math.abs(view.userData.lastX - view.position.x) + Math.abs(view.userData.lastZ - view.position.z);
        const swing = speed > 0.001 ? Math.sin(t * 9) * 0.42 : 0;
        view.userData.legL.rotation.x = swing;
        view.userData.legR.rotation.x = -swing;
        view.userData.armL.rotation.x = -swing * 0.55;
        view.userData.armR.rotation.x = swing * 0.55;
        view.userData.lastX = view.position.x;
        view.userData.lastZ = view.position.z;
      }
      if (view.userData.orb) {
        view.userData.orb.rotation.y += 0.025;
        view.userData.orb.rotation.x += 0.012;
      }
      if (view.userData.hpBar) {
        view.userData.hpBar.lookAt(this.camera.position);
      }
      if (view.userData.nameTag) {
        view.userData.nameTag.lookAt(this.camera.position);
      }
      if (view.userData.levelTag) {
        view.userData.levelTag.lookAt(this.camera.position);
      }
    }
  }

  isNearCamera(position, maxDistance) {
    const lifted = this._cullVector || (this._cullVector = new this.THREE.Vector3());
    lifted.set(position.x, position.y + 1.4, position.z);
    if (!this.frustum?.containsPoint(position) && !this.frustum?.containsPoint(lifted)) {
      return false;
    }
    return this.camera.position.distanceTo(position) <= maxDistance + 35;
  }

  // ---- low-poly mesh helpers (flat-shaded via this.mat; { basic: true } = unlit glow) ----
  place(object, x, y, z) { object.position.set(x, y, z); return object; }
  mkBox(w, h, d, color, opts) { return new this.THREE.Mesh(new this.THREE.BoxGeometry(w, h, d), this.mat(color, opts)); }
  mkCyl(rt, rb, h, seg, color, opts) { return new this.THREE.Mesh(new this.THREE.CylinderGeometry(rt, rb, h, seg), this.mat(color, opts)); }
  mkCone(r, h, seg, color, opts) { return new this.THREE.Mesh(new this.THREE.ConeGeometry(r, h, seg), this.mat(color, opts)); }
  mkIco(r, detail, color, opts) { return new this.THREE.Mesh(new this.THREE.IcosahedronGeometry(r, detail), this.mat(color, opts)); }

  // Shared faceted humanoid. Returns the group plus hip/shoulder pivot groups
  // (legL/legR/armL/armR) the animator swings, and hand anchors that weapons
  // parent into so they follow the arm. Feet at y=0; head-top ~1.77.
  buildHumanoidBase(opts) {
    const T = this.THREE;
    const skin = opts.skin ?? 0xf0b870;
    const torsoColor = opts.torso ?? 0x5a4a32;
    const legColor = opts.legs ?? 0x40331f;
    const boots = opts.boots ?? 0x241a10;
    const belt = opts.belt ?? 0x2a2014;
    const sleeve = opts.sleeve ?? torsoColor;
    const bulk = opts.bulk ?? 1;
    const bare = Boolean(opts.bareChest);
    const g = new T.Group();
    const hipY = 0.62;

    const makeLeg = (sx) => {
      const leg = new T.Group();
      leg.position.set(0.16 * sx, hipY, 0);
      leg.add(this.place(this.mkBox(0.24, 0.32, 0.26, legColor), 0, -0.17, 0)); // thigh
      leg.add(this.place(this.mkBox(0.22, 0.30, 0.24, legColor), 0, -0.45, 0)); // shin
      leg.add(this.place(this.mkBox(0.26, 0.12, 0.34, boots), 0, -0.62, 0.04)); // foot
      return leg;
    };
    const legL = makeLeg(-1);
    const legR = makeLeg(1);

    g.add(this.place(this.mkBox(0.54 * bulk, 0.16, 0.30, belt), 0, hipY + 0.02, 0));     // pelvis/belt
    g.add(this.place(this.mkBox(0.62 * bulk, 0.5, 0.34, bare ? skin : torsoColor), 0, 0.92, 0)); // torso
    if (!bare) g.add(this.place(this.mkBox(0.30, 0.5, 0.02, opts.accent ?? torsoColor), 0, 0.92, 0.17));
    g.add(this.place(this.mkBox(0.70 * bulk, 0.16, 0.34, bare ? skin : torsoColor), 0, 1.16, 0)); // shoulders
    g.add(this.place(this.mkCyl(0.09, 0.10, 0.12, 7, skin), 0, 1.28, 0));                 // neck
    const head = this.mkIco(0.24, 1, skin);
    head.position.y = 1.52; head.scale.set(0.95, 1.05, 0.95);
    g.add(head);

    const makeArm = (sx) => {
      const arm = new T.Group();
      arm.position.set(0.40 * bulk * sx, 1.16, 0);
      arm.rotation.z = 0.08 * sx;
      arm.add(this.place(this.mkBox(0.17, 0.30, 0.19, bare ? skin : torsoColor), 0, -0.16, 0));
      arm.add(this.place(this.mkBox(0.15, 0.30, 0.17, sleeve), 0, -0.44, 0));
      arm.add(this.place(this.mkIco(0.10, 0, skin), 0, -0.62, 0.04));
      const hand = new T.Object3D();
      hand.position.set(0, -0.62, 0.12);
      arm.add(hand);
      return { arm, hand };
    };
    const L = makeArm(-1);
    const R = makeArm(1);
    g.add(legL, legR, L.arm, R.arm);
    return { g, legL, legR, armL: L.arm, armR: R.arm, handL: L.hand, handR: R.hand };
  }

  // ---- shared cosmetics / weapons (local +Y is "up the weapon"; grip near origin) ----
  mkHood(color) {
    const h = new this.THREE.Group();
    h.add(this.place(this.mkBox(0.34, 0.34, 0.36, color), 0, 0, -0.02));
    h.add(this.place(this.mkCone(0.25, 0.30, 6, color), 0, 0.26, -0.02));
    h.add(this.place(this.mkBox(0.30, 0.10, 0.06, color), 0, -0.16, 0.18));
    return h;
  }
  mkRobe(color, accent) {
    const r = new this.THREE.Group();
    r.add(this.place(this.mkCyl(0.30, 0.52, 0.70, 8, color), 0, 0.35, 0));         // skirt
    r.add(this.place(this.mkCyl(0.52, 0.54, 0.06, 8, accent ?? color), 0, 0.04, 0)); // hem
    r.add(this.place(this.mkCyl(0.33, 0.33, 0.14, 8, accent ?? color), 0, 0.66, 0)); // waistband
    return r;
  }
  mkCape(color) {
    const g = new this.THREE.Group();
    g.add(this.place(this.mkBox(0.5, 0.8, 0.05, color), 0, -0.25, -0.02));
    g.rotation.x = 0.12;
    return g;
  }
  mkBow() {
    const g = new this.THREE.Group();
    const wood = 0x6b4a26;
    g.add(this.place(this.mkCyl(0.03, 0.03, 0.5, 5, wood), 0, 0.18, 0));
    const top = this.place(this.mkCyl(0.025, 0.03, 0.28, 5, wood), 0, 0.5, -0.06); top.rotation.x = 0.5; g.add(top);
    const bot = this.place(this.mkCyl(0.025, 0.03, 0.28, 5, wood), 0, -0.14, -0.06); bot.rotation.x = -0.5; g.add(bot);
    g.add(this.place(this.mkBox(0.01, 0.86, 0.01, 0xe8e0c0), 0, 0.18, 0.09));
    return g;
  }
  mkSword(blade, hilt) {
    const g = new this.THREE.Group();
    g.add(this.place(this.mkBox(0.10, 0.66, 0.04, blade), 0, 0.42, 0));
    g.add(this.place(this.mkCone(0.07, 0.13, 4, blade), 0, 0.80, 0));
    g.add(this.place(this.mkBox(0.28, 0.07, 0.07, hilt), 0, 0.08, 0));
    g.add(this.place(this.mkCyl(0.04, 0.04, 0.16, 6, hilt), 0, -0.02, 0));
    return g;
  }
  mkShield(face, rim) {
    const g = new this.THREE.Group();
    g.add(this.place(this.mkBox(0.46, 0.58, 0.06, face), 0, 0, 0));
    g.add(this.place(this.mkBox(0.52, 0.09, 0.05, rim), 0, 0.28, 0.02));
    g.add(this.place(this.mkBox(0.52, 0.09, 0.05, rim), 0, -0.28, 0.02));
    g.add(this.place(this.mkIco(0.08, 0, rim), 0, 0, 0.06));
    return g;
  }
  mkStaff(shaft, orb) {
    const g = new this.THREE.Group();
    g.add(this.place(this.mkCyl(0.035, 0.045, 1.15, 6, shaft), 0, 0.32, 0));
    g.add(this.place(this.mkIco(0.12, 0, orb, { basic: true }), 0, 0.95, 0));
    return g;
  }
  mkDagger(blade, hilt) {
    const g = new this.THREE.Group();
    g.add(this.place(this.mkBox(0.06, 0.32, 0.03, blade), 0, 0.2, 0));
    g.add(this.place(this.mkCone(0.045, 0.10, 4, blade), 0, 0.4, 0));
    g.add(this.place(this.mkBox(0.16, 0.05, 0.05, hilt), 0, 0.02, 0));
    g.add(this.place(this.mkCyl(0.03, 0.03, 0.12, 6, hilt), 0, -0.05, 0));
    return g;
  }
  mkSpear() {
    const g = new this.THREE.Group();
    g.add(this.place(this.mkCyl(0.03, 0.035, 1.5, 6, 0x6b4a26), 0, 0.4, 0));
    g.add(this.place(this.mkCone(0.07, 0.32, 5, 0xb8bcc4), 0, 1.3, 0));
    g.add(this.place(this.mkBox(0.16, 0.05, 0.05, 0xb8bcc4), 0, 1.08, 0));
    return g;
  }
  mkCleaver(blade) {
    const g = new this.THREE.Group();
    g.add(this.place(this.mkCyl(0.04, 0.045, 0.62, 6, 0x3a2a18), 0, 0.18, 0));
    g.add(this.place(this.mkBox(0.32, 0.46, 0.05, blade), 0.10, 0.62, 0));
    return g;
  }
  mkLauncher(body, accent) {
    const g = new this.THREE.Group();
    g.add(this.place(this.mkBox(0.16, 0.16, 0.46, body), 0, 0, 0));
    const barrel = this.place(this.mkCyl(0.05, 0.06, 0.28, 7, accent), 0, 0.02, 0.32); barrel.rotation.x = Math.PI / 2; g.add(barrel);
    g.add(this.place(this.mkBox(0.10, 0.20, 0.10, body), 0, -0.15, -0.08));
    g.add(this.place(this.mkIco(0.05, 0, 0x55ccff, { basic: true }), 0, 0.05, 0.48));
    return g;
  }

  buildCharacterMesh(classId, isLocal = false) {
    const T = this.THREE;
    let base;

    switch (classId) {
      case "guardian": {
        base = this.buildHumanoidBase({ skin: 0xbf9468, torso: 0x6f7884, legs: 0x4a525c, boots: 0x2b2f36, accent: 0x9aa3b0, sleeve: 0x5a626c, belt: 0x3a3f47, bulk: 1.18 });
        const helm = new T.Group();
        helm.add(this.place(this.mkBox(0.34, 0.30, 0.36, 0x8a93a0), 0, 0.02, 0));
        helm.add(this.place(this.mkBox(0.30, 0.10, 0.04, 0x222222), 0, -0.06, 0.18));
        helm.add(this.place(this.mkCone(0.06, 0.16, 4, 0xc8a24a), 0, 0.22, 0));
        base.g.add(this.place(helm, 0, 1.52, 0));
        for (const s of [-1, 1]) { const pp = this.mkIco(0.17, 0, 0x8a93a0); pp.position.set(0.42 * s, 1.18, 0); pp.scale.set(1, 0.7, 1); base.g.add(pp); }
        base.handR.add(this.mkSword(0xc6ccd4, 0x4a3320));
        const shield = this.mkShield(0x5a6470, 0xc8a24a); shield.rotation.y = Math.PI / 2; base.handL.add(shield);
        break;
      }
      case "engineer": {
        base = this.buildHumanoidBase({ skin: 0xc2966a, torso: 0x7a5a32, legs: 0x5a4628, boots: 0x2e2316, accent: 0xc8902f, sleeve: 0x8a6a3a, belt: 0x3a2c18 });
        base.g.add(this.place(this.mkCyl(0.24, 0.26, 0.12, 8, 0xc8902f), 0, 1.72, 0)); // hard hat
        const gog = new T.Group();
        gog.add(this.place(this.mkBox(0.40, 0.07, 0.05, 0x3a2c18), 0, 0, 0.02));
        for (const s of [-1, 1]) gog.add(this.place(this.mkIco(0.07, 0, 0x66ddff, { basic: true }), 0.10 * s, 0, 0.05));
        base.g.add(this.place(gog, 0, 1.52, 0.18));
        const pack = new T.Group();
        pack.add(this.place(this.mkBox(0.30, 0.38, 0.18, 0x6b6058), 0, 0, 0));
        pack.add(this.place(this.mkIco(0.07, 0, 0x77cc66, { basic: true }), 0.08, 0.12, 0.12));
        base.g.add(this.place(pack, 0, 1.0, -0.22));
        const launcher = this.mkLauncher(0x55504a, 0xc8a24a); launcher.rotation.x = -0.4; base.handR.add(launcher);
        break;
      }
      case "shadowblade": {
        base = this.buildHumanoidBase({ skin: 0xb89070, torso: 0x2a2636, legs: 0x201d2c, boots: 0x14121c, accent: 0x6a4fa0, sleeve: 0x241f30, belt: 0x4a3f6a });
        base.g.add(this.place(this.mkHood(0x231f30), 0, 1.52, 0.06));
        base.g.add(this.place(this.mkBox(0.24, 0.10, 0.05, 0x6a4fa0, { basic: true }), 0, 1.46, 0.20)); // glowing mask
        base.g.add(this.place(this.mkCape(0x201d2c), 0, 1.28, -0.18));
        const dR = this.mkDagger(0xcfd4dd, 0x2a2636); dR.rotation.x = Math.PI; base.handR.add(dR);
        const dL = this.mkDagger(0xcfd4dd, 0x2a2636); dL.rotation.x = Math.PI; base.handL.add(dL);
        break;
      }
      case "arcanist": {
        base = this.buildHumanoidBase({ skin: 0xceaa82, torso: 0x2f4f8a, legs: 0x2f4f8a, boots: 0x1c2c4a });
        base.g.add(this.mkRobe(0x2f4f8a, 0x7fa8e0));
        const hat = new T.Group();
        hat.add(this.place(this.mkCyl(0.30, 0.33, 0.05, 8, 0x24407a), 0, -0.02, 0));
        hat.add(this.place(this.mkCone(0.20, 0.5, 7, 0x2f4f8a), 0, 0.24, 0));
        hat.add(this.place(this.mkIco(0.05, 0, 0x9fd0ff, { basic: true }), 0, 0.48, 0));
        base.g.add(this.place(hat, 0, 1.66, 0));
        base.handR.add(this.mkStaff(0x4a3a6a, 0x9fd0ff));
        break;
      }
      case "berserker": {
        base = this.buildHumanoidBase({ bareChest: true, skin: 0xc28a5e, legs: 0x5a3a22, boots: 0x2e2012, belt: 0x3a2814, bulk: 1.15 });
        base.g.add(this.place(this.mkBox(0.24, 0.05, 0.02, 0xc4392f), 0, 1.54, 0.22)); // war paint
        for (const s of [-1, 1]) { const fur = this.mkIco(0.20, 0, 0x6b4a2a); fur.position.set(0.42 * s, 1.18, 0); fur.scale.set(1.1, 0.6, 1.1); base.g.add(fur); }
        const helm = new T.Group();
        helm.add(this.place(this.mkBox(0.30, 0.20, 0.34, 0x4a4a4a), 0, 0.04, 0));
        for (const s of [-1, 1]) { const horn = this.place(this.mkCone(0.05, 0.26, 5, 0xe8dcc0), 0.16 * s, 0.16, 0); horn.rotation.z = -0.7 * s; helm.add(horn); }
        base.g.add(this.place(helm, 0, 1.54, 0));
        base.handR.add(this.mkCleaver(0x9aa0a8));
        break;
      }
      case "druid": {
        base = this.buildHumanoidBase({ skin: 0xb89a6a, torso: 0x4a6b3a, legs: 0x3a5230, boots: 0x2c3a1e });
        base.g.add(this.mkRobe(0x4a6b3a, 0x6b8a4a));
        base.g.add(this.place(this.mkHood(0x3a5230), 0, 1.52, 0.06));
        const antlers = new T.Group();
        for (const s of [-1, 1]) {
          const b = this.place(this.mkCyl(0.02, 0.03, 0.3, 5, 0x8a6a3a), 0.10 * s, 0.1, -0.05); b.rotation.z = 0.5 * s; antlers.add(b);
          const t = this.place(this.mkCyl(0.015, 0.02, 0.18, 5, 0x8a6a3a), 0.20 * s, 0.28, -0.05); t.rotation.z = 0.9 * s; antlers.add(t);
        }
        base.g.add(this.place(antlers, 0, 1.62, 0));
        const st = new T.Group();
        st.add(this.place(this.mkCyl(0.04, 0.05, 1.15, 6, 0x5a3f22), 0, 0.32, 0));
        for (let i = 0; i < 5; i += 1) st.add(this.place(this.mkIco(0.09, 0, 0x6fae4a), 0.1 * Math.cos(i * 1.3), 0.92 + (i % 2) * 0.05, 0.1 * Math.sin(i * 1.3)));
        st.add(this.place(this.mkIco(0.07, 0, 0x9fe07a, { basic: true }), 0, 0.98, 0));
        base.handR.add(st);
        break;
      }
      case "sentinel": {
        base = this.buildHumanoidBase({ skin: 0xbf9468, torso: 0x4a6f70, legs: 0x3a4f50, boots: 0x232f30, accent: 0xc8a24a, sleeve: 0x3f5f60, belt: 0x2e3e3f, bulk: 1.08 });
        const helm = new T.Group();
        helm.add(this.place(this.mkBox(0.32, 0.30, 0.36, 0x8a93a0), 0, 0.02, 0));
        helm.add(this.place(this.mkBox(0.30, 0.08, 0.04, 0x222222), 0, -0.04, 0.18));
        helm.add(this.place(this.mkBox(0.04, 0.16, 0.30, 0xc4392f), 0, 0.22, 0)); // crest
        base.g.add(this.place(helm, 0, 1.52, 0));
        base.handR.add(this.mkSpear());
        const shield = this.mkShield(0x4a6f70, 0xc8a24a); shield.children[0].scale.set(0.9, 1.4, 1); shield.rotation.y = Math.PI / 2; base.handL.add(shield);
        break;
      }
      case "warlock": {
        base = this.buildHumanoidBase({ skin: 0xb0a0a8, torso: 0x33223f, legs: 0x281a30, boots: 0x1a1020 });
        base.g.add(this.mkRobe(0x33223f, 0x6a2f6a));
        base.g.add(this.place(this.mkHood(0x281a30), 0, 1.52, 0.06));
        base.g.add(this.place(this.mkCape(0x231630), 0, 1.28, -0.18));
        const st = new T.Group();
        st.add(this.place(this.mkCyl(0.035, 0.045, 1.15, 6, 0x2a1a30), 0, 0.32, 0));
        st.add(this.place(this.mkIco(0.11, 0, 0xe8e0d0), 0, 0.92, 0)); // skull
        st.add(this.place(this.mkIco(0.14, 0, 0x9b4fd0, { basic: true }), 0, 0.92, 0)); // soul glow
        base.handR.add(st);
        const wisp = this.mkIco(0.10, 0, 0x9b4fd0, { basic: true }); wisp.position.set(0.5, 1.2, 0.2); base.g.add(wisp);
        break;
      }
      case "ranger":
      default: {
        base = this.buildHumanoidBase({ skin: 0xc89b6e, torso: 0x3f6b3a, legs: 0x4a5a30, boots: 0x2a2012, accent: 0x2e4d2a, sleeve: 0x355c30, belt: 0x6b4a26 });
        base.g.add(this.place(this.mkHood(0x2e4d2a), 0, 1.52, 0.06));
        base.handL.add(this.mkBow());
        const quiver = this.place(this.mkCyl(0.07, 0.08, 0.32, 6, 0x4a3320), 0.12, 1.25, -0.20);
        quiver.rotation.set(0.3, 0, 0.4); base.g.add(quiver);
        break;
      }
    }

    const g = base.g;
    if (isLocal) {
      const halo = new T.Mesh(new T.TorusGeometry(0.55, 0.03, 6, 24), this.mat(0x72d8e8, { transparent: true, opacity: 0.85 }));
      halo.rotation.x = Math.PI / 2;
      halo.position.y = 0.05;
      g.add(halo);
    }
    this.addHpBar(g, 2.25);
    this.addNameTag(g, isLocal ? "You" : "AI", 2.6);
    g.userData.legL = base.legL;
    g.userData.legR = base.legR;
    g.userData.armL = base.armL;
    g.userData.armR = base.armR;
    return g;
  }

  // Resolve a mob to one of the 8 archetypes. Real camp mobs use `archetype`;
  // summoned defenders pass `variant` (with "fast" meaning swift).
  mobArchetype(mob) {
    if (mob.isBoss) return "boss";
    const a = mob.archetype || mob.variant || "melee";
    if (a === "fast") return "swift";
    return MOB_SHAPE[a] ? a : "melee";
  }

  // Spectral floating body for wraith-camp mobs (no legs; glides).
  buildWraith(theme) {
    const g = new this.THREE.Group();
    const ghost = { transparent: true, opacity: 0.7 };
    g.add(this.place(this.mkCyl(0.30, 0.04, 1.0, 7, theme.cloth, ghost), 0, 0.55, 0));   // tapered shroud
    g.add(this.place(this.mkBox(0.5, 0.4, 0.34, theme.cloth, ghost), 0, 1.06, 0));        // shoulders
    for (const s of [-1, 1]) g.add(this.place(this.mkCyl(0.07, 0.02, 0.5, 5, theme.cloth, ghost), 0.32 * s, 0.98, 0)); // wispy arms
    g.add(this.place(this.mkIco(0.20, 0, theme.skin, { transparent: true, opacity: 0.85 }), 0, 1.4, 0)); // skull
    for (const s of [-1, 1]) g.add(this.place(this.mkBox(0.06, 0.06, 0.04, 0x0a1a20), 0.07 * s, 1.41, 0.16)); // eye sockets
    g.add(this.place(this.mkIco(0.13, 0, theme.glow || theme.accent, { basic: true }), 0, 1.02, 0)); // soul core
    return g;
  }

  // Hand the right archetype weapon to the humanoid base, reusing hero builders.
  addMobWeapon(base, arch, theme) {
    switch (arch) {
      case "ranged": base.handL.add(this.mkBow()); break;
      case "summoner": base.handR.add(this.mkStaff(theme.accent, theme.glow || 0xb391f0)); break;
      case "brute": base.handR.add(this.mkCleaver(theme.weapon)); break;
      case "boss": base.handR.add(this.mkCleaver(theme.weapon)); break;
      case "tank": {
        base.handR.add(this.mkSword(theme.weapon, theme.accent));
        const shield = this.mkShield(theme.cloth, theme.accent); shield.rotation.y = Math.PI / 2; base.handL.add(shield);
        break;
      }
      case "swift": {
        const dR = this.mkDagger(theme.weapon, theme.accent); dR.rotation.x = Math.PI; base.handR.add(dR);
        const dL = this.mkDagger(theme.weapon, theme.accent); dL.rotation.x = Math.PI; base.handL.add(dL);
        break;
      }
      case "skitter": break; // bare claws, tiny swarmer
      case "melee":
      default: base.handR.add(this.mkSword(theme.weapon, theme.accent)); break;
    }
  }

  buildMobView(mob) {
    const T = this.THREE;
    const arch = this.mobArchetype(mob);
    const theme = MOB_THEMES[mob.campType] || MOB_THEMES.goblin;
    const shape = MOB_SHAPE[arch] || MOB_SHAPE.melee;
    const isElite = Boolean(mob.isElite || mob.elite || (typeof mob.tier === "number" && mob.tier >= 4));

    const lod = new T.LOD();
    const high = new T.Group();
    const shadow = new T.Mesh(new T.TorusGeometry(0.4 * shape.bulk * shape.scale + (arch === "boss" ? 0.22 : 0.08), 0.03, 5, 22), this.mat(0x10160e, { transparent: true, opacity: theme.ghost ? 0.3 : 0.5 }));
    shadow.rotation.x = Math.PI / 2;
    shadow.position.y = 0.04;
    high.add(shadow);

    let bodyGroup;
    if (theme.ghost) {
      bodyGroup = this.buildWraith(theme);
      bodyGroup.scale.setScalar(shape.scale);
      high.add(bodyGroup);
    } else {
      const base = this.buildHumanoidBase({ skin: theme.skin, torso: theme.cloth, legs: theme.cloth, boots: theme.accent, belt: theme.accent, sleeve: theme.cloth, accent: theme.accent, bulk: shape.bulk });
      bodyGroup = base.g;
      bodyGroup.scale.setScalar(shape.scale);
      high.add(bodyGroup);
      if (theme.bone) for (const s of [-1, 1]) bodyGroup.add(this.place(this.mkBox(0.07, 0.08, 0.04, 0x161210), 0.07 * s, 1.54, 0.21)); // skull eyes
      if (theme.hooded) bodyGroup.add(this.place(this.mkHood(theme.cloth), 0, 1.52, 0.06));
      if (theme.robe) bodyGroup.add(this.mkRobe(theme.cloth, theme.accent));
      if (theme.fur) for (const s of [-1, 1]) { const f = this.mkIco(0.18, 0, theme.accent); f.position.set(0.42 * shape.bulk * s, 1.16, 0); f.scale.set(1.1, 0.6, 1.1); bodyGroup.add(f); }
      this.addMobWeapon(base, arch, theme);
      lod.userData.legL = base.legL;
      lod.userData.legR = base.legR;
      lod.userData.armL = base.armL;
      lod.userData.armR = base.armR;
    }

    if (arch === "boss") {
      const crown = this.mkCone(0.34, 0.42, 5, theme.glow || 0xf0c85d, theme.glow ? { basic: true } : undefined);
      bodyGroup.add(this.place(crown, 0, 1.95, 0));
    }
    if (isElite) bodyGroup.add(this.place(this.mkIco(0.09, 0, 0xffd86a, { basic: true }), 0, 1.66, 0)); // elite crest

    const topY = 1.85 * shape.scale + (arch === "boss" ? 0.25 : 0.12);
    const low = this.makeLabelSprite(arch === "boss" ? "BOSS" : `L${mob.scaledLevel || mob.level || 1}`, "#ffb26a");
    low.scale.set(1.8, 0.5, 1);
    low.position.y = topY;
    lod.addLevel(high, 0);
    // THREE.LOD measures full 3D camera distance, including the top-down
    // camera height, so keep high-detail mobs active at ordinary gameplay range.
    lod.addLevel(low, 42);
    this.addHpBar(lod, topY + 0.18);
    this.addLevelTag(lod, `L${mob.scaledLevel || mob.level || 1}`, topY + 0.5);
    return lod;
  }

  buildStructure(type, teamColor = "#63d46b", building = null) {
    const g = new this.THREE.Group();
    const team = cssToHex(teamColor);
    if (type === "core") {
      const base = new this.THREE.Mesh(new this.THREE.BoxGeometry(1.9, 0.28, 1.9), this.mat(0x24384a));
      const tower = new this.THREE.Mesh(new this.THREE.BoxGeometry(1.02, 1.85, 1.02), this.mat(0x1f4255));
      tower.position.y = 1.02;
      const orb = new this.THREE.Mesh(new this.THREE.IcosahedronGeometry(0.32, 0), this.mat(team, { basic: true }));
      orb.position.y = 2.12;
      g.add(base, tower, orb);
      g.userData.orb = orb;
      for (const [x, z] of [[-0.84, -0.84], [0.84, -0.84], [-0.84, 0.84], [0.84, 0.84]]) {
        const spire = new this.THREE.Mesh(new this.THREE.CylinderGeometry(0.16, 0.2, 0.92, 6), this.mat(0x2a5070));
        spire.position.set(x, 0.62, z);
        g.add(spire);
      }
      this.addHpBar(g, 2.62);
    } else if (type === "wall") {
      g.add(this.buildWallSegment(building?.width || 72, building?.height || 72));
      this.addHpBar(g, 1.45);
    } else if (type === "generator") {
      const base = new this.THREE.Mesh(new this.THREE.CylinderGeometry(0.48, 0.58, 0.62, 6), this.mat(0x6b4a2f));
      base.position.y = 0.31;
      const top = new this.THREE.Mesh(new this.THREE.IcosahedronGeometry(0.28, 0), this.mat(PALETTE.gold, { basic: true }));
      top.position.y = 0.82;
      g.add(base, top);
      this.addHpBar(g, 1.26);
    } else if (type === "barracks") {
      const body = new this.THREE.Mesh(new this.THREE.BoxGeometry(1.4, 0.76, 1.0), this.mat(PALETTE.floor));
      body.position.y = 0.38;
      const roof = new this.THREE.Mesh(new this.THREE.ConeGeometry(0.95, 0.65, 4), this.mat(PALETTE.roof));
      roof.rotation.y = Math.PI / 4;
      roof.position.y = 1.08;
      g.add(body, roof);
      this.addHpBar(g, 1.6);
    } else {
      const shaft = new this.THREE.Mesh(new this.THREE.CylinderGeometry(0.36, 0.45, 1.18, 8), this.mat(PALETTE.stone));
      shaft.position.y = 0.59;
      const cap = new this.THREE.Mesh(new this.THREE.CylinderGeometry(0.52, 0.46, 0.28, 8), this.mat(0x4a4a4a));
      cap.position.y = 1.26;
      const flag = new this.THREE.Mesh(new this.THREE.PlaneGeometry(0.42, 0.28), this.mat(team, { basic: true }));
      flag.position.set(0.36, 1.55, 0);
      g.add(shaft, cap, flag);
      this.addHpBar(g, 1.78);
    }
    this.addLevelTag(g, "L1", 2.08);
    return g;
  }

  buildWallSegment(width, height, material = this.mat(PALETTE.wall)) {
    const g = new this.THREE.Group();
    const w = Math.max(0.42, width * SCALE);
    const d = Math.max(0.42, height * SCALE);
    const longAxis = Math.max(w, d);
    const isHorizontal = w >= d;
    const base = new this.THREE.Mesh(new this.THREE.BoxGeometry(w, 0.82, d), material);
    base.position.y = 0.41;
    const cap = new this.THREE.Mesh(new this.THREE.BoxGeometry(w + 0.08, 0.14, d + 0.08), this.mat(0x5b4a35));
    cap.position.y = 0.88;
    g.add(base, cap);

    const crenelCount = Math.max(3, Math.min(18, Math.floor(longAxis / 0.58)));
    for (let index = 0; index < crenelCount; index += 1) {
      const t = crenelCount === 1 ? 0.5 : index / (crenelCount - 1);
      const x = isHorizontal ? -w * 0.45 + t * w * 0.9 : 0;
      const z = isHorizontal ? 0 : -d * 0.45 + t * d * 0.9;
      const merlon = new this.THREE.Mesh(new this.THREE.BoxGeometry(isHorizontal ? 0.26 : Math.max(0.28, w), 0.28, isHorizontal ? Math.max(0.28, d) : 0.26), this.mat(0x6a5840));
      merlon.position.set(x, 1.06, z);
      g.add(merlon);
    }

    for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) {
      const post = new this.THREE.Mesh(new this.THREE.BoxGeometry(0.42, 1.12, 0.42), this.mat(0x4a3a2a));
      post.position.set(x, 0.56, z);
      g.add(post);
    }
    return g;
  }

  buildNeutralTower(tower) {
    const g = this.buildStructure(tower.type === "vision" ? "tower" : "ballista", tower.ownerId ? "#72d8e8" : "#f0c85d");
    const ring = new this.THREE.Mesh(new this.THREE.TorusGeometry(0.8, 0.035, 5, 28), this.mat(tower.type === "vision" ? 0x72d8e8 : 0xef5d58, { transparent: true, opacity: 0.78 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    g.add(ring);
    return g;
  }

  buildObjectiveZone(objective) {
    const g = new this.THREE.Group();
    if (objective.guardianBounds && !objective.captured) {
      const bounds = objective.guardianBounds;
      const color = objective.type === "boss" ? 0xef5d58 : 0xf0c85d;
      const arenaMat = this.helperMat(color, objective.type === "boss" ? 0.24 : 0.18);
      const width = Math.max(0.2, bounds.w * SCALE);
      const height = Math.max(0.2, bounds.h * SCALE);
      const offsetX = (bounds.x + bounds.w / 2 - objective.x) * SCALE;
      const offsetZ = (bounds.y + bounds.h / 2 - objective.y) * SCALE;
      const top = new this.THREE.Mesh(new this.THREE.BoxGeometry(width, 0.035, 0.06), arenaMat);
      const bottom = new this.THREE.Mesh(new this.THREE.BoxGeometry(width, 0.035, 0.06), arenaMat);
      const left = new this.THREE.Mesh(new this.THREE.BoxGeometry(0.06, 0.035, height), arenaMat);
      const right = new this.THREE.Mesh(new this.THREE.BoxGeometry(0.06, 0.035, height), arenaMat);
      top.position.set(offsetX, 0.05, offsetZ - height / 2);
      bottom.position.set(offsetX, 0.05, offsetZ + height / 2);
      left.position.set(offsetX - width / 2, 0.05, offsetZ);
      right.position.set(offsetX + width / 2, 0.05, offsetZ);
      g.add(top, bottom, left, right);
    }
    const ring = new this.THREE.Mesh(new this.THREE.TorusGeometry(Math.max(0.75, (objective.radius || 160) * SCALE), 0.035, 5, 44), this.mat(objective.type === "boss" ? 0xef5d58 : 0xf0c85d, { transparent: true, opacity: 0.74 }));
    ring.rotation.x = Math.PI / 2;
    const marker = new this.THREE.Mesh(new this.THREE.CylinderGeometry(0.34, 0.46, 0.28, 6), this.mat(objective.captured ? 0x63d46b : 0xf0c85d));
    marker.position.y = 0.18;
    g.add(ring, marker);
    this.addLevelTag(g, `L${objective.level || 1}`, 1.4);
    return g;
  }

  buildObjectiveGuardian(objective) {
    if (objective.guardianKind === "tower" || objective.captured) {
      return this.buildNeutralTower({ type: "vision", ownerId: objective.ownerId, health: objective.health, maxHealth: objective.maxHealth, level: objective.level || 1 });
    }
    const g = new this.THREE.Group();
    const bodyColor = objective.type === "boss" ? 0x7a244f : objective.guardianKind === "charger" ? 0x8a4329 : objective.guardianKind === "hybrid" ? 0x9a7030 : 0x4b2f7a;
    const shadow = new this.THREE.Mesh(new this.THREE.TorusGeometry(0.62, 0.035, 5, 24), this.mat(0x11180f, { transparent: true, opacity: 0.5 }));
    shadow.rotation.x = Math.PI / 2;
    shadow.position.y = 0.04;
    const body = new this.THREE.Mesh(new this.THREE.BoxGeometry(0.9, 1.1, 0.66), this.mat(bodyColor));
    body.position.y = 0.72;
    const head = new this.THREE.Mesh(new this.THREE.BoxGeometry(0.58, 0.52, 0.52), this.mat(0xd0a45e));
    head.position.y = 1.45;
    const crown = new this.THREE.Mesh(new this.THREE.ConeGeometry(0.38, 0.42, 5), this.mat(objective.type === "boss" ? 0xef5d58 : 0xf0c85d));
    crown.position.y = 1.93;
    const weapon = new this.THREE.Mesh(new this.THREE.CylinderGeometry(0.045, 0.045, 1.25, 6), this.mat(0xf0c85d));
    weapon.rotation.z = -0.38;
    weapon.position.set(0.56, 0.94, 0);
    g.add(shadow, body, head, crown, weapon);
    this.addHpBar(g, 2.18);
    this.addLevelTag(g, `L${objective.level || 1}`, 2.5);
    return g;
  }

  buildVillage(village) {
    const g = new this.THREE.Group();
    const count = Math.max(3, Math.min(5, village.propCount || 4));
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const radius = 0.55 + (index % 2) * 0.34;
      const hut = new this.THREE.Group();
      const body = new this.THREE.Mesh(new this.THREE.BoxGeometry(0.66, 0.48, 0.56), this.mat(0x6f5433));
      body.position.y = 0.24;
      const roof = new this.THREE.Mesh(new this.THREE.ConeGeometry(0.52, 0.42, 4), this.mat(PALETTE.roof));
      roof.rotation.y = Math.PI / 4;
      roof.position.y = 0.72;
      hut.add(body, roof);
      hut.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      hut.rotation.y = angle;
      g.add(hut);
    }
    return g;
  }

  buildChest() {
    const g = new this.THREE.Group();
    const body = new this.THREE.Mesh(new this.THREE.BoxGeometry(0.58, 0.32, 0.42), this.mat(0x9a7030));
    body.position.y = 0.16;
    const band = new this.THREE.Mesh(new this.THREE.BoxGeometry(0.62, 0.08, 0.46), this.mat(PALETTE.gold));
    band.position.y = 0.34;
    g.add(body, band);
    return g;
  }

  buildLoot() {
    const g = new this.THREE.Group();
    const gem = new this.THREE.Mesh(new this.THREE.IcosahedronGeometry(0.22, 0), this.mat(0xb997f4, { basic: true }));
    gem.position.y = 0.24;
    g.add(gem);
    return g;
  }

  addHpBar(group, y) {
    const bar = new this.THREE.Group();
    const back = new this.THREE.Mesh(new this.THREE.BoxGeometry(1.1, 0.09, 0.03), this.mat(PALETTE.hpBack));
    const fill = new this.THREE.Mesh(new this.THREE.BoxGeometry(1.05, 0.07, 0.04), this.mat(0x33dd55));
    const shield = new this.THREE.Mesh(new this.THREE.BoxGeometry(1.05, 0.04, 0.045), this.mat(PALETTE.shield));
    fill.position.z = 0.01;
    shield.position.set(0, 0.08, 0.012);
    shield.visible = false;
    bar.position.y = y;
    bar.add(back, fill, shield);
    group.add(bar);
    group.userData.hpBar = bar;
    group.userData.hpFill = fill;
    group.userData.shieldFill = shield;
  }

  addNameTag(group, text, y) {
    const tag = this.makeLabelSprite(text, "#fff8e8");
    tag.position.y = y;
    tag.scale.set(1.95, 0.52, 1);
    group.add(tag);
    group.userData.nameTag = tag;
  }

  addLevelTag(group, text, y = 1.6) {
    const tag = this.makeLabelSprite(text, "#72d8e8");
    tag.position.y = y;
    tag.scale.set(1.5, 0.44, 1);
    group.add(tag);
    group.userData.levelTag = tag;
  }

  updateHpBar(group, ratio, shieldRatio) {
    if (group.userData.hpFill) {
      group.userData.hpFill.scale.x = Math.max(0.001, Math.min(1, ratio || 0));
      group.userData.hpFill.position.x = -0.525 * (1 - group.userData.hpFill.scale.x);
    }
    if (group.userData.shieldFill) {
      const visible = shieldRatio > 0;
      group.userData.shieldFill.visible = visible;
      if (visible) {
        group.userData.shieldFill.scale.x = Math.max(0.001, Math.min(1, shieldRatio));
        group.userData.shieldFill.position.x = -0.525 * (1 - group.userData.shieldFill.scale.x);
      }
    }
  }

  updateNameTag(group, text) {
    if (!group.userData.nameTag || group.userData.nameText === text) return;
    group.userData.nameTag.material.map?.dispose?.();
    group.userData.nameTag.material.map = this.makeLabelTexture(text, "#fff8e8");
    group.userData.nameTag.material.needsUpdate = true;
    group.userData.nameText = text;
  }

  updateLevelTag(group, text) {
    if (!group.userData.levelTag || group.userData.levelText === text) return;
    group.userData.levelTag.material.map?.dispose?.();
    group.userData.levelTag.material.map = this.makeLabelTexture(text, "#72d8e8");
    group.userData.levelTag.material.needsUpdate = true;
    group.userData.levelText = text;
  }

  syncHelperViews(game) {
    const liveIds = new Set();
    this.syncBasePreview(game, liveIds);
    this.syncWardHelpers(game, liveIds);
    this.syncAbilityPreview(game, liveIds);
    this.syncAreaEffectHelpers(game, liveIds);
    this.syncTargetHighlights(game, liveIds);
    this.syncFloatingTextHelpers(game, liveIds);
    this.syncRecallHelper(game, liveIds);
    for (const [id, view] of [...this.helperViews]) {
      if (!liveIds.has(id)) {
        this.scene.remove(view);
        disposeObject(view);
        this.helperViews.delete(id);
      }
    }
  }

  syncTargetHighlights(game, liveIds) {
    const targets = [
      { id: "selected", target: game.selectedTarget, color: 0xff3333, opacity: 0.86 },
      { id: "hover", target: game.hoverTarget, color: 0xff7b5c, opacity: 0.42 }
    ];
    for (const entry of targets) {
      const target = entry.target;
      if (!target || (entry.id === "hover" && target === game.selectedTarget) || !game.isAutoAttackTargetValid?.(target)) {
        continue;
      }
      const point = game.getTargetPoint?.(target) || target;
      const radius = (game.getTargetRadius?.(target) || target.radius || 28) * SCALE + 0.18;
      if (!game.isPointCurrentlyVisible?.(point, (target.radius || 24) + 24)) {
        continue;
      }
      const id = `target-${entry.id}`;
      liveIds.add(id);
      let view = this.helperViews.get(id);
      if (!view || view.userData.targetColor !== entry.color) {
        if (view) {
          this.scene.remove(view);
          disposeObject(view);
        }
        view = this.buildGroundRing(radius, entry.color, entry.opacity);
        view.userData.targetColor = entry.color;
        this.scene.add(view);
        this.helperViews.set(id, view);
      }
      this.setObjectPosition(view, point.x, point.y, 0.12);
      view.scale.setScalar(Math.max(0.8, radius / Math.max(0.2, view.geometry?.parameters?.radius || radius)));
      view.visible = this.isNearCamera(view.position, FAR_LOD_DISTANCE * 2);
    }
    const baseBuilding = game.hoveredBaseBuilding;
    if (baseBuilding?.alive) {
      const point = game.getTargetPoint?.(baseBuilding) || baseBuilding;
      const id = "target-base-building";
      liveIds.add(id);
      const radius = (game.getTargetRadius?.(baseBuilding) || baseBuilding.radius || 30) * SCALE + 0.28;
      let view = this.helperViews.get(id);
      if (!view) {
        view = this.buildGroundRing(radius, 0x72d8e8, 0.7);
        this.scene.add(view);
        this.helperViews.set(id, view);
      }
      this.setObjectPosition(view, point.x, point.y, 0.16);
      view.scale.setScalar(Math.max(0.95, radius / Math.max(0.2, view.geometry?.parameters?.radius || radius)));
      view.visible = this.isNearCamera(view.position, FAR_LOD_DISTANCE * 2);
    }
  }

  syncFloatingTextHelpers(game, liveIds) {
    for (const text of game.floatingTexts || []) {
      const id = `floating-${text.id}`;
      const visible = game.isPointCurrentlyVisible?.(text, 96) ?? true;
      if (!visible) {
        continue;
      }
      liveIds.add(id);
      const key = `${text.label}-${text.color}-${text.kind}`;
      let view = this.helperViews.get(id);
      if (!view || view.userData.labelKey !== key) {
        if (view) {
          this.scene.remove(view);
          disposeObject(view);
        }
        view = this.makeLabelSprite(text.label, text.color || "#fff8e8");
        view.userData.labelKey = key;
        view.renderOrder = 50;
        this.scene.add(view);
        this.helperViews.set(id, view);
      }
      const progress = 1 - Math.max(0, text.life) / Math.max(0.01, text.maxLife || 1);
      const alpha = Math.max(0, Math.min(1, text.life / Math.max(0.01, text.maxLife || 1)));
      view.material.opacity = alpha;
      view.material.depthWrite = false;
      view.material.needsUpdate = true;
      const scale = CONFIG.combat?.damageNumbers?.labelScale || 1;
      view.scale.set((text.kind === "text" ? 1.55 : 1.38) * scale, (text.kind === "text" ? 0.42 : 0.38) * scale, 1);
      this.setObjectPosition(view, text.x, text.y, 1.35 + progress * 0.55);
      view.visible = this.isNearCamera(view.position, FAR_LOD_DISTANCE * 1.6);
    }
  }

  syncRecallHelper(game, liveIds) {
    if (!game.recall?.active || !game.player?.alive) {
      return;
    }
    const id = "recall-helper";
    liveIds.add(id);
    let view = this.helperViews.get(id);
    if (!view) {
      view = new this.THREE.Group();
      view.add(this.buildGroundRing((game.player.radius + 28) * SCALE, 0x72d8e8, 0.72));
      const label = this.makeLabelSprite("RECALL", "#72d8e8");
      label.position.y = 1.25;
      view.add(label);
      this.scene.add(view);
      this.helperViews.set(id, view);
    }
    const progress = 1 - game.recall.timer / Math.max(0.01, game.recall.duration || 8);
    view.rotation.y += 0.035;
    view.scale.setScalar(0.82 + progress * 0.48);
    this.setObjectPosition(view, game.player.x, game.player.y, 0.13);
    view.visible = true;
  }

  syncBasePreview(game, liveIds) {
    if (!game.basePlacementPreviewActive || !game.canArmBasePlacementPreview?.()) {
      return;
    }
    const placement = game.isBaseClaimLocationAllowed?.(game.player) || { ok: true };
    const preview = game.base?.getLayoutPreview?.(game.player.x, game.player.y, game.selectedBaseLayoutId) || [];
    const color = placement.ok ? 0x72d8e8 : 0xe85b58;
    for (let index = 0; index < preview.length; index += 1) {
      const item = preview[index];
      const id = `preview-base-${index}`;
      const key = `${item.type}-${Math.round(item.width || 0)}-${Math.round(item.height || 0)}-${color}`;
      liveIds.add(id);
      let view = this.helperViews.get(id);
      if (!view || view.userData.previewKey !== key) {
        if (view) {
          this.scene.remove(view);
          disposeObject(view);
        }
        view = this.buildPreviewStructure(item, color);
        view.userData.previewKey = key;
        this.scene.add(view);
        this.helperViews.set(id, view);
      }
      this.setObjectPosition(view, item.x, item.y, 0.04);
      view.visible = this.isNearCamera(view.position, FAR_LOD_DISTANCE * 1.6);
    }
  }

  syncWardHelpers(game, liveIds) {
    const sites = game.wardSites || CONFIG.wardSites || [];
    for (const site of sites) {
      const ward = (game.placedWards || []).find((placedWard) => placedWard.alive && placedWard.siteId === site.id);
      const id = `ward-site-${site.id}`;
      liveIds.add(id);
      let siteView = this.helperViews.get(id);
      if (!siteView) {
        siteView = this.buildGroundRing((site.radius || 90) * SCALE, 0x72d8e8, 0.42);
        siteView.add(this.makeLabelSprite("WARD", "#72d8e8"));
        siteView.children[siteView.children.length - 1].position.y = 0.55;
        this.scene.add(siteView);
        this.helperViews.set(id, siteView);
      }
      this.setObjectPosition(siteView, site.x, site.y, 0.045);
      siteView.visible = this.isNearCamera(siteView.position, FAR_LOD_DISTANCE * 2);

      if (!ward) {
        continue;
      }
      const wardId = `ward-active-${ward.id}`;
      liveIds.add(wardId);
      let wardView = this.helperViews.get(wardId);
      if (!wardView) {
        wardView = new this.THREE.Group();
        wardView.add(this.buildGroundRing((ward.visionRadius || 520) * SCALE, 0x72d8e8, 0.2));
        const crystal = new this.THREE.Mesh(new this.THREE.IcosahedronGeometry(0.24, 0), this.helperMat(0x72d8e8, 0.92));
        crystal.position.y = 0.38;
        wardView.add(crystal);
        this.addHpBar(wardView, 0.86);
        this.scene.add(wardView);
        this.helperViews.set(wardId, wardView);
      }
      this.setObjectPosition(wardView, ward.x, ward.y, 0.04);
      wardView.visible = this.isNearCamera(wardView.position, FAR_LOD_DISTANCE * 2.8);
      this.updateHpBar(wardView, ward.healthRatio || 1, 0);
    }
  }

  syncAbilityPreview(game, liveIds) {
    const abilityId = game.queuedAbilityId;
    const ability = abilityId ? game.player?.abilityBook?.abilities?.[abilityId] : null;
    if (!ability || !game.player?.alive) {
      return;
    }
    const aim = normalize2(game.input.mouseWorld.x - game.player.x, game.input.mouseWorld.y - game.player.y);
    const target = clampPointToRange3(game.player, game.input.mouseWorld, ability.range);
    const color = ability.ready ? cssToHex(ability.config.color || "#72d8e8") : 0xb9c5af;
    const id = "ability-preview";
    const type = ability.config.type || "projectile";
    const key = `${type}-${color}`;
    liveIds.add(id);
    let view = this.helperViews.get(id);
    if (!view || view.userData.previewKey !== key) {
      if (view) {
        this.scene.remove(view);
        disposeObject(view);
      }
      view = this.buildAbilityPreview(type, color);
      view.userData.previewKey = key;
      this.scene.add(view);
      this.helperViews.set(id, view);
    }
    if (type === "flameWall") {
      const side = { x: -aim.y, y: aim.x };
      const length = (ability.config.wallLength || 360) + Math.max(0, ability.level - 1) * 28;
      const width = (ability.config.wallWidth || 52) + Math.max(0, ability.level - 1) * 4;
      this.setObjectPosition(view, target.x, target.y, 0.075);
      view.rotation.y = rotationForWorldVector(side.x, side.y);
      view.scale.set(Math.max(0.4, length * SCALE), 1, Math.max(0.12, width * SCALE));
    } else if (type === "area" || type === "meteor" || type === "repairField" || type === "turret" || type === "summon") {
      this.setObjectPosition(view, target.x, target.y, 0.075);
      const radius = (ability.effectRadius || ability.config.radius || 130) * SCALE;
      view.scale.set(radius, radius, radius);
    } else if (type === "selfArea" || type === "selfBuff" || type === "stealth" || type === "overclock") {
      this.setObjectPosition(view, game.player.x, game.player.y, 0.075);
      const radius = (ability.effectRadius || ability.config.radius || 140) * SCALE;
      view.scale.set(radius, radius, radius);
    } else {
      const length = ability.range * SCALE;
      const midpoint = {
        x: game.player.x + aim.x * ability.range * 0.5,
        y: game.player.y + aim.y * ability.range * 0.5
      };
      this.setObjectPosition(view, midpoint.x, midpoint.y, 0.09);
      view.rotation.y = rotationForWorldVector(aim.x, aim.y);
      view.scale.set(Math.max(0.4, length), 1, 1);
    }
    view.visible = this.isNearCamera(view.position, FAR_LOD_DISTANCE * 2.5);
  }

  syncAreaEffectHelpers(game, liveIds) {
    for (let index = 0; index < (game.areaEffects || []).length; index += 1) {
      const effect = game.areaEffects[index];
      const id = `area-effect-${index}`;
      const color = cssToHex(effect.color || "#f0c85d");
      const key = `${effect.shape || "circle"}-${color}`;
      liveIds.add(id);
      let view = this.helperViews.get(id);
      if (!view || view.userData.previewKey !== key) {
        if (view) {
          this.scene.remove(view);
          disposeObject(view);
        }
        view = this.buildAreaEffectView(effect, color);
        view.userData.previewKey = key;
        this.scene.add(view);
        this.helperViews.set(id, view);
      }
      const alpha = Math.max(0.12, 1 - (effect.elapsed || 0) / Math.max(0.01, effect.duration || 1));
      setObjectOpacity(view, 0.18 + alpha * 0.34);
      if (effect.shape === "wall") {
        const x = (effect.x1 + effect.x2) * 0.5;
        const y = (effect.y1 + effect.y2) * 0.5;
        const length = Math.hypot(effect.x2 - effect.x1, effect.y2 - effect.y1) * SCALE;
        this.setObjectPosition(view, x, y, 0.07);
        view.rotation.y = rotationForWorldVector(effect.x2 - effect.x1, effect.y2 - effect.y1);
        view.scale.set(Math.max(0.4, length), 1, Math.max(0.12, (effect.width || 52) * SCALE));
      } else {
        this.setObjectPosition(view, effect.x, effect.y, 0.07);
        const radius = (effect.radius || 120) * SCALE;
        view.scale.set(radius, radius, radius);
      }
      view.visible = this.isNearCamera(view.position, FAR_LOD_DISTANCE * 2.2);
    }
  }

  buildPreviewStructure(item, color) {
    const g = new this.THREE.Group();
    const material = this.helperMat(color, 0.36);
    if (item.type === "wall") {
      g.add(this.buildWallSegment(item.width || 72, item.height || 72, material));
    } else if (item.type === "core") {
      const base = new this.THREE.Mesh(new this.THREE.BoxGeometry(1.9, 0.3, 1.9), material);
      base.position.y = 0.15;
      const tower = new this.THREE.Mesh(new this.THREE.BoxGeometry(1.0, 1.1, 1.0), material);
      tower.position.y = 0.82;
      g.add(base, tower);
    } else if (item.type === "generator") {
      const body = new this.THREE.Mesh(new this.THREE.CylinderGeometry(0.5, 0.6, 0.58, 6), material);
      body.position.y = 0.29;
      g.add(body);
    } else {
      const body = new this.THREE.Mesh(new this.THREE.CylinderGeometry(0.42, 0.5, 0.92, 8), material);
      body.position.y = 0.46;
      g.add(body);
    }
    return g;
  }

  buildGroundRing(radius, color, opacity) {
    const ring = new this.THREE.Mesh(new this.THREE.TorusGeometry(Math.max(0.2, radius), 0.035, 5, 52), this.helperMat(color, opacity));
    ring.rotation.x = Math.PI / 2;
    return ring;
  }

  buildAbilityPreview(type, color) {
    if (type === "flameWall") {
      return new this.THREE.Mesh(new this.THREE.BoxGeometry(1, 0.035, 1), this.helperMat(color, 0.46));
    }
    if (type === "area" || type === "meteor" || type === "repairField" || type === "turret" || type === "summon" || type === "selfArea" || type === "selfBuff" || type === "stealth" || type === "overclock") {
      const disk = new this.THREE.Mesh(new this.THREE.CylinderGeometry(1, 1, 0.035, 32), this.helperMat(color, 0.24));
      disk.userData.noOpacityOverride = false;
      return disk;
    }
    return new this.THREE.Mesh(new this.THREE.BoxGeometry(1, 0.035, 0.16), this.helperMat(color, 0.5));
  }

  buildAreaEffectView(effect, color) {
    if (effect.shape === "wall") {
      return new this.THREE.Mesh(new this.THREE.BoxGeometry(1, 0.035, 1), this.helperMat(color, 0.42));
    }
    return new this.THREE.Mesh(new this.THREE.CylinderGeometry(1, 1, 0.035, 32), this.helperMat(color, 0.3));
  }

  helperMat(color, opacity = 0.4) {
    const material = new this.THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: false
    });
    material.userData.helperMaterial = true;
    return material;
  }

  makeLabelSprite(text, color) {
    const texture = this.makeLabelTexture(text, color);
    const sprite = new this.THREE.Sprite(new this.THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
    sprite.scale.set(1.45, 0.38, 1);
    return sprite;
  }

  makeLabelTexture(text, color) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(20,14,4,0.72)";
    roundRect(ctx, 8, 10, 240, 42, 7);
    ctx.fill();
    ctx.strokeStyle = "rgba(92,74,30,0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(0,0,0,0.62)";
    ctx.lineWidth = 4;
    ctx.font = "950 24px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeText(text, 128, 32);
    ctx.fillText(text, 128, 32);
    const texture = new this.THREE.CanvasTexture(canvas);
    texture.minFilter = this.THREE.NearestFilter;
    texture.magFilter = this.THREE.NearestFilter;
    return texture;
  }

  createMeshPool(count, geometry, material) {
    const items = [];
    for (let index = 0; index < count; index += 1) {
      const mesh = new this.THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.userData.pooled = true;
      items.push(mesh);
    }
    return { items, freeList: [...items], group: null };
  }
}

export class SpatialHash {
  constructor(cellSize = 8) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  clear() {
    this.cells.clear();
  }

  key(x, z) {
    return `${Math.floor(x / this.cellSize)}_${Math.floor(z / this.cellSize)}`;
  }

  insert(id, x, z, value) {
    const key = this.key(x, z);
    if (!this.cells.has(key)) this.cells.set(key, new Map());
    this.cells.get(key).set(id, value);
  }

  query(x, z, radiusCells = 1) {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    const results = [];
    for (let dz = -radiusCells; dz <= radiusCells; dz += 1) {
      for (let dx = -radiusCells; dx <= radiusCells; dx += 1) {
        const cell = this.cells.get(`${cx + dx}_${cz + dz}`);
        if (cell) results.push(...cell.values());
      }
    }
    return results;
  }
}

function pushQuad(positions, normals, colors, color, a, b, c, d) {
  // Keep the terrain front faces pointed upward so Three.js back-face culling
  // does not hide the chunk meshes from the top-down camera.
  const verts = [a, c, b, a, d, c];
  for (const v of verts) {
    positions.push(v[0], v[1], v[2]);
    normals.push(0, 1, 0);
    colors.push(color.r, color.g, color.b);
  }
}

function setInstancedTransform(dummy, mesh, index, basePosition, scale, rotationY, yOffset) {
  dummy.position.set(basePosition.x, basePosition.y + yOffset, basePosition.z);
  dummy.rotation.set(0, rotationY, 0);
  dummy.scale.set(scale[0], scale[1], scale[2]);
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
}

function distanceToPolyline(point, polyline) {
  let best = Infinity;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    best = Math.min(best, closestDistance(point, polyline[index], polyline[index + 1]));
  }
  return best;
}

function closestDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  const x = a.x + dx * t;
  const y = a.y + dy * t;
  return Math.hypot(point.x - x, point.y - y);
}

function seededRandom(seed) {
  let state = seed || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function clampWorldX(x) {
  return Math.max(320, Math.min(CONFIG.world.width - 320, x));
}

function clampWorldY(y) {
  return Math.max(320, Math.min(CONFIG.world.height - 320, y));
}

function isWaterish(map, x, y) {
  return map?.riverDistance?.({ x, y }) < 220;
}

function isBaseFootprintBlocked(game, x, y) {
  const bounds = game.base?.getWallBounds?.();
  const origin = game.base?.origin || game.base?.core;
  if (!bounds || !origin) {
    return false;
  }
  const padding = (CONFIG.mapGeneration?.propClearRadius || 620) * 0.32;
  return x >= origin.x - bounds.x - padding && x <= origin.x + bounds.x + padding && y >= origin.y - bounds.y - padding && y <= origin.y + bounds.y + padding;
}

function normalize2(x, y) {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function clampWorld(value, max) {
  return Math.max(0, Math.min(max, value));
}

function clampPointToRange3(origin, target, range) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length <= range) {
    return { x: target.x, y: target.y };
  }
  const normalized = normalize2(dx, dy);
  return {
    x: origin.x + normalized.x * range,
    y: origin.y + normalized.y * range
  };
}

function rotationForWorldVector(dx, dy) {
  return Math.atan2(-dy, dx);
}

function setObjectOpacity(object, opacity) {
  object.traverse?.((child) => {
    const material = child.material;
    if (!material) return;
    if (Array.isArray(material)) {
      for (const entry of material) {
        if (entry?.userData?.helperMaterial) entry.opacity = opacity;
      }
    } else if (material.userData?.helperMaterial) {
      material.opacity = opacity;
    }
  });
}

function cssToHex(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0xffffff;
  if (value.startsWith("#")) {
    return Number.parseInt(value.slice(1), 16);
  }
  return 0xffffff;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function disposeObject(object) {
  object.traverse?.((child) => {
    if (child.geometry && !child.userData?.pooled) child.geometry.dispose?.();
    if (child.material && !child.material?.userData?.sharedMaterial) {
      if (Array.isArray(child.material)) {
        for (const material of child.material) material.dispose?.();
      } else {
        child.material.dispose?.();
      }
    }
  });
}




