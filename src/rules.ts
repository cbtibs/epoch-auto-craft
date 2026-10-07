import type { RuleConfig } from "./types";

/**
 * Season 5 (Rage of the Frostborn, patch 1.5.1.1 as of 3 Oct 2026).
 * Shard ranges: player-documented forge tooltips, consistent with Maxroll's
 * March 2026 example that tier 3 → tier 4 costs 1–18.
 * Hope: official support article, 25%.
 * Critical success rate: 12% from a Season 4 community guide. EHG has not
 * published it, and the 1.5 notes do not say it changed.
 * Seal chances: Tunklab datamine. Tunk said in June 2025 the formula was unchanged.
 * Removal 1–25 and Havoc/Redemption 1–20: player-documented, not patch notes.
 * Forging Potential is community-reported as the lower of two rolls.
 * Ice and Blood rates are not published.
 */

const SEAL_STEP = { 1: 1050, 2: 690, 3: 345, 4: 150 } as const;

export function sealChance(tier: number, unsealedCount: number, exalted: boolean): number {
  const step = SEAL_STEP[tier as 1 | 2 | 3 | 4];
  if (!step || unsealedCount < 1) return 0;
  const raritySteps = exalted ? 3 : 1;
  const percent = (step * (4 + raritySteps + (unsealedCount - 1))) / 100;
  return Math.min(1, percent / 100);
}

export function expectedRoll(max: number, lucky: boolean): number {
  if (max <= 0) return 0;
  if (!lucky) return (max + 1) / 2;
  let sum = 0;
  for (let k = 1; k <= max; k += 1) {
    const survive = (max - k + 1) / max;
    sum += survive * survive;
  }
  return sum;
}

export function rollForgingPotential(max: number, lucky: boolean, rng: () => number): number {
  const once = () => 1 + Math.floor(rng() * max);
  if (!lucky) return once();
  return Math.min(once(), once());
}

export function upgradeCost(nextTier: number, rules: RuleConfig): number {
  return rules.upgradeMax[nextTier] ?? rules.addMax;
}

export function freeCraftChance(
  rules: RuleConfig,
  hope: boolean,
  crit: boolean,
  ice: boolean,
): number {
  const critChance = crit ? rules.critChance : 0;
  const hopeChance = hope ? rules.hopeChance : 0;
  const iceChance = ice ? rules.icePreserveChance : 0;
  return 1 - (1 - critChance) * (1 - hopeChance) * (1 - iceChance);
}
