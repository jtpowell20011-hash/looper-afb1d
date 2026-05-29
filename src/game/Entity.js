// @ts-check
let nextEntityId = 1;

export class Entity {
  constructor({ id, x, y, radius, maxHealth, team = "neutral" }) {
    this.id = id || `entity-${nextEntityId++}`;
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.maxHealth = maxHealth;
    this.health = maxHealth;
    this.team = team;
    this.alive = true;
  }

  get healthRatio() {
    if (this.maxHealth <= 0) {
      return 0;
    }
    return Math.max(0, this.health / this.maxHealth);
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
    }
    return applied;
  }

  heal(amount) {
    if (!this.alive) {
      return;
    }
    this.health = Math.min(this.maxHealth, this.health + Math.max(0, amount));
  }
}







