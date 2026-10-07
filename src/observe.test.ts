import { describe, expect, it } from "vitest";
import { AFFIXES } from "./affixes";
import { resolveCraft } from "./observe";
import { planCraft } from "./solver";
import { DEFAULT_RULES, type ItemState } from "./types";

const origin: ItemState = { fp: 41, affixes: [{ id: "health", tier: 1, sealed: false }] };

function craft(input: Parameters<typeof resolveCraft>[1], state: ItemState = origin) {
  return resolveCraft(state, input, AFFIXES, "body", "none");
}

describe("resolveCraft", () => {
  it("records an upgrade and the forging potential left afterwards", () => {
    const result = craft({
      action: { type: "upgrade", id: "health" },
      fpAfter: 30,
      critAffixId: null,
      sealFailed: false,
      becameId: null,
      removedId: null,
      havocTiers: null,
      redemption: null,
    });
    expect(result.ok).toBe(true);
    expect(result.state).toEqual({ fp: 30, affixes: [{ id: "health", tier: 2, sealed: false }] });
  });

  it("lets a critical success raise the affix a second time and shortens the remaining plan", () => {
    const result = craft({
      action: { type: "upgrade", id: "health" },
      fpAfter: 41,
      critAffixId: "health",
      sealFailed: false,
      becameId: null,
      removedId: null,
      havocTiers: null,
      redemption: null,
    });
    expect(result.state?.affixes[0].tier).toBe(3);
    const plan = planCraft({
      state: result.state!,
      goal: { affixes: [{ id: "health", minTier: 5, sealed: false }], exact: false, minFp: 0 },
      catalog: AFFIXES,
      slot: "body",
      itemClass: "none",
      fpType: "standard",
      iterations: 200,
      rules: DEFAULT_RULES,
    });
    expect(plan.verdict).toBe("guaranteed");
    expect(plan.steps.map((step) => step.title)).toEqual([
      "Glyph of Hope: upgrade Health to tier 4",
      "Glyph of Hope: upgrade Health to tier 5",
    ]);
  });

  it("turns a spare affix into the one chaos hit", () => {
    const state: ItemState = {
      fp: 40,
      affixes: [
        { id: "strength", tier: 2, sealed: false },
        { id: "health", tier: 1, sealed: false },
      ],
    };
    const result = craft({
      action: { type: "chaos", id: "strength" },
      fpAfter: 28,
      critAffixId: null,
      sealFailed: false,
      becameId: "vitality",
      removedId: null,
      havocTiers: null,
      redemption: null,
    }, state);
    expect(result.ok).toBe(true);
    expect(result.state?.affixes.find((affix) => affix.id === "vitality")).toEqual({ id: "vitality", tier: 3, sealed: false });
    expect(result.note).toMatch(/Vitality at tier 3/);
  });

  it("upgrades an affix when the seal fails", () => {
    const state: ItemState = { fp: 20, affixes: [{ id: "armor", tier: 2, sealed: false }] };
    const result = craft({
      action: { type: "seal", id: "armor" },
      fpAfter: 14,
      critAffixId: null,
      sealFailed: true,
      becameId: null,
      removedId: null,
      havocTiers: null,
      redemption: null,
    }, state);
    expect(result.state?.affixes[0]).toEqual({ id: "armor", tier: 3, sealed: false });
  });

  it("rejects a havoc result that invents a tier", () => {
    const state: ItemState = {
      fp: 20,
      affixes: [
        { id: "strength", tier: 7, sealed: false },
        { id: "armor", tier: 2, sealed: false },
        { id: "health", tier: 1, sealed: false },
        { id: "fire-res", tier: 1, sealed: false },
      ],
    };
    const result = craft({
      action: { type: "havoc" },
      fpAfter: 10,
      critAffixId: null,
      sealFailed: false,
      becameId: null,
      removedId: null,
      havocTiers: [
        { id: "strength", tier: 7 },
        { id: "armor", tier: 7 },
        { id: "health", tier: 1 },
        { id: "fire-res", tier: 1 },
      ],
      redemption: null,
    }, state);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/rearranges/i);
  });
});
