// @ts-check
import { CONFIG } from "./config.js?v=1.8.51";

export class MatchManager {
  constructor() {
    this.phases = CONFIG.phases;
    this.phaseIndex = 0;
    this.timeRemaining = this.phases[0].duration;
    this.totalElapsed = 0;
    this.matchWon = false;
    this.matchLost = false;
  }

  get currentPhase() {
    return this.phases[this.phaseIndex];
  }

  get currentPhaseId() {
    return this.currentPhase.id;
  }

  get canPlaceBase() {
    return Boolean(this.currentPhase.canPlaceBase);
  }

  get isFinalPhaseComplete() {
    return this.phaseIndex >= this.phases.length - 1 && this.timeRemaining <= 0;
  }

  update(dt) {
    if (this.matchWon || this.matchLost) {
      return null;
    }

    this.totalElapsed += dt;
    this.timeRemaining -= dt;
    if (this.timeRemaining > 0) {
      return null;
    }

    if (this.phaseIndex >= this.phases.length - 1) {
      this.matchWon = true;
      this.timeRemaining = 0;
      return "match_complete";
    }

    this.phaseIndex += 1;
    this.timeRemaining = this.currentPhase.duration;
    return "phase_changed";
  }

  advancePhase() {
    if (this.phaseIndex >= this.phases.length - 1) {
      this.matchWon = true;
      this.timeRemaining = 0;
      return "match_complete";
    }
    this.phaseIndex += 1;
    this.timeRemaining = this.currentPhase.duration;
    this.totalElapsed = this.phases.slice(0, this.phaseIndex).reduce((sum, phase) => sum + phase.duration, 0);
    return "phase_changed";
  }
}










