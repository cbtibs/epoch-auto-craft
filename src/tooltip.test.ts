import { describe, expect, it } from "vitest";
import { AFFIXES } from "./affixes";
import { parseTooltip, tierInLine } from "./tooltip";

const helm = `
Exalted Solarum Helm
Helmet

+24 Armor

Forging Potential: 42

+7 Strength
Tier 7

+18 Armor
Tier 2

+12% Fire Resistance
Tier 1
`;

describe("parseTooltip", () => {
  it("reads forging potential and affixes, and skips the implicit above it", () => {
    const read = parseTooltip(helm, AFFIXES, "ring", "none");
    expect(read.fp).toBe(42);
    expect(read.slot).toBe("helmet");
    expect(read.affixes.map((affix) => [affix.id, affix.tier])).toEqual([
      ["strength", 7],
      ["armor", 2],
      ["fire-res", 1],
    ]);
  });

  it("keeps a tier that sits on the next line and a sealed affix", () => {
    const read = parseTooltip(`
Rare
Body Armour
Requires: Mage
Forging Potential: 18
Prefixes
+12 Intelligence
Tier 4
Sealed Affix
+22% Cold Resistance
Tier 3
`, AFFIXES, "helmet", "none");
    expect(read.slot).toBe("body");
    expect(read.itemClass).toBe("mage");
    expect(read.affixes.map((affix) => [affix.id, affix.tier, affix.sealed])).toEqual([
      ["intelligence", 4, false],
      ["cold-res", 3, true],
    ]);
  });

  it("understands armour spelling and a tier badge on the same line", () => {
    const read = parseTooltip(`
Boots
Forging Potential: 9
T5 Increased Armour
+3% Movement Speed
Tier 2
`, AFFIXES, "boots", "none");
    expect(read.affixes.map((affix) => affix.id)).toEqual(["increased-armor", "movement-speed"]);
    expect(read.affixes[0].tier).toBe(5);
  });

  it("reads the staff screenshot, keeping the hybrid minion suffix as one affix", () => {
    const read = parseTooltip(`
FLAMING BLADED STAFF OF )
BRUTALITY |
TWO-HANDED STAFF |
f RANGE 2.6M
I BASE ATTACK RATE 0.98 - Average
| +94 MELEE DAMAGE
i Range: 94 to 94
} +103 SPELL DAMAGE
/ Range: 84 to 104
+1 TO MELEE ATTACKS
- Range: 1to1
“37 39 FORGING POTENTIAL
PREFIXES
+30 MELEE FIRE DAMAGE
y Tier: 4
Range: 29 to 37
82% INCREASED PHYSICAL DAMAGE
> Tier: 3
Range: 70% to 96%
SUFFIXES
+52 MINION MELEE DAMAGE
+52 MINION SPELL DAMAGE
Tier: 7 (drop only)
Range: 48 to 59
Range: 48 to 59
& 194 Requires: Level 74
Cannot be Traded
`, AFFIXES, "helmet", "none");
    expect(read.fp).toBe(39);
    expect(read.slot).toBe("two-hand");
    expect(read.itemClass).toBeNull();
    expect(read.affixes.map((affix) => [affix.id, affix.tier, affix.tierKnown])).toEqual([
      ["melee-fire-damage", 4, true],
      ["increased-physical-damage", 3, true],
      ["minion-melee-spell-damage", 7, true],
    ]);
  });

  it("does not treat the rolled number as the tier", () => {
    expect(tierInLine("+7 Strength")).toBeNull();
    expect(tierInLine("Tier 7")).toBe(7);
    expect(tierInLine("+18 Strength T2")).toBe(2);
    expect(tierInLine("7 +18 Strength")).toBe(7);
  });
});
