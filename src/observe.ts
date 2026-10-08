import { affixName, printedName } from "./affixes";
import type { Action, AffixDef, AffixGroup, AffixState, ItemClass, ItemState, SlotId } from "./types";

export type CraftInput = {
  action: Action;
  fpAfter: number;
  critAffixId: string | null;
  sealFailed: boolean;
  becameId: string | null;
  removedId: string | null;
  havocTiers: { id: string; tier: number }[] | null;
  redemption: { fromId: string; toId: string }[] | null;
};

export type CraftResult = {
  ok: boolean;
  state: ItemState | null;
  note: string;
  reason: string;
  critOptions: AffixState[];
};

export function otherAffixes(
  catalog: AffixDef[],
  slot: SlotId,
  itemClass: ItemClass,
  affixes: AffixState[],
  id: string,
): AffixDef[] {
  const self = catalog.find((affix) => affix.id === id);
  if (!self) return [];
  const present = new Set(affixes.map((affix) => affix.id));
  return catalog.filter((affix) => affix.group === self.group && affix.group !== "set" && affix.id !== id && !present.has(affix.id) && allowed(affix, slot, itemClass));
}

export function critCandidates(state: ItemState): AffixState[] {
  return state.affixes.filter((affix) => !affix.sealed && affix.tier < 5);
}

export function resolveCraft(
  origin: ItemState,
  input: CraftInput,
  catalog: AffixDef[],
  slot: SlotId,
  itemClass: ItemClass,
): CraftResult {
  const state = clone(origin);
  const main = applyMain(state, input, catalog, slot, itemClass);
  if (!main.ok) return { ok: false, state: null, note: "", reason: main.reason, critOptions: [] };
  const critOptions = critCandidates(state).filter((affix) => catalog.find((def) => def.id === affix.id)?.group !== "set").map((affix) => ({ ...affix }));
  if (!Number.isFinite(input.fpAfter) || input.fpAfter < 0) {
    return { ok: false, state: null, note: "", reason: "Enter the Forging Potential left on the item.", critOptions };
  }
  state.fp = Math.round(input.fpAfter);
  let note = describeCraft(origin, state, input, catalog);
  if (input.critAffixId) {
    const crit = state.affixes.find((affix) => affix.id === input.critAffixId && !affix.sealed && affix.tier < 5);
    if (!crit) {
      return {
        ok: false,
        state: null,
        note: "",
        reason: "Critical success can only raise an open affix that is still below tier 5.",
        critOptions,
      };
    }
    crit.tier += 1;
    note += ` Critical success also raised ${affixName(catalog, crit.id)} to tier ${crit.tier}.`;
  }
  return { ok: true, state, note, reason: "", critOptions };
}

function applyMain(
  state: ItemState,
  input: CraftInput,
  catalog: AffixDef[],
  slot: SlotId,
  itemClass: ItemClass,
): { ok: true } | { ok: false; reason: string } {
  const action = input.action;
  if (action.type === "add") return applyAdd(state, action.id, catalog, slot, itemClass);
  if (action.type === "upgrade") return applyUpgrade(state, action.id, catalog);
  if (action.type === "seal") return applySeal(state, action.id, input.sealFailed, catalog);
  if (action.type === "chaos") return applyChaos(state, action.id, input.becameId, catalog, slot, itemClass);
  if (action.type === "removal") return applyRemoval(state, input.removedId, catalog);
  if (action.type === "havoc") return applyHavoc(state, input.havocTiers, catalog);
  return applyRedemption(state, input.redemption, catalog, slot, itemClass);
}

function applyAdd(state: ItemState, id: string, catalog: AffixDef[], slot: SlotId, itemClass: ItemClass): { ok: true } | { ok: false; reason: string } {
  const def = catalog.find((affix) => affix.id === id);
  if (!def) return { ok: false, reason: "Choose the affix that was added." };
  if (state.affixes.some((affix) => affix.id === id)) return { ok: false, reason: `${printedName(def)} is already on the item.` };
  if (!allowed(def, slot, itemClass)) {
    if (def.group === "set") {
      return { ok: false, reason: `${printedName(def)} only goes on a ${def.class ? `${def.class.charAt(0).toUpperCase()}${def.class.slice(1)} ` : ""}${def.itemType ?? "matching item"}.` };
    }
    if (def.class && def.slots.includes(slot) && itemClass !== def.class) {
      const who = def.class.charAt(0).toUpperCase() + def.class.slice(1);
      return { ok: false, reason: `${printedName(def)} only rolls on ${who} items.` };
    }
    return { ok: false, reason: `${printedName(def)} cannot be added to this item.` };
  }
  if (def.group === "set") {
    if (state.affixes.some((affix) => catalog.find((item) => item.id === affix.id)?.group === "set")) {
      return { ok: false, reason: "The item already has a set shard." };
    }
    state.affixes.push({ id, tier: 1, sealed: false });
    return { ok: true };
  }
  if (openSlots(state, def.group, catalog) <= 0) {
    return { ok: false, reason: `The ${def.group} side is full. Seal or remove an affix first.` };
  }
  state.affixes.push({ id, tier: 1, sealed: false });
  return { ok: true };
}

function applyUpgrade(state: ItemState, id: string, catalog: AffixDef[]): { ok: true } | { ok: false; reason: string } {
  if (catalog.find((item) => item.id === id)?.group === "set") return { ok: false, reason: "A set shard is applied once. Affix shards do not raise it." };
  const affix = state.affixes.find((item) => item.id === id && !item.sealed);
  if (!affix) return { ok: false, reason: `${affixName(catalog, id)} is not an open affix on this item.` };
  if (affix.tier >= 5) return { ok: false, reason: "Shards cannot raise an affix past tier 5." };
  affix.tier += 1;
  return { ok: true };
}

function applySeal(state: ItemState, id: string, failed: boolean, catalog: AffixDef[]): { ok: true } | { ok: false; reason: string } {
  if (catalog.find((item) => item.id === id)?.group === "set") return { ok: false, reason: "A set shard cannot be sealed." };
  if (state.affixes.some((affix) => affix.sealed)) return { ok: false, reason: "The item already has a sealed affix." };
  const affix = state.affixes.find((item) => item.id === id && !item.sealed);
  if (!affix) return { ok: false, reason: "Choose the affix you tried to seal." };
  if (affix.tier > 4) return { ok: false, reason: "Glyph of Despair only seals up to tier 4." };
  if (failed) affix.tier += 1;
  else affix.sealed = true;
  return { ok: true };
}

function applyChaos(
  state: ItemState,
  id: string,
  becameId: string | null,
  catalog: AffixDef[],
  slot: SlotId,
  itemClass: ItemClass,
): { ok: true } | { ok: false; reason: string } {
  if (catalog.find((item) => item.id === id)?.group === "set") return { ok: false, reason: "Glyph of Chaos cannot change a set shard." };
  const affix = state.affixes.find((item) => item.id === id && !item.sealed);
  if (!affix) return { ok: false, reason: "Choose the affix you used Glyph of Chaos on." };
  if (affix.tier >= 5) return { ok: false, reason: "Glyph of Chaos cannot be used on a tier 5 affix." };
  if (!becameId) return { ok: false, reason: "Pick the affix Chaos turned it into." };
  const options = otherAffixes(catalog, slot, itemClass, state.affixes, id);
  if (!options.some((option) => option.id === becameId)) return { ok: false, reason: "Chaos cannot turn it into that affix." };
  affix.tier += 1;
  affix.id = becameId;
  return { ok: true };
}

function applyRemoval(state: ItemState, removedId: string | null, catalog: AffixDef[]): { ok: true } | { ok: false; reason: string } {
  if (!removedId) return { ok: false, reason: "Pick the affix Removal took off." };
  if (catalog.find((item) => item.id === removedId)?.group === "set") return { ok: false, reason: "A set shard cannot be removed." };
  const target = state.affixes.find((affix) => affix.id === removedId && !affix.sealed);
  if (!target) return { ok: false, reason: `${affixName(catalog, removedId)} is not an open affix.` };
  state.affixes = state.affixes.filter((affix) => affix !== target);
  return { ok: true };
}

function applyHavoc(state: ItemState, tiers: { id: string; tier: number }[] | null, catalog: AffixDef[]): { ok: true } | { ok: false; reason: string } {
  const open = state.affixes.filter((affix) => !affix.sealed && catalog.find((def) => def.id === affix.id)?.group !== "set");
  if (open.length !== 4 || !open.some((affix) => affix.tier >= 6)) {
    return { ok: false, reason: "Havoc needs four open affixes and an exalted tier." };
  }
  if (!tiers || tiers.length !== open.length) return { ok: false, reason: "Set the tier each affix landed on." };
  const ids = new Set(tiers.map((tier) => tier.id));
  if (open.some((affix) => !ids.has(affix.id))) return { ok: false, reason: "Set the tier each affix landed on." };
  const before = open.map((affix) => affix.tier);
  const after = open.map((affix) => tiers.find((tier) => tier.id === affix.id)?.tier ?? 0);
  if (!sameMultiset(before, after)) return { ok: false, reason: "Havoc only rearranges the tiers already on the item." };
  for (const affix of open) affix.tier = tiers.find((tier) => tier.id === affix.id)?.tier ?? affix.tier;
  return { ok: true };
}

function applyRedemption(
  state: ItemState,
  redemption: { fromId: string; toId: string }[] | null,
  catalog: AffixDef[],
  slot: SlotId,
  itemClass: ItemClass,
): { ok: true } | { ok: false; reason: string } {
  const exalted = state.affixes.filter((affix) => !affix.sealed && affix.tier >= 6);
  if (!exalted.length) return { ok: false, reason: "Redemption needs an exalted affix." };
  const chosen = new Map((redemption ?? []).map((entry) => [entry.fromId, entry.toId]));
  const staying = new Set(state.affixes.filter((affix) => affix.sealed || affix.tier < 6).map((affix) => affix.id));
  const used = new Set(staying);
  for (const affix of exalted) {
    const nextId = chosen.get(affix.id) ?? "";
    const name = affixName(catalog, affix.id);
    if (!nextId || nextId === affix.id) return { ok: false, reason: `Pick what ${name} became.` };
    const self = catalog.find((item) => item.id === affix.id);
    const next = catalog.find((item) => item.id === nextId);
    if (!self || !next || next.group !== self.group || !allowed(next, slot, itemClass) || used.has(nextId)) {
      return { ok: false, reason: `${name} cannot become ${affixName(catalog, nextId)}.` };
    }
    used.add(nextId);
    affix.id = nextId;
  }
  return { ok: true };
}

function describeCraft(before: ItemState, after: ItemState, input: CraftInput, catalog: AffixDef[]): string {
  const name = (id: string) => affixName(catalog, id);
  const action = input.action;
  let line = "The craft resolved.";
  if (action.type === "add") line = `Added ${name(action.id)} at tier 1.`;
  if (action.type === "upgrade") {
    const tier = after.affixes.find((affix) => affix.id === action.id)?.tier;
    line = `Upgraded ${name(action.id)} to tier ${tier}.`;
  }
  if (action.type === "seal") {
    const affix = after.affixes.find((item) => item.id === action.id);
    line = input.sealFailed
      ? `Glyph of Despair failed, so ${name(action.id)} upgraded to tier ${affix?.tier}.`
      : `Sealed ${name(action.id)} at tier ${affix?.tier}.`;
  }
  if (action.type === "chaos") {
    const affix = after.affixes.find((item) => item.id === input.becameId);
    line = `Glyph of Chaos turned ${name(action.id)} into ${name(input.becameId ?? "")} at tier ${affix?.tier}.`;
  }
  if (action.type === "removal") line = `Rune of Removal took off ${name(input.removedId ?? "")}.`;
  if (action.type === "havoc") {
    const moved = after.affixes.filter((affix) => !affix.sealed).map((affix) => `${name(affix.id)} is tier ${affix.tier}`);
    line = `Rune of Havoc rearranged the tiers: ${moved.join(", ")}.`;
  }
  if (action.type === "redemption") {
    const changes = (input.redemption ?? []).map((entry) => `${name(entry.fromId)} became ${name(entry.toId)}`);
    line = `Rune of Redemption rerolled the exalted affixes: ${changes.join(", ")}.`;
  }
  const cost = after.fp === before.fp
    ? ` Forging Potential stayed at ${after.fp}.`
    : ` Forging Potential is now ${after.fp}.`;
  return `${line}${cost}`;
}

function allowed(def: AffixDef, slot: SlotId, itemClass: ItemClass): boolean {
  if (!def.slots.includes(slot)) return false;
  if (def.class && itemClass !== def.class) return false;
  return true;
}

function openSlots(state: ItemState, group: AffixGroup, catalog: AffixDef[]): number {
  const used = state.affixes.filter((affix) => !affix.sealed && (catalog.find((def) => def.id === affix.id)?.group ?? "prefix") === group).length;
  return 2 - used;
}

function sameMultiset(left: number[], right: number[]): boolean {
  const a = [...left].sort((x, y) => x - y);
  const b = [...right].sort((x, y) => x - y);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function clone(state: ItemState): ItemState {
  return { fp: state.fp, affixes: state.affixes.map((affix) => ({ ...affix })) };
}
