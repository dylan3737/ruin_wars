# Ruin Wars

Arthurian / fantasy clicker starter in the spirit of old Facebook *Mafia Wars*: spend **Energy** on quests (with **mastery** + **story**), **Stamina** on arena fights, manage **Health**, earn **gold** and **XP**, buy **holdings** for passive income, find **loot** to equip, level up, and buy permanent shop upgrades. No backend — pure static HTML/CSS/JS with `localStorage` saves.

## Resources

| Resource | Used for | Regen |
|----------|----------|--------|
| **Energy** | Quests | ~+1 / 5s (faster with Cloak of Rest) |
| **Stamina** | The Lists (AI fights) | +1 / 7.5s |
| **Health** | Survive fights; 0 = fallen (fights locked) | +1 / 15s while below max; Chapel heals for gold |
| **Gold** | Shop, Chapel, Holdings buy/upgrade | Quests, fights, holding Collect |

## Pacing (v0.3.1)

- Energy regenerates about every **12s**; Stamina about every **18s** (slower, more Mafia Wars–like).
- Quest cooldowns are **short on early jobs**, **long on late jobs** (up to a few minutes).
- Fight opponent cooldowns are longer too.

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
| `index.html` | Layout: stats, quests, Lists + Chapel, holdings, inventory, shop, chronicle + legends |
| `styles.css` | Dark parchment / stone theme |
| `game.js` | All game logic — quests/mastery/story, fights, holdings, loot, shop, regen, save/load |

In `game.js`:

- **`QUESTS` / `FOES` / `HEALS` / `UPGRADES` / `HOLDINGS` / `LOOT` / `STORY_BEATS`** — content tables
- **`doQuest` / `doFight` / `doHeal` / `buyUpgrade` / `buyHolding` / `collectHolding` / `equipItem`** — core actions
- **Fight formula** — `playerPower ≈ level×8 + blade + equipped attack ±6` vs `foe.power ±8`
- **`tick`** — energy, stamina, health regen + holding accrual every second
- **`save` / `load`** — `localStorage` key `ruin_wars_save_v1` (old saves **merge**; new fields get defaults)
- **`window.RuinWars`** — DevTools helpers

## Save compatibility

`SAVE_KEY` remains `ruin_wars_save_v1`. Load merges missing fields (`questCounts`, `storyUnlocks`, `holdings`, `inventory`, `equipped`) so v0.2 saves keep working. Use **Reset** for a clean slate.

## Suggested next features

1. Prestige / New Game+ that keeps a banner title after a soft reset.
2. Collection sets (3-item bonuses) on top of equip.
3. Sound cues and a short “quest complete” flourish.
4. Export / import save as JSON for moving between browsers.

## License

Starter code for Dylan — use freely in the Ruin Wars project.
