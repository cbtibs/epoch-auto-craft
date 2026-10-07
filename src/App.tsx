import { useMemo, useRef, useState } from "react";
import { AFFIXES, affixChoices, affixName, customAffixId, printedName } from "./affixes";
import { FollowCraft } from "./FollowCraft";
import { readTooltipImage } from "./ocr";
import { formatChance, planCraft } from "./solver";
import { TooltipReview } from "./TooltipReview";
import { parseTooltip, type ImportDraft } from "./tooltip";
import {
  CLASSES,
  DEFAULT_RULES,
  SLOTS,
  type AffixDef,
  type AffixGroup,
  type AffixState,
  type FpType,
  type GoalAffix,
  type ItemClass,
  type ItemState,
  type PlanResult,
  type SlotId,
} from "./types";

type Draft = {
  slot: SlotId;
  itemClass: ItemClass;
  fp: number;
  fpType: FpType;
  current: AffixState[];
  target: GoalAffix[];
  exact: boolean;
  minFp: number;
};

const EXAMPLES: Record<string, Draft> = {
  helmet: {
    slot: "helmet",
    itemClass: "none",
    fp: 42,
    fpType: "standard",
    current: [
      { id: "strength", tier: 7, sealed: false },
      { id: "armor", tier: 2, sealed: false },
      { id: "fire-res", tier: 1, sealed: false },
    ],
    target: [
      { id: "strength", minTier: 7, sealed: false },
      { id: "vitality", minTier: 5, sealed: false },
      { id: "health", minTier: 5, sealed: false },
      { id: "fire-res", minTier: 5, sealed: false },
    ],
    exact: false,
    minFp: 0,
  },
  guaranteed: {
    slot: "body",
    itemClass: "none",
    fp: 41,
    fpType: "standard",
    current: [{ id: "health", tier: 1, sealed: false }],
    target: [{ id: "health", minTier: 5, sealed: false }],
    exact: false,
    minFp: 0,
  },
  impossible: {
    slot: "ring",
    itemClass: "none",
    fp: 70,
    fpType: "standard",
    current: [
      { id: "health", tier: 5, sealed: false },
      { id: "fire-res", tier: 4, sealed: false },
    ],
    target: [
      { id: "health", minTier: 7, sealed: false },
      { id: "fire-res", minTier: 5, sealed: false },
    ],
    exact: false,
    minFp: 0,
  },
};

function rarityOf(affixes: AffixState[]): string {
  if (affixes.some((affix) => affix.tier >= 6)) return "Exalted";
  if (affixes.length >= 3) return "Rare";
  if (affixes.length >= 1) return "Magic";
  return "Common";
}

export function App() {
  const start = EXAMPLES.helmet;
  const [slot, setSlot] = useState<SlotId>(start.slot);
  const [itemClass, setItemClass] = useState<ItemClass>(start.itemClass);
  const [fp, setFp] = useState(start.fp);
  const [fpType, setFpType] = useState<FpType>(start.fpType);
  const [current, setCurrent] = useState<AffixState[]>(start.current);
  const [target, setTarget] = useState<GoalAffix[]>(start.target);
  const [exact, setExact] = useState(start.exact);
  const [minFp, setMinFp] = useState(start.minFp);
  const [customs, setCustoms] = useState<AffixDef[]>([]);
  const [crit, setCrit] = useState(12);
  const [hope, setHope] = useState(25);
  const [lucky, setLucky] = useState(true);
  const [extra, setExtra] = useState(25);
  const [ice, setIce] = useState(0);
  const [blood, setBlood] = useState(0);
  const [addMax, setAddMax] = useState(18);
  const [to2, setTo2] = useState(10);
  const [to3, setTo3] = useState(12);
  const [to4, setTo4] = useState(18);
  const [to5, setTo5] = useState(24);
  const [removalMax, setRemovalMax] = useState(25);
  const [havocMax, setHavocMax] = useState(20);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [history, setHistory] = useState<{ fp: number; affixes: AffixState[]; note: string }[]>([]);
  const [importDraft, setImportDraft] = useState<ImportDraft | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  const importRequest = useRef(0);
  const catalog = useMemo(() => [...AFFIXES, ...customs], [customs]);

  function load(example: Draft) {
    setSlot(example.slot);
    setItemClass(example.itemClass);
    setFp(example.fp);
    setFpType(example.fpType);
    setCurrent(example.current);
    setTarget(example.target);
    setExact(example.exact);
    setMinFp(example.minFp);
    setResult(null);
    setHistory([]);
    dismissImport();
  }

  function changeSlot(next: SlotId) {
    setSlot(next);
    const keep = (id: string) => {
      const def = catalog.find((affix) => affix.id === id);
      return def ? def.slots.includes(next) && (!def.class || def.class === itemClass) : false;
    };
    setCurrent((affixes) => affixes.filter((affix) => keep(affix.id)));
    setTarget((affixes) => affixes.filter((affix) => affix.any || keep(affix.id)));
    setResult(null);
    setHistory([]);
  }

  function forgeRules() {
    return {
      ...DEFAULT_RULES,
      critChance: crit / 100,
      hopeChance: hope / 100,
      icePreserveChance: ice / 100,
      bloodCritBonus: blood / 100,
      luckyFpRoll: lucky,
      extraChaosOutcomes: extra,
      addMax,
      upgradeMax: { 2: to2, 3: to3, 4: to4, 5: to5 },
      removalMax,
      havocMax,
      redemptionMax: havocMax,
    };
  }

  function runPlan(nextFp: number, nextAffixes: AffixState[], extraCatalog: AffixDef[] = []) {
    const next = planCraft({
      state: { fp: nextFp, affixes: nextAffixes },
      goal: { affixes: target, exact, minFp },
      catalog: [...catalog, ...extraCatalog],
      slot,
      itemClass,
      fpType,
      iterations: 1800,
      rules: forgeRules(),
    });
    setResult(next);
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function plan() {
    runPlan(fp, current);
  }

  function dismissImport() {
    setImportDraft((currentDraft) => {
      if (currentDraft?.imageUrl) URL.revokeObjectURL(currentDraft.imageUrl);
      return null;
    });
  }

  async function handleImage(file: File) {
    const request = ++importRequest.current;
    const imageUrl = URL.createObjectURL(file);
    setImportDraft((currentDraft) => {
      if (currentDraft?.imageUrl) URL.revokeObjectURL(currentDraft.imageUrl);
      return emptyImport({ status: "reading", imageUrl, fp });
    });
    try {
      const text = await readTooltipImage(file);
      if (importRequest.current !== request) {
        URL.revokeObjectURL(imageUrl);
        return;
      }
      publishRead(parseTooltip(text, catalog, slot, itemClass), imageUrl);
    } catch {
      if (importRequest.current !== request) return;
      setImportDraft(emptyImport({
        status: "error",
        imageUrl,
        fp,
        error: "The screenshot could not be read. Crop closer to the tooltip, or paste the text below.",
      }));
    }
  }

  function handleText(text: string) {
    setImportDraft((currentDraft) => {
      const parsed = parseTooltip(text, catalog, slot, itemClass);
      const found = parsed.affixes.length > 0 || parsed.fp !== null;
      return emptyImport({
        status: found ? "ready" : "error",
        imageUrl: currentDraft?.imageUrl ?? null,
        fp: parsed.fp ?? fp,
        fpType: parsed.fpType,
        slot: parsed.slot,
        itemClass: parsed.itemClass,
        affixes: parsed.affixes,
        rawText: parsed.rawText,
        error: found ? null : "Nothing in that tooltip matched an item. Crop closer, or edit the text and read it again.",
      });
    });
  }

  function publishRead(parsed: ReturnType<typeof parseTooltip>, imageUrl: string | null) {
    const found = parsed.affixes.length > 0 || parsed.fp !== null;
    setImportDraft(emptyImport({
      status: found ? "ready" : "error",
      imageUrl,
      fp: parsed.fp ?? fp,
      fpType: parsed.fpType,
      slot: parsed.slot,
      itemClass: parsed.itemClass,
      affixes: parsed.affixes,
      rawText: parsed.rawText,
      error: found ? null : "Nothing in that tooltip matched an item. Crop closer, or edit the text and read it again.",
    }));
  }

  function applyImport() {
    if (!importDraft || importDraft.status !== "ready" || importDraft.fp === null) return;
    const nextSlot = importDraft.slot ?? slot;
    const extras: AffixDef[] = [];
    const affixes: AffixState[] = [];
    for (const row of importDraft.affixes) {
      if (row.id === "__custom__") {
        const id = customAffixId(row.group, row.customName);
        if (!catalog.some((affix) => affix.id === id) && !extras.some((affix) => affix.id === id)) {
          extras.push({ id, name: row.customName.trim(), group: row.group, slots: [nextSlot] });
        }
        affixes.push({ id, tier: row.tier, sealed: row.sealed });
      } else {
        affixes.push({ id: row.id, tier: row.tier, sealed: row.sealed });
      }
    }
    if (extras.length) setCustoms((list) => [...list, ...extras]);
    const nextClass = importDraft.itemClass ?? itemClass;
    if (importDraft.slot) setSlot(importDraft.slot);
    if (importDraft.itemClass) setItemClass(importDraft.itemClass);
    if (importDraft.slot || importDraft.itemClass) {
      const keep = (id: string) => {
        const def = [...catalog, ...extras].find((affix) => affix.id === id);
        return def ? def.slots.includes(nextSlot) && (!def.class || def.class === nextClass) : false;
      };
      setTarget((affixes) => affixes.filter((affix) => affix.any || keep(affix.id)));
    }
    if (importDraft.fpType) setFpType(importDraft.fpType);
    setFp(importDraft.fp);
    setCurrent(affixes);
    setResult(null);
    setHistory([]);
    dismissImport();
  }

  function commitCraft(next: ItemState, note: string, extras: AffixDef[]) {
    setHistory((entries) => [...entries, { fp, affixes: current, note }]);
    if (extras.length) setCustoms((list) => [...list, ...extras]);
    setFp(next.fp);
    setCurrent(next.affixes);
    runPlan(next.fp, next.affixes, extras);
  }

  function undoCraft() {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((entries) => entries.slice(0, -1));
    setFp(previous.fp);
    setCurrent(previous.affixes);
    runPlan(previous.fp, previous.affixes);
  }

  return (
    <div className="page">
      <header className="top">
        <div>
          <p className="eyebrow">Last Epoch · Season 5 · Rage of the Frostborn</p>
          <h1>Epoch Auto Craft</h1>
          <p className="lede">
            Put in the item you have and the item you want. The forge tells you whether that craft can finish, and the sequence most likely to get there. Paste a tooltip onto the item you have, then record each craft so the path can change with it.
          </p>
        </div>
        <div className="examples">
          <button type="button" onClick={() => load(EXAMPLES.helmet)}>Exalted helmet</button>
          <button type="button" onClick={() => load(EXAMPLES.guaranteed)}>Safe health craft</button>
          <button type="button" onClick={() => load(EXAMPLES.impossible)}>Impossible tier 7</button>
        </div>
      </header>

      <section className="shared">
        <label>
          Slot
          <select value={slot} onChange={(event) => changeSlot(event.target.value as SlotId)}>
            {SLOTS.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.label}</option>
            ))}
          </select>
        </label>
        <label>
          Class requirement
          <select
            value={itemClass}
            onChange={(event) => {
              setItemClass(event.target.value as ItemClass);
              setResult(null);
            }}
          >
            {CLASSES.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.label}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={exact} onChange={(event) => { setExact(event.target.checked); setResult(null); }} />
          Target must match exactly, with no extra affixes
        </label>
      </section>

      <div className="boards">
        <div className="stack">
          <ItemBoard
            title="Item you have"
            rarity={rarityOf(current)}
            catalog={catalog}
            slot={slot}
            itemClass={itemClass}
            affixes={current}
            mode="current"
            fp={fp}
            fpType={fpType}
            reading={importDraft?.status === "reading"}
            onImage={(file) => void handleImage(file)}
            onText={handleText}
            onFp={(next) => {
              setFp(next);
              setResult(null);
              setHistory([]);
            }}
            onFpType={(next) => {
              setFpType(next);
              setResult(null);
            }}
            onChange={(next) => {
              setCurrent(next);
              setResult(null);
              setHistory([]);
            }}
            onCustom={(affix) => setCustoms((list) => [...list, affix])}
            onUseClass={(next) => {
              setItemClass(next);
              setResult(null);
            }}
          />
          {importDraft && (
            <TooltipReview
              draft={importDraft}
              catalog={catalog}
              slot={slot}
              itemClass={itemClass}
              onChange={setImportDraft}
              onApply={applyImport}
              onDismiss={dismissImport}
              onReread={handleText}
            />
          )}
        </div>
        <ItemBoard
          title="Item you want"
          rarity="Target"
          catalog={catalog}
          slot={slot}
          itemClass={itemClass}
          affixes={target}
          mode="target"
          minFp={minFp}
          onMinFp={(next) => {
            setMinFp(next);
            setResult(null);
          }}
          onChange={(next) => {
            setTarget(next);
            setResult(null);
          }}
          onCopyCurrent={() => {
            setTarget(current.map((affix) => ({
              id: affix.id,
              minTier: affix.tier,
              sealed: affix.sealed && affix.tier <= 4,
            })));
            setResult(null);
          }}
          canCopyCurrent={current.length > 0}
          onCustom={(affix) => setCustoms((list) => [...list, affix])}
          onUseClass={(next) => {
            setItemClass(next);
            setResult(null);
          }}
        />
      </div>

      <details className="rules">
        <summary>Forge assumptions</summary>
        <p>
          Shard ranges match the tooltips players see: a new affix is 1–18, then 1–10, 1–12, 1–18, and 1–24 up to tier 5. Glyph of Hope is 25%. Critical success defaults to 12% from a Season 4 guide; Eleventh Hour has not printed it, and patch 1.5.1.1 does not say it changed. Ice and Blood rates are unpublished, so they do nothing until you enter one.
        </p>
        <div className="rule-grid">
          <Num label="Critical success %" value={crit} set={setCrit} />
          <Num label="Glyph of Hope %" value={hope} set={setHope} />
          <Num label="Ice preserve %" value={ice} set={setIce} />
          <Num label="Blood added crit %" value={blood} set={setBlood} />
          <Num label="Unlisted chaos outcomes" value={extra} set={setExtra} />
          <Num label="New affix max FP" value={addMax} set={setAddMax} />
          <Num label="To tier 2" value={to2} set={setTo2} />
          <Num label="To tier 3" value={to3} set={setTo3} />
          <Num label="To tier 4" value={to4} set={setTo4} />
          <Num label="To tier 5" value={to5} set={setTo5} />
          <Num label="Removal max FP" value={removalMax} set={setRemovalMax} />
          <Num label="Havoc / Redemption max" value={havocMax} set={setHavocMax} />
          <label className="check">
            <input type="checkbox" checked={lucky} onChange={(event) => setLucky(event.target.checked)} />
            Forging Potential takes the lower of two rolls
          </label>
        </div>
      </details>

      <div className="plan-row">
        <button type="button" className="plan" onClick={plan}>Plan the craft</button>
        <p>Edit either item, then plan the craft.</p>
      </div>

      {result && (
        <section className={`result ${result.verdict}`} ref={resultRef} data-testid="verdict">
          <p className="stamp">{stamp(result.verdict)}</p>
          <h2>{result.headline}</h2>
          <p className="summary">{result.summary}</p>
          {result.verdict !== "impossible" && (
            <div className="meter" aria-hidden="true">
              <span style={{ width: `${Math.round(result.successChance * 100)}%` }} />
            </div>
          )}
          {history.length > 0 && (
            <div className="log">
              <h3>Crafts so far</h3>
              <ol>
                {history.map((entry, index) => <li key={`${entry.note}-${index}`}>{entry.note}</li>)}
              </ol>
              <button type="button" className="ghost" onClick={undoCraft}>Undo last craft</button>
            </div>
          )}
          {result.steps[0] && (
            <FollowCraft
              key={`${fp}-${current.map((affix) => `${affix.id}:${affix.tier}:${affix.sealed}`).join("|")}-${result.steps[0].title}`}
              step={result.steps[0]}
              fp={fp}
              affixes={current}
              catalog={catalog}
              slot={slot}
              itemClass={itemClass}
              goalIds={target.filter((affix) => !affix.any).map((affix) => affix.id)}
              onApply={commitCraft}
            />
          )}
          {result.blockers.length > 0 && (
            <ul className="blockers">
              {result.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
            </ul>
          )}
          {result.steps.length > 0 && (
            <>
              <h3>{result.strategyName}</h3>
              <p>{result.strategyBlurb}</p>
              <ol className="steps">
                {result.steps.map((step, index) => (
                  <li key={`${step.title}-${index}`}>
                    <strong>{step.title}</strong>
                    <span>{step.detail}</span>
                    {step.odds && <em>{step.odds}</em>}
                  </li>
                ))}
              </ol>
            </>
          )}
          <div className="stats">
            {result.typicalSpend !== null && <p>Typical Forging Potential spent, if each risky craft hits immediately: <strong>{result.typicalSpend}</strong></p>}
            {result.medianFp !== null && result.successChance > 0 && <p>Forging Potential left when a simulated craft finishes: <strong>{result.medianFp}</strong></p>}
            {result.materials.length > 0 && <p>Materials if the clean path hits first try: {result.materials.join(", ")}. Retries cost more.</p>}
          </div>
          {result.failureReasons.length > 0 && result.successChance < 1 && (
            <>
              <h3>Why the other crafts die</h3>
              <ul>
                {result.failureReasons.map((reason) => (
                  <li key={reason.reason}>{reason.reason} · {formatChance(reason.share)} of runs</li>
                ))}
              </ul>
            </>
          )}
          {result.clears.length > 1 && (
            <>
              <h3>{clearHeading(result.clears.map((option) => option.tool))}</h3>
              <ul className="clears">
                {result.clears.map((option) => (
                  <li key={option.tool}>
                    <strong>{option.tool}</strong> finishes {formatChance(option.chance)} of these crafts, used {option.when}.
                    {option.roll && <span>{option.roll}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {result.alternatives.length > 0 && (
            <>
              <h3>Other routes</h3>
              <ul>
                {result.alternatives.map((alt) => (
                  <li key={alt.name}>{alt.name} · {formatChance(alt.chance)}</li>
                ))}
              </ul>
            </>
          )}
          <ul className="notes">
            {result.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

function clearHeading(tools: string[]): string {
  if (tools.length <= 1) return tools[0] ?? "";
  if (tools.length === 2) return `${tools[0]} or ${tools[1]}`;
  return `${tools.slice(0, -1).join(", ")}, or ${tools[tools.length - 1]}`;
}

function emptyImport(partial: Partial<ImportDraft> & Pick<ImportDraft, "status">): ImportDraft {
  return {
    imageUrl: null,
    fp: null,
    fpType: null,
    slot: null,
    itemClass: null,
    affixes: [],
    rawText: "",
    error: null,
    ...partial,
  };
}

function stamp(verdict: PlanResult["verdict"]): string {
  if (verdict === "guaranteed") return "Guaranteed";
  if (verdict === "likely") return "Likely";
  if (verdict === "risky") return "Risky";
  if (verdict === "unlikely") return "Long shot";
  return "Not possible";
}

function Num({ label, value, set }: { label: string; value: number; set: (n: number) => void }) {
  return (
    <label>
      {label}
      <input type="number" min={0} value={value} onChange={(event) => set(Number(event.target.value))} />
    </label>
  );
}

type BoardProps = {
  title: string;
  rarity: string;
  catalog: AffixDef[];
  slot: SlotId;
  itemClass: ItemClass;
  onCustom: (affix: AffixDef) => void;
  onUseClass: (next: ItemClass) => void;
} & (
  | {
      mode: "current";
      affixes: AffixState[];
      onChange: (next: AffixState[]) => void;
      fp: number;
      fpType: FpType;
      reading: boolean;
      onImage: (file: File) => void;
      onText: (text: string) => void;
      onFp: (n: number) => void;
      onFpType: (type: FpType) => void;
    }
      | {
      mode: "target";
      affixes: GoalAffix[];
      onChange: (next: GoalAffix[]) => void;
      minFp: number;
      onMinFp: (n: number) => void;
      onCopyCurrent: () => void;
      canCopyCurrent: boolean;
    }
);

function ItemBoard(props: BoardProps) {
  const taken = new Set(props.affixes.map((affix) => affix.id));
  const [query, setQuery] = useState("");
  const [customName, setCustomName] = useState("");
  const [customGroup, setCustomGroup] = useState<AffixGroup>("prefix");
  const [dragOver, setDragOver] = useState(false);
  const [tooltipText, setTooltipText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const choices = affixChoices(props.catalog, props.slot, props.itemClass, query, taken);

  function addAny() {
    if (props.mode !== "target") return;
    const used = new Set(props.affixes.map((affix) => affix.id));
    let index = 1;
    while (used.has(`any-${index}`)) index += 1;
    props.onChange([...props.affixes, { id: `any-${index}`, minTier: 1, sealed: false, any: true }]);
  }

  function add(id: string) {
    const def = props.catalog.find((affix) => affix.id === id);
    if (def?.class && props.itemClass === "none") props.onUseClass(def.class);
    if (props.mode === "current") props.onChange([...props.affixes, { id, tier: 1, sealed: false }]);
    else props.onChange([...props.affixes, { id, minTier: 5, sealed: false }]);
    setQuery("");
  }

  function addCustom() {
    const name = customName.trim();
    if (!name) return;
    const id = customAffixId(customGroup, name);
    if (props.catalog.some((affix) => affix.id === id) || taken.has(id)) return;
    props.onCustom({ id, name, group: customGroup, slots: [props.slot] });
    add(id);
    setCustomName("");
  }

  function onPaste(event: React.ClipboardEvent) {
    if (props.mode !== "current") return;
    const image = [...event.clipboardData.items].find((item) => item.type.startsWith("image/"));
    if (image) {
      const file = image.getAsFile();
      if (!file) return;
      event.preventDefault();
      props.onImage(file);
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select")) return;
    const text = event.clipboardData.getData("text/plain").trim();
    if (!text) return;
    event.preventDefault();
    props.onText(text);
  }

  function onDrop(event: React.DragEvent) {
    if (props.mode !== "current") return;
    event.preventDefault();
    setDragOver(false);
    const file = [...event.dataTransfer.files].find((item) => item.type.startsWith("image/"));
    if (file) props.onImage(file);
  }

  return (
    <section
      className="board"
      onPaste={props.mode === "current" ? onPaste : undefined}
      onDragOver={props.mode === "current" ? (event) => { event.preventDefault(); setDragOver(true); } : undefined}
      onDragLeave={props.mode === "current" ? () => setDragOver(false) : undefined}
      onDrop={props.mode === "current" ? onDrop : undefined}
    >
      <header className={props.mode === "target" ? "split" : undefined}>
        <div>
          <p>{props.rarity}</p>
          <h2>{props.title}</h2>
        </div>
        {props.mode === "target" && (
          <button type="button" className="ghost" data-testid="copy-current" onClick={props.onCopyCurrent} disabled={!props.canCopyCurrent}>
            Use the item you have
          </button>
        )}
      </header>
      {props.mode === "current" && (
        <div className={`paste-zone${dragOver ? " over" : ""}`} data-testid="paste-zone" tabIndex={0}>
          <p>{props.reading ? "Reading the tooltip…" : "Click here and paste a screenshot of the item tooltip, or drop the image."}</p>
          <div className="paste-actions">
            <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>Choose image</button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              aria-label="Tooltip image"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) props.onImage(file);
                event.target.value = "";
              }}
            />
          </div>
          <details className="text-import">
            <summary>Paste tooltip text instead</summary>
            <textarea
              value={tooltipText}
              spellCheck={false}
              aria-label="Tooltip text"
              placeholder={"Forging Potential: 42\nTier 7 Strength"}
              onChange={(event) => setTooltipText(event.target.value)}
            />
            <button type="button" data-testid="read-tooltip-text" onClick={() => props.onText(tooltipText)}>Read text</button>
          </details>
        </div>
      )}
      {props.mode === "current" ? (
        <div className="fp">
          <label>
            Forging Potential
            <input type="number" min={0} max={200} value={props.fp} onChange={(event) => props.onFp(Number(event.target.value))} />
          </label>
          <div className="pills" role="group" aria-label="Forging Potential type">
            {(["standard", "ice", "blood"] as const).map((type) => (
              <button key={type} type="button" className={props.fpType === type ? "on" : ""} onClick={() => props.onFpType(type)}>
                {type === "standard" ? "Standard" : type === "ice" ? "Ice" : "Blood"}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <label className="fp-left">
          Forging Potential still required at the end
          <input type="number" min={0} value={props.minFp} onChange={(event) => props.onMinFp(Number(event.target.value))} />
        </label>
      )}
      <ul className="affix-list">
        {props.affixes.length === 0 && <li className="empty">No affixes yet.</li>}
        {props.mode === "current"
          ? props.affixes.map((affix) => (
              <li key={affix.id}>
                <div>
                  <span className={groupClass(props.catalog, affix.id)}>{groupLabel(props.catalog, affix.id)}</span>
                  <strong className={`t${affix.tier}`}>{affixName(props.catalog, affix.id)}</strong>
                  {affix.sealed && <em className="seal">Sealed</em>}
                </div>
                <TierPicker value={affix.tier} onChange={(tier) => props.onChange(props.affixes.map((item) => item.id === affix.id ? { ...item, tier } : item))} />
                <label className="check slim">
                  <input
                    type="checkbox"
                    checked={affix.sealed}
                    onChange={(event) => props.onChange(props.affixes.map((item) => item.id === affix.id ? { ...item, sealed: event.target.checked } : item))}
                  />
                  Sealed
                </label>
                <button type="button" className="ghost" onClick={() => props.onChange(props.affixes.filter((item) => item.id !== affix.id))}>Remove</button>
              </li>
            ))
          : props.affixes.map((affix) => affix.any ? (
              <li key={affix.id} className="any-affix">
                <div>
                  <span className="any">Any</span>
                  <strong>Any affix</strong>
                </div>
                <p className="any-note">Leave this line alone. Forging Potential goes to the lines you named.</p>
                <button type="button" className="ghost" onClick={() => props.onChange(props.affixes.filter((item) => item.id !== affix.id))}>Remove</button>
              </li>
            ) : (
              <li key={affix.id}>
                <div>
                  <span className={groupClass(props.catalog, affix.id)}>{groupLabel(props.catalog, affix.id)}</span>
                  <strong className={`t${affix.minTier}`}>{affixName(props.catalog, affix.id)}</strong>
                  {affix.sealed && <em className="seal">Must be sealed</em>}
                </div>
                <TierPicker
                  value={affix.minTier}
                  onChange={(tier) => props.onChange(props.affixes.map((item) => item.id === affix.id ? { ...item, minTier: tier } : item))}
                />
                <label className="check slim">
                  <input
                    type="checkbox"
                    checked={affix.sealed}
                    onChange={(event) => props.onChange(props.affixes.map((item) => item.id === affix.id ? { ...item, sealed: event.target.checked, minTier: event.target.checked ? Math.min(item.minTier, 4) : item.minTier } : item))}
                  />
                  Seal it
                </label>
                <button type="button" className="ghost" onClick={() => props.onChange(props.affixes.filter((item) => item.id !== affix.id))}>Remove</button>
              </li>
            ))}
      </ul>
      <div className="adder">
        <input value={query} placeholder="Search affixes" onChange={(event) => setQuery(event.target.value)} aria-label={`Search affixes for ${props.title}`} />
        {query && (
          <div className="menu">
            {choices.length === 0 && <p>No matching affix. Add it as a custom one below.</p>}
            {choices.map((affix) => (
              <button key={affix.id} type="button" onClick={() => add(affix.id)}>
                <span>{affix.class ? `${affix.group} · ${affix.class}` : affix.group}</span>
                {printedName(affix)}
              </button>
            ))}
          </div>
        )}
        {props.mode === "target" && (
          <button type="button" className="ghost any-add" onClick={addAny} disabled={props.affixes.filter((affix) => affix.any).length >= 4}>
            Any affix
          </button>
        )}
        <div className="custom">
          <input value={customName} placeholder="Custom affix name" onChange={(event) => setCustomName(event.target.value)} aria-label="Custom affix name" />
          <select value={customGroup} onChange={(event) => setCustomGroup(event.target.value as AffixGroup)} aria-label="Custom affix type">
            <option value="prefix">Prefix</option>
            <option value="suffix">Suffix</option>
          </select>
          <button type="button" onClick={addCustom}>Add</button>
        </div>
      </div>
    </section>
  );
}

function TierPicker({ value, onChange }: { value: number; onChange: (tier: number) => void }) {
  return (
    <div className="tiers" role="group" aria-label="Tier">
      {[1, 2, 3, 4, 5, 6, 7].map((tier) => (
        <button key={tier} type="button" className={value === tier ? `on t${tier}` : ""} onClick={() => onChange(tier)} aria-pressed={value === tier}>
          {tier}
        </button>
      ))}
    </div>
  );
}

function groupLabel(catalog: AffixDef[], id: string): string {
  return catalog.find((affix) => affix.id === id)?.group === "suffix" ? "Suffix" : "Prefix";
}

function groupClass(catalog: AffixDef[], id: string): string {
  return catalog.find((affix) => affix.id === id)?.group === "suffix" ? "suffix" : "prefix";
}
