import { describe, expect, it } from "vitest";
import { AFFIXES } from "./affixes";
import { expectedRoll, sealChance } from "./rules";
import { planCraft } from "./solver";
import { DEFAULT_RULES, type ItemState } from "./types";

const base = {
  catalog: AFFIXES,
  slot: "helmet" as const,
  itemClass: "none" as const,
  fpType: "standard" as const,
  rules: DEFAULT_RULES,
  iterations: 400,
};

describe("forge rules", () => {
  it("matches the published seal table", () => {
    expect(sealChance(1, 4, true)).toBe(1);
    expect(sealChance(2, 4, true)).toBeCloseTo(0.69);
    expect(sealChance(1, 3, true)).toBeCloseTo(0.945);
    expect(sealChance(3, 4, true)).toBeCloseTo(0.345);
    expect(sealChance(4, 4, true)).toBeCloseTo(0.15);
    expect(sealChance(1, 4, false)).toBeCloseTo(0.84);
    expect(sealChance(2, 3, false)).toBeCloseTo(0.483);
  });

  it("uses the lower of two forging potential rolls", () => {
    expect(expectedRoll(10, true)).toBeCloseTo(3.85);
    expect(expectedRoll(10, false)).toBeCloseTo(5.5);
  });
});

describe("planCraft", () => {
  it("guarantees a tier 5 when forging potential covers the worst rolls", () => {
    const state: ItemState = { fp: 41, affixes: [{ id: "health", tier: 1, sealed: false }] };
    const plan = planCraft({
      ...base,
      state,
      goal: { affixes: [{ id: "health", minTier: 5, sealed: false }], exact: false, minFp: 0 },
    });
    expect(plan.verdict).toBe("guaranteed");
    expect(plan.successChance).toBe(1);
    expect(plan.guaranteeFp).toBe(41);
    expect(plan.steps.map((step) => step.title)).toEqual([
      "Glyph of Hope: upgrade Health to tier 2",
      "Glyph of Hope: upgrade Health to tier 3",
      "Glyph of Hope: upgrade Health to tier 4",
      "Glyph of Hope: upgrade Health to tier 5",
    ]);
  });

  it("refuses to guarantee a craft one point short of the worst case", () => {
    const plan = planCraft({
      ...base,
      state: { fp: 40, affixes: [{ id: "health", tier: 1, sealed: false }] },
      goal: { affixes: [{ id: "health", minTier: 5, sealed: false }], exact: false, minFp: 0 },
    });
    expect(plan.guaranteed).toBe(false);
    expect(plan.successChance).toBeGreaterThan(0.5);
    expect(plan.guaranteeFp).toBe(41);
  });

  it("spends forging potential on the named lines and leaves Any affix slots alone", () => {
    const plan = planCraft({
      ...base,
      slot: "two-hand",
      iterations: 1000,
      state: {
        fp: 39,
        affixes: [
          { id: "melee-fire-damage", tier: 4, sealed: false },
          { id: "increased-physical-damage", tier: 3, sealed: false },
          { id: "minion-melee-spell-damage", tier: 7, sealed: false },
        ],
      },
      goal: {
        affixes: [
          { id: "melee-fire-damage", minTier: 7, sealed: false },
          { id: "crit-multi", minTier: 5, sealed: false },
          { id: "any-1", minTier: 1, sealed: false, any: true },
          { id: "any-2", minTier: 1, sealed: false, any: true },
        ],
        exact: false,
        minFp: 0,
      },
    });
    expect(plan.steps.map((step) => step.title)).toEqual([
      "Glyph of Hope: add any suffix at tier 1",
      "Rune of Havoc, with Glyph of Hope",
      "Glyph of Despair: seal Increased Physical Damage",
      "Glyph of Hope: add Critical Strike Multiplier at tier 1",
      "Glyph of Hope: upgrade Critical Strike Multiplier to tier 2",
      "Glyph of Hope: upgrade Critical Strike Multiplier to tier 3",
      "Glyph of Hope: upgrade Critical Strike Multiplier to tier 4",
      "Glyph of Hope: upgrade Critical Strike Multiplier to tier 5",
    ]);
    expect(plan.steps[0].detail).toMatch(/any suffix this item can roll/);
    expect(plan.steps[2].odds).toMatch(/4 affix/);
    expect(plan.clears.map((option) => option.tool)).toEqual(["Seal", "Removal", "Chaos"]);
    expect(plan.clears[0].chance).toBeGreaterThan(plan.clears[1].chance);
    expect(plan.clears[1].chance).toBeGreaterThan(plan.clears[2].chance);
    expect(plan.successChance).toBeGreaterThan(0.1);
    expect(plan.notes[0]).toMatch(/Any affix/);
  });

  it("blocks a tier 7 that is not already on the item", () => {
    const plan = planCraft({
      ...base,
      state: { fp: 80, affixes: [{ id: "health", tier: 5, sealed: false }] },
      goal: { affixes: [{ id: "health", minTier: 7, sealed: false }], exact: false, minFp: 0 },
    });
    expect(plan.verdict).toBe("impossible");
    expect(plan.blockers[0]).toMatch(/tier 5/i);
  });

  it("finds a seal to open a prefix on an exalted helmet", () => {
    const plan = planCraft({
      ...base,
      iterations: 700,
      state: {
        fp: 42,
        affixes: [
          { id: "strength", tier: 7, sealed: false },
          { id: "armor", tier: 2, sealed: false },
          { id: "fire-res", tier: 1, sealed: false },
        ],
      },
      goal: {
        exact: false,
        minFp: 0,
        affixes: [
          { id: "strength", minTier: 7, sealed: false },
          { id: "vitality", minTier: 5, sealed: false },
          { id: "health", minTier: 5, sealed: false },
          { id: "fire-res", minTier: 5, sealed: false },
        ],
      },
    });
    expect(plan.blockers).toEqual([]);
    expect(plan.successChance).toBeGreaterThan(0.15);
    expect(plan.steps.some((step) => /seal armor/i.test(step.title))).toBe(true);
    expect(plan.strategyName.toLowerCase()).toMatch(/seal/);
  });

  it("uses chaos or removal when the item already has a sealed affix", () => {
    const plan = planCraft({
      ...base,
      slot: "two-hand",
      iterations: 600,
      state: {
        fp: 39,
        affixes: [
          { id: "melee-fire-damage", tier: 4, sealed: false },
          { id: "increased-physical-damage", tier: 3, sealed: false },
          { id: "minion-melee-spell-damage", tier: 7, sealed: false },
          { id: "fire-penetration-and-minion-fire-penetration", tier: 1, sealed: true },
        ],
      },
      goal: {
        affixes: [
          { id: "melee-fire-damage", minTier: 7, sealed: false },
          { id: "crit-multi", minTier: 5, sealed: false },
          { id: "any-1", minTier: 1, sealed: false, any: true },
          { id: "any-2", minTier: 1, sealed: false, any: true },
        ],
        exact: false,
        minFp: 0,
      },
    });
    expect(plan.steps.some((step) => step.title.includes("Despair"))).toBe(false);
    expect(plan.clears.map((option) => option.tool).sort()).toEqual(["Chaos", "Removal"]);
    expect(plan.notes[0]).toMatch(/already has a sealed affix/);
    expect(plan.steps[0].title).toMatch(/Removal|Chaos/);
  });

  it("rejects a second seal", () => {
    const plan = planCraft({
      ...base,
      state: {
        fp: 40,
        affixes: [
          { id: "health", tier: 1, sealed: true },
          { id: "strength", tier: 5, sealed: false },
        ],
      },
      goal: {
        exact: false,
        minFp: 0,
        affixes: [
          { id: "health", minTier: 1, sealed: true },
          { id: "armor", minTier: 1, sealed: true },
        ],
      },
    });
    expect(plan.verdict).toBe("impossible");
  });

  it("keeps a dropped tier 6 seal and refuses to create one", () => {
    const state: ItemState = {
      fp: 40,
      affixes: [
        { id: "increased-void-damage", tier: 3, sealed: false },
        { id: "increased-poison-damage", tier: 5, sealed: false },
        { id: "chance-to-chill", tier: 3, sealed: false },
        { id: "chance-to-shock", tier: 7, sealed: false },
        { id: "chance-to-slow", tier: 6, sealed: true },
      ],
    };
    const kept = planCraft({
      ...base,
      slot: "two-hand",
      iterations: 400,
      state,
      goal: {
        exact: false,
        minFp: 0,
        affixes: [
          { id: "chance-to-slow", minTier: 6, sealed: true },
          { id: "chance-to-shock", minTier: 7, sealed: false },
          { id: "increased-void-damage", minTier: 5, sealed: false },
          { id: "any-1", minTier: 1, sealed: false, any: true },
        ],
      },
    });
    expect(kept.blockers).toEqual([]);
    expect(kept.verdict).not.toBe("impossible");
    expect(kept.steps.some((step) => /chance to slow/i.test(step.title))).toBe(false);
    expect(kept.notes.some((note) => /already sealed at tier 6/i.test(note))).toBe(true);

    const created = planCraft({
      ...base,
      slot: "two-hand",
      state: { fp: 40, affixes: [{ id: "chance-to-slow", tier: 6, sealed: false }] },
      goal: { affixes: [{ id: "chance-to-slow", minTier: 6, sealed: true }], exact: false, minFp: 0 },
    });
    expect(created.verdict).toBe("impossible");
    expect(created.blockers[0]).toMatch(/only seals tiers 1–4/);
  });

  it("upgrades health regen with Hope when the exalted tier is already on dexterity", () => {
    const plan = planCraft({
      ...base,
      itemClass: "mage",
      iterations: 800,
      state: {
        fp: 35,
        affixes: [
          { id: "dexterity", tier: 7, sealed: false },
          { id: "mage-chance-to-cast-fire-aura-on-crit", tier: 5, sealed: false },
          { id: "health-regen", tier: 1, sealed: false },
          { id: "void-res", tier: 2, sealed: false },
        ],
      },
      goal: {
        exact: false,
        minFp: 0,
        affixes: [
          { id: "dexterity", minTier: 7, sealed: false },
          { id: "health-regen", minTier: 5, sealed: false },
        ],
      },
    });
    expect(plan.steps.map((step) => step.title)).toEqual([
      "Glyph of Hope: upgrade Health Regen per Second to tier 2",
      "Glyph of Hope: upgrade Health Regen per Second to tier 3",
      "Glyph of Hope: upgrade Health Regen per Second to tier 4",
      "Glyph of Hope: upgrade Health Regen per Second to tier 5",
    ]);
    expect(plan.successChance).toBeGreaterThan(0.5);
  });

  it("applies a set shard without spending a prefix slot or forging potential", () => {
    const plan = planCraft({
      ...base,
      slot: "one-hand",
      state: { fp: 41, affixes: [{ id: "crit-multi", tier: 1, sealed: false }] },
      goal: {
        exact: false,
        minFp: 0,
        affixes: [
          { id: "set-blade-of-the-forgotten-knight", minTier: 1, sealed: false },
          { id: "crit-multi", minTier: 2, sealed: false },
        ],
      },
    });
    expect(plan.verdict).not.toBe("impossible");
    expect(plan.steps[0].title).toMatch(/Set shard: Blade of the Forgotten Knight/);
    expect(plan.steps[0].detail).toMatch(/One-Handed Sword/);
    expect(plan.steps.some((step) => step.title.includes("Critical Strike Multiplier"))).toBe(true);
    expect(plan.materials.some((line) => line.includes("Blade of the Forgotten Knight"))).toBe(true);

    const wrongClass = planCraft({
      ...base,
      slot: "helmet",
      itemClass: "mage",
      state: { fp: 20, affixes: [] },
      goal: { affixes: [{ id: "set-doppelgangers-facade", minTier: 1, sealed: false }], exact: false, minFp: 0 },
    });
    expect(wrongClass.verdict).toBe("impossible");
    expect(wrongClass.blockers[0]).toMatch(/Rogue Helmet/);
  });
});
