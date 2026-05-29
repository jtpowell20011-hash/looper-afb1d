export type MovementMode = "wasd" | "click-to-move";
export type AllianceState = "solo" | "temporary_alliance" | "shared_victory_vote" | "broken";
export type FutureHeroArchetype = "warrior" | "ranger" | "mage" | "engineer";

export interface NetworkPlayerSnapshot {
  playerId: string;
  heroClassId: string;
  x: number;
  y: number;
  health: number;
  level: number;
  baseCoreId: string | null;
  allianceId: string | null;
}

export interface DamageContribution {
  sourceId: string;
  sourceKind: "player" | "mob" | "tower";
  damage: number;
}

export interface PlayerKillRewardEvent {
  victimPlayerId: string;
  xp: number;
  gold: number;
  resources: number;
  contributors: DamageContribution[];
}

export interface TemporaryAlliance {
  allianceId: string;
  memberPlayerIds: string[];
  state: AllianceState;
  createdAtMatchSeconds: number;
  sharedVictoryVotes: Record<string, boolean>;
}

export interface HeroClassDefinition {
  id: string;
  archetype: FutureHeroArchetype;
  label: string;
  baseHealth: number;
  moveSpeed: number;
  abilityIds: string[];
  buildCostMultiplier?: number;
  visionMultiplier?: number;
}

// TODO multiplayer:
// Server authority should own player kill reward distribution. In a 1v1,
// the winner receives 100% of the XP/currency reward. In group fights,
// rewards are split by damage contribution instead of last hit.
