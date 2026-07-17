// @ts-check
import { CONFIG } from "./config.js?v=1.8.65";

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

  // Non-host clients only smoothly count the timer down for display between
  // authoritative updates from the host; they never decide phase transitions.
  tickDisplay(dt) {
    if (this.matchWon || this.matchLost) {
      return null;
    }
    this.timeRemaining = Math.max(0, this.timeRemaining - dt);
    return null;
  }

  // Adopt the host's authoritative phase/time. The host is the single source of
  // truth for match phase and timers; clients display what it sends.
  applyAuthoritativeState(state = {}) {
    if (!state || typeof state.phaseIndex !== "number") {
      return null;
    }
    const clamped = Math.max(0, Math.min(this.phases.length - 1, Math.floor(state.phaseIndex)));
    const changed = clamped !== this.phaseIndex;
    this.phaseIndex = clamped;
    if (Number.isFinite(state.timeRemaining)) {
      this.timeRemaining = Math.max(0, state.timeRemaining);
    }
    this.totalElapsed =
      this.phases.slice(0, this.phaseIndex).reduce((sum, phase) => sum + phase.duration, 0) +
      Math.max(0, (this.currentPhase?.duration || 0) - this.timeRemaining);
    if (state.matchWon) {
      this.matchWon = true;
    }
    return changed ? "phase_changed" : null;
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










