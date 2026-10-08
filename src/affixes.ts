import type { AffixDef, AffixGroup, ItemClass, SlotId } from "./types";
import { AFFIX_DATA } from "./affix-data";
import { SET_AFFIXES } from "./set-data";

export const AFFIXES: AffixDef[] = [...AFFIX_DATA, ...SET_AFFIXES];

export function printedName(def: AffixDef): string {
  if (!def.class) return def.name;
  const stripped = def.name.replace(new RegExp(`^${def.class}\\s+`, "i"), "");
  return stripped.length > 0 ? stripped : def.name;
}

export function affixName(catalog: AffixDef[], id: string): string {
  const def = catalog.find((affix) => affix.id === id);
  return def ? printedName(def) : id;
}

export function affixChoices(
  catalog: AffixDef[],
  slot: SlotId,
  itemClass: ItemClass,
  query: string,
  taken: ReadonlySet<string>,
): AffixDef[] {
  const needle = query.trim().toLowerCase();
  return catalog
    .filter((affix) => {
      if (taken.has(affix.id)) return false;
      if (!affix.slots.includes(slot)) return false;
      if (affix.class && itemClass !== "none" && affix.class !== itemClass) return false;
      if (!needle) return affix.group !== "set" && !affix.class;
      const haystack = `${printedName(affix)} ${affix.itemType ?? ""} ${affix.setName ?? ""}`.toLowerCase();
      return haystack.includes(needle);
    })
    .sort((left, right) => {
      const leftName = printedName(left).toLowerCase();
      const rightName = printedName(right).toLowerCase();
      const rank = Number(!leftName.startsWith(needle)) - Number(!rightName.startsWith(needle));
      return rank !== 0 ? rank : leftName.localeCompare(rightName);
    })
    .slice(0, 8);
}

export function customAffixId(group: AffixGroup, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `custom-${group}-${slug}`;
}
