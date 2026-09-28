/**
 * Ruin Wars — core game loop (v0.3)
 * Quests (Energy) + mastery/story, The Lists (Stamina/Health), Holdings (passive gold),
 * Loot/Inventory (equip), shop upgrades. Persist: localStorage SAVE_KEY
 */

(function () {
  "use strict";

  const SAVE_KEY = "ruin_wars_save_v1";
  const TICK_MS = 1000;
  const BASE_ENERGY_MAX = 25;
  const BASE_STAMINA_MAX = 20;
  const BASE_HEALTH_MAX = 100;
  const BASE_REGEN_MS = 12000;
  const STAMINA_REGEN_MS = 18000;
  const HEALTH_REGEN_MS = 20000;
  const LOG_MAX = 50;
  const BLADE_ATTACK_BONUS = 12;
  const LOOT_DROP_CHANCE = 0.22;
  const MASTERY_THRESHOLDS = [5, 15, 40];
  const MASTERY_RANKS = ["Unproven", "Proven", "Veteran", "Master"];
  const HOLDING_CAP_CYCLES = 2;

  /** XP needed to go from `level` to level+1 — kept gentle early */
  function xpForLevel(level) {
    return Math.floor(35 + level * 22 + Math.pow(level, 1.15) * 6);
  }

  /**
   * Quest cooldown: mild on early jobs, long on big ones (A+B pacing).
   * Energy/Stamina regen is also slow — MW-style resource wait + job rests.
   */
  function cooldownMsFor(quest) {
    var e = quest.energy;
    if (e <= 5) {
      return 6000 + e * 2000; // ~12–16s early jobs
    }
    if (e <= 10) {
      return 45000 + (e - 5) * 8000; // ~45–85s mid
    }
    return 120000 + (e - 10) * 18000; // ~2–3.5 min late jobs
  }

  function questCooldownRemaining(questId) {
    const until = (state.questCooldownUntil && state.questCooldownUntil[questId]) || 0;
    return Math.max(0, until - Date.now());
  }

  function fightCooldownRemaining(foeId) {
    const until = (state.fightCooldownUntil && state.fightCooldownUntil[foeId]) || 0;
    return Math.max(0, until - Date.now());
  }

  function formatCooldown(ms) {
    const s = Math.ceil(ms / 1000);
    if (s < 60) return s + "s";
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + "m " + r + "s";
  }

  function formatSeconds(sec) {
    if (sec < 60) return sec + "s";
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return r ? m + "m " + r + "s" : m + "m";
  }

  function randInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  // --- Content tables ---

  const QUESTS = [
    {
      id: "patrol",
      name: "Patrol the Outer Walls",
      desc: "Walk the crumbling battlements.",
      energy: 3,
      gold: 18,
      xp: 28,
      minLevel: 1,
    },
    {
      id: "bandits",
      name: "Drive Off Bandits",
      desc: "Clear the road to the ruined chapel.",
      energy: 5,
      gold: 35,
      xp: 48,
      minLevel: 1,
    },
    {
      id: "relics",
      name: "Scavenge Relics",
      desc: "Search mossy tombs for forgotten coin.",
      energy: 7,
      gold: 60,
      xp: 75,
      minLevel: 2,
    },
    {
      id: "wyrm",
      name: "Hunt the Marsh Wyrm",
      desc: "A lesser beast plagues the fen.",
      energy: 10,
      gold: 95,
      xp: 110,
      minLevel: 3,
    },
    {
      id: "siege",
      name: "Hold the Broken Keep",
      desc: "Stand watch through the night.",
      energy: 12,
      gold: 140,
      xp: 155,
      minLevel: 5,
    },
    {
      id: "grail",
      name: "Quest for the Lost Chalice",
      desc: "Venture deep into the old kingdom.",
      energy: 15,
      gold: 210,
      xp: 230,
      minLevel: 7,
    },
  ];

  /** Arthurian story beats keyed by questId + milestone threshold */
  const STORY_BEATS = {
    patrol: {
      5: "On the fifth circuit of the walls you find a knight's boot-print in the frost — facing outward, never returning. The watchmen say the old king walked these stones alone. You begin to understand why the battlements still hold.",
      15: "Veterans of the wall salute you now. A raven nests in the gatehouse; some claim it speaks the names of kings. You leave a coin for the bird and keep walking — the realm needs eyes more than omens.",
      40: "Master of the Outer Walls: the stones remember your tread. In a dream the Round Table's empty seats catch moonlight, and a voice asks only that you keep the watch. You wake knowing the wall is yours as much as any crown.",
    },
    bandits: {
      5: "The road to the chapel runs red with bandit blood — and once, with yours. A dying thief presses a scrap of silk into your hand: a lady's favor from a court that no longer stands. You bury him facing the chapel door.",
      15: "Word spreads that the chapel road is safe again. Pilgrims leave bread at your camp. An old woman swears you ride with the ghost of Galahad; you tell her you only clear the path. She smiles as if that were enough.",
      40: "Master of the Road: the outlaws flee at your banner. In the chapel crypt you find a ledger of stolen tithes — and reverse every entry in gold of your own. The priest calls it penance; the land calls it justice.",
    },
    relics: {
      5: "Beneath moss and bone you uncover a chalice rim, cracked and dull. It does not glow. It only feels warm when you think of home. You wrap it in cloth and wonder what 'holy' meant before the kingdoms fell.",
      15: "Tombs yield more than coin: a broken lance-tip etched with a star. Scholars of the ruin say it matched Lancelot's mark. You keep it not for glory, but because someone should remember the names the moss tried to erase.",
      40: "Master Scavenger: the dead no longer begrudge your visits. One night a white stag leads you to a sealed alcove — empty, save for a single line carved in Latin: 'The quest is the keeping.' You leave a flower and take nothing.",
    },
    wyrm: {
      5: "The marsh wyrm's blood hisses on cold steel. Fen-folk say lesser dragons once served the Lady of the Lake. This one served hunger alone. You burn the carcass so nothing darker claims the bones.",
      15: "Veterans of the fen call you Wyrm-Bane. Children dare each other to touch your shield. You teach them to read the mud for tracks instead — the marsh still breeds worse than one beast's brood.",
      40: "Master of the Marsh: the last wyrm bows its head before you strike. In its eye you see a reflection of a lake that is not there. When the blade falls, the water smells faintly of lilies for an hour. Then only peat again.",
    },
    siege: {
      5: "Night one on the Broken Keep: arrows in the dark, a song from the courtyard that no living throat could finish. You hold the stair. At dawn the song is gone, and so are three of your companions. You carve their names into the gate.",
      15: "The Keep knows your footsteps. Siege-engines rust beyond the ditch; you oil one ballista anyway. A messenger from a rival lord offers gold to abandon the watch. You send him home with his purse lighter and his pride intact.",
      40: "Master of the Broken Keep: the night no longer tests you — it trusts you. In the great hall's ash you find a single unbroken goblet. You fill it with rainwater and toast the absent kings. The Keep stands because you do.",
    },
    grail: {
      5: "Deep in the old kingdom you drink from a spring that tastes of iron and honey. Visions flicker: a table, a wound that will not close, a question never asked. You wake with wet boots and a purpose sharper than before.",
      15: "The Lost Chalice remains lost — yet the seeking has remade you. Hermits call you Grail-Touched. You answer that you have found only roads, ruins, and the courage to walk them again. They say that is the chalice's first gift.",
      40: "Master of the Quest: you stand where maps end. No cup appears. Instead, a quiet certainty — that the kingdom's healing was never a prize to seize, but a duty to keep. You turn homeward, lighter, and the path blooms behind you.",
    },
  };

  /** Per-quest mastery bonuses: index 0 unused; 1=Proven, 2=Veteran, 3=Master (cumulative) */
  const MASTERY_BONUSES = {
    // goldAdd / xpAdd are additive multipliers on THAT quest only (0.02 = +2%)
    1: { goldAdd: 0.02, xpAdd: 0 },
    2: { goldAdd: 0.02, xpAdd: 0.02 },
    3: { goldAdd: 0.03, xpAdd: 0.02 },
  };

  const FOES = [
    {
      id: "squire",
      name: "Boastful Squire",
      desc: "Eager steel, little skill.",
      stamina: 3,
      power: 18,
      gold: 12,
      xp: 18,
      dmgMin: 4,
      dmgMax: 10,
      cooldownMs: 25000,
      minLevel: 1,
    },
    {
      id: "outlaw",
      name: "Roadside Outlaw",
      desc: "A cutpurse who thinks himself a knight.",
      stamina: 5,
      power: 32,
      gold: 28,
      xp: 36,
      dmgMin: 8,
      dmgMax: 16,
      cooldownMs: 35000,
      minLevel: 1,
    },
    {
      id: "hedge",
      name: "Hedge Knight",
      desc: "Scarred mail and a borrowed lance.",
      stamina: 7,
      power: 48,
      gold: 48,
      xp: 55,
      dmgMin: 12,
      dmgMax: 22,
      cooldownMs: 45000,
      minLevel: 2,
    },
    {
      id: "captain",
      name: "Ruined Watch Captain",
      desc: "Still keeps the old codes — and a sharp blade.",
      stamina: 9,
      power: 68,
      gold: 75,
      xp: 85,
      dmgMin: 16,
      dmgMax: 28,
      cooldownMs: 60000,
      minLevel: 4,
    },
    {
      id: "black",
      name: "Black Banner Champion",
      desc: "The lists' terror; few leave unscathed.",
      stamina: 12,
      power: 95,
      gold: 120,
      xp: 130,
      dmgMin: 22,
      dmgMax: 38,
      cooldownMs: 90000,
      minLevel: 6,
    },
  ];

  const HEALS = [
    {
      id: "poultice",
      name: "Small Poultice",
      desc: "Chapel salve. Restores 40 Health.",
      cost: 15,
      heal: 40,
    },
    {
      id: "fullrest",
      name: "Full Rest",
      desc: "A night under the chapel roof. Restore all Health.",
      cost: 40,
      heal: "full",
    },
  ];

  const UPGRADES = [
    {
      id: "sword",
      name: "Tempered Blade",
      desc: "+35% gold from every quest; +12 attack power in The Lists",
      cost: 40,
      effect: { goldMult: 0.35, attackBonus: BLADE_ATTACK_BONUS },
    },
    {
      id: "cloak",
      name: "Cloak of Rest",
      desc: "Energy regenerates 40% faster",
      cost: 55,
      effect: { regenMult: 0.4 },
    },
    {
      id: "banner",
      name: "Banner of Valor",
      desc: "+30% XP from every quest",
      cost: 70,
      effect: { xpMult: 0.3 },
    },
  ];

  /** Holdings: passive gold. cycleSec = real seconds per income tick. maxLevel = purchase + upgrades */
  const HOLDINGS = [
    {
      id: "farm",
      name: "Millet Farm",
      desc: "Humble fields beyond the ditch. Slow coin, honest work.",
      cost: 75,
      minLevel: 1,
      cycleSec: 60,
      baseGold: 8,
      upgradeCost: [120, 200],
      upgradeGoldAdd: [4, 6],
      maxLevel: 2,
    },
    {
      id: "chapel_lands",
      name: "Chapel Tithe Lands",
      desc: "Orchards pledged to the ruined chapel. Pilgrims leave coins.",
      cost: 180,
      minLevel: 2,
      cycleSec: 90,
      baseGold: 16,
      upgradeCost: [250, 400],
      upgradeGoldAdd: [8, 12],
      maxLevel: 2,
    },
    {
      id: "watchtower",
      name: "Watchtower Toll",
      desc: "A lean tower on the trade road. Merchants pay for safe passage.",
      cost: 400,
      minLevel: 3,
      cycleSec: 120,
      baseGold: 30,
      upgradeCost: [500, 750],
      upgradeGoldAdd: [12, 18],
      maxLevel: 2,
    },
    {
      id: "ruin_market",
      name: "Ruin Market Stall",
      desc: "Vendors under broken arches. Relics and rumors change hands.",
      cost: 850,
      minLevel: 5,
      cycleSec: 150,
      baseGold: 55,
      upgradeCost: [900, 1400],
      upgradeGoldAdd: [20, 30],
      maxLevel: 2,
    },
  ];

  /**
   * Loot table — weapons/armor equip (1 each); relics are passive while owned.
   * weight: relative drop weight when a loot roll succeeds.
   */
  const LOOT = [
    {
      id: "ashwood_spear",
      name: "Ashwood Spear",
      slot: "weapon",
      desc: "+4 fight power",
      weight: 28,
      effect: { attack: 4 },
    },
    {
      id: "knight_longsword",
      name: "Knight's Longsword",
      slot: "weapon",
      desc: "+9 fight power",
      weight: 16,
      effect: { attack: 9 },
    },
    {
      id: "grail_blade",
      name: "Grail-Touched Blade",
      slot: "weapon",
      desc: "+15 fight power",
      weight: 6,
      effect: { attack: 15 },
    },
    {
      id: "leather_brigandine",
      name: "Leather Brigandine",
      slot: "armor",
      desc: "+3% quest gold",
      weight: 26,
      effect: { goldMult: 0.03 },
    },
    {
      id: "mail_hauberk",
      name: "Mail Hauberk",
      slot: "armor",
      desc: "+6% quest gold; +3 fight power",
      weight: 14,
      effect: { goldMult: 0.06, attack: 3 },
    },
    {
      id: "sanctified_plate",
      name: "Sanctified Plate",
      slot: "armor",
      desc: "+10% quest gold; +5 fight power",
      weight: 5,
      effect: { goldMult: 0.1, attack: 5 },
    },
    {
      id: "pilgrim_token",
      name: "Pilgrim's Token",
      slot: "relic",
      desc: "+3% XP (passive while kept)",
      weight: 20,
      effect: { xpMult: 0.03 },
    },
    {
      id: "fen_wyrm_scale",
      name: "Fen Wyrm Scale",
      slot: "relic",
      desc: "+4% gold (passive while kept)",
      weight: 14,
      effect: { goldMult: 0.04 },
    },
    {
      id: "chalice_shard",
      name: "Broken Chalice Shard",
      slot: "relic",
      desc: "+3% XP and +2% gold (passive)",
      weight: 8,
      effect: { xpMult: 0.03, goldMult: 0.02 },
    },
  ];

  function defaultState() {
    return {
      name: "Knight",
      level: 1,
      xp: 0,
      gold: 0,
      energy: BASE_ENERGY_MAX,
      energyMax: BASE_ENERGY_MAX,
      stamina: BASE_STAMINA_MAX,
      staminaMax: BASE_STAMINA_MAX,
      health: BASE_HEALTH_MAX,
      healthMax: BASE_HEALTH_MAX,
      fallen: false,
      ownedUpgrades: {},
      questCooldownUntil: {},
      fightCooldownUntil: {},
      questCounts: {},
      storyUnlocks: [],
      holdings: {},
      inventory: {},
      equipped: { weapon: null, armor: null },
      lastTick: Date.now(),
      energyAccMs: 0,
      staminaAccMs: 0,
      healthAccMs: 0,
    };
  }

  let state = defaultState();
  let logLines = [];

  // --- Mastery helpers ---

  function questCount(questId) {
    return (state.questCounts && state.questCounts[questId]) || 0;
  }

  function masteryTier(questId) {
    const c = questCount(questId);
    let tier = 0;
    for (let i = 0; i < MASTERY_THRESHOLDS.length; i++) {
      if (c >= MASTERY_THRESHOLDS[i]) tier = i + 1;
    }
    return tier;
  }

  function masteryRankName(questId) {
    return MASTERY_RANKS[masteryTier(questId)] || MASTERY_RANKS[0];
  }

  function masteryBonusForQuest(questId) {
    const tier = masteryTier(questId);
    let goldAdd = 0;
    let xpAdd = 0;
    for (let t = 1; t <= tier; t++) {
      const b = MASTERY_BONUSES[t];
      if (b) {
        goldAdd += b.goldAdd;
        xpAdd += b.xpAdd;
      }
    }
    return { goldAdd: goldAdd, xpAdd: xpAdd };
  }

  function nextMasteryHint(questId) {
    const c = questCount(questId);
    for (let i = 0; i < MASTERY_THRESHOLDS.length; i++) {
      if (c < MASTERY_THRESHOLDS[i]) {
        return MASTERY_THRESHOLDS[i] - c + " to " + MASTERY_RANKS[i + 1];
      }
    }
    return "Max rank";
  }

  // --- Loot / equip bonuses ---

  function getLootDef(itemId) {
    return LOOT.find(function (L) {
      return L.id === itemId;
    });
  }

  function inventoryCount(itemId) {
    return (state.inventory && state.inventory[itemId]) || 0;
  }

  function collectEquipEffects() {
    let attack = 0;
    let goldMult = 0;
    let xpMult = 0;

    function applyEffect(eff) {
      if (!eff) return;
      if (eff.attack) attack += eff.attack;
      if (eff.goldMult) goldMult += eff.goldMult;
      if (eff.xpMult) xpMult += eff.xpMult;
    }

    if (state.equipped && state.equipped.weapon) {
      const w = getLootDef(state.equipped.weapon);
      if (w && inventoryCount(w.id) > 0) applyEffect(w.effect);
    }
    if (state.equipped && state.equipped.armor) {
      const a = getLootDef(state.equipped.armor);
      if (a && inventoryCount(a.id) > 0) applyEffect(a.effect);
    }
    // Relics: passive if owned (count > 0)
    LOOT.forEach(function (L) {
      if (L.slot === "relic" && inventoryCount(L.id) > 0) {
        applyEffect(L.effect);
      }
    });

    return { attack: attack, goldMult: goldMult, xpMult: xpMult };
  }

  // --- Bonuses from shop + equip + mastery ---

  function goldMultiplier(questId) {
    let m = 1;
    for (const u of UPGRADES) {
      if (state.ownedUpgrades[u.id] && u.effect.goldMult) {
        m += u.effect.goldMult;
      }
    }
    const eq = collectEquipEffects();
    m += eq.goldMult;
    if (questId) {
      m += masteryBonusForQuest(questId).goldAdd;
    }
    return m;
  }

  function xpMultiplier(questId) {
    let m = 1;
    for (const u of UPGRADES) {
      if (state.ownedUpgrades[u.id] && u.effect.xpMult) {
        m += u.effect.xpMult;
      }
    }
    const eq = collectEquipEffects();
    m += eq.xpMult;
    if (questId) {
      m += masteryBonusForQuest(questId).xpAdd;
    }
    return m;
  }

  function attackBonusFromShop() {
    let bonus = 0;
    for (const u of UPGRADES) {
      if (state.ownedUpgrades[u.id] && u.effect.attackBonus) {
        bonus += u.effect.attackBonus;
      }
    }
    return bonus;
  }

  function regenIntervalMs() {
    let bonus = 0;
    for (const u of UPGRADES) {
      if (state.ownedUpgrades[u.id] && u.effect.regenMult) {
        bonus += u.effect.regenMult;
      }
    }
    return Math.max(2500, Math.floor(BASE_REGEN_MS / (1 + bonus)));
  }

  function playerPower() {
    const eq = collectEquipEffects();
    return state.level * 8 + attackBonusFromShop() + eq.attack + randInt(-6, 6);
  }

  function foePower(foe) {
    return foe.power + randInt(-8, 8);
  }

  function syncMaxesFromLevel() {
    state.energyMax = BASE_ENERGY_MAX + (state.level - 1) * 2;
    state.staminaMax = BASE_STAMINA_MAX + (state.level - 1) * 1;
    state.healthMax = BASE_HEALTH_MAX + (state.level - 1) * 5;
  }

  function clearFallenIfHealed() {
    if (state.health > 0) {
      state.fallen = false;
    } else {
      state.fallen = true;
      state.health = 0;
    }
  }

  // --- Holdings helpers ---

  function holdingState(id) {
    if (!state.holdings) state.holdings = {};
    if (!state.holdings[id]) {
      state.holdings[id] = {
        owned: false,
        level: 0,
        accMs: 0,
        pending: 0,
      };
    }
    return state.holdings[id];
  }

  function holdingIncomePerCycle(def, h) {
    if (!h.owned) return 0;
    let g = def.baseGold;
    for (let i = 0; i < h.level && i < def.upgradeGoldAdd.length; i++) {
      g += def.upgradeGoldAdd[i];
    }
    return g;
  }

  function holdingCap(def, h) {
    return holdingIncomePerCycle(def, h) * HOLDING_CAP_CYCLES;
  }

  function accrueHolding(def, h, elapsedMs) {
    if (!h.owned) return;
    const cycleMs = def.cycleSec * 1000;
    const cap = holdingCap(def, h);
    if (h.pending >= cap) {
      h.accMs = 0;
      return;
    }
    h.accMs = (h.accMs || 0) + elapsedMs;
    const income = holdingIncomePerCycle(def, h);
    while (h.accMs >= cycleMs && h.pending < cap) {
      h.accMs -= cycleMs;
      h.pending = Math.min(cap, h.pending + income);
    }
    if (h.pending >= cap) h.accMs = 0;
  }

  function accrueAllHoldings(elapsedMs) {
    HOLDINGS.forEach(function (def) {
      accrueHolding(def, holdingState(def.id), elapsedMs);
    });
  }

  // --- Loot roll ---

  function rollLootDrop() {
    const total = LOOT.reduce(function (s, L) {
      return s + L.weight;
    }, 0);
    let r = Math.random() * total;
    for (let i = 0; i < LOOT.length; i++) {
      r -= LOOT[i].weight;
      if (r <= 0) return LOOT[i];
    }
    return LOOT[LOOT.length - 1];
  }

  function grantLoot(item) {
    if (!state.inventory) state.inventory = {};
    state.inventory[item.id] = (state.inventory[item.id] || 0) + 1;
    addLog("Loot: found " + item.name + "!");
  }

  // --- Persistence ---

  function save() {
    try {
      const payload = {
        ...state,
        lastTick: Date.now(),
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    } catch (e) {
      // ignore quota / private mode
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return;
      state = { ...defaultState(), ...data };
      if (!state.questCooldownUntil || typeof state.questCooldownUntil !== "object") {
        state.questCooldownUntil = {};
      }
      if (!state.fightCooldownUntil || typeof state.fightCooldownUntil !== "object") {
        state.fightCooldownUntil = {};
      }
      if (!state.ownedUpgrades || typeof state.ownedUpgrades !== "object") {
        state.ownedUpgrades = {};
      }
      if (!state.questCounts || typeof state.questCounts !== "object") {
        state.questCounts = {};
      }
      if (!Array.isArray(state.storyUnlocks)) {
        state.storyUnlocks = [];
      }
      if (!state.holdings || typeof state.holdings !== "object") {
        state.holdings = {};
      }
      if (!state.inventory || typeof state.inventory !== "object") {
        state.inventory = {};
      }
      if (!state.equipped || typeof state.equipped !== "object") {
        state.equipped = { weapon: null, armor: null };
      }
      if (state.equipped.weapon === undefined) state.equipped.weapon = null;
      if (state.equipped.armor === undefined) state.equipped.armor = null;
      syncMaxesFromLevel();
      if (typeof state.stamina !== "number") state.stamina = state.staminaMax;
      if (typeof state.health !== "number") state.health = state.healthMax;
      state.energy = Math.min(state.energy, state.energyMax);
      state.stamina = Math.min(state.stamina, state.staminaMax);
      state.health = Math.min(Math.max(0, state.health), state.healthMax);
      clearFallenIfHealed();
      applyOfflineRegen();
    } catch (e) {
      state = defaultState();
    }
  }

  function applyOfflineRegen() {
    const now = Date.now();
    const elapsed = Math.max(0, now - (state.lastTick || now));
    state.lastTick = now;

    const eInterval = regenIntervalMs();
    const eTotal = (state.energyAccMs || 0) + elapsed;
    const eGained = Math.floor(eTotal / eInterval);
    state.energyAccMs = eTotal % eInterval;
    if (eGained > 0) {
      state.energy = Math.min(state.energyMax, state.energy + eGained);
    }

    const sTotal = (state.staminaAccMs || 0) + elapsed;
    const sGained = Math.floor(sTotal / STAMINA_REGEN_MS);
    state.staminaAccMs = sTotal % STAMINA_REGEN_MS;
    if (sGained > 0) {
      state.stamina = Math.min(state.staminaMax, state.stamina + sGained);
    }

    if (state.health < state.healthMax) {
      const hTotal = (state.healthAccMs || 0) + elapsed;
      const hGained = Math.floor(hTotal / HEALTH_REGEN_MS);
      state.healthAccMs = hTotal % HEALTH_REGEN_MS;
      if (hGained > 0) {
        state.health = Math.min(state.healthMax, state.health + hGained);
        clearFallenIfHealed();
      }
    } else {
      state.healthAccMs = 0;
    }

    accrueAllHoldings(elapsed);
  }

  // --- Game actions ---

  function addLog(msg) {
    logLines.unshift(msg);
    if (logLines.length > LOG_MAX) logLines.length = LOG_MAX;
  }

  function tryLevelUp() {
    let leveled = false;
    while (state.xp >= xpForLevel(state.level)) {
      state.xp -= xpForLevel(state.level);
      state.level += 1;
      syncMaxesFromLevel();
      state.energy = state.energyMax;
      state.stamina = Math.min(state.staminaMax, state.stamina + 5);
      leveled = true;
      addLog(
        "You rise to Level " +
          state.level +
          "! Max Energy " +
          state.energyMax +
          ", Stamina " +
          state.staminaMax +
          ", Health " +
          state.healthMax +
          "."
      );
    }
    return leveled;
  }

  function unlockStoryBeat(questId, threshold) {
    const beats = STORY_BEATS[questId];
    if (!beats || !beats[threshold]) return;
    const already = state.storyUnlocks.some(function (s) {
      return s.questId === questId && s.threshold === threshold;
    });
    if (already) return;
    const quest = QUESTS.find(function (q) {
      return q.id === questId;
    });
    const rankIdx = MASTERY_THRESHOLDS.indexOf(threshold) + 1;
    const entry = {
      questId: questId,
      threshold: threshold,
      rank: MASTERY_RANKS[rankIdx] || "Master",
      questName: quest ? quest.name : questId,
      text: beats[threshold],
      at: Date.now(),
    };
    state.storyUnlocks.push(entry);
    addLog("Legend unlocked (" + entry.rank + " — " + entry.questName + "). See Legends below.");
  }

  function checkMasteryMilestones(questId, newCount) {
    for (let i = 0; i < MASTERY_THRESHOLDS.length; i++) {
      const t = MASTERY_THRESHOLDS[i];
      if (newCount === t) {
        const rank = MASTERY_RANKS[i + 1];
        const bonus = MASTERY_BONUSES[i + 1];
        const parts = [];
        if (bonus.goldAdd) parts.push("+" + Math.round(bonus.goldAdd * 100) + "% gold on this quest");
        if (bonus.xpAdd) parts.push("+" + Math.round(bonus.xpAdd * 100) + "% XP on this quest");
        addLog(
          "Mastery: \"" +
            (QUESTS.find(function (q) {
              return q.id === questId;
            }) || { name: questId }).name +
            "\" → " +
            rank +
            "!" +
            (parts.length ? " (" + parts.join(", ") + ")" : "")
        );
        unlockStoryBeat(questId, t);
      }
    }
  }

  function doQuest(questId) {
    const quest = QUESTS.find(function (q) {
      return q.id === questId;
    });
    if (!quest) return;
    if (state.level < quest.minLevel) {
      addLog("You are not yet ready for \"" + quest.name + "\".");
      render();
      return;
    }
    if (state.energy < quest.energy) {
      addLog("Not enough Energy for \"" + quest.name + "\".");
      render();
      return;
    }
    const cdLeft = questCooldownRemaining(quest.id);
    if (cdLeft > 0) {
      addLog(
        "\"" +
          quest.name +
          "\" is recovering — " +
          formatCooldown(cdLeft) +
          " left."
      );
      render();
      return;
    }

    state.energy -= quest.energy;
    if (!state.questCooldownUntil) state.questCooldownUntil = {};
    state.questCooldownUntil[quest.id] = Date.now() + cooldownMsFor(quest);

    if (!state.questCounts) state.questCounts = {};
    state.questCounts[quest.id] = (state.questCounts[quest.id] || 0) + 1;
    const newCount = state.questCounts[quest.id];

    const goldGain = Math.floor(quest.gold * goldMultiplier(quest.id));
    const xpGain = Math.floor(quest.xp * xpMultiplier(quest.id));
    state.gold += goldGain;
    state.xp += xpGain;
    addLog(
      "Completed \"" +
        quest.name +
        "\" — +" +
        goldGain +
        " gold, +" +
        xpGain +
        " XP. (" +
        newCount +
        "×, " +
        masteryRankName(quest.id) +
        ")"
    );

    checkMasteryMilestones(quest.id, newCount);

    if (Math.random() < LOOT_DROP_CHANCE) {
      grantLoot(rollLootDrop());
    }

    tryLevelUp();
    save();
    render();
  }

  function doFight(foeId) {
    const foe = FOES.find(function (f) {
      return f.id === foeId;
    });
    if (!foe) return;

    if (state.level < foe.minLevel) {
      addLog("You are not yet ready to face " + foe.name + ".");
      render();
      return;
    }
    if (state.fallen || state.health <= 0) {
      addLog("You have fallen. Rest at the Chapel before returning to The Lists.");
      render();
      return;
    }
    if (state.stamina < foe.stamina) {
      addLog("Not enough Stamina to challenge " + foe.name + ".");
      render();
      return;
    }
    const cdLeft = fightCooldownRemaining(foe.id);
    if (cdLeft > 0) {
      addLog(
        foe.name + " is not yet ready for another bout — " + formatCooldown(cdLeft) + " left."
      );
      render();
      return;
    }

    state.stamina -= foe.stamina;
    if (!state.fightCooldownUntil) state.fightCooldownUntil = {};
    state.fightCooldownUntil[foe.id] = Date.now() + foe.cooldownMs;

    const pPow = playerPower();
    const fPow = foePower(foe);
    const won = pPow >= fPow;

    if (won) {
      const goldGain = Math.floor(foe.gold * goldMultiplier());
      const xpGain = Math.floor(foe.xp * xpMultiplier());
      state.gold += goldGain;
      state.xp += xpGain;
      let chip = 0;
      if (Math.random() < 0.25) {
        chip = randInt(1, Math.max(2, Math.floor(foe.dmgMin / 2)));
        state.health = Math.max(0, state.health - chip);
      }
      addLog(
        "Victory over " +
          foe.name +
          "! (power " +
          pPow +
          " vs " +
          fPow +
          ") — +" +
          goldGain +
          " gold, +" +
          xpGain +
          " XP" +
          (chip > 0 ? "; took " + chip + " chip damage." : ".")
      );
      if (state.health <= 0) {
        state.fallen = true;
        state.health = 0;
        addLog("The bout left you fallen. Seek the Chapel.");
      }
      // Small fight loot chance
      if (Math.random() < 0.12) {
        grantLoot(rollLootDrop());
      }
      tryLevelUp();
    } else {
      const dmg = randInt(foe.dmgMin, foe.dmgMax);
      state.health = Math.max(0, state.health - dmg);
      const pityXp = Math.max(1, Math.floor(foe.xp * 0.1));
      state.xp += pityXp;
      addLog(
        "Defeated by " +
          foe.name +
          " (power " +
          pPow +
          " vs " +
          fPow +
          "). Took " +
          dmg +
          " damage. +" +
          pityXp +
          " XP."
      );
      if (state.health <= 0) {
        state.fallen = true;
        state.health = 0;
        addLog("You have fallen on the Field of Honor. Rest at the Chapel to rise again.");
      }
      tryLevelUp();
    }

    save();
    render();
  }

  function doHeal(healId) {
    const pack = HEALS.find(function (h) {
      return h.id === healId;
    });
    if (!pack) return;

    if (state.health >= state.healthMax) {
      addLog("You are already at full Health.");
      render();
      return;
    }
    if (state.gold < pack.cost) {
      addLog("Need " + pack.cost + " gold for " + pack.name + ".");
      render();
      return;
    }

    state.gold -= pack.cost;
    const before = state.health;
    if (pack.heal === "full") {
      state.health = state.healthMax;
    } else {
      state.health = Math.min(state.healthMax, state.health + pack.heal);
    }
    const gained = state.health - before;
    clearFallenIfHealed();
    addLog(
      "Chapel: " +
        pack.name +
        " — restored " +
        gained +
        " Health (" +
        state.health +
        "/" +
        state.healthMax +
        ")."
    );
    save();
    render();
  }

  function buyUpgrade(upgradeId) {
    const up = UPGRADES.find(function (u) {
      return u.id === upgradeId;
    });
    if (!up) return;
    if (state.ownedUpgrades[up.id]) {
      addLog("You already own " + up.name + ".");
      render();
      return;
    }
    if (state.gold < up.cost) {
      addLog("Need " + up.cost + " gold for " + up.name + ".");
      render();
      return;
    }
    state.gold -= up.cost;
    state.ownedUpgrades[up.id] = true;
    addLog("Purchased " + up.name + ".");
    save();
    render();
  }

  function buyHolding(holdingId) {
    const def = HOLDINGS.find(function (h) {
      return h.id === holdingId;
    });
    if (!def) return;
    const h = holdingState(def.id);
    if (h.owned) {
      addLog("You already hold " + def.name + ".");
      render();
      return;
    }
    if (state.level < def.minLevel) {
      addLog("Need Level " + def.minLevel + " for " + def.name + ".");
      render();
      return;
    }
    if (state.gold < def.cost) {
      addLog("Need " + def.cost + " gold for " + def.name + ".");
      render();
      return;
    }
    state.gold -= def.cost;
    h.owned = true;
    h.level = 0;
    h.accMs = 0;
    h.pending = 0;
    addLog("Acquired holding: " + def.name + ".");
    save();
    render();
  }

  function upgradeHolding(holdingId) {
    const def = HOLDINGS.find(function (h) {
      return h.id === holdingId;
    });
    if (!def) return;
    const h = holdingState(def.id);
    if (!h.owned) {
      addLog("Buy " + def.name + " first.");
      render();
      return;
    }
    if (h.level >= def.maxLevel) {
      addLog(def.name + " is fully improved.");
      render();
      return;
    }
    const cost = def.upgradeCost[h.level];
    if (state.gold < cost) {
      addLog("Need " + cost + " gold to upgrade " + def.name + ".");
      render();
      return;
    }
    state.gold -= cost;
    h.level += 1;
    addLog(
      "Upgraded " +
        def.name +
        " to rank " +
        h.level +
        " (+" +
        def.upgradeGoldAdd[h.level - 1] +
        " gold/cycle)."
    );
    save();
    render();
  }

  function collectHolding(holdingId) {
    const def = HOLDINGS.find(function (h) {
      return h.id === holdingId;
    });
    if (!def) return;
    const h = holdingState(def.id);
    if (!h.owned) return;
    const amt = Math.floor(h.pending || 0);
    if (amt <= 0) {
      addLog(def.name + " has nothing to collect yet.");
      render();
      return;
    }
    h.pending = 0;
    state.gold += amt;
    addLog("Collected " + amt + " gold from " + def.name + ".");
    save();
    render();
  }

  function equipItem(itemId) {
    const item = getLootDef(itemId);
    if (!item) return;
    if (inventoryCount(itemId) <= 0) {
      addLog("You do not own " + item.name + ".");
      render();
      return;
    }
    if (item.slot === "relic") {
      addLog(item.name + " is a kept relic — its blessing is already active.");
      render();
      return;
    }
    if (!state.equipped) state.equipped = { weapon: null, armor: null };
    state.equipped[item.slot] = itemId;
    addLog("Equipped " + item.name + ".");
    save();
    render();
  }

  function unequipSlot(slot) {
    if (!state.equipped) return;
    if (slot !== "weapon" && slot !== "armor") return;
    const id = state.equipped[slot];
    if (!id) return;
    const item = getLootDef(id);
    state.equipped[slot] = null;
    addLog("Unequipped " + (item ? item.name : slot) + ".");
    save();
    render();
  }

  function renamePlayer() {
    const next = window.prompt("Name your knight:", state.name);
    if (next === null) return;
    const trimmed = String(next).trim().slice(0, 24);
    if (!trimmed) return;
    state.name = trimmed;
    addLog("You are known as " + state.name + ".");
    save();
    render();
  }

  function resetGame() {
    if (!window.confirm("Reset all Ruin Wars progress in this browser?")) return;
    state = defaultState();
    logLines = [];
    addLog("A new knight takes up the quest.");
    save();
    render();
  }

  // --- Tick ---

  function tick() {
    const now = Date.now();
    const dt = Math.max(0, now - state.lastTick);
    state.lastTick = now;

    if (state.energy < state.energyMax) {
      state.energyAccMs = (state.energyAccMs || 0) + dt;
      const interval = regenIntervalMs();
      while (state.energyAccMs >= interval && state.energy < state.energyMax) {
        state.energyAccMs -= interval;
        state.energy += 1;
      }
      if (state.energy >= state.energyMax) {
        state.energyAccMs = 0;
      }
    } else {
      state.energyAccMs = 0;
    }

    if (state.stamina < state.staminaMax) {
      state.staminaAccMs = (state.staminaAccMs || 0) + dt;
      while (state.staminaAccMs >= STAMINA_REGEN_MS && state.stamina < state.staminaMax) {
        state.staminaAccMs -= STAMINA_REGEN_MS;
        state.stamina += 1;
      }
      if (state.stamina >= state.staminaMax) {
        state.staminaAccMs = 0;
      }
    } else {
      state.staminaAccMs = 0;
    }

    if (state.health < state.healthMax) {
      state.healthAccMs = (state.healthAccMs || 0) + dt;
      while (state.healthAccMs >= HEALTH_REGEN_MS && state.health < state.healthMax) {
        state.healthAccMs -= HEALTH_REGEN_MS;
        state.health += 1;
        clearFallenIfHealed();
      }
      if (state.health >= state.healthMax) {
        state.healthAccMs = 0;
      }
    } else {
      state.healthAccMs = 0;
    }

    accrueAllHoldings(dt);

    save();
    renderStatsOnly();

    var anyQuestCd = false;
    if (state.questCooldownUntil) {
      for (var qid in state.questCooldownUntil) {
        if (questCooldownRemaining(qid) > 0) {
          anyQuestCd = true;
          break;
        }
      }
    }
    if (anyQuestCd) {
      renderQuests();
    }

    var anyFightCd = false;
    if (state.fightCooldownUntil) {
      for (var fid in state.fightCooldownUntil) {
        if (fightCooldownRemaining(fid) > 0) {
          anyFightCd = true;
          break;
        }
      }
    }
    if (anyFightCd || state.fallen) {
      renderFights();
    }

    // Refresh holdings pending display periodically
    renderHoldings();
  }

  // --- DOM ---

  const el = {
    name: document.getElementById("player-name"),
    level: document.getElementById("stat-level"),
    xp: document.getElementById("stat-xp"),
    xpNext: document.getElementById("stat-xp-next"),
    xpBar: document.getElementById("xp-bar"),
    gold: document.getElementById("stat-gold"),
    energy: document.getElementById("stat-energy"),
    energyMax: document.getElementById("stat-energy-max"),
    energyBar: document.getElementById("energy-bar"),
    regenHint: document.getElementById("regen-hint"),
    stamina: document.getElementById("stat-stamina"),
    staminaMax: document.getElementById("stat-stamina-max"),
    staminaBar: document.getElementById("stamina-bar"),
    staminaRegenHint: document.getElementById("stamina-regen-hint"),
    health: document.getElementById("stat-health"),
    healthMax: document.getElementById("stat-health-max"),
    healthBar: document.getElementById("health-bar"),
    healthRegenHint: document.getElementById("health-regen-hint"),
    questList: document.getElementById("quest-list"),
    fightList: document.getElementById("fight-list"),
    healList: document.getElementById("heal-list"),
    holdingsList: document.getElementById("holdings-list"),
    inventoryList: document.getElementById("inventory-list"),
    equipSummary: document.getElementById("equip-summary"),
    shopList: document.getElementById("shop-list"),
    log: document.getElementById("log"),
    legendsList: document.getElementById("legends-list"),
    btnRename: document.getElementById("btn-rename"),
    btnReset: document.getElementById("btn-reset"),
  };

  function renderStatsOnly() {
    el.name.textContent = state.name;
    el.level.textContent = String(state.level);
    const need = xpForLevel(state.level);
    el.xp.textContent = String(state.xp);
    el.xpNext.textContent = String(need);
    el.xpBar.style.width = Math.min(100, (state.xp / need) * 100) + "%";
    el.gold.textContent = String(state.gold);

    el.energy.textContent = String(state.energy);
    el.energyMax.textContent = String(state.energyMax);
    el.energyBar.style.width =
      Math.min(100, (state.energy / state.energyMax) * 100) + "%";
    const secs = Math.round(regenIntervalMs() / 1000);
    el.regenHint.textContent = "+1 / " + secs + "s";

    el.stamina.textContent = String(state.stamina);
    el.staminaMax.textContent = String(state.staminaMax);
    el.staminaBar.style.width =
      Math.min(100, (state.stamina / state.staminaMax) * 100) + "%";
    el.staminaRegenHint.textContent =
      "+1 / " + Math.round(STAMINA_REGEN_MS / 1000) + "s";

    el.health.textContent = String(state.health);
    el.healthMax.textContent = String(state.healthMax);
    el.healthBar.style.width =
      Math.min(100, (state.health / Math.max(1, state.healthMax)) * 100) + "%";
    if (state.fallen || state.health <= 0) {
      el.healthRegenHint.textContent = "Fallen — Chapel";
    } else if (state.health >= state.healthMax) {
      el.healthRegenHint.textContent = "Full";
    } else {
      el.healthRegenHint.textContent =
        "+1 / " + Math.round(HEALTH_REGEN_MS / 1000) + "s";
    }
  }

  function renderQuests() {
    el.questList.innerHTML = "";
    QUESTS.forEach(function (q) {
      const locked = state.level < q.minLevel;
      const canAfford = state.energy >= q.energy;
      const cdLeft = questCooldownRemaining(q.id);
      const onCooldown = cdLeft > 0;
      const count = questCount(q.id);
      const rank = masteryRankName(q.id);
      const mb = masteryBonusForQuest(q.id);
      const goldShow = Math.floor(q.gold * goldMultiplier(q.id));
      const xpShow = Math.floor(q.xp * xpMultiplier(q.id));
      const card = document.createElement("article");
      card.className =
        "card" + (locked ? " locked" : "") + (onCooldown ? " cooling" : "");
      card.innerHTML =
        '<div class="card-body">' +
        "<h3>" +
        escapeHtml(q.name) +
        '<span class="badge mastery-badge">' +
        escapeHtml(rank) +
        "</span></h3>" +
        '<p class="card-meta">' +
        escapeHtml(q.desc) +
        "</p>" +
        '<p class="card-meta">' +
        '<span class="cost">' +
        q.energy +
        " Energy</span> · " +
        '<span class="reward-gold">+' +
        goldShow +
        " gold</span> · " +
        '<span class="reward-xp">+' +
        xpShow +
        " XP</span>" +
        (locked
          ? ' · <span class="gate">Requires Level ' + q.minLevel + "</span>"
          : "") +
        (onCooldown
          ? ' · <span class="gate">Cooldown ' + formatCooldown(cdLeft) + "</span>"
          : "") +
        "</p>" +
        '<p class="card-meta"><span class="mastery">' +
        count +
        " completions · " +
        escapeHtml(nextMasteryHint(q.id)) +
        (mb.goldAdd || mb.xpAdd
          ? " · bonus +" +
            Math.round(mb.goldAdd * 100) +
            "%g / +" +
            Math.round(mb.xpAdd * 100) +
            "%xp"
          : "") +
        "</span></p>" +
        "</div>";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      if (locked) {
        btn.textContent = "Locked";
      } else if (onCooldown) {
        btn.textContent = "Wait " + formatCooldown(cdLeft);
      } else {
        btn.textContent = "Embark";
      }
      btn.disabled = locked || !canAfford || onCooldown;
      btn.addEventListener("click", function () {
        doQuest(q.id);
      });
      card.appendChild(btn);
      el.questList.appendChild(card);
    });
  }

  function renderFights() {
    el.fightList.innerHTML = "";
    const isFallen = state.fallen || state.health <= 0;
    FOES.forEach(function (f) {
      const locked = state.level < f.minLevel;
      const canAfford = state.stamina >= f.stamina;
      const cdLeft = fightCooldownRemaining(f.id);
      const onCooldown = cdLeft > 0;
      const card = document.createElement("article");
      card.className =
        "card" +
        (locked ? " locked" : "") +
        (onCooldown ? " cooling" : "") +
        (isFallen ? " fallen" : "");
      card.innerHTML =
        '<div class="card-body">' +
        "<h3>" +
        escapeHtml(f.name) +
        (isFallen ? '<span class="badge fallen-badge">Fallen</span>' : "") +
        "</h3>" +
        '<p class="card-meta">' +
        escapeHtml(f.desc) +
        "</p>" +
        '<p class="card-meta">' +
        '<span class="cost-stamina">' +
        f.stamina +
        " Stamina</span> · " +
        '<span class="reward-gold">+' +
        Math.floor(f.gold * goldMultiplier()) +
        " gold</span> · " +
        '<span class="reward-xp">+' +
        Math.floor(f.xp * xpMultiplier()) +
        " XP</span> · " +
        '<span class="cost-health">dmg ' +
        f.dmgMin +
        "–" +
        f.dmgMax +
        "</span>" +
        (locked
          ? ' · <span class="gate">Requires Level ' + f.minLevel + "</span>"
          : "") +
        (onCooldown
          ? ' · <span class="gate">Cooldown ' + formatCooldown(cdLeft) + "</span>"
          : "") +
        "</p>" +
        "</div>";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      if (isFallen) {
        btn.textContent = "Fallen";
      } else if (locked) {
        btn.textContent = "Locked";
      } else if (onCooldown) {
        btn.textContent = "Wait " + formatCooldown(cdLeft);
      } else {
        btn.textContent = "Challenge";
      }
      btn.disabled = locked || !canAfford || onCooldown || isFallen;
      btn.addEventListener("click", function () {
        doFight(f.id);
      });
      card.appendChild(btn);
      el.fightList.appendChild(card);
    });
  }

  function renderHeals() {
    el.healList.innerHTML = "";
    HEALS.forEach(function (h) {
      const atFull = state.health >= state.healthMax;
      const canAfford = state.gold >= h.cost;
      const healLabel =
        h.heal === "full" ? "Full heal" : "+" + h.heal + " HP";
      const card = document.createElement("article");
      card.className = "card";
      card.innerHTML =
        '<div class="card-body">' +
        "<h3>" +
        escapeHtml(h.name) +
        "</h3>" +
        '<p class="card-meta">' +
        escapeHtml(h.desc) +
        "</p>" +
        '<p class="card-meta">' +
        '<span class="reward-gold">' +
        h.cost +
        " gold</span> · " +
        '<span class="cost-health">' +
        healLabel +
        "</span>" +
        "</p>" +
        "</div>";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-heal";
      if (atFull) {
        btn.textContent = "Full HP";
        btn.disabled = true;
      } else {
        btn.textContent = "Heal";
        btn.disabled = !canAfford;
        btn.addEventListener("click", function () {
          doHeal(h.id);
        });
      }
      card.appendChild(btn);
      el.healList.appendChild(card);
    });
  }

  function renderHoldings() {
    if (!el.holdingsList) return;
    el.holdingsList.innerHTML = "";
    HOLDINGS.forEach(function (def) {
      const h = holdingState(def.id);
      const locked = state.level < def.minLevel && !h.owned;
      const income = holdingIncomePerCycle(def, h);
      const cap = holdingCap(def, h);
      const pending = Math.floor(h.pending || 0);
      const card = document.createElement("article");
      card.className =
        "card" + (h.owned ? " owned" : "") + (locked ? " locked" : "");

      let metaExtra = "";
      if (h.owned) {
        metaExtra =
          '<span class="reward-gold">+' +
          income +
          " gold / " +
          formatSeconds(def.cycleSec) +
          "</span> · pending " +
          pending +
          "/" +
          cap +
          " · rank " +
          h.level +
          "/" +
          def.maxLevel;
      } else {
        metaExtra =
          '<span class="reward-gold">' +
          def.cost +
          " gold</span> · +" +
          def.baseGold +
          " / " +
          formatSeconds(def.cycleSec) +
          (locked
            ? ' · <span class="gate">Requires Level ' + def.minLevel + "</span>"
            : "");
      }

      card.innerHTML =
        '<div class="card-body">' +
        "<h3>" +
        escapeHtml(def.name) +
        (h.owned ? '<span class="badge">Held</span>' : "") +
        "</h3>" +
        '<p class="card-meta">' +
        escapeHtml(def.desc) +
        "</p>" +
        '<p class="card-meta">' +
        metaExtra +
        "</p>" +
        "</div>";

      const actions = document.createElement("div");
      actions.className = "card-actions";

      if (!h.owned) {
        const buyBtn = document.createElement("button");
        buyBtn.type = "button";
        buyBtn.className = "btn btn-primary";
        buyBtn.textContent = locked ? "Locked" : "Buy";
        buyBtn.disabled = locked || state.gold < def.cost;
        buyBtn.addEventListener("click", function () {
          buyHolding(def.id);
        });
        actions.appendChild(buyBtn);
      } else {
        const collectBtn = document.createElement("button");
        collectBtn.type = "button";
        collectBtn.className = "btn btn-primary";
        collectBtn.textContent = pending > 0 ? "Collect (" + pending + ")" : "Collect";
        collectBtn.disabled = pending <= 0;
        collectBtn.addEventListener("click", function () {
          collectHolding(def.id);
        });
        actions.appendChild(collectBtn);

        if (h.level < def.maxLevel) {
          const upCost = def.upgradeCost[h.level];
          const upBtn = document.createElement("button");
          upBtn.type = "button";
          upBtn.className = "btn";
          upBtn.textContent = "Upgrade (" + upCost + "g)";
          upBtn.disabled = state.gold < upCost;
          upBtn.addEventListener("click", function () {
            upgradeHolding(def.id);
          });
          actions.appendChild(upBtn);
        }
      }

      card.appendChild(actions);
      el.holdingsList.appendChild(card);
    });
  }

  function renderInventory() {
    if (!el.inventoryList || !el.equipSummary) return;

    const eq = collectEquipEffects();
    const wId = state.equipped && state.equipped.weapon;
    const aId = state.equipped && state.equipped.armor;
    const wName = wId && getLootDef(wId) ? getLootDef(wId).name : "none";
    const aName = aId && getLootDef(aId) ? getLootDef(aId).name : "none";
    el.equipSummary.innerHTML =
      "<strong>Weapon:</strong> " +
      escapeHtml(wName) +
      " · <strong>Armor:</strong> " +
      escapeHtml(aName) +
      " · bonuses +" +
      eq.attack +
      " atk, +" +
      Math.round(eq.goldMult * 100) +
      "% gold, +" +
      Math.round(eq.xpMult * 100) +
      "% XP (incl. relics)";

    el.inventoryList.innerHTML = "";
    let any = false;
    LOOT.forEach(function (item) {
      const count = inventoryCount(item.id);
      if (count <= 0) return;
      any = true;
      const isEquipped =
        (item.slot === "weapon" && state.equipped.weapon === item.id) ||
        (item.slot === "armor" && state.equipped.armor === item.id);
      const card = document.createElement("article");
      card.className = "card" + (isEquipped ? " equipped" : "");
      card.innerHTML =
        '<div class="card-body">' +
        "<h3>" +
        escapeHtml(item.name) +
        (count > 1 ? ' <span class="badge">×' + count + "</span>" : "") +
        (isEquipped ? '<span class="badge equip-badge">Equipped</span>' : "") +
        '<span class="badge slot-badge">' +
        escapeHtml(item.slot) +
        "</span></h3>" +
        '<p class="card-meta">' +
        escapeHtml(item.desc) +
        "</p>" +
        "</div>";

      const actions = document.createElement("div");
      actions.className = "card-actions";

      if (item.slot === "weapon" || item.slot === "armor") {
        if (isEquipped) {
          const uneq = document.createElement("button");
          uneq.type = "button";
          uneq.className = "btn";
          uneq.textContent = "Unequip";
          uneq.addEventListener("click", function () {
            unequipSlot(item.slot);
          });
          actions.appendChild(uneq);
        } else {
          const eqBtn = document.createElement("button");
          eqBtn.type = "button";
          eqBtn.className = "btn btn-primary";
          eqBtn.textContent = "Equip";
          eqBtn.addEventListener("click", function () {
            equipItem(item.id);
          });
          actions.appendChild(eqBtn);
        }
      } else {
        const note = document.createElement("button");
        note.type = "button";
        note.className = "btn";
        note.textContent = "Kept";
        note.disabled = true;
        actions.appendChild(note);
      }

      card.appendChild(actions);
      el.inventoryList.appendChild(card);
    });

    if (!any) {
      const empty = document.createElement("p");
      empty.className = "legend-empty";
      empty.textContent = "No loot yet. Complete quests (~22% drop chance) to find gear.";
      el.inventoryList.appendChild(empty);
    }
  }

  function renderShop() {
    el.shopList.innerHTML = "";
    UPGRADES.forEach(function (u) {
      const owned = !!state.ownedUpgrades[u.id];
      const card = document.createElement("article");
      card.className = "card" + (owned ? " owned" : "");
      card.innerHTML =
        '<div class="card-body">' +
        "<h3>" +
        escapeHtml(u.name) +
        (owned ? '<span class="badge">Owned</span>' : "") +
        "</h3>" +
        '<p class="card-meta">' +
        escapeHtml(u.desc) +
        "</p>" +
        '<p class="card-meta"><span class="reward-gold">' +
        u.cost +
        " gold</span></p>" +
        "</div>";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      if (owned) {
        btn.textContent = "Owned";
        btn.disabled = true;
      } else {
        btn.textContent = "Buy";
        btn.disabled = state.gold < u.cost;
        btn.addEventListener("click", function () {
          buyUpgrade(u.id);
        });
      }
      card.appendChild(btn);
      el.shopList.appendChild(card);
    });
  }

  function renderLog() {
    el.log.innerHTML = "";
    logLines.forEach(function (line) {
      const li = document.createElement("li");
      li.textContent = line;
      el.log.appendChild(li);
    });
  }

  function renderLegends() {
    if (!el.legendsList) return;
    el.legendsList.innerHTML = "";
    const list = (state.storyUnlocks || []).slice().reverse();
    if (list.length === 0) {
      const empty = document.createElement("p");
      empty.className = "legend-empty";
      empty.textContent =
        "No legends yet. Reach mastery ranks (5 / 15 / 40 completions) on any quest.";
      el.legendsList.appendChild(empty);
      return;
    }
    list.forEach(function (entry) {
      const card = document.createElement("article");
      card.className = "legend-card";
      card.innerHTML =
        "<h4>" +
        escapeHtml(entry.rank) +
        " — " +
        escapeHtml(entry.questName || entry.questId) +
        "</h4>" +
        "<p>" +
        escapeHtml(entry.text) +
        "</p>";
      el.legendsList.appendChild(card);
    });
  }

  function render() {
    renderStatsOnly();
    renderQuests();
    renderFights();
    renderHeals();
    renderHoldings();
    renderInventory();
    renderShop();
    renderLog();
    renderLegends();
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // --- Boot ---

  el.btnRename.addEventListener("click", renamePlayer);
  el.btnReset.addEventListener("click", resetGame);

  load();
  if (logLines.length === 0) {
    addLog(
      "Welcome to Ruin Wars. Quests, The Lists, Holdings, and loot await. Mastery ranks unlock legends."
    );
  }
  render();
  setInterval(tick, TICK_MS);

  window.RuinWars = {
    getState: function () {
      return Object.assign({}, state);
    },
    QUESTS: QUESTS,
    FOES: FOES,
    HEALS: HEALS,
    UPGRADES: UPGRADES,
    HOLDINGS: HOLDINGS,
    LOOT: LOOT,
    STORY_BEATS: STORY_BEATS,
    MASTERY_THRESHOLDS: MASTERY_THRESHOLDS,
  };
})();
