import { describe, expect, it } from "vitest";
import { AFFIXES, affixChoices, printedName } from "./affixes";
import { parseTooltip } from "./tooltip";
import type { SlotId } from "./types";

function on(slot: SlotId) {
  return AFFIXES.filter((affix) => affix.slots.includes(slot));
}

describe("affix slots", () => {
  it("gives every equipment slot its own roll list", () => {
    const slots: SlotId[] = ["helmet", "body", "gloves", "boots", "belt", "ring", "amulet", "relic", "one-hand", "two-hand", "bow", "catalyst", "shield", "quiver"];
    for (const slot of slots) {
      expect(on(slot).length).toBeGreaterThan(15);
    }
  });

  it("keeps health off weapons and on armour", () => {
    const health = AFFIXES.find((affix) => affix.id === "health");
    expect(health?.slots).toEqual(expect.arrayContaining(["helmet", "boots", "gloves", "body"]));
    expect(health?.slots).not.toContain("two-hand");
    expect(health?.slots).not.toContain("bow");
  });

  it("lets a staff roll the minion fire penetration suffix and not flat health", () => {
    const pen = AFFIXES.find((affix) => affix.id === "fire-penetration-and-minion-fire-penetration");
    expect(pen?.group).toBe("suffix");
    expect(pen?.slots).toContain("two-hand");
    expect(on("two-hand").some((affix) => affix.id === "health")).toBe(false);
    expect(on("boots").some((affix) => affix.id === "movement-speed")).toBe(true);
    expect(on("boots").some((affix) => affix.id === "melee-fire-damage")).toBe(false);
  });

  it("finds increased melee elemental damage on a helmet by the name printed in game", () => {
    const hits = affixChoices(AFFIXES, "helmet", "none", "increased melee elemental damage", new Set());
    expect(hits.map((affix) => affix.id)).toEqual(["mage-increased-melee-elemental-damage"]);
    expect(printedName(hits[0])).toBe("Increased Melee Elemental Damage");
    expect(affixChoices(AFFIXES, "helmet", "sentinel", "increased melee elemental damage", new Set())).toEqual([]);
    expect(affixChoices(AFFIXES, "helmet", "mage", "increased melee elemental damage", new Set()).map((affix) => affix.id)).toEqual([
      "mage-increased-melee-elemental-damage",
    ]);
  });

  it("finds every class affix by the name printed on the item", () => {
    const prefixed = AFFIXES.filter((affix) => affix.class && new RegExp(`^${affix.class}\\s+`, "i").test(affix.name));
    expect(prefixed.length).toBeGreaterThan(60);
    for (const affix of prefixed) {
      for (const slot of affix.slots) {
        const hits = affixChoices(AFFIXES, slot, "none", printedName(affix), new Set());
        expect(hits.map((hit) => hit.id)).toContain(affix.id);
        const read = parseTooltip(`
Item
10 Forging Potential
${affix.group === "suffix" ? "Suffixes" : "Prefixes"}
${printedName(affix)}
Tier 1
Requires: Level 1 ${affix.class}
`, AFFIXES, slot, "none");
        expect(read.itemClass).toBe(affix.class);
        expect(read.affixes.map((row) => row.id)).toContain(affix.id);
      }
    }
  });
});
