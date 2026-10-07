import { useState } from "react";
import { affixChoices, affixName, customAffixId, printedName } from "./affixes";
import { otherAffixes, resolveCraft, type CraftInput } from "./observe";
import type { Action, AffixDef, AffixState, ItemClass, ItemState, PlanStep, SlotId } from "./types";

type Kind = "recommended" | Action["type"];

export function FollowCraft({
  step,
  fp,
  affixes,
  catalog,
  slot,
  itemClass,
  goalIds,
  onApply,
}: {
  step: PlanStep;
  fp: number;
  affixes: AffixState[];
  catalog: AffixDef[];
  slot: SlotId;
  itemClass: ItemClass;
  goalIds: string[];
  onApply: (state: ItemState, note: string, extras: AffixDef[]) => void;
}) {
  const [kind, setKind] = useState<Kind>("recommended");
  const [upgradeId, setUpgradeId] = useState(step.action.type === "upgrade" ? step.action.id : openBelowFive(affixes)[0]?.id ?? "");
  const [addId, setAddId] = useState(step.action.type === "add" ? step.action.id : "");
  const [addQuery, setAddQuery] = useState("");
  const [sealId, setSealId] = useState(step.action.type === "seal" ? step.action.id : sealable(affixes)[0]?.id ?? "");
  const [chaosId, setChaosId] = useState(step.action.type === "chaos" ? step.action.id : openBelowFive(affixes)[0]?.id ?? "");
  const [becameId, setBecameId] = useState(() => preferredBecame(catalog, slot, itemClass, affixes, step.action.type === "chaos" ? step.action.id : openBelowFive(affixes)[0]?.id ?? "", goalIds));
  const [customName, setCustomName] = useState("");
  const [removedId, setRemovedId] = useState(defaultRemoved(affixes, goalIds));
  const [sealFailed, setSealFailed] = useState(false);
  const [critAffixId, setCritAffixId] = useState("");
  const [fpAfter, setFpAfter] = useState(String(fp));
  const [havocTiers, setHavocTiers] = useState(() => affixes.filter((affix) => !affix.sealed).map((affix) => ({ id: affix.id, tier: affix.tier })));
  const [redemption, setRedemption] = useState<Record<string, string>>({});

  const action = buildAction(kind, step, { upgradeId, addId, sealId, chaosId });
  const chaosSource = action?.type === "chaos" ? action.id : "";
  const sourceGroup = catalog.find((affix) => affix.id === chaosSource)?.group ?? "prefix";
  const customId = customName.trim() ? customAffixId(sourceGroup, customName) : "";
  const extras = becameId === "__custom__" && customId && !catalog.some((affix) => affix.id === customId)
    ? [{ id: customId, name: customName.trim(), group: sourceGroup, slots: [slot] } satisfies AffixDef]
    : [];
  const chaosOptions = chaosSource ? otherAffixes(catalog, slot, itemClass, affixes, chaosSource) : [];
  const became = becameId === "__custom__" ? customId || null : chaosOptions.some((affix) => affix.id === becameId) ? becameId : null;
  const library = [...catalog, ...extras];
  const input: CraftInput | null = action ? {
    action,
    fpAfter: Number(fpAfter),
    critAffixId: null,
    sealFailed,
    becameId: became,
    removedId: removedId || null,
    havocTiers,
    redemption: Object.entries(redemption).filter((entry) => entry[1]).map(([fromId, toId]) => ({ fromId, toId })),
  } : null;
  const base = input
    ? resolveCraft({ fp, affixes }, input, library, slot, itemClass)
    : { ok: false, state: null, note: "", reason: "Choose a craft.", critOptions: [] as AffixState[] };
  const critValue = base.critOptions.some((affix) => affix.id === critAffixId) ? critAffixId : "";
  const preview = input && critValue
    ? resolveCraft({ fp, affixes }, { ...input, critAffixId: critValue }, library, slot, itemClass)
    : base;
  const customMissing = action?.type === "chaos" && becameId === "__custom__" && !customName.trim();
  const shown = customMissing
    ? { ...preview, ok: false, state: null, note: "", reason: "Type the name of the affix Chaos turned it into." }
    : preview;
  const showCrit = action && (action.type === "add" || action.type === "upgrade" || action.type === "chaos" || action.type === "seal");
  const adds = affixChoices(catalog, slot, itemClass, addQuery, new Set(affixes.map((affix) => affix.id)));

  function chooseChaos(id: string) {
    setChaosId(id);
    setBecameId(preferredBecame(catalog, slot, itemClass, affixes, id, goalIds));
    setCustomName("");
  }

  return (
    <section className="follow" data-testid="follow-craft">
      <h3>Record the next craft</h3>
      <p>
        The next planned step is <strong>{step.title}</strong>. If a crit lands, a seal fails, or Chaos comes up differently, put the real result here. The forge then replans from the item you have now.
      </p>
      <div className="follow-grid">
        <label>
          Craft you used
          <select value={kind} onChange={(event) => setKind(event.target.value as Kind)} data-testid="craft-kind">
            <option value="recommended">{step.title}</option>
            <option value="upgrade">Upgrade an affix</option>
            <option value="add">Add an affix</option>
            <option value="seal">Glyph of Despair</option>
            <option value="chaos">Glyph of Chaos</option>
            <option value="removal">Rune of Removal</option>
            <option value="havoc">Rune of Havoc</option>
            <option value="redemption">Rune of Redemption</option>
          </select>
        </label>
        <label>
          Forging Potential afterwards
          <input data-testid="fp-after" type="number" min={0} value={fpAfter} onChange={(event) => setFpAfter(event.target.value)} />
        </label>
      </div>

      {action?.type === "upgrade" && kind !== "recommended" && (
        <label>
          Affix upgraded
          <select value={upgradeId} onChange={(event) => setUpgradeId(event.target.value)}>
            {openBelowFive(affixes).map((affix) => (
              <option key={affix.id} value={affix.id}>{affixName(catalog, affix.id)} from tier {affix.tier}</option>
            ))}
          </select>
        </label>
      )}

      {action?.type === "add" && kind !== "recommended" && (
        <div className="adder">
          <input value={addQuery} placeholder="Search the affix you added" onChange={(event) => setAddQuery(event.target.value)} aria-label="Search the affix you added" />
          {addQuery && (
            <div className="menu">
              {adds.length === 0 && <p>No matching affix.</p>}
              {adds.map((affix) => (
                <button key={affix.id} type="button" onClick={() => { setAddId(affix.id); setAddQuery(printedName(affix)); }}>
                  <span>{affix.class ? `${affix.group} · ${affix.class}` : affix.group}</span>
                  {printedName(affix)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {action?.type === "seal" && (
        <>
          {kind !== "recommended" && (
            <label>
              Affix you sealed
              <select value={sealId} onChange={(event) => setSealId(event.target.value)}>
                {sealable(affixes).map((affix) => (
                  <option key={affix.id} value={affix.id}>{affixName(catalog, affix.id)} tier {affix.tier}</option>
                ))}
              </select>
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={sealFailed} onChange={(event) => setSealFailed(event.target.checked)} />
            The seal failed and the affix upgraded instead
          </label>
        </>
      )}

      {action?.type === "chaos" && (
        <>
          {kind !== "recommended" && (
            <label>
              Affix you used Chaos on
              <select value={chaosId} onChange={(event) => chooseChaos(event.target.value)}>
                {openBelowFive(affixes).map((affix) => (
                  <option key={affix.id} value={affix.id}>{affixName(catalog, affix.id)} tier {affix.tier}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            It became
            <select
              value={becameId === "__custom__" || chaosOptions.some((affix) => affix.id === becameId) ? becameId : ""}
              onChange={(event) => setBecameId(event.target.value)}
              data-testid="chaos-result"
            >
              <option value="">Choose the result</option>
              {chaosOptions.map((affix) => (
                <option key={affix.id} value={affix.id}>
                  {printedName(affix)}{goalIds.includes(affix.id) ? " · on your target" : ""}
                </option>
              ))}
              <option value="__custom__">An affix that is not listed</option>
            </select>
          </label>
          {becameId === "__custom__" && (
            <label>
              Affix name
              <input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="Name printed on the item" />
            </label>
          )}
        </>
      )}

      {action?.type === "removal" && (
        <label>
          Affix removed
          <select value={removedId} onChange={(event) => setRemovedId(event.target.value)}>
            {affixes.filter((affix) => !affix.sealed).map((affix) => (
              <option key={affix.id} value={affix.id}>{affixName(catalog, affix.id)} tier {affix.tier}</option>
            ))}
          </select>
        </label>
      )}

      {action?.type === "havoc" && (
        <div className="havoc">
          {havocTiers.map((entry) => (
            <label key={entry.id}>
              {affixName(catalog, entry.id)}
              <select
                value={entry.tier}
                onChange={(event) => setHavocTiers((tiers) => tiers.map((tier) => tier.id === entry.id ? { ...tier, tier: Number(event.target.value) } : tier))}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((tier) => <option key={tier} value={tier}>Tier {tier}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}

      {action?.type === "redemption" && (
        <div className="havoc">
          {affixes.filter((affix) => !affix.sealed && affix.tier >= 6).map((affix) => (
            <label key={affix.id}>
              {affixName(catalog, affix.id)} became
              <select value={redemption[affix.id] ?? ""} onChange={(event) => setRedemption((current) => ({ ...current, [affix.id]: event.target.value }))}>
                <option value="">Choose</option>
                {redemptionChoices(catalog, slot, itemClass, affixes, affix.id, redemption).map((option) => (
                  <option key={option.id} value={option.id}>{printedName(option)}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      {showCrit && (
        <label>
          Critical success also raised
          <select value={critValue} onChange={(event) => setCritAffixId(event.target.value)} data-testid="crit-affix">
            <option value="">No critical success</option>
            {base.critOptions.map((affix) => (
              <option key={affix.id} value={affix.id}>{affixName(catalog, affix.id)} to tier {affix.tier + 1}</option>
            ))}
          </select>
        </label>
      )}

      {shown.ok ? <p className="preview" data-testid="craft-preview">{shown.note}</p> : <p className="warn">{shown.reason}</p>}
      <button
        type="button"
        className="plan"
        data-testid="apply-craft"
        disabled={!shown.ok || !shown.state}
        onClick={() => shown.state && onApply(shown.state, shown.note, extras)}
      >
        Update the item and replan
      </button>
    </section>
  );
}

function buildAction(kind: Kind, step: PlanStep, ids: { upgradeId: string; addId: string; sealId: string; chaosId: string }): Action | null {
  if (kind === "recommended") return step.action;
  if (kind === "upgrade") return ids.upgradeId ? { type: "upgrade", id: ids.upgradeId } : null;
  if (kind === "add") return ids.addId ? { type: "add", id: ids.addId } : null;
  if (kind === "seal") return ids.sealId ? { type: "seal", id: ids.sealId } : null;
  if (kind === "chaos") return ids.chaosId ? { type: "chaos", id: ids.chaosId } : null;
  if (kind === "removal") return { type: "removal" };
  if (kind === "havoc") return { type: "havoc" };
  return { type: "redemption" };
}

function openBelowFive(affixes: AffixState[]): AffixState[] {
  return affixes.filter((affix) => !affix.sealed && affix.tier < 5);
}

function sealable(affixes: AffixState[]): AffixState[] {
  return affixes.filter((affix) => !affix.sealed && affix.tier <= 4);
}

function defaultRemoved(affixes: AffixState[], goalIds: string[]): string {
  const open = affixes.filter((affix) => !affix.sealed);
  const junk = open.filter((affix) => !goalIds.includes(affix.id));
  const pool = (junk.length ? junk : open).slice().sort((a, b) => a.tier - b.tier);
  return pool[0]?.id ?? "";
}

function preferredBecame(
  catalog: AffixDef[],
  slot: SlotId,
  itemClass: ItemClass,
  affixes: AffixState[],
  id: string,
  goalIds: string[],
): string {
  const options = otherAffixes(catalog, slot, itemClass, affixes, id);
  return options.find((affix) => goalIds.includes(affix.id))?.id ?? "";
}

function redemptionChoices(
  catalog: AffixDef[],
  slot: SlotId,
  itemClass: ItemClass,
  affixes: AffixState[],
  selfId: string,
  chosen: Record<string, string>,
): AffixDef[] {
  const self = catalog.find((affix) => affix.id === selfId);
  if (!self) return [];
  const taken = new Set(affixes.filter((affix) => affix.sealed || affix.tier < 6).map((affix) => affix.id));
  for (const [fromId, toId] of Object.entries(chosen)) {
    if (fromId !== selfId && toId) taken.add(toId);
  }
  return catalog.filter((affix) => affix.group === self.group && affix.id !== selfId && !taken.has(affix.id) && affix.slots.includes(slot) && (!affix.class || affix.class === itemClass));
}
