export const SLOTS = [
  { id: "helmet", label: "Helmet" },
  { id: "body", label: "Body armour" },
  { id: "gloves", label: "Gloves" },
  { id: "boots", label: "Boots" },
  { id: "belt", label: "Belt" },
  { id: "ring", label: "Ring" },
  { id: "amulet", label: "Amulet" },
  { id: "relic", label: "Relic" },
  { id: "one-hand", label: "One-handed weapon" },
  { id: "two-hand", label: "Two-handed weapon" },
  { id: "bow", label: "Bow" },
  { id: "catalyst", label: "Catalyst" },
  { id: "shield", label: "Shield" },
  { id: "quiver", label: "Quiver" },
] as const;

export type SlotId = (typeof SLOTS)[number]["id"];

export const CLASSES = [
  { id: "none", label: "No class requirement" },
  { id: "sentinel", label: "Sentinel" },
  { id: "mage", label: "Mage" },
  { id: "primalist", label: "Primalist" },
  { id: "acolyte", label: "Acolyte" },
  { id: "rogue", label: "Rogue" },
] as const;

export type ItemClass = (typeof CLASSES)[number]["id"];
export type ClassSpec = Exclude<ItemClass, "none">;
export type AffixGroup = "prefix" | "suffix";
export type FpType = "standard" | "ice" | "blood";

export type AffixDef = {
  id: string;
  name: string;
  group: AffixGroup;
  slots: SlotId[];
  class?: ClassSpec;
};

export type AffixState = {
  id: string;
  tier: number;
  sealed: boolean;
};

export type GoalAffix = {
  id: string;
  minTier: number;
  sealed: boolean;
  any?: boolean;
};

export type ItemState = {
  fp: number;
  affixes: AffixState[];
};

export type Goal = {
  affixes: GoalAffix[];
  exact: boolean;
  minFp: number;
};

export type RuleConfig = {
  critChance: number;
  hopeChance: number;
  icePreserveChance: number;
  bloodCritBonus: number;
  luckyFpRoll: boolean;
  extraChaosOutcomes: number;
  addMax: number;
  upgradeMax: Record<number, number>;
  removalMax: number;
  havocMax: number;
  redemptionMax: number;
};

export const DEFAULT_RULES: RuleConfig = {
  critChance: 0.12,
  hopeChance: 0.25,
  icePreserveChance: 0,
  bloodCritBonus: 0,
  luckyFpRoll: true,
  extraChaosOutcomes: 25,
  addMax: 18,
  upgradeMax: { 2: 10, 3: 12, 4: 18, 5: 24 },
  removalMax: 25,
  havocMax: 20,
  redemptionMax: 20,
};

export type Action =
  | { type: "add"; id: string }
  | { type: "upgrade"; id: string }
  | { type: "seal"; id: string }
  | { type: "chaos"; id: string }
  | { type: "removal" }
  | { type: "havoc" }
  | { type: "redemption" };

export type AddTiming = "early" | "late" | "cheapest";
export type SealTiming = "asap" | "fill-first";
export type JunkPlan = "seal" | "chaos" | "removal" | "redemption";
export type BlockTiming = "before-fill" | "after-havoc";

export type Style = {
  id: string;
  name: string;
  blurb: string;
  addTiming: AddTiming;
  sealTiming: SealTiming;
  junk: JunkPlan;
  blockTiming?: BlockTiming;
};

export type PlanStep = {
  title: string;
  detail: string;
  odds: string | null;
  action: Action;
};

export type PlanResult = {
  verdict: "guaranteed" | "likely" | "risky" | "unlikely" | "impossible";
  headline: string;
  summary: string;
  successChance: number;
  guaranteed: boolean;
  steps: PlanStep[];
  strategyName: string;
  strategyBlurb: string;
  materials: string[];
  typicalSpend: number | null;
  guaranteeFp: number | null;
  medianFp: number | null;
  failureReasons: { reason: string; share: number }[];
  alternatives: { name: string; chance: number }[];
  clears: { tool: string; chance: number; when: string; roll: string | null }[];
  blockers: string[];
  notes: string[];
};
