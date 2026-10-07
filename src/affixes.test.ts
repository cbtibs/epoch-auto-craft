import { describe, expect, it } from "vitest";
import { AFFIXES } from "./affixes";
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
});
