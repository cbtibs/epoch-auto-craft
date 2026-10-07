import { affixName, customAffixId, printedName } from "./affixes";
import { SLOTS, type AffixDef, type AffixGroup, type ItemClass, type SlotId } from "./types";
import type { ImportAffix, ImportDraft } from "./tooltip";

export function TooltipReview({
  draft,
  catalog,
  slot,
  itemClass,
  onChange,
  onApply,
  onDismiss,
  onReread,
}: {
  draft: ImportDraft;
  catalog: AffixDef[];
  slot: SlotId;
  itemClass: ItemClass;
  onChange: (draft: ImportDraft) => void;
  onApply: () => void;
  onDismiss: () => void;
  onReread: (text: string) => void;
}) {
  const usedSlot = draft.slot ?? slot;
  const usedClass = draft.itemClass ?? itemClass;
  const choices = catalog.filter((affix) => affix.slots.includes(usedSlot) && (!affix.class || affix.class === usedClass || usedClass === "none"));
  const problems = reviewProblems(draft, catalog);

  function update(affix: ImportAffix) {
    onChange({ ...draft, affixes: draft.affixes.map((row) => row.key === affix.key ? affix : row) });
  }

  return (
    <section className="import-card" data-testid="import-review">
      <header>
        <p>Read from the tooltip</p>
        <h2>Check this before it replaces the item</h2>
      </header>
      {draft.status === "reading" && <p>Reading the tooltip. The first time, the reader downloads its language data.</p>}
      {draft.imageUrl && <img src={draft.imageUrl} alt="Pasted item tooltip" />}
      {draft.error && <p className="warn">{draft.error}</p>}
      {draft.status !== "reading" && (
        <>
          <div className="follow-grid">
            <label>
              Forging Potential
              <input
                type="number"
                min={0}
                value={draft.fp ?? ""}
                onChange={(event) => onChange({ ...draft, fp: event.target.value === "" ? null : Number(event.target.value) })}
              />
            </label>
            <label>
              Forging Potential type
              <select
                value={draft.fpType ?? "standard"}
                onChange={(event) => onChange({ ...draft, fpType: event.target.value === "standard" ? null : event.target.value as ImportDraft["fpType"] })}
              >
                <option value="standard">Standard</option>
                <option value="ice">Ice</option>
                <option value="blood">Blood</option>
              </select>
            </label>
          </div>
          {draft.slot && draft.slot !== slot && (
            <p>This looks like a {SLOTS.find((entry) => entry.id === draft.slot)?.label.toLowerCase()}. Applying it will switch the slot.</p>
          )}
          {draft.itemClass && draft.itemClass !== itemClass && (
            <p>The tooltip requires {draft.itemClass}. Applying it will set that class.</p>
          )}
          <ul className="import-list">
            {draft.affixes.length === 0 && <li className="empty">No affixes were found. Fix the text below, or dismiss this and enter them by hand.</li>}
            {draft.affixes.map((affix) => (
              <li key={affix.key} className={affix.tierKnown && affix.id ? "" : "unsure"}>
                {affix.raw && <span className="raw">{affix.raw}</span>}
                <select
                  value={affix.id}
                  aria-label={`Affix for ${affix.raw || "a tooltip line"}`}
                  onChange={(event) => update({ ...affix, id: event.target.value })}
                >
                  <option value="">Choose an affix</option>
                  {choices.map((choice) => (
                    <option key={choice.id} value={choice.id}>{choice.group === "suffix" ? "Suffix" : "Prefix"} · {printedName(choice)}{choice.class ? ` · ${choice.class}` : ""}</option>
                  ))}
                  <option value="__custom__">Custom affix</option>
                </select>
                {affix.id === "__custom__" && (
                  <div className="custom">
                    <input
                      value={affix.customName}
                      aria-label="Custom affix name"
                      onChange={(event) => update({ ...affix, customName: event.target.value })}
                    />
                    <select
                      value={affix.group}
                      aria-label="Custom affix type"
                      onChange={(event) => update({ ...affix, group: event.target.value as AffixGroup })}
                    >
                      <option value="prefix">Prefix</option>
                      <option value="suffix">Suffix</option>
                    </select>
                  </div>
                )}
                {affix.id && affix.id !== "__custom__" && <strong>{affixName(catalog, affix.id)}</strong>}
                {!affix.tierKnown && <em className="seal">Tier was not read. Set it.</em>}
                <div className="tiers" role="group" aria-label="Tier">
                  {[1, 2, 3, 4, 5, 6, 7].map((tier) => (
                    <button key={tier} type="button" className={affix.tier === tier ? `on t${tier}` : ""} aria-pressed={affix.tier === tier} onClick={() => update({ ...affix, tier, tierKnown: true })}>
                      {tier}
                    </button>
                  ))}
                </div>
                <label className="check slim">
                  <input type="checkbox" checked={affix.sealed} onChange={(event) => update({ ...affix, sealed: event.target.checked })} />
                  Sealed
                </label>
                <button type="button" className="ghost" onClick={() => onChange({ ...draft, affixes: draft.affixes.filter((row) => row.key !== affix.key) })}>Remove</button>
              </li>
            ))}
          </ul>
          {problems.map((problem) => <p key={problem} className="warn">{problem}</p>)}
          <div className="paste-actions">
            <button type="button" className="plan" disabled={problems.length > 0} onClick={onApply} data-testid="apply-import">Use this item</button>
            <button type="button" className="ghost" onClick={onDismiss}>Dismiss</button>
          </div>
          <details className="text-import">
            <summary>Text the reader saw</summary>
            <textarea value={draft.rawText} spellCheck={false} onChange={(event) => onChange({ ...draft, rawText: event.target.value })} aria-label="Tooltip text" />
            <button type="button" onClick={() => onReread(draft.rawText)}>Read this text again</button>
          </details>
        </>
      )}
    </section>
  );
}

function reviewProblems(draft: ImportDraft, catalog: AffixDef[]): string[] {
  if (draft.status === "reading") return [];
  const problems: string[] = [];
  if (draft.fp === null || draft.fp < 0 || !Number.isFinite(draft.fp)) problems.push("Enter the Forging Potential.");
  if (draft.affixes.some((affix) => !affix.id || (affix.id === "__custom__" && !affix.customName.trim()))) {
    problems.push("Choose an affix for every line, or remove the line.");
  }
  const ids = draft.affixes.map((affix) => {
    if (!affix.id) return "";
    return affix.id === "__custom__" ? customAffixId(affix.group, affix.customName) : affix.id;
  }).filter(Boolean);
  if (new Set(ids).size !== ids.length) problems.push("Two lines resolved to the same affix.");
  const open = draft.affixes.filter((affix) => !affix.sealed);
  const prefixes = open.filter((affix) => groupOf(affix, catalog) === "prefix").length;
  const suffixes = open.filter((affix) => groupOf(affix, catalog) === "suffix").length;
  if (prefixes > 2) problems.push("An item can only have two open prefixes. Remove one, or mark one sealed.");
  if (suffixes > 2) problems.push("An item can only have two open suffixes. Remove one, or mark one sealed.");
  if (draft.affixes.filter((affix) => affix.sealed).length > 1) problems.push("An item can only have one sealed affix.");
  return problems;
}

function groupOf(affix: ImportAffix, catalog: AffixDef[]): AffixGroup {
  if (affix.id === "__custom__" || !affix.id) return affix.group;
  return catalog.find((item) => item.id === affix.id)?.group ?? affix.group;
}
