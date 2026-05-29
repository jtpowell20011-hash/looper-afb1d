// @ts-check
export const FutureMultiplayerContracts = Object.freeze({
  maxPlayers: 8,
  rewardModel: "damage-contribution",
  movementModes: ["wasd", "click-to-move"],
  allianceModel: "temporary-breakable",
  netcodeNote:
    "Version 1 is single-player. Keep simulation state deterministic where practical so later server authority can validate movement, combat, building placement, and rewards."
});

/**
 * @typedef {"solo" | "temporary_alliance" | "shared_victory_vote" | "broken"} AllianceState
 * @typedef {"warrior" | "ranger" | "mage" | "engineer"} FutureHeroArchetype
 * @typedef {{ sourceId: string, sourceKind: "player" | "mob" | "tower", damage: number }} DamageContribution
 * @typedef {{ victimPlayerId: string, xp: number, gold: number, resources: number, contributors: DamageContribution[] }} PlayerKillRewardEvent
 *
 * TODO multiplayer:
 * - Move combat authority to a server-side simulation tick.
 * - Award player kills by damage contribution, not last hit.
 * - In 1v1 fights the winner receives 100% of player kill rewards.
 * - In multi-player fights XP/currency are split by damage share.
 * - Let temporary alliances share vision/objective state until broken.
 * - When allied players are last alive, run a shared victory vote; rejection breaks the alliance.
 */







