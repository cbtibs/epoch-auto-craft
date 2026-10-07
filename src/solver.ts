import { affixName, printedName } from "./affixes";
import { expectedRoll, freeCraftChance, rollForgingPotential, sealChance, upgradeCost } from "./rules";
import type {
  Action,
  AffixDef,
  AffixGroup,
  AffixState,
  FpType,
  Goal,
  GoalAffix,
  ItemClass,
  ItemState,
  PlanResult,
  PlanStep,
  RuleConfig,
  SlotId,
  Style,
} from "./types";

const STEP_CAP = 80;

const BASE_STYLES: Array<Omit<Style, "blockTiming">> = [
  {
    id: "seal-cheap",
    name: "Seal the spare affix",
    blurb: "Glyph of Hope on shard crafts. Always craft the cheapest tier next. If a spare affix blocks a slot, seal it.",
    addTiming: "cheapest",
    sealTiming: "asap",
    junk: "seal",
  },
  {
    id: "seal-fill",
    name: "Fill the item, then seal",
    blurb: "Add the affixes you still need before sealing, so the seal chance is higher. Then craft the cheapest tier.",
    addTiming: "cheapest",
    sealTiming: "fill-first",
    junk: "seal",
  },
  {
    id: "chaos",
    name: "Chaos the spare affix",
    blurb: "Use Glyph of Chaos to turn a spare affix into a missing one. Add missing affixes before upgrading.",
    addTiming: "early",
    sealTiming: "asap",
    junk: "chaos",
  },
  {
    id: "removal",
    name: "Strip the spare affix",
    blurb: "Rune of Removal, with Hope, when a slot is blocked. Upgrade affixes already on the item before adding new ones.",
    addTiming: "late",
    sealTiming: "asap",
    junk: "removal",
  },
  {
    id: "removal-cheap",
    name: "Cheapest crafts, remove if blocked",
    blurb: "Same Hope-and-lowest-tier plan, but Removal is the tool that opens a blocked slot.",
    addTiming: "cheapest",
    sealTiming: "asap",
    junk: "removal",
  },
  {
    id: "redemption",
    name: "Redeem a wrong exalted affix",
    blurb: "If the exalted tier is on the wrong affix, Rune of Redemption tries to reroll it. Otherwise craft the cheapest tier.",
    addTiming: "cheapest",
    sealTiming: "asap",
    junk: "redemption",
  },
];

export const STYLES: Style[] = BASE_STYLES.flatMap((style) => {
  if (style.junk === "redemption") return [{ ...style, blockTiming: "before-fill" as const }];
  return (["before-fill", "after-havoc"] as const).map((blockTiming) => ({
    ...style,
    id: `${style.id}-${blockTiming}`,
    blockTiming,
    name: blockTiming === "before-fill" ? style.name : `${style.name}, after Havoc`,
    blurb: blockTiming === "before-fill"
      ? `${style.blurb} Open a blocked slot before adding another line, so Removal is aimed at fewer affixes and Despair is rolled at the current affix count.`
      : `${style.blurb} Add a line so Havoc can move an exalted tier first, then open the blocked slot.`,
  }));
});

type Ctx = {
  catalog: AffixDef[];
  slot: SlotId;
  itemClass: ItemClass;
  goal: Goal;
  rules: RuleConfig;
  style: Style;
};

type Progress = {
  type: "add" | "upgrade";
  id: string;
  maxFp: number;
  tier: number;
  priority: number;
};

function cloneState(state: ItemState): ItemState {
  return { fp: state.fp, affixes: state.affixes.map((affix) => ({ ...affix })) };
}

function resolveDef(catalog: AffixDef[], id: string): AffixDef | undefined {
  const found = catalog.find((affix) => affix.id === id);
  if (found) return found;
  if (id === "filler-prefix") return { id, name: "Any prefix", group: "prefix", slots: [] };
  if (id === "filler-suffix") return { id, name: "Any suffix", group: "suffix", slots: [] };
  if (id.startsWith("unlisted-prefix-")) {
    return { id, name: "Unlisted prefix", group: "prefix", slots: [] };
  }
  if (id.startsWith("unlisted-suffix-")) {
    return { id, name: "Unlisted suffix", group: "suffix", slots: [] };
  }
  return undefined;
}

function groupOf(catalog: AffixDef[], id: string): AffixGroup {
  return resolveDef(catalog, id)?.group ?? "prefix";
}

function allowed(def: AffixDef, slot: SlotId, itemClass: ItemClass): boolean {
  if (def.id.startsWith("unlisted-")) return false;
  if (!def.slots.includes(slot)) return false;
  if (def.class && itemClass !== def.class) return false;
  return true;
}

function rollBlocker(def: AffixDef, slot: SlotId, itemClass: ItemClass): string {
  if (def.class && def.slots.includes(slot) && itemClass !== def.class) {
    const who = def.class.charAt(0).toUpperCase() + def.class.slice(1);
    return `${printedName(def)} only rolls on ${who} items.`;
  }
  return `${printedName(def)} cannot roll on this item.`;
}

function isExalted(state: ItemState): boolean {
  return state.affixes.some((affix) => affix.tier >= 6);
}

function unsealed(state: ItemState): AffixState[] {
  return state.affixes.filter((affix) => !affix.sealed);
}

function openSlots(state: ItemState, group: AffixGroup, catalog: AffixDef[]): number {
  const used = state.affixes.filter(
    (affix) => !affix.sealed && groupOf(catalog, affix.id) === group,
  ).length;
  return 2 - used;
}

function hasSeal(state: ItemState): boolean {
  return state.affixes.some((affix) => affix.sealed);
}

function junkOf(state: ItemState, goal: Goal): AffixState[] {
  const wanted = new Set(goal.affixes.map((affix) => affix.id));
  return unsealed(state).filter((affix) => !wanted.has(affix.id));
}

function missingOf(state: ItemState, goal: Goal): GoalAffix[] {
  const have = new Set(state.affixes.map((affix) => affix.id));
  return goal.affixes.filter((affix) => !have.has(affix.id));
}

export function meetsGoal(state: ItemState, goal: Goal): boolean {
  if (state.fp < goal.minFp) return false;
  for (const wanted of goal.affixes) {
    const have = state.affixes.find((affix) => affix.id === wanted.id);
    if (!have || have.sealed !== wanted.sealed || have.tier < wanted.minTier) return false;
  }
  if (goal.exact) {
    if (state.affixes.length !== goal.affixes.length) return false;
    const wanted = new Set(goal.affixes.map((affix) => affix.id));
    if (state.affixes.some((affix) => !wanted.has(affix.id))) return false;
  }
  return true;
}

function sealChanceNow(state: ItemState, tier: number): number {
  return sealChance(tier, unsealed(state).length, isExalted(state));
}

function chaosOptions(state: ItemState, id: string, ctx: Ctx): AffixDef[] {
  const self = resolveDef(ctx.catalog, id);
  if (!self) return [];
  const present = new Set(state.affixes.map((affix) => affix.id));
  return ctx.catalog.filter(
    (affix) =>
      affix.group === self.group &&
      affix.id !== id &&
      !present.has(affix.id) &&
      allowed(affix, ctx.slot, ctx.itemClass),
  );
}

function assignmentScore(affixes: AffixState[], goal: Goal): number {
  let score = 0;
  for (const wanted of goal.affixes) {
    const have = affixes.find((affix) => affix.id === wanted.id && affix.sealed === wanted.sealed);
    if (!have) {
      if (!wanted.sealed && wanted.minTier >= 6) score -= 1000;
      continue;
    }
    if (wanted.sealed) {
      score += have.tier >= wanted.minTier ? 250 + have.tier : -500;
      continue;
    }
    if (have.tier >= wanted.minTier) score += 100;
    else if (wanted.minTier >= 6) score -= 1000;
    score += Math.min(have.tier, wanted.minTier);
  }
  return score;
}

function permuteTiers(tiers: number[], visit: (next: number[]) => void): void {
  const perm = tiers.slice();
  const walk = (index: number) => {
    if (index === perm.length) {
      visit(perm);
      return;
    }
    for (let swap = index; swap < perm.length; swap += 1) {
      [perm[index], perm[swap]] = [perm[swap], perm[index]];
      walk(index + 1);
      [perm[index], perm[swap]] = [perm[swap], perm[index]];
    }
  };
  walk(0);
}

function havocLegal(state: ItemState): boolean {
  const open = unsealed(state);
  return open.length === 4 && open.some((affix) => affix.tier >= 6);
}

function scoreTiers(open: AffixState[], tiers: number[], goal: Goal): number {
  const saved = open.map((affix) => affix.tier);
  open.forEach((affix, index) => {
    affix.tier = tiers[index];
  });
  const score = assignmentScore(open, goal);
  open.forEach((affix, index) => {
    affix.tier = saved[index];
  });
  return score;
}

function havocOdds(state: ItemState, goal: Goal): { best: number; fraction: number; tiers: number[] } | null {
  if (!havocLegal(state)) return null;
  const open = unsealed(state);
  const current = scoreTiers(open, open.map((affix) => affix.tier), goal);
  let best = current;
  let bestTiers = open.map((affix) => affix.tier);
  let favorable = 0;
  let total = 0;
  permuteTiers(open.map((affix) => affix.tier), (tiers) => {
    total += 1;
    const score = scoreTiers(open, tiers, goal);
    if (score > best) {
      best = score;
      bestTiers = tiers.slice();
    }
  });
  permuteTiers(open.map((affix) => affix.tier), (tiers) => {
    if (scoreTiers(open, tiers, goal) === best && best > current) favorable += 1;
  });
  if (best <= current || total === 0) return null;
  return { best, fraction: favorable / total, tiers: bestTiers };
}

function delayHavoc(state: ItemState, ctx: Ctx): boolean {
  return missingOf(state, ctx.goal).some(
    (wanted) => openSlots(state, groupOf(ctx.catalog, wanted.id), ctx.catalog) > 0,
  );
}

function hopeOn(action: Action): boolean {
  return action.type === "add" || action.type === "upgrade" || action.type === "removal" || action.type === "havoc" || action.type === "redemption";
}

function critOn(action: Action): boolean {
  return action.type === "add" || action.type === "upgrade" || action.type === "chaos" || action.type === "seal";
}

function maxCost(state: ItemState, action: Action, rules: RuleConfig): number {
  if (action.type === "add") return rules.addMax;
  if (action.type === "removal") return rules.removalMax;
  if (action.type === "havoc") return rules.havocMax;
  if (action.type === "redemption") return rules.redemptionMax;
  const affix = state.affixes.find((item) => item.id === action.id);
  return upgradeCost((affix?.tier ?? 0) + 1, rules);
}

function listProgress(state: ItemState, ctx: Ctx): Progress[] {
  const sealId = ctx.goal.affixes.find((affix) => affix.sealed)?.id;
  const actions: Progress[] = [];
  for (const wanted of ctx.goal.affixes) {
    if (wanted.sealed || wanted.id === sealId) continue;
    const have = state.affixes.find((affix) => affix.id === wanted.id);
    if (!have) {
      const def = resolveDef(ctx.catalog, wanted.id);
      if (!def || openSlots(state, def.group, ctx.catalog) <= 0) continue;
      actions.push({
        type: "add",
        id: wanted.id,
        maxFp: ctx.rules.addMax,
        tier: 0,
        priority: wanted.minTier,
      });
      continue;
    }
    if (have.sealed || have.tier >= Math.min(wanted.minTier, 5)) continue;
    const next = have.tier + 1;
    actions.push({
      type: "upgrade",
      id: wanted.id,
      maxFp: upgradeCost(next, ctx.rules),
      tier: have.tier,
      priority: wanted.minTier,
    });
  }
  return actions;
}

function pickProgress(actions: Progress[], ctx: Ctx): Action {
  let pool = actions;
  if (ctx.style.addTiming === "late") {
    const upgrades = actions.filter((action) => action.type === "upgrade");
    if (upgrades.length) pool = upgrades;
  } else if (ctx.style.addTiming === "early") {
    const adds = actions.filter((action) => action.type === "add");
    if (adds.length) pool = adds;
  }
  pool = pool.slice().sort((a, b) => a.maxFp - b.maxFp || a.tier - b.tier || b.priority - a.priority);
  const chosen = pool[0];
  return { type: chosen.type, id: chosen.id };
}

function redemptionUseful(state: ItemState, ctx: Ctx): boolean {
  const exalted = unsealed(state).filter((affix) => affix.tier >= 6);
  if (!exalted.length) return false;
  const allWrong = exalted.every((affix) => {
    const wanted = ctx.goal.affixes.find((goal) => goal.id === affix.id && !goal.sealed);
    return !wanted || affix.tier < wanted.minTier;
  });
  if (!allWrong) return false;
  return exalted.some((affix) =>
    chaosOptions(state, affix.id, ctx).some((option) => {
      const wanted = ctx.goal.affixes.find((goal) => goal.id === option.id && !goal.sealed);
      return Boolean(wanted && affix.tier >= wanted.minTier);
    }),
  );
}

function blockingJunk(state: ItemState, ctx: Ctx): AffixState[] {
  const junk = junkOf(state, ctx.goal);
  const blocking = junk.filter((affix) => {
    const group = groupOf(ctx.catalog, affix.id);
    return missingOf(state, ctx.goal).some((wanted) => groupOf(ctx.catalog, wanted.id) === group)
      && openSlots(state, group, ctx.catalog) <= 0;
  });
  return blocking.length ? blocking : junk;
}

function needsExaltedMove(state: ItemState, goal: Goal): boolean {
  const exalted = unsealed(state).some((affix) => affix.tier >= 6);
  if (!exalted) return false;
  return goal.affixes.some((wanted) => {
    if (wanted.sealed || wanted.minTier < 6) return false;
    const have = state.affixes.find((affix) => affix.id === wanted.id && !affix.sealed);
    return !have || have.tier < wanted.minTier;
  });
}

function havocFiller(state: ItemState, ctx: Ctx): string | null {
  if (unsealed(state).length >= 4 || !needsExaltedMove(state, ctx.goal)) return null;
  for (const group of ["prefix", "suffix"] as const) {
    if (openSlots(state, group, ctx.catalog) <= 0) continue;
    const missing = missingOf(state, ctx.goal).find((wanted) => !wanted.sealed && groupOf(ctx.catalog, wanted.id) === group);
    if (missing) return missing.id;
    if (ctx.goal.exact) continue;
    return group === "prefix" ? "filler-prefix" : "filler-suffix";
  }
  return null;
}

function junkAction(state: ItemState, ctx: Ctx, allowRemoval: boolean): Action | null {
  const junk = blockingJunk(state, ctx);
  if (!junk.length) return null;
  const missing = new Set(missingOf(state, ctx.goal).map((affix) => affix.id));
  const goalSeal = ctx.goal.affixes.some((affix) => affix.sealed);

  if (ctx.style.junk === "seal" && !ctx.goal.exact && !goalSeal && !hasSeal(state)) {
    const candidate = junk.filter((affix) => affix.tier <= 4).sort((a, b) => a.tier - b.tier)[0];
    if (candidate) return { type: "seal", id: candidate.id };
  }
  if (ctx.style.junk === "chaos" || ctx.style.junk === "seal") {
    const candidate = junk.find(
      (affix) => affix.tier < 5 && chaosOptions(state, affix.id, ctx).some((option) => missing.has(option.id)),
    );
    if (candidate) return { type: "chaos", id: candidate.id };
  }
  if ((ctx.style.junk === "redemption" || ctx.style.junk === "chaos") && redemptionUseful(state, ctx)) {
    return { type: "redemption" };
  }
  if (allowRemoval && (ctx.style.junk === "removal" || ctx.style.junk === "redemption" || ctx.style.junk === "chaos" || ctx.style.junk === "seal")) {
    return { type: "removal" };
  }
  return null;
}

function pendingAdds(state: ItemState, ctx: Ctx, exceptId?: string): Progress[] {
  return listProgress(state, {
    ...ctx,
    goal: {
      ...ctx.goal,
      affixes: ctx.goal.affixes.filter((affix) => affix.id !== exceptId),
    },
  }).filter((action) => action.type === "add");
}

export function chooseAction(state: ItemState, ctx: Ctx): Action | null {
  if (meetsGoal(state, ctx.goal) || state.fp < 1) return null;
  const sealGoal = ctx.goal.affixes.find((affix) => affix.sealed);
  const sealAffix = sealGoal ? state.affixes.find((affix) => affix.id === sealGoal.id && !affix.sealed) : undefined;
  const sealedAlready = sealGoal ? state.affixes.find((affix) => affix.id === sealGoal.id && affix.sealed) : undefined;

  if (sealedAlready && sealGoal && sealedAlready.tier < sealGoal.minTier) return null;

  if (sealGoal && !state.affixes.some((affix) => affix.id === sealGoal.id)) {
    const others = ctx.style.sealTiming === "fill-first" ? pendingAdds(state, ctx, sealGoal.id) : [];
    if (others.length && sealChanceNow(state, sealGoal.minTier) < 1) return { type: "add", id: others[0].id };
    if (openSlots(state, groupOf(ctx.catalog, sealGoal.id), ctx.catalog) > 0) return { type: "add", id: sealGoal.id };
  }

  if (sealAffix && sealGoal) {
    if (sealAffix.tier > 4) {
      const odds = havocOdds(state, ctx.goal);
      if (!odds) return null;
    } else if (sealAffix.tier < sealGoal.minTier) {
      const others = ctx.style.sealTiming === "fill-first" ? pendingAdds(state, ctx, sealGoal.id) : [];
      if (others.length && sealChanceNow(state, sealAffix.tier) < 1) return { type: "add", id: others[0].id };
      return { type: "upgrade", id: sealAffix.id };
    } else {
      const chance = sealChanceNow(state, sealAffix.tier);
      const others = pendingAdds(state, ctx, sealGoal.id);
      if (ctx.style.sealTiming === "asap" || chance >= 1 || others.length === 0) return { type: "seal", id: sealAffix.id };
      return { type: "add", id: others[0].id };
    }
  }

  const roomBlocked = missingOf(state, ctx.goal).some(
    (wanted) => openSlots(state, groupOf(ctx.catalog, wanted.id), ctx.catalog) <= 0,
  );
  const moveExalted = needsExaltedMove(state, ctx.goal);
  if (ctx.style.blockTiming === "after-havoc" && moveExalted) {
    const filler = havocFiller(state, ctx);
    if (filler) return { type: "add", id: filler };
    if (!delayHavoc(state, ctx)) {
      const odds = havocOdds(state, ctx.goal);
      if (odds && odds.fraction > 0) return { type: "havoc" };
    }
  }
  const exactLeftover = ctx.goal.exact && junkOf(state, ctx.goal).length > 0 && missingOf(state, ctx.goal).length === 0;
  if (roomBlocked || exactLeftover) {
    if (roomBlocked && ctx.style.sealTiming === "fill-first" && ctx.style.junk === "seal") {
      const adds = listProgress(state, ctx).filter((action) => action.type === "add");
      const sealable = junkOf(state, ctx.goal).filter((affix) => affix.tier <= 4);
      if (adds[0] && sealable[0] && sealChanceNow(state, sealable[0].tier) < 1) {
        return { type: "add", id: adds[0].id };
      }
    }
    const action = junkAction(state, ctx, true);
    if (action) return action;
  }

  if (ctx.style.blockTiming !== "after-havoc" && moveExalted) {
    const filler = havocFiller(state, ctx);
    if (filler) return { type: "add", id: filler };
    if (!delayHavoc(state, ctx)) {
      const odds = havocOdds(state, ctx.goal);
      if (odds && odds.fraction > 0) return { type: "havoc" };
    }
  }

  if (!delayHavoc(state, ctx)) {
    const odds = havocOdds(state, ctx.goal);
    if (odds && odds.fraction > 0) return { type: "havoc" };
  }

  const progress = listProgress(state, ctx);
  if (progress.length) return pickProgress(progress, ctx);

  if (ctx.goal.exact && junkOf(state, ctx.goal).length) return junkAction(state, ctx, true);
  return null;
}

function applyCrit(state: ItemState, rng: () => number): void {
  const pool = state.affixes.filter((affix) => !affix.sealed && affix.tier < 5);
  if (!pool.length) return;
  const pick = pool[Math.floor(rng() * pool.length)];
  pick.tier += 1;
}

function spend(
  state: ItemState,
  max: number,
  hope: boolean,
  critEligible: boolean,
  rules: RuleConfig,
  rng: () => number,
): boolean {
  const crit = critEligible && rng() < rules.critChance;
  const hopeProc = hope && rng() < rules.hopeChance;
  const iceProc = !crit && !hopeProc && rules.icePreserveChance > 0 && rng() < rules.icePreserveChance;
  if (!crit && !hopeProc && !iceProc) {
    state.fp = Math.max(0, state.fp - rollForgingPotential(max, rules.luckyFpRoll, rng));
  }
  return crit;
}

function applyRandom(state: ItemState, action: Action, ctx: Ctx, rng: () => number): boolean {
  const max = maxCost(state, action, ctx.rules);
  if (action.type === "add") {
    const def = resolveDef(ctx.catalog, action.id);
    if (!def || state.affixes.some((affix) => affix.id === action.id)) return false;
    if (openSlots(state, def.group, ctx.catalog) <= 0) return false;
    state.affixes.push({ id: action.id, tier: 1, sealed: false });
    if (spend(state, max, true, true, ctx.rules, rng)) applyCrit(state, rng);
    return true;
  }
  if (action.type === "upgrade") {
    const affix = state.affixes.find((item) => item.id === action.id && !item.sealed);
    if (!affix || affix.tier >= 5) return false;
    affix.tier += 1;
    if (spend(state, max, true, true, ctx.rules, rng)) applyCrit(state, rng);
    return true;
  }
  if (action.type === "seal") {
    const affix = state.affixes.find((item) => item.id === action.id && !item.sealed);
    if (!affix || affix.tier > 4 || hasSeal(state)) return false;
    const chance = sealChanceNow(state, affix.tier);
    const sealed = rng() < chance;
    const crit = spend(state, max, false, true, ctx.rules, rng);
    if (sealed) affix.sealed = true;
    else affix.tier += 1;
    if (crit) applyCrit(state, rng);
    return true;
  }
  if (action.type === "chaos") {
    const affix = state.affixes.find((item) => item.id === action.id && !item.sealed);
    if (!affix || affix.tier >= 5) return false;
    const options = chaosOptions(state, affix.id, ctx);
    const denom = options.length + ctx.rules.extraChaosOutcomes;
    if (denom <= 0) return false;
    const roll = Math.floor(rng() * denom);
    const group = groupOf(ctx.catalog, affix.id);
    affix.tier += 1;
    if (roll >= options.length) {
      let seq = 1;
      while (state.affixes.some((item) => item.id === `unlisted-${group}-${seq}`)) seq += 1;
      affix.id = `unlisted-${group}-${seq}`;
    } else {
      affix.id = options[roll].id;
    }
    if (spend(state, max, false, true, ctx.rules, rng)) applyCrit(state, rng);
    return true;
  }
  if (action.type === "removal") {
    const open = unsealed(state);
    if (!open.length) return false;
    const pick = open[Math.floor(rng() * open.length)];
    spend(state, max, true, false, ctx.rules, rng);
    state.affixes = state.affixes.filter((affix) => affix !== pick);
    return true;
  }
  if (action.type === "havoc") {
    if (!havocLegal(state)) return false;
    spend(state, max, true, false, ctx.rules, rng);
    const open = unsealed(state);
    const tiers = open.map((affix) => affix.tier);
    for (let index = tiers.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(rng() * (index + 1));
      [tiers[index], tiers[swap]] = [tiers[swap], tiers[index]];
    }
    open.forEach((affix, index) => {
      affix.tier = tiers[index];
    });
    return true;
  }
  const exalted = state.affixes.filter((affix) => !affix.sealed && affix.tier >= 6);
  if (!exalted.length) return false;
  spend(state, max, true, false, ctx.rules, rng);
  for (const affix of exalted) {
    const options = chaosOptions(state, affix.id, ctx);
    const denom = options.length + ctx.rules.extraChaosOutcomes;
    if (denom <= 0) continue;
    const roll = Math.floor(rng() * denom);
    if (roll >= options.length) {
      const group = groupOf(ctx.catalog, affix.id);
      let seq = 1;
      while (state.affixes.some((item) => item.id === `unlisted-${group}-${seq}`)) seq += 1;
      affix.id = `unlisted-${group}-${seq}`;
    } else {
      affix.id = options[roll].id;
    }
  }
  return true;
}

function applyOracle(state: ItemState, action: Action, ctx: Ctx): boolean {
  if (action.type === "add") {
    const def = resolveDef(ctx.catalog, action.id);
    if (!def || state.affixes.some((affix) => affix.id === action.id)) return false;
    if (openSlots(state, def.group, ctx.catalog) <= 0) return false;
    state.affixes.push({ id: action.id, tier: 1, sealed: false });
    return true;
  }
  if (action.type === "upgrade") {
    const affix = state.affixes.find((item) => item.id === action.id && !item.sealed);
    if (!affix || affix.tier >= 5) return false;
    affix.tier += 1;
    return true;
  }
  if (action.type === "seal") {
    const affix = state.affixes.find((item) => item.id === action.id && !item.sealed);
    if (!affix || affix.tier > 4 || hasSeal(state)) return false;
    affix.sealed = true;
    return true;
  }
  if (action.type === "chaos") {
    const affix = state.affixes.find((item) => item.id === action.id && !item.sealed);
    if (!affix || affix.tier >= 5) return false;
    const missing = new Set(missingOf(state, ctx.goal).map((item) => item.id));
    const options = chaosOptions(state, affix.id, ctx).filter((option) => missing.has(option.id));
    if (!options.length) return false;
    options.sort((a, b) => {
      const aTier = ctx.goal.affixes.find((item) => item.id === a.id)?.minTier ?? 0;
      const bTier = ctx.goal.affixes.find((item) => item.id === b.id)?.minTier ?? 0;
      return bTier - aTier;
    });
    affix.tier += 1;
    affix.id = options[0].id;
    return true;
  }
  if (action.type === "removal") {
    const junk = junkOf(state, ctx.goal);
    if (!junk.length) return false;
    const blocked = junk.filter(
      (affix) =>
        missingOf(state, ctx.goal).some((wanted) => groupOf(ctx.catalog, wanted.id) === groupOf(ctx.catalog, affix.id)) &&
        openSlots(state, groupOf(ctx.catalog, affix.id), ctx.catalog) <= 0,
    );
    const pool = (blocked.length ? blocked : junk).slice().sort((a, b) => a.tier - b.tier);
    state.affixes = state.affixes.filter((affix) => affix !== pool[0]);
    return true;
  }
  if (action.type === "havoc") {
    const odds = havocOdds(state, ctx.goal);
    if (!odds) return false;
    const open = unsealed(state);
    open.forEach((affix, index) => {
      affix.tier = odds.tiers[index];
    });
    return true;
  }
  const exalted = state.affixes.filter((affix) => !affix.sealed && affix.tier >= 6);
  if (!exalted.length) return false;
  let hit = false;
  for (const affix of exalted) {
    const options = chaosOptions(state, affix.id, ctx).filter((option) => {
      const wanted = ctx.goal.affixes.find((goal) => goal.id === option.id && !goal.sealed);
      return Boolean(wanted && affix.tier >= wanted.minTier);
    });
    if (!options.length) continue;
    options.sort((a, b) => {
      const aTier = ctx.goal.affixes.find((item) => item.id === a.id)?.minTier ?? 0;
      const bTier = ctx.goal.affixes.find((item) => item.id === b.id)?.minTier ?? 0;
      return bTier - aTier;
    });
    affix.id = options[0].id;
    hit = true;
  }
  return hit;
}

function risky(state: ItemState, action: Action, ctx: Ctx): boolean {
  if (action.type === "chaos" || action.type === "removal" || action.type === "redemption") return true;
  if (action.type === "seal") {
    const affix = state.affixes.find((item) => item.id === action.id);
    return !affix || sealChanceNow(state, affix.tier) < 0.999;
  }
  if (action.type === "havoc") {
    const odds = havocOdds(state, ctx.goal);
    return !odds || odds.fraction < 0.999;
  }
  return false;
}

function formatPct(chance: number): string {
  const percent = Math.round(chance * 1000) / 10;
  return `${percent}%`;
}

export function formatChance(chance: number): string {
  if (chance >= 0.995) return "100%";
  if (chance <= 0.0005) return "0%";
  return formatPct(chance);
}

function describe(state: ItemState, action: Action, ctx: Ctx): PlanStep {
  return { ...describeStep(state, action, ctx), action };
}

function describeStep(state: ItemState, action: Action, ctx: Ctx): Omit<PlanStep, "action"> {
  const name = (id: string) => affixName(ctx.catalog, id);
  const cost = maxCost(state, action, ctx.rules);
  const hope = hopeOn(action);
  const crit = critOn(action);
  const free = freeCraftChance(ctx.rules, hope, crit, ctx.rules.icePreserveChance > 0);
  const typical = Math.round((1 - free) * expectedRoll(cost, ctx.rules.luckyFpRoll) * 10) / 10;
  const pay = `Costs ${1}–${cost} Forging Potential${ctx.rules.luckyFpRoll ? ", taking the lower of two rolls" : ""}. A typical paid craft is about ${typical} after free crafts.`;
  const hopeText = hope ? ` Glyph of Hope is ${formatPct(ctx.rules.hopeChance)} to make it free.` : " This glyph slot cannot also hold Hope.";
  const critText = crit
    ? ` Critical success is ${formatPct(ctx.rules.critChance)}: the craft is free and one random affix below tier 5 gains a tier.`
    : "";
  const iceText = ctx.rules.icePreserveChance > 0 ? ` Ice Forging Potential preserves the cost ${formatPct(ctx.rules.icePreserveChance)} of the time.` : "";

  if (action.type === "add") {
    const fillerGroup = action.id === "filler-prefix" ? "prefix" : action.id === "filler-suffix" ? "suffix" : null;
    const exalted = ctx.goal.affixes.find((affix) => !affix.sealed && affix.minTier >= 6);
    return {
      title: fillerGroup
        ? `Glyph of Hope: add any ${fillerGroup} at tier 1`
        : `Glyph of Hope: add ${name(action.id)} at tier 1`,
      detail: fillerGroup
        ? `Put Glyph of Hope in the glyph slot. Use a shard for any ${fillerGroup} this item can roll. The line itself does not matter. It only has to be there so the item has four open affixes before Rune of Havoc moves the exalted tier onto ${name(exalted?.id ?? action.id)}. ${pay}${hopeText}${critText}${iceText}`
        : `Put Glyph of Hope in the glyph slot. ${pay}${hopeText}${critText}${iceText}`,
      odds: "The affix you pick is guaranteed.",
    };
  }
  if (action.type === "upgrade") {
    const affix = state.affixes.find((item) => item.id === action.id);
    const next = (affix?.tier ?? 0) + 1;
    return {
      title: `Glyph of Hope: upgrade ${name(action.id)} to tier ${next}`,
      detail: `Put Glyph of Hope in the glyph slot. ${pay}${hopeText}${critText}${iceText}`,
      odds: "The tier increase is guaranteed.",
    };
  }
  if (action.type === "seal") {
    const affix = state.affixes.find((item) => item.id === action.id);
    const chance = affix ? sealChanceNow(state, affix.tier) : 0;
    const exalted = isExalted(state) ? "exalted" : "magic or rare";
    return {
      title: `Glyph of Despair: seal ${name(action.id)}`,
      detail: `Put Glyph of Despair in the glyph slot. Seals it at tier ${affix?.tier ?? "?"} and frees its slot. ${pay}${hopeText}${critText} If the seal fails, the affix upgrades instead.`,
      odds: `${formatChance(chance)} on this ${exalted} item with ${unsealed(state).length} affix${unsealed(state).length === 1 ? "" : "es"}.`,
    };
  }
  if (action.type === "chaos") {
    const options = chaosOptions(state, action.id, ctx);
    const denom = options.length + ctx.rules.extraChaosOutcomes;
    const missing = missingOf(state, ctx.goal).map((item) => name(item.id)).slice(0, 3).join(", ");
    return {
      title: `Glyph of Chaos: reroll ${name(action.id)}`,
      detail: `Put Glyph of Chaos in the glyph slot. The tier goes up by one, then the affix changes. Hope cannot be used with Chaos. ${pay}${critText}`,
      odds: denom > 0 ? `${formatChance(1 / denom)} per try to hit ${missing || "the missing affix"}. Retries until it hits or the affix reaches tier 5.` : null,
    };
  }
  if (action.type === "removal") {
    const open = unsealed(state);
    const blocking = blockingJunk(state, ctx);
    const aimed = blocking.length > 1
      ? blocking.slice(0, 3).map((affix) => name(affix.id)).join(" or ")
      : blocking[0] ? name(blocking[0].id) : "the spare affix";
    const hits = blocking.length > 1 ? blocking.length : 1;
    return {
      title: "Rune of Removal, with Glyph of Hope",
      detail: `Put Rune of Removal in the rune slot and Glyph of Hope in the glyph slot. Removes one random open affix and returns shards equal to its tier. ${pay}${hopeText}`,
      odds: open.length ? `${formatChance(hits / open.length)} to remove ${aimed} (${hits} of ${open.length} open affix${open.length === 1 ? "" : "es"}). A line you still need has to be crafted back from tier 1.` : null,
    };
  }
  if (action.type === "havoc") {
    const odds = havocOdds(state, ctx.goal);
    return {
      title: "Rune of Havoc, with Glyph of Hope",
      detail: `Put Rune of Havoc in the rune slot and Glyph of Hope in the glyph slot. Shuffles the tiers of the four open affixes. Sealed affixes stay put. ${pay}${hopeText} Try again while Forging Potential remains.`,
      odds: odds ? `${formatChance(odds.fraction)} per try to land the exalted tier where it needs to be.` : null,
    };
  }
  const exalted = unsealed(state).filter((affix) => affix.tier >= 6);
  const options = exalted[0] ? chaosOptions(state, exalted[0].id, ctx).length + ctx.rules.extraChaosOutcomes : 0;
  return {
    title: "Rune of Redemption, with Glyph of Hope",
    detail: `Put Rune of Redemption in the rune slot and Glyph of Hope in the glyph slot. Rerolls every exalted affix into a different affix of the same type and keeps the tier. ${pay}${hopeText}`,
    odds: options > 0 ? `About ${formatChance(1 / options)} for a given exalted affix to become the one you want.` : null,
  };
}

type Walk = {
  reached: boolean;
  steps: PlanStep[];
  costs: number[];
  risky: boolean;
  materials: Record<string, number>;
  typicalSpend: number;
};

function walkPlan(origin: ItemState, ctx: Ctx): Walk {
  const state = cloneState(origin);
  state.fp = 999;
  const steps: PlanStep[] = [];
  const costs: number[] = [];
  const materials: Record<string, number> = {};
  let spent = 0;
  let sawRisk = false;
  let reached = false;
  for (let guard = 0; guard < STEP_CAP; guard += 1) {
    if (meetsGoal({ ...state, fp: ctx.goal.minFp }, ctx.goal)) {
      reached = true;
      break;
    }
    const action = chooseAction(state, ctx);
    if (!action || !applyWouldWork(state, action, ctx)) break;
    steps.push(describe(state, action, ctx));
    const cost = maxCost(state, action, ctx.rules);
    costs.push(cost);
    sawRisk = sawRisk || risky(state, action, ctx);
    const free = freeCraftChance(ctx.rules, hopeOn(action), critOn(action), ctx.rules.icePreserveChance > 0);
    spent += (1 - free) * expectedRoll(cost, ctx.rules.luckyFpRoll);
    const key = action.type === "add" || action.type === "upgrade" ? "shard" : action.type;
    materials[key] = (materials[key] ?? 0) + 1;
    if (hopeOn(action)) materials.hope = (materials.hope ?? 0) + 1;
    if (!applyOracle(state, action, ctx)) break;
  }
  if (meetsGoal({ ...state, fp: ctx.goal.minFp }, ctx.goal)) reached = true;
  return { reached, steps, costs, risky: sawRisk, materials, typicalSpend: Math.round(spent * 10) / 10 };
}

function applyWouldWork(state: ItemState, action: Action, ctx: Ctx): boolean {
  const copy = cloneState(state);
  return applyOracle(copy, action, ctx);
}

function fpRequired(costs: number[], minFp: number): number {
  if (!costs.length) return minFp;
  let need = minFp === 0 ? 1 : costs[costs.length - 1] + minFp;
  for (let index = costs.length - 2; index >= 0; index -= 1) need = costs[index] + need;
  return need;
}

function failureReason(state: ItemState, goal: Goal): string {
  if (state.fp < 1) return "Ran out of Forging Potential";
  const sealGoal = goal.affixes.find((affix) => affix.sealed);
  if (sealGoal) {
    const affix = state.affixes.find((item) => item.id === sealGoal.id);
    if (affix && !affix.sealed && affix.tier > 4) return "The affix you need to seal was pushed above tier 4";
    if (affix?.sealed && affix.tier < sealGoal.minTier) return "The sealed affix is stuck below the tier you need";
  }
  const missedExalt = goal.affixes.some((wanted) => {
    if (wanted.sealed || wanted.minTier < 6) return false;
    return !state.affixes.some((affix) => affix.id === wanted.id && !affix.sealed && affix.tier >= wanted.minTier);
  });
  if (missedExalt) return "The exalted tier never landed on the right affix";
  if (goal.exact && junkOf(state, goal).length) return "A spare affix was still on the item";
  return "No forge craft can move the item closer";
}

function simulate(origin: ItemState, ctx: Ctx, iterations: number, seed: number): { chance: number; medianFp: number | null; reasons: Map<string, number> } {
  const reasons = new Map<string, number>();
  const leftovers: number[] = [];
  let wins = 0;
  for (let run = 0; run < iterations; run += 1) {
    const rng = mulberry32(seed + run * 997);
    const state = cloneState(origin);
    let reason = "No forge craft can move the item closer";
    for (let guard = 0; guard < STEP_CAP; guard += 1) {
      if (meetsGoal(state, ctx.goal)) break;
      if (state.fp < 1) {
        reason = "Ran out of Forging Potential";
        break;
      }
      const action = chooseAction(state, ctx);
      if (!action || !applyRandom(state, action, ctx, rng)) {
        reason = failureReason(state, ctx.goal);
        break;
      }
    }
    if (meetsGoal(state, ctx.goal)) {
      wins += 1;
      leftovers.push(state.fp);
    } else {
      if (!meetsGoal(state, ctx.goal) && state.fp < 1) reason = "Ran out of Forging Potential";
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
  }
  leftovers.sort((a, b) => a - b);
  const medianFp = leftovers.length ? leftovers[Math.floor(leftovers.length / 2)] : null;
  return { chance: iterations ? wins / iterations : 0, medianFp, reasons };
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canAssignExalted(supply: number[], demand: number[]): boolean {
  const left = supply.slice().sort((a, b) => b - a);
  for (const need of demand.slice().sort((a, b) => b - a)) {
    const index = left.findIndex((tier) => tier >= need);
    if (index < 0) return false;
    left.splice(index, 1);
  }
  return true;
}

export function diagnose(state: ItemState, goal: Goal, catalog: AffixDef[], slot: SlotId, itemClass: ItemClass): string[] {
  const blockers: string[] = [];
  const name = (id: string) => affixName(catalog, id);
  if (goal.affixes.length === 0) blockers.push("Add at least one affix to the target item.");
  const goalIds = goal.affixes.map((affix) => affix.id);
  if (new Set(goalIds).size !== goalIds.length) blockers.push("The target lists the same affix twice. An item can hold each affix once.");
  const currentIds = state.affixes.map((affix) => affix.id);
  if (new Set(currentIds).size !== currentIds.length) blockers.push("The starting item lists the same affix twice.");
  if (goal.affixes.filter((affix) => affix.sealed).length > 1) blockers.push("An item can have only one sealed affix.");
  if (state.affixes.filter((affix) => affix.sealed).length > 1) blockers.push("The starting item has two sealed affixes. The forge only has one seal.");
  if (state.fp < 1 && !meetsGoal({ ...state, fp: goal.minFp }, goal)) blockers.push("This item has no Forging Potential left, so the forge will not take another craft.");

  for (const affix of state.affixes) {
    const def = resolveDef(catalog, affix.id);
    if (!def) blockers.push(`${affix.id} is not in the affix list.`);
    else if (!allowed(def, slot, itemClass)) blockers.push(rollBlocker(def, slot, itemClass));
    if (affix.tier < 1 || affix.tier > 7) blockers.push(`${name(affix.id)} is tier ${affix.tier}. This planner covers tiers 1 through 7.`);
    if (affix.sealed && affix.tier > 4) blockers.push(`${name(affix.id)} is sealed above tier 4. Despair cannot create that.`);
  }

  const sealedNow = state.affixes.find((affix) => affix.sealed);
  for (const wanted of goal.affixes) {
    const def = resolveDef(catalog, wanted.id);
    if (!def) {
      blockers.push(`${wanted.id} is not in the affix list.`);
      continue;
    }
    if (!allowed(def, slot, itemClass)) blockers.push(rollBlocker(def, slot, itemClass));
    if (wanted.minTier < 1 || wanted.minTier > 7) blockers.push(`${printedName(def)} has a target tier outside 1–7.`);
    if (wanted.sealed && (wanted.minTier < 1 || wanted.minTier > 4)) {
      blockers.push(`${printedName(def)} cannot be sealed at tier ${wanted.minTier}. Despair seals the current tier, and only tiers 1–4 can be sealed.`);
    }
    if (wanted.minTier > 5 && wanted.sealed) blockers.push(`${printedName(def)} cannot be both exalted and sealed. Sealing stops at tier 4.`);
  }

  for (const group of ["prefix", "suffix"] as const) {
    const count = goal.affixes.filter((affix) => !affix.sealed && groupOf(catalog, affix.id) === group).length;
    if (count > 2) blockers.push(`The target has ${count} unsealed ${group}es. An item only has two ${group} slots.`);
  }

  if (sealedNow) {
    const wanted = goal.affixes.find((affix) => affix.id === sealedNow.id);
    if (!wanted && goal.exact) blockers.push(`${name(sealedNow.id)} is already sealed, and a sealed affix cannot be removed.`);
    if (wanted && !wanted.sealed) blockers.push(`${name(sealedNow.id)} is sealed on the starting item, and a seal cannot be opened.`);
    if (wanted?.sealed && sealedNow.tier < wanted.minTier) blockers.push(`${name(sealedNow.id)} is sealed at tier ${sealedNow.tier} and cannot be upgraded.`);
    const otherSeal = goal.affixes.find((affix) => affix.sealed && affix.id !== sealedNow.id);
    if (otherSeal) blockers.push(`The item is already sealed with ${name(sealedNow.id)}, so ${name(otherSeal.id)} cannot be sealed as well.`);
  }

  const supply = unsealed(state).filter((affix) => affix.tier >= 6).map((affix) => affix.tier);
  const demand = goal.affixes.filter((affix) => !affix.sealed && affix.minTier >= 6);
  if (!canAssignExalted(supply, demand.map((affix) => affix.minTier))) {
    const missing = demand.filter((affix) => {
      const have = state.affixes.find((item) => item.id === affix.id && !item.sealed);
      return !have || have.tier < affix.minTier;
    });
    const label = missing.map((affix) => `${name(affix.id)} T${affix.minTier}`).join(", ");
    blockers.push(
      `Shards stop at tier 5, so ${label || "that exalted affix"} has to come from a tier already on the item. Rune of Havoc only moves tiers that are already there, and this item does not have enough tier 6+ affixes.`,
    );
  }

  return [...new Set(blockers)];
}

function materialLines(materials: Record<string, number>): string[] {
  const lines: string[] = [];
  if (materials.shard) lines.push(`${materials.shard} affix shard${materials.shard === 1 ? "" : "s"}`);
  if (materials.hope) lines.push(`${materials.hope} Glyph of Hope`);
  if (materials.seal) lines.push(`${materials.seal} Glyph of Despair`);
  if (materials.chaos) lines.push(`${materials.chaos} Glyph of Chaos`);
  if (materials.removal) lines.push(`${materials.removal} Rune of Removal`);
  if (materials.havoc) lines.push(`${materials.havoc} Rune of Havoc`);
  if (materials.redemption) lines.push(`${materials.redemption} Rune of Redemption`);
  return lines;
}

function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export type SolverInput = {
  state: ItemState;
  goal: Goal;
  catalog: AffixDef[];
  slot: SlotId;
  itemClass: ItemClass;
  fpType: FpType;
  rules: RuleConfig;
  iterations?: number;
};

export function planCraft(input: SolverInput): PlanResult {
  const anyLines = input.goal.affixes.filter((affix) => affix.any).length;
  input = {
    ...input,
    goal: {
      ...input.goal,
      exact: anyLines > 0 ? false : input.goal.exact,
      affixes: input.goal.affixes.filter((affix) => !affix.any),
    },
  };
  const rules: RuleConfig = {
    ...input.rules,
    critChance: Math.min(1, input.rules.critChance + (input.fpType === "blood" ? input.rules.bloodCritBonus : 0)),
    icePreserveChance: input.fpType === "ice" ? input.rules.icePreserveChance : 0,
  };
  const blockers = diagnose(input.state, input.goal, input.catalog, input.slot, input.itemClass);
  const notes = plannerNotes(input.fpType, rules);
  if (anyLines > 0) {
    notes.unshift(`${anyLines === 1 ? "One line is" : `${anyLines} lines are`} Any affix. Those can stay as they are, and Forging Potential is spent on the lines you named.`);
  }
  if (anyLines > 0 && input.goal.affixes.length === 0) {
    const message = "Name the affixes you want. Any affix is a line you can leave alone.";
    return emptyResult("impossible", "This craft is not possible.", message, [message], notes);
  }
  if (blockers.length) {
    return emptyResult("impossible", "This craft is not possible.", blockers[0], blockers, notes);
  }
  if (meetsGoal(input.state, input.goal)) {
    return {
      ...emptyResult("guaranteed", "The item is already there.", "Nothing in the forge is required.", [], notes),
      successChance: 1,
      guaranteed: true,
      medianFp: input.state.fp,
      guaranteeFp: input.goal.minFp,
    };
  }

  const iterations = input.iterations ?? 2000;
  const seed = hashSeed(JSON.stringify({ state: input.state, goal: input.goal, rules, slot: input.slot, itemClass: input.itemClass }));
  const ranked: {
    style: Style;
    chance: number;
    medianFp: number | null;
    reasons: Map<string, number>;
    walk: Walk;
    guaranteeFp: number | null;
  }[] = [];

  for (const style of STYLES) {
    const ctx: Ctx = { catalog: input.catalog, slot: input.slot, itemClass: input.itemClass, goal: input.goal, rules, style };
    const walk = walkPlan(input.state, ctx);
    const guaranteeFp = walk.reached && !walk.risky ? fpRequired(walk.costs, input.goal.minFp) : null;
    const styleGuaranteed = guaranteeFp !== null && input.state.fp >= guaranteeFp;
    if (!walk.reached) {
      ranked.push({ style, chance: 0, medianFp: null, reasons: new Map(), walk, guaranteeFp: null });
      continue;
    }
    if (styleGuaranteed) {
      ranked.push({ style, chance: 1, medianFp: null, reasons: new Map(), walk, guaranteeFp });
      continue;
    }
    const sim = simulate(input.state, ctx, iterations, seed + style.id.length * 10007);
    ranked.push({ style, chance: sim.chance, medianFp: sim.medianFp, reasons: sim.reasons, walk, guaranteeFp });
  }

  ranked.sort((a, b) => b.chance - a.chance || (b.medianFp ?? -1) - (a.medianFp ?? -1) || a.walk.steps.length - b.walk.steps.length);
  const best = ranked.find((entry) => entry.walk.reached) ?? ranked[0];
  if (!best.walk.reached) {
    return emptyResult(
      "impossible",
      "This craft is not possible.",
      "No forge sequence turns the starting item into the target, even if Forging Potential never runs out.",
      ["No forge sequence turns the starting item into the target, even if Forging Potential never runs out."],
      notes,
    );
  }

  const guaranteeFp = best.guaranteeFp;
  const guaranteed = guaranteeFp !== null && input.state.fp >= guaranteeFp;
  const chance = guaranteed ? 1 : best.chance;
  const verdict = guaranteed ? "guaranteed" : chance >= 0.55 ? "likely" : chance >= 0.12 ? "risky" : chance > 0 ? "unlikely" : "impossible";
  const headline = headlineFor(verdict, chance);
  const failures = [...best.reasons.entries()]
    .map(([reason, count]) => ({ reason, share: count / iterations }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 3);

  const shown = displayedStrategy(best.style, best.walk.steps);
  const clears = clearComparison(ranked);
  if (hasSeal(input.state) && clears.length > 0 && clears.every((option) => option.tool !== "Seal")) {
    notes.unshift("The item already has a sealed affix, so Glyph of Despair cannot free another slot. Chaos and Removal are the remaining ways to open it.");
  }
  return {
    verdict,
    headline,
    summary: summaryFor({ ...best, style: { ...best.style, name: shown.name } }, guaranteeFp, input.state.fp, guaranteed),
    successChance: chance,
    guaranteed,
    steps: best.walk.steps,
    strategyName: shown.name,
    strategyBlurb: shown.blurb,
    materials: materialLines(best.walk.materials),
    typicalSpend: best.walk.typicalSpend,
    guaranteeFp,
    medianFp: best.medianFp,
    failureReasons: failures,
    alternatives: ranked
      .filter((entry) => entry.style.id !== best.style.id && entry.walk.reached && Math.abs(entry.chance - chance) > 0.02)
      .slice(0, 3)
      .map((entry) => ({ name: displayedStrategy(entry.style, entry.walk.steps).name, chance: entry.chance })),
    clears,
    blockers: [],
    notes,
  };
}

function clearComparison(ranked: { style: Style; chance: number; walk: Walk }[]): PlanResult["clears"] {
  const tools = [
    { junk: "seal" as const, tool: "Seal", mark: "Despair" },
    { junk: "chaos" as const, tool: "Chaos", mark: "Chaos" },
    { junk: "removal" as const, tool: "Removal", mark: "Removal" },
  ];
  const options = tools.flatMap((tool) => {
    const matches = ranked.filter((entry) =>
      entry.style.junk === tool.junk
      && entry.walk.reached
      && entry.walk.steps.some((step) => step.title.includes(tool.mark)),
    );
    if (!matches.length) return [];
    const best = matches.reduce((left, right) => right.chance > left.chance ? right : left);
    const step = best.walk.steps.find((item) => item.title.includes(tool.mark));
    return [{
      tool: tool.tool,
      chance: best.chance,
      when: best.style.blockTiming === "after-havoc" ? "after a line is added for Havoc" : "before another line is added",
      roll: step?.odds ?? null,
    }];
  });
  return options.sort((left, right) => right.chance - left.chance);
}

function displayedStrategy(style: Style, steps: PlanStep[]): { name: string; blurb: string } {
  const titled = (word: string) => steps.some((step) => step.title.includes(word));
  if (!titled("Despair") && !titled("Chaos") && !titled("Removal") && !titled("Havoc") && !titled("Redemption")) {
    return {
      name: "Glyph of Hope, cheapest tier first",
      blurb: "Upgrade whichever affix is sitting on the lowest tier, with Hope on every shard craft. Nothing in this route can miss.",
    };
  }
  const used = titled("Despair") ? "seal" : titled("Redemption") ? "redemption" : titled("Chaos") ? "chaos" : titled("Removal") ? "removal" : style.junk;
  if (used === "chaos" && style.junk !== "chaos") {
    return {
      name: "Chaos the spare affix",
      blurb: "Glyph of Chaos turns the blocking affix into the missing one.",
    };
  }
  if (used === "removal" && style.junk !== "removal") {
    return {
      name: "Strip the spare affix",
      blurb: "Rune of Removal opens the blocked slot.",
    };
  }
  return { name: style.name, blurb: style.blurb };
}

function plannerNotes(fpType: FpType, rules: RuleConfig): string[] {
  const notes = [
    "Season 5, Rage of the Frostborn. Shard crafts use Hope. The plan assumes each risky craft hits on the first try; the percentage is from simulating misses, critical successes, and Forging Potential rolls.",
    rules.luckyFpRoll
      ? "Forging Potential uses the lower of two rolls, which is how experienced crafters describe the forge."
      : "Forging Potential uses a single roll inside the range.",
  ];
  if (fpType === "ice" && rules.icePreserveChance <= 0) {
    notes.push("Ice Forging Potential is selected, but its preserve chance is 0%, so it is treated as standard Forging Potential. EHG has not published the real rate.");
  }
  if (fpType === "blood" && rules.bloodCritBonus <= 0) {
    notes.push("Blood Forging Potential is selected, but no crit bonus is entered, so crit stays at the base rate. EHG has not published the bonus.");
  }
  notes.push("Chaos and Redemption odds include the affixes in this app plus the extra unlisted outcomes in the rules. Legendary Potential slams, corruption, and Weaver items are a different bench.");
  return notes;
}

function headlineFor(verdict: PlanResult["verdict"], chance: number): string {
  if (verdict === "guaranteed") return "Yes. This finishes even on the worst Forging Potential rolls.";
  if (verdict === "likely") return `Yes. About ${formatChance(chance)} of simulated crafts finish.`;
  if (verdict === "risky") return `Possible. About ${formatChance(chance)} of simulated crafts finish.`;
  if (verdict === "unlikely") return `A long shot. About ${formatChance(chance)} of simulated crafts finish.`;
  return "No. This item does not become that item.";
}

function summaryFor(
  best: { style: Style; chance: number; walk: Walk },
  guaranteeFp: number | null,
  fp: number,
  guaranteed: boolean,
): string {
  if (guaranteed && guaranteeFp !== null) {
    return `${best.style.name} is the route. ${guaranteeFp} Forging Potential covers every craft at the maximum roll, and this item has ${fp}.`;
  }
  if (guaranteeFp !== null) {
    return `${best.style.name} is the route. It would be guaranteed at ${guaranteeFp} Forging Potential. This item has ${fp}, so Hope, crits, and low rolls have to carry the rest.`;
  }
  if (best.chance <= 0) {
    return `${best.style.name} is the shape of a craft that can get there, and the simulations never finished it.`;
  }
  return `${best.style.name} is the route with the highest finish rate. The risky steps are where the craft usually dies.`;
}

function emptyResult(
  verdict: PlanResult["verdict"],
  headline: string,
  summary: string,
  blockers: string[],
  notes: string[],
): PlanResult {
  return {
    verdict,
    headline,
    summary,
    successChance: 0,
    guaranteed: false,
    steps: [],
    strategyName: "",
    strategyBlurb: "",
    materials: [],
    typicalSpend: null,
    guaranteeFp: null,
    medianFp: null,
    failureReasons: [],
    alternatives: [],
    clears: [],
    blockers,
    notes,
  };
}
