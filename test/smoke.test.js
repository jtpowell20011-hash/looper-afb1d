"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
  "index.html",
  "styles.css",
  "src/main.js",
  "src/game/GameScene.js",
  "src/game/Player.js",
  "src/game/Ability.js",
  "src/game/Mob.js",
  "src/game/Base.js",
  "src/game/Objective.js",
  "src/game/MatchManager.js",
  "src/game/RewardSystem.js",
  "src/game/FutureMultiplayerInterfaces.js"
];

for (const file of requiredFiles) {
  assert.equal(fs.existsSync(path.join(root, file)), true, `${file} should exist`);
}

const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.match(indexHtml, /Basebound/);
assert.match(indexHtml, /src\/main\.js/);

const sceneSource = fs.readFileSync(path.join(root, "src/game/GameScene.js"), "utf8");
assert.match(sceneSource, /placeBaseAtPlayer/);
assert.match(sceneSource, /debugAdvancePhase/);
assert.match(sceneSource, /spawnAreaEffect/);

console.log("ok - Basebound smoke files are present");
