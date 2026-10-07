import type { AffixDef, AffixGroup } from "./types";
import { AFFIX_DATA } from "./affix-data";

export const AFFIXES: AffixDef[] = AFFIX_DATA;

export function affixName(catalog: AffixDef[], id: string): string {
  return catalog.find((affixDef) => affixDef.id === id)?.name ?? id;
}

export function customAffixId(group: AffixGroup, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `custom-${group}-${slug}`;
}
