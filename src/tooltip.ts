import { printedName } from "./affixes";
import type { AffixDef, AffixGroup, FpType, ItemClass, SlotId } from "./types";

export type ImportAffix = {
  key: string;
  id: string;
  customName: string;
  tier: number;
  sealed: boolean;
  tierKnown: boolean;
  raw: string;
  group: AffixGroup;
};

export type ImportDraft = TooltipRead & {
  status: "reading" | "ready" | "error";
  imageUrl: string | null;
  error: string | null;
};

export type TooltipRead = {
  fp: number | null;
  fpType: FpType | null;
  slot: SlotId | null;
  itemClass: ItemClass | null;
  affixes: ImportAffix[];
  rawText: string;
};

const STOP = new Set(["to", "of", "the", "a", "an", "and", "added"]);

const SLOT_RULES: { pattern: RegExp; slot: SlotId }[] = [
  { pattern: /\b(helmet|helm)\b/i, slot: "helmet" },
  { pattern: /\b(body armour|body armor|chest armour|chest armor)\b/i, slot: "body" },
  { pattern: /\b(gloves|gauntlets)\b/i, slot: "gloves" },
  { pattern: /\bboots\b/i, slot: "boots" },
  { pattern: /\bbelt\b/i, slot: "belt" },
  { pattern: /\bring\b/i, slot: "ring" },
  { pattern: /\bamulet\b/i, slot: "amulet" },
  { pattern: /\brelic\b/i, slot: "relic" },
  { pattern: /\bquiver\b/i, slot: "quiver" },
  { pattern: /\bshield\b/i, slot: "shield" },
  { pattern: /\bcatalyst\b/i, slot: "catalyst" },
  { pattern: /\bbow\b/i, slot: "bow" },
  { pattern: /\b(two[- ]handed|staff)\b/i, slot: "two-hand" },
  { pattern: /\b(one[- ]handed|wand|scepter|sceptre|dagger|sword|axe|mace|spear)\b/i, slot: "one-hand" },
];

export function looksLikeTooltip(text: string): boolean {
  return /forging potential/i.test(text)
    || /\bt(?:ier)?\s*[1-7]\b/i.test(text)
    || (/\+\s*\d/.test(text) && /health|resist|strength|dexterity|intelligence|vitality|armou?r/i.test(text));
}

export function parseTooltip(text: string, catalog: AffixDef[], fallbackSlot: SlotId, fallbackClass: ItemClass): TooltipRead {
  const rawText = text.replace(/\r/g, "").trim();
  const lines = rawText.split("\n").map((line) => line.trim()).filter(Boolean);
  const fpIndex = lines.findIndex((line) => /forging potential/i.test(line));
  const headerLines = (fpIndex >= 0 ? lines.slice(0, fpIndex) : lines.slice(0, 12)).filter((line) => !/\+\s*\d/.test(line));
  const headerText = headerLines.join("\n");
  const slot = detectSlot(headerText);
  const detectedClass = detectClass(lines);
  const usedSlot = slot ?? fallbackSlot;
  const affixLines = fpIndex >= 0 ? lines.slice(fpIndex + 1) : lines;
  const openRead = readAffixes(affixLines, catalog, usedSlot, detectedClass ?? "none");
  const itemClass = detectedClass ?? classFromAffixes(openRead, catalog);
  const usedClass = itemClass ?? fallbackClass;
  const affixes = usedClass === (detectedClass ?? "none")
    ? openRead
    : readAffixes(affixLines, catalog, usedSlot, usedClass);

  return {
    fp: detectFp(rawText),
    fpType: /ice forging potential/i.test(rawText) ? "ice" : /blood forging potential/i.test(rawText) ? "blood" : null,
    slot,
    itemClass,
    affixes,
    rawText,
  };
}

function detectFp(text: string): number | null {
  const labeled = text.match(/forging potential\s*[:\-]?\s*(\d+)/i);
  if (labeled) return Number(labeled[1]);
  const leading = text.match(/(\d+)\s*(?:\/\s*\d+\s*)?forging potential/i);
  return leading ? Number(leading[1]) : null;
}

function detectSlot(headerText: string): SlotId | null {
  for (const rule of SLOT_RULES) {
    if (rule.pattern.test(headerText)) return rule.slot;
  }
  return null;
}

function detectClass(lines: string[]): ItemClass | null {
  const line = lines.find((entry) => /requires/i.test(entry));
  const match = line?.match(/\b(sentinel|mage|primalist|acolyte|rogue)\b/i);
  return match ? match[1].toLowerCase() as ItemClass : null;
}

function classFromAffixes(rows: ImportAffix[], catalog: AffixDef[]): ItemClass | null {
  const found = new Set<ItemClass>();
  for (const row of rows) {
    const spec = catalog.find((affix) => affix.id === row.id)?.class;
    if (spec) found.add(spec);
  }
  return found.size === 1 ? [...found][0] : null;
}

function readAffixes(lines: string[], catalog: AffixDef[], slot: SlotId, itemClass: ItemClass): ImportAffix[] {
  const rows: ImportAffix[] = [];
  let serial = 0;
  let pending: { raw: string; tier: number | null; sealed: boolean; group: AffixGroup | null } | null = null;
  let section: AffixGroup | null = null;
  let sealNext = false;

  function flush() {
    if (!pending) return;
    const matched = matchAffix(pending.raw, catalog, slot, itemClass);
    const keep = matched || isAffixLike(pending.raw, section);
    if (keep) {
      const id = matched?.id ?? "";
      if (id) {
        const earlier = rows.findIndex((row) => row.id === id);
        if (earlier >= 0) rows.splice(earlier, 1);
      }
      rows.push({
        key: `read-${serial++}`,
        id,
        customName: matched ? "" : cleanName(pending.raw),
        tier: pending.tier ?? 1,
        sealed: pending.sealed,
        tierKnown: pending.tier !== null,
        raw: pending.raw,
        group: matched?.group ?? pending.group ?? "prefix",
      });
    }
    pending = null;
  }

  for (const line of lines) {
    const header = headerKind(line);
    if (header === "prefix" || header === "suffix") {
      flush();
      section = header;
      continue;
    }
    if (header === "sealed") {
      flush();
      sealNext = true;
      continue;
    }
    if (header === "skip") continue;
    const cleaned = normalizeLine(line);
    if (!cleaned || ignorable(cleaned)) continue;
    const notedTier = annotatedTier(cleaned);
    if (notedTier !== null) {
      if (pending && pending.tier === null) pending.tier = notedTier;
      continue;
    }
    const tier = tierInLine(cleaned);
    if (pending && pending.tier === null && tier === null) {
      pending.raw = `${pending.raw}\n${cleaned}`;
      continue;
    }
    flush();
    pending = {
      raw: cleaned,
      tier,
      sealed: sealNext || /\bsealed\b/i.test(line),
      group: section,
    };
    sealNext = false;
  }
  flush();
  return rows;
}

function headerKind(line: string): "prefix" | "suffix" | "sealed" | "skip" | null {
  const clean = line.trim().toLowerCase().replace(/[:\-]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^prefixes?$/.test(clean)) return "prefix";
  if (/^suffixes?$/.test(clean)) return "suffix";
  if (/^sealed affix(?:es)?$/.test(clean)) return "sealed";
  if (/^(implicit|implicits|unique|set|legendary|exalted|rare|magic|common)$/.test(clean)) return "skip";
  if (/^(requires?\b|item level\b|forging potential\b|ice forging\b|blood forging\b)/.test(clean)) return "skip";
  return null;
}

function normalizeLine(line: string): string {
  const stripped = line.replace(/^[^a-z0-9+%]+/i, "").trim();
  return stripped.replace(/^[a-z]{1,2}\s+(?=(?:tier|range)\b)/i, "");
}

function annotatedTier(line: string): number | null {
  const match = line.match(/^tier\s*[:.]?\s*([1-7])\b/i);
  return match ? Number(match[1]) : null;
}

function ignorable(line: string): boolean {
  return /^range\b/i.test(line)
    || /^cannot be traded\b/i.test(line)
    || /\brequires\b/i.test(line)
    || /^base attack rate\b/i.test(line);
}

function isAffixLike(line: string, section: AffixGroup | null): boolean {
  const words = /[a-z]{3,}/i.test(line);
  if (!words) return false;
  if (/\+\s*\d/.test(line)) return true;
  return section !== null;
}

export function tierInLine(line: string): number | null {
  const explicit = line.match(/(?:^|[^a-z])t(?:ier)?\s*[:.]?\s*([1-7])\b/i);
  if (explicit) return Number(explicit[1]);
  const bracket = line.match(/[\[(]\s*([1-7])\s*[\])]/);
  if (bracket) return Number(bracket[1]);
  const leading = line.match(/^([1-7])\s+\+/);
  if (leading) return Number(leading[1]);
  const trailing = line.match(/\+\s*\d+[^\n]*\s([1-7])\s*$/);
  if (trailing) return Number(trailing[1]);
  return null;
}

function matchAffix(line: string, catalog: AffixDef[], slot: SlotId, itemClass: ItemClass): AffixDef | null {
  const alias = matchAlias(line, catalog, slot, itemClass);
  if (alias) return alias;
  const lineTokens = new Set(tokens(line));
  if (!lineTokens.size) return null;
  const linePhrase = [...lineTokens].join(" ");
  let best: { def: AffixDef; score: number } | null = null;
  for (const def of catalog) {
    if (!def.slots.includes(slot)) continue;
    if (def.class && itemClass !== "none" && def.class !== itemClass) continue;
    const nameTokens = tokens(printedName(def));
    if (!nameTokens.length || !nameTokens.every((token) => lineTokens.has(token))) continue;
    const namePhrase = nameTokens.join(" ");
    const score = nameTokens.length * 1000 + (linePhrase.includes(namePhrase) ? 500 : 0) + namePhrase.length;
    if (!best || score > best.score) best = { def, score };
  }
  return best?.def ?? null;
}

function matchAlias(line: string, catalog: AffixDef[], slot: SlotId, itemClass: ItemClass): AffixDef | null {
  const hybrid = /health and\b.*\bincreased health|\bincreased health\b.*\band\b.*\bhealth/i.test(line);
  if (!hybrid) return null;
  const def = catalog.find((affix) => affix.id === "hybrid-health");
  if (!def || !def.slots.includes(slot)) return null;
  if (def.class && itemClass !== "none" && def.class !== itemClass) return null;
  return def;
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/armour/g, "armor")
    .replace(/\bcrit\b/g, "critical")
    .replace(/\bres\b/g, "resist")
    .replace(/\bresistances?\b/g, "resist")
    .replace(/(?:^|[^a-z])t(?:ier)?\s*[:.]?\s*[1-7]\b/gi, " ")
    .replace(/\bsealed\b/g, " ")
    .replace(/\+\s*\d+(?:\.\d+)?%?/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !STOP.has(word));
}

function cleanName(line: string): string {
  return line
    .replace(/\+\s*\d+(?:\.\d+)?%?/g, " ")
    .replace(/(?:^|[^a-z])t(?:ier)?\s*[:.]?\s*[1-7]\b/gi, " ")
    .replace(/\bsealed\b/gi, " ")
    .replace(/[^a-zA-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
