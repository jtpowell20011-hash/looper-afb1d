// @ts-check
import { CONFIG } from "./config.js?v=1.8.64";
import { distance } from "./math.js?v=1.8.64";
import { DamageTracker } from "./RewardSystem.js?v=1.8.64";

export class Objective {
  constructor(config) {
    this.id = config.id;
    this.type = config.type;
    this.label = config.label;
    this.x = config.x;
    this.y = config.y;
    this.radius = config.radius;
    this.captureSeconds = config.captureSeconds;
    this.reward = config.reward;
    this.guardianKind = config.guardianKind || (config.type === "boss" ? "boss" : "tower");
    this.neutralGuardianKind = this.guardianKind;
    this.baseMaxHealth = config.guardianHealth || (config.type === "boss" ? 720 : 220);
    this.baseDamage = config.guardianDamage || (this.type === "mine" ? 16 : this.guardianKind === "melee" ? 18 : 13);
    this.maxHealth = this.baseMaxHealth;
    this.health = this.maxHealth;
    this.alive = this.type === "boss" ? false : true;
    this.attackTimer = 1.2;
    this.damageTracker = new DamageTracker();
    this.progress = 0;
    this.captured = false;
    this.captureReady = false;
    this.ownerId = null;
    this.active = true;
    this.pulse = Math.random() * 10;
    this.scaleLevel = 1;
    this.damageScale = 1;
    this.guardianX = this.x;
    this.guardianY = this.y;
    this.guardianPhase = Math.random() * Math.PI * 2;
    this.guardianBounds = config.guardianBounds || {
      x: this.x - this.radius * 2.2,
      y: this.y - this.radius * 2.2,
      w: this.radius * 4.4,
      h: this.radius * 4.4
    };
  }

  get healthRatio() {
    return Math.max(0, this.health / Math.max(1, this.maxHealth));
  }

  get progressRatio() {
    if (this.captureSeconds <= 0) {
      return this.captured ? 1 : 0;
    }
    return Math.min(1, this.progress / this.captureSeconds);
  }

  update(dt, scene) {
    this.pulse += dt;
    if (!this.active || this.type === "boss") {
      return;
    }
    this.scaleToWorldLevel(scene.getAveragePlayerLevel?.() || scene.player.level);

    if (this.captured) {
      if (this.alive) {
        this.updateGuardian(dt, scene);
      }
      return;
    }

    if (this.alive) {
      this.updateGuardian(dt, scene);
      return;
    }

    const contestants = scene.getObjectiveContestants?.(this) || [];
    const contestant = contestants[0] || null;
    if (contestant) {
      if (this.captureOwnerId && this.captureOwnerId !== contestant.player.id) {
        this.progress = 0;
      }
      this.captureOwnerId = contestant.player.id;
      this.progress += dt;
      if (this.progress >= this.captureSeconds) {
        scene.onObjectiveCaptured(this, contestant.player);
      }
    } else {
      this.progress = Math.max(0, this.progress - dt * 0.65);
      if (this.progress <= 0) {
        this.captureOwnerId = null;
      }
    }
  }

  updateGuardian(dt, scene) {
    const target = scene.getObjectiveAttackTarget?.(this) || null;
    if (!target || scene.isPlayerInSafeZone()) {
      this.returnGuardianHome(dt, scene);
      return;
    }
    this.updateGuardianMovement(dt, target);
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    const guardianPoint = this.guardianPoint;
    const meleeKind = this.guardianKind === "melee" || this.guardianKind === "hybrid" || this.guardianKind === "charger";
    if (meleeKind) {
      const meleeRange = this.guardianKind === "charger" ? 102 : 86;
      if (distance(guardianPoint, target) <= meleeRange && this.attackTimer <= 0) {
        this.attackTimer = this.guardianKind === "hybrid" ? 0.72 : this.guardianKind === "charger" ? 0.88 : 1.35;
        const meleeDamage =
          this.guardianKind === "hybrid" ? 0.48 : this.guardianKind === "charger" ? 0.82 : 1;
        scene.applyDamage(target, Math.round(this.guardianDamage * meleeDamage), {
          sourceId: this.id,
          sourceOwnerId: this.ownerId,
          sourceKind: "objective"
        });
        scene.addFloatingText(
          target.x,
          target.y - 34,
          this.guardianKind === "hybrid" ? "Shrine slash" : this.guardianKind === "charger" ? "Beast rush" : "Relic strike",
          "#b391f0"
        );
        return;
      }
      if (this.guardianKind === "melee" || this.guardianKind === "charger") {
        return;
      }
    }
    if (this.attackTimer <= 0) {
      this.attackTimer = this.guardianKind === "hybrid" ? 0.92 : this.guardianKind === "volley" ? 1.45 : this.type === "mine" ? 0.95 : 1.35;
      const dx = target.x - guardianPoint.x;
      const dy = target.y - guardianPoint.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const spreadAngles = this.guardianKind === "hybrid" ? [-0.18, 0, 0.18] : this.guardianKind === "volley" ? [-0.36, -0.18, 0, 0.18, 0.36] : [0];
      for (const angle of spreadAngles) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const dirX = dx / length;
        const dirY = dy / length;
        const volley = this.guardianKind === "volley";
        scene.spawnProjectile({
          x: guardianPoint.x,
          y: guardianPoint.y,
          vx: (dirX * cos - dirY * sin) * (this.guardianKind === "hybrid" ? 530 : volley ? 560 : 480),
          vy: (dirX * sin + dirY * cos) * (this.guardianKind === "hybrid" ? 530 : volley ? 560 : 480),
          radius: volley ? 8 : 7,
          range: this.guardianKind === "hybrid" ? 680 : volley ? 760 : 620,
          damage: Math.round(this.guardianDamage * (this.guardianKind === "hybrid" ? 0.62 : volley ? 0.72 : 1)),
          color: this.guardianKind === "hybrid" ? "#f0c85d" : volley ? "#ff8a5a" : this.type === "relic" ? "#b391f0" : "#e7bd58",
          pierce: false,
          sourceId: this.id,
          sourceOwnerId: this.ownerId,
          sourceKind: "objective",
          team: "hostile"
        });
      }
    }
  }

  returnGuardianHome(dt, scene) {
    if (this.captured || this.guardianKind === "tower") {
      this.guardianX = this.x;
      this.guardianY = this.y;
      return;
    }
    const rules = CONFIG.objectiveRules?.leash || {};
    const dx = this.x - this.guardianX;
    const dy = this.y - this.guardianY;
    const length = Math.max(1, Math.hypot(dx, dy));
    const step = Math.min((rules.returnSpeed || 300) * dt, length);
    this.guardianX += (dx / length) * step;
    this.guardianY += (dy / length) * step;
    this.combatTimer = Math.max(0, (this.combatTimer || 0) - dt);
    // Suppress disengage-healing while recently damaged so an objective boss does
    // not "heal back up" between a player's hits.
    if (this.health < this.maxHealth && (this.combatTimer || 0) <= 0) {
      this.health = Math.min(this.maxHealth, this.health + this.maxHealth * (rules.healingPercentPerSecond || 0.08) * dt);
    }
    if (length <= (rules.resetDistance || 42) && rules.fullResetAtHome) {
      this.health = this.maxHealth;
    }
    if (scene?.addFloatingText && this.health < this.maxHealth && Math.random() < dt * 0.18) {
      scene.addFloatingText(this.guardianX, this.guardianY - 44, "Disengaging", "#b9c5af");
    }
  }

  updateGuardianMovement(dt, target) {
    if (this.captured || this.guardianKind === "tower") {
      this.guardianX = this.x;
      this.guardianY = this.y;
      return;
    }
    const leashRules = CONFIG.objectiveRules?.leash || {};
    const moveScale = leashRules.guardianMoveSpeedScale || 1;
    const orbitScale = leashRules.guardianOrbitSpeedScale || 1;
    if (this.guardianKind === "volley") {
      this.guardianPhase += dt * 1.05 * orbitScale;
      const bounds = this.guardianBounds;
      const guardian = this.guardianPoint;
      const targetDistance = distance(guardian, target);
      const anchorToTarget = Math.max(1, targetDistance);
      const followDistance = targetDistance > 260 ? 190 : 245;
      const goal = {
        x: target.x - ((target.x - guardian.x) / anchorToTarget) * followDistance + Math.cos(this.guardianPhase) * 74,
        y: target.y - ((target.y - guardian.y) / anchorToTarget) * followDistance + Math.sin(this.guardianPhase * 1.2) * 58
      };
      goal.x = Math.max(bounds.x, Math.min(bounds.x + bounds.w, goal.x));
      goal.y = Math.max(bounds.y, Math.min(bounds.y + bounds.h, goal.y));
      const goalDx = goal.x - this.guardianX;
      const goalDy = goal.y - this.guardianY;
      const goalDistance = Math.max(1, Math.hypot(goalDx, goalDy));
      const speed = 205 * moveScale;
      this.guardianX += (goalDx / goalDistance) * Math.min(speed * dt, goalDistance);
      this.guardianY += (goalDy / goalDistance) * Math.min(speed * dt, goalDistance);
      this.guardianX = Math.max(bounds.x, Math.min(bounds.x + bounds.w, this.guardianX));
      this.guardianY = Math.max(bounds.y, Math.min(bounds.y + bounds.h, this.guardianY));
      return;
    }
    this.guardianPhase += dt * (this.guardianKind === "hybrid" ? 1.8 : this.guardianKind === "charger" ? 2.6 : 1.1) * orbitScale;
    const guardian = this.guardianPoint;
    const targetDistance = distance(guardian, target);
    const orbitX = Math.cos(this.guardianPhase) * (this.guardianKind === "hybrid" ? 44 : this.guardianKind === "charger" ? 18 : 20);
    const orbitY = Math.sin(this.guardianPhase) * (this.guardianKind === "hybrid" ? 44 : this.guardianKind === "charger" ? 18 : 20);
    const anchorToTarget = Math.max(1, distance(guardian, target));
    const followDistance = this.guardianKind === "hybrid" ? (targetDistance > 150 ? 86 : 132) : this.guardianKind === "charger" ? 44 : 58;
    const goal = {
      x: target.x - ((target.x - guardian.x) / anchorToTarget) * followDistance + orbitX,
      y: target.y - ((target.y - guardian.y) / anchorToTarget) * followDistance + orbitY
    };
    const bounds = this.guardianBounds;
    goal.x = Math.max(bounds.x, Math.min(bounds.x + bounds.w, goal.x));
    goal.y = Math.max(bounds.y, Math.min(bounds.y + bounds.h, goal.y));
    const goalDx = goal.x - this.guardianX;
    const goalDy = goal.y - this.guardianY;
    const goalDistance = Math.max(1, Math.hypot(goalDx, goalDy));
    const speed = (this.guardianKind === "hybrid" ? 245 : this.guardianKind === "charger" ? 320 : 185) * moveScale;
    this.guardianX += (goalDx / goalDistance) * Math.min(speed * dt, goalDistance);
    this.guardianY += (goalDy / goalDistance) * Math.min(speed * dt, goalDistance);
    this.guardianX = Math.max(bounds.x, Math.min(bounds.x + bounds.w, this.guardianX));
    this.guardianY = Math.max(bounds.y, Math.min(bounds.y + bounds.h, this.guardianY));
  }

  get guardianPoint() {
    return {
      x: this.guardianX ?? this.x,
      y: this.guardianY ?? this.y,
      radius: 24
    };
  }

  get combatPoint() {
    if (this.guardianKind === "tower" || this.captured) {
      return {
        x: this.x,
        y: this.y,
        radius: 30
      };
    }
    const point = this.guardianPoint;
    return {
      x: point.x,
      y: point.y,
      radius: this.guardianKind === "hybrid" || this.guardianKind === "volley" ? 30 : this.guardianKind === "charger" ? 34 : 26
    };
  }

  takeDamage(amount) {
    if (!this.alive) {
      return 0;
    }
    const applied = Math.min(this.health, Math.max(0, amount));
    this.health -= applied;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.wasCapturedBeforeDeath = this.captured;
      this.previousOwnerId = this.ownerId;
      if (this.captured) {
        this.captured = false;
        this.ownerId = null;
        this.guardianKind = this.neutralGuardianKind;
        this.captureOwnerId = null;
      }
      this.progress = 0;
      this.captureReady = true;
    }
    return applied;
  }

  claim(owner) {
    this.captured = true;
    this.captureReady = false;
    this.ownerId = owner.id;
    this.captureOwnerId = null;
    this.guardianKind = "tower";
    this.alive = true;
    this.progress = this.captureSeconds;
    this.guardianX = this.x;
    this.guardianY = this.y;
    this.health = this.maxHealth;
  }

  get guardianDamage() {
    return Math.round(this.baseDamage * this.damageScale);
  }

  scaleToWorldLevel(level) {
    const nextLevel = Math.max(3, Math.floor(level || 1));
    if (nextLevel === this.scaleLevel) {
      return;
    }
    const oldMax = this.maxHealth;
    this.scaleLevel = nextLevel;
    this.damageScale = 1.28 + (nextLevel - 1) * 0.17;
    this.maxHealth = Math.round(this.baseMaxHealth * 1.4 * (1 + (nextLevel - 1) * 0.26));
    if (this.alive) {
      this.health = Math.min(this.maxHealth, this.health + Math.max(0, this.maxHealth - oldMax));
    }
  }
}

export function createObjectives(map = null) {
  return CONFIG.objectives.map((objective) => new Objective(map?.createObjectiveConfig?.(objective) || objective));
}










