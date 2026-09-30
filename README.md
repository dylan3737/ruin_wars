# Ruin Wars

Arthurian / fantasy clicker starter in the spirit of old Facebook *Mafia Wars*: spend **Energy** on quests across **three regions** (with **mastery** + **story**), **Stamina** on arena fights and **boss** strikes, manage **Health**, grow a **knight band**, earn **gold** and **XP**, buy **holdings** for passive income, find **loot** to equip, complete **collections**, level up, and buy permanent shop upgrades. No backend — pure static HTML/CSS/JS with `localStorage` saves.

**Current version: v0.4** — adds Regions, Bosses, Knight Band and Collections (see below).

## Resources

| Resource | Used for | Regen |
|----------|----------|--------|
| **Energy** | Quests | +1 / 12s (~9s with Cloak of Rest) |
| **Stamina** | The Lists (AI fights) + boss strikes | +1 / 18s |
| **Health** | Survive fights / boss counterblows; 0 = fallen (fights + bosses locked) | +1 / 20s while below max; Chapel heals for gold |
| **Gold** | Shop, Chapel, Holdings buy/upgrade | Quests, fights, holding Collect |

## Pacing (v0.3.1)

- Energy regenerates about every **12s**; Stamina about every **18s** (slower, more Mafia Wars–like).
- Quest cooldowns are **short on early jobs**, **long on late jobs** (up to a few minutes).
- Fight opponent cooldowns are longer too.

## v0.4 systems

### Regions
Quest board has region tabs. Each region has 6 quests with its own mastery ranks (5 / 15 / 40) and story beats.

| Region | Unlock | Quests | Energy | Gold / XP (base) | Cooldown |
|--------|--------|--------|--------|------------------|----------|
| **Camelot** | Lv 1 | the original 6 | 3–15 | 18–210 / 28–230 | 12s – ~3 min (unchanged) |
| **Avalon** | Lv 10 (quests Lv 10–18) | Mists, Lady of the Lake, Apple Groves, Faerie Ring, Morgan's Illusions, Lost Scabbard | 14–24 | 260–640 / 270–550 | 2.5 – 3.75 min |
| **The Wastes** | Lv 20 (quests Lv 20–30) | Ashen Road, Unquiet Dead, Saxon Warband, Fisher King, Camlann, Hollow Throne | 20–35 | 600–1400 / 560–1050 | 3.5 – 5 min |

Holdings are tagged by region; two new ones: **Isle Apple Orchard** (Lv 10, 3,000g, +140g / 3 min) and **Salt Road Fort** (Lv 20, 8,000g, +360g / 4 min). Two new Lists foes: **Faerie Champion** (Lv 11, power 140) and **Mordred's Outrider** (Lv 20, power 230).

### Bosses
Shared HP pool whittled down by Stamina strikes. HP persists (saved), regenerates slowly while the boss lives, and resets when it returns after its cooldown. Strike damage ≈ your attack rating ×0.85–1.15 (+ named-knight bonuses); each strike also pays a little gold/XP and the boss hits back (reduced by defense). Every kill guarantees the boss's unique item plus a collection piece (missing pieces preferred); the first kill writes a Legend.

| Boss | Level | HP | Regen | Stamina / strike | Counter | Kill reward | Returns |
|------|-------|----|-------|------------------|---------|-------------|---------|
| **The Green Knight** | 12 | 2,400 | 30 HP/min | 5 | 6–14 | 2,500 gold, 1,000 XP, **Green Girdle** (relic: +15 def, +5% XP), Round Table piece | 30 min ("a year and a day") |
| **Mordred** | 25 | 10,000 | 45 HP/min | 8 | 12–26 | 8,000 gold, 3,000 XP, **Clarent** (weapon: +30 power, +5 def), Pendragon piece | 60 min |

(Kill gold/XP are multiplied by your gold/XP bonuses. Strikes also give 15g/10xp and 40g/25xp respectively.)

### Knight Band
- **Attack rating** = level×8 + Tempered Blade + gear + band + collections. **Defense rating** = level×3 + gear + band + collections; damage taken is multiplied by `1 − def / (def + 150)`.
- **Sworn knights**: +2 attack, +2 defense each. Cap = **2 + level** (max 60). **Hire** costs `30 + 20 × current sworn` gold; **Sound the Muster Horn** recruits one free every **10 min** (same cap).
- **Named knights** (one-time, don't use the cap): **Sir Gawain** (Lv 8, 1,500g: +10 atk/+5 def, +25% damage vs the Green Knight), **Sir Percival** (Lv 15, 4,000g: +8/+8, +5% XP), **Sir Lancelot** (Lv 22, 9,000g: +20/+10, +10% damage to all bosses).
- Band size / max and Atk · Def ratings are shown in the stats bar.

### Collections
One 5-piece set per region. Pieces drop from quests in that region (**15%**), fight wins (**10%**, from any unlocked region's set) and are guaranteed from boss kills. Duplicates are counted. A complete set can be redeemed **once** (consumes one of each piece) for a permanent bonus:

| Set | Region | Pieces | Bonus |
|-----|--------|--------|-------|
| **Arms of the Round Table** | Camelot | Round Table Splinter, Kay's Seneschal Key, Bedivere's Gauntlet, Gawain's Pentangle Boss, Arthur's Signet Ring | +10 attack, +10 defense |
| **Relics of the Grail** | Avalon | Lady's Veil, Golden Apple of Avalon, Silver Paten, Tip of the Bleeding Lance, Grail's Light | +10 max Energy, +5 max Stamina |
| **Regalia of Pendragon** | Wastes | Red Dragon Banner, Camlann Arrowhead, Uther's Torque, Merlin's Hazel Staff, Crown of Logres | +10% gold, +10% XP |

## v0.3 systems

### Quest mastery + Legends
- Each quest tracks `questCounts`. Ranks: **Unproven → Proven (5) → Veteran (15) → Master (40)**.
- Hitting a milestone unlocks an Arthurian story beat (re-readable under **Legends** in the Chronicle) and a small permanent bonus on that quest (cumulative ~+2–7% gold / +0–4% XP depending on rank).

### Holdings
- Buy fantasy properties (farm, chapel lands, watchtower, ruin market). Each accrues gold on a real-time cycle (60–150s).
- **Collect** gathers pending gold (capped at **2 cycles** so AFK does not explode). Optional upgrades (up to rank 2) raise income. Offline time accrues like energy.

### Loot + inventory
- ~22% chance on quest complete (also ~12% on fight win) to drop from a 9-item table (weapons, armor, relics).
- Equip **1 weapon + 1 armor**; **relics** are passive while owned. Duplicates stack as counts.

## How to run locally

Zero build step. From this folder:

```bash
# Option A — open the file
open index.html          # macOS
xdg-open index.html      # Linux
start index.html         # Windows

# Option B — tiny static server
npx --yes serve .
```

## Where the main loop lives

| File | Role |
|------|------|
| `index.html` | Layout: stats (incl. band), quests + region tabs, Lists + Chapel, bosses, knight band, holdings, inventory, collections, shop, chronicle + legends |
| `styles.css` | Dark parchment / stone theme |
| `game.js` | All game logic — regions/quests/mastery/story, fights, bosses, band, holdings, loot, collections, shop, regen, save/load |

In `game.js`:

- **`REGIONS` / `QUESTS` / `FOES` / `BOSSES` / `NAMED_KNIGHTS` / `HEALS` / `UPGRADES` / `HOLDINGS` / `LOOT` / `COLLECTIONS` / `STORY_BEATS` / `BOSS_LEGENDS`** — content tables
- **`doQuest` / `doFight` / `doBossStrike` / `hireRecruit` / `rallyRecruit` / `recruitNamed` / `redeemCollection` / `setRegion` / `doHeal` / `buyUpgrade` / `buyHolding` / `collectHolding` / `equipItem`** — core actions
- **Fight formula** — `playerPower = attackRating() ±6` vs `foe.power ±8`; losses/chip damage soaked by `defenseRating()`
- **`tick`** — energy, stamina, health regen + holding accrual + boss regen/respawn every second, then `renderLive()`
- **Rendering** — render functions build detached nodes and `patchChildren()` morphs them into the page (keyed by `data-key`), so unchanged buttons keep their identity across ticks (no dropped clicks / hover flicker). Buttons use `data-action` / `data-id` with one delegated click listener (`ACTIONS`).
- **`save` / `load`** — `localStorage` key `ruin_wars_save_v4` (`saveVersion: 4`); falls back to legacy `ruin_wars_save_v1` and migrates. Saves happen immediately after actions, at most every ~8s from the tick when something changed, and on `visibilitychange` (hidden) / `pagehide` / `beforeunload`. The last 50 chronicle lines are saved under `log` (optional; older saves load fine without it).
- **`window.RuinWars`** — DevTools helpers

## Save compatibility

v0.4 saves to `ruin_wars_save_v4` with `saveVersion: 4`. If no v4 save exists, the v0.3 save under `ruin_wars_save_v1` is loaded and migrated: missing fields (`region`, `collections`, `collectionsRedeemed`, `bosses`, `band`, plus the older `questCounts`, `storyUnlocks`, `holdings`, `inventory`, `equipped`) get defaults. The legacy key is left untouched, so rolling back to v0.3 still works. Use **Reset** for a clean slate.

## Suggested next features

1. Prestige / New Game+ that keeps a banner title after a soft reset.
2. Sound cues and a short “quest complete” flourish.
3. Export / import save as JSON for moving between browsers.
4. A third boss (the Questing Beast?) and region-specific foes in The Lists.

## License

Starter code for Dylan — use freely in the Ruin Wars project.
