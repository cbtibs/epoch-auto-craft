# Epoch Auto Craft

A Last Epoch Season 5 crafting planner for Rage of the Frostborn (patch 1.5.1.1).

Put in the item you have and the item you want, including tiers and Forging Potential. The planner says whether that craft can finish, and which sequence is most likely to get there.

## What you can do

- Pick the slot and class. The affix search only lists lines that slot can roll. Class skill levels show up once that class is selected.
- Set Forging Potential, each affix tier, and whether a line is sealed.
- Paste a tooltip, or a screenshot of one, into the item you have. Check the read before you apply it. Screenshot reading uses the browser and is the part most likely to miss a faint tier.
- Mark spare lines as **Any affix**. Forging Potential is spent on the lines you named. The spare lines can stay as they are, which is the usual setup before a slam into a unique.
- Copy the item you have onto the target with **Use the item you have**, then change the tiers you care about.
- After a craft, record what actually happened. A crit, a failed seal, or a Chaos result rebuilds the plan from the item you have now.
- Every step names the glyph or rune and which slot it goes in. Glyph of Hope goes in the glyph slot. A rune step says to put Hope in the glyph slot and the rune in the rune slot. Despair and Chaos cannot also hold Hope.

The three example buttons load a helmet that needs a seal, a safe Health craft, and a tier 7 that shards cannot create.

## How a plan is chosen

An item has two prefixes, two suffixes, and one sealed affix. Shards add a line at tier 1 or raise a line by one, and they stop at tier 5. Tier 6 and tier 7 only exist if they are already on the item, or if Havoc moves them. Havoc is legal only with exactly four unsealed affixes and at least one of those at tier 6 or higher. A sealed affix does not count toward those four.

When a prefix or a suffix is full and you still need a line in that group, the planner compares Seal, Chaos, and Removal by the chance the **whole craft** finishes, not by the chance of that one roll. It also compares doing it before adding another line against doing it after a filler is in so Havoc can move an exalted tier.

The printed steps are the path where each risky craft hits. The percentage comes from simulating misses, critical successes, and Forging Potential rolls. If every craft in the route is safe and your Forging Potential covers the worst roll of each, the plan is 100%.

"Best" means the best of these shapes: seal now, seal after filling, Chaos, Removal, and Redemption, each tried before a Havoc filler and after one. It is not every possible order of clicks.

A filler step says to add any prefix or any suffix that item can roll. It does not name a specific junk affix. The search box is limited to lines that slot can actually take.

## Forge rules used here

| Craft | What the planner assumes |
| --- | --- |
| Glyph of Hope | 25%. The craft is free. Used on shard crafts, Removal, Havoc, and Redemption. |
| Critical success | 12% by default. Free, and one random unsealed affix still below tier 5 goes up by one. Eleventh Hour has not published this rate. |
| Forging Potential | The lower of two rolls. A new affix is 1–18, then 1–10, 1–12, 1–18, and 1–24 up to tier 5. |
| Glyph of Despair | Seals one affix of tier 4 or lower. A failed seal upgrades that affix instead. A second seal is refused. Hope cannot be used with it. |
| Glyph of Chaos | Raises the tier by one, then rerolls the affix. Cannot be used on tier 5. Hope cannot be used with it. |
| Rune of Removal | Deletes one random unsealed affix. Costs 1–25. |
| Rune of Havoc | Shuffles the tiers on the four unsealed affixes. Costs up to 20. |
| Rune of Redemption | Rerolls every exalted affix. Costs up to 20. |

Seal chances use the Tunklab formula. More unsealed affixes raise the seal chance a little. An exalted item seals more readily than a normal one. Glyph of Despair cannot seal tier 5 or higher. A seal above tier 4 can already be on the item from a drop or a lucky Blood Rage craft, and Havoc cannot move it.

Chaos and Redemption odds count the affixes in this app, plus 25 extra unlisted outcomes. That extra number is a dial in Forge assumptions, so Chaos is the loosest odds in the plan. A bigger affix list makes Chaos less likely to hit the line you want.

Ice and Blood Forging Potential stay at no bonus until you type one. Those rates are not published.

## What it does not do

- Legendary Potential slams, corruption, Weaver's Will, experimental affixes, and tier 8.
- A staff and a two-handed sword share one list. A wand shares the one-handed list with axes, daggers, maces, sceptres, and swords. An affix is offered if any base in that slot can roll it.
- The step list does not draw the failure branch. A failed seal, or a Removal that deletes a tier 7, is inside the percentage. A deleted tier 7 cannot be crafted back with shards.

## Log

7 Oct 2026. First version friends can try.

- Season 5 forge model: shards to tier 5, one seal, Havoc only with four open affixes and an exalted tier to move.
- Seal, Chaos, and Removal are ranked by finish rate, including whether to open the slot before a Havoc filler or after one.
- If the item already has a sealed affix, Despair is not offered as a way to free another slot.
- Affix lists are per slot: helmet, body, gloves, boots, belt, ring, amulet, relic, one-handed weapon, two-handed weapon, bow, catalyst, shield, and quiver. Health is not offered on weapons. Movement Speed is on boots. Flat Fire Penetration is an amulet prefix. The weapon suffix is Fire Penetration and Minion Fire Penetration.
- Any-affix targets, copy-current-to-target, tooltip text, tooltip screenshots, and follow-up replanning.
- Steps name the glyph or rune. A Havoc filler says to add any legal prefix or suffix, not a named affix the item cannot roll.
- 22 automated checks cover seal math, a guaranteed tier 5, a blocked tier 7, the exalted helmet seal, a staff that must move a tier 7, and an item that is already sealed.

## Run it locally

Node 22.

```bash
npm install
npm test
npm run dev
```

The dev server is http://localhost:5173/.

```bash
npm run build
npx vite preview --host --port 4173
```

That serves the production build at http://localhost:4173/.

## Notes for testers

Worth checking on a real item:

- Search a helmet, a pair of boots, and a weapon. A line that cannot roll there should not appear.
- A craft that needs a slot opened should show Seal, Removal, and Chaos with finish rates, and the steps should name the glyph or rune.
- An item that already has a sealed affix should not tell you to seal another one.
- Paste a tooltip and see whether the slot, Forging Potential, and tiers match the item. Faint "Tier:" text is the usual miss.
- Record one real craft and see whether the new plan matches the item in your inventory.

Forge assumptions at the bottom of the page are editable. Leave them alone unless you are testing a different crit rate or Chaos pool.

## Publishing

GitHub Pages is set up and not turned on yet. `.github/workflows/pages.yml` tests, builds, and deploys on a push to `main`. Free Pages needs a **public** repository. The site will be `https://<username>.github.io/epoch-auto-craft/`.

`node_modules`, `dist`, `.env` files, keys, and local `*.traineddata` files are ignored. Do not commit those.
