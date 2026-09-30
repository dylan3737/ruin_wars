/**
 * Ruin Wars — core game loop (v0.4)
 * Quests (Energy) across Regions + mastery/story, The Lists (Stamina/Health), Bosses,
 * Knight Band, Holdings (passive gold), Loot/Inventory (equip), Collections, shop upgrades.
 * Persist: localStorage SAVE_KEY (legacy v0.3 key migrated on load)
 */

(function () {
  "use strict";

  const SAVE_KEY = "ruin_wars_save_v4";
  const LEGACY_SAVE_KEYS = ["ruin_wars_save_v1"];
  const SAVE_VERSION = 4;
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
  const COLLECTION_DROP_QUEST = 0.15;
  const COLLECTION_DROP_FIGHT = 0.1;
  const BAND_ATTACK_PER_RECRUIT = 2;
  const BAND_DEFENSE_PER_RECRUIT = 2;
  const BAND_CAP_BASE = 2; // hired cap = BASE + level (max BAND_CAP_MAX)
  const BAND_CAP_MAX = 60;
  const BAND_HIRE_BASE = 30; // gold for the first hire; +BAND_HIRE_STEP per recruit already in the band
  const BAND_HIRE_STEP = 20;
  const RALLY_COOLDOWN_MS = 10 * 60 * 1000; // free recruit every 10 min
  const DEFENSE_SOAK = 150; // damage taken × (1 - def / (def + DEFENSE_SOAK))

  /** XP needed to go from `level` to level+1 — kept gentle early */
  function xpForLevel(level) {
    return Math.floor(35 + level * 22 + Math.pow(level, 1.15) * 6);
  }

  /**
   * Quest cooldown: mild on early jobs, long on big ones (A+B pacing).
   * Energy/Stamina regen is also slow — MW-style resource wait + job rests.
   */
  function cooldownMsFor(quest) {
    if (quest.cooldownMs) return quest.cooldownMs; // explicit rests on Avalon / Wastes jobs
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

  /** Regions gate quest boards. Camelot = the original six jobs. */
  const REGIONS = [
    {
      id: "camelot",
      name: "Camelot",
      desc: "The ruined heart of Logres — walls, roads, tombs and the old keep.",
      minLevel: 1,
    },
    {
      id: "avalon",
      name: "Avalon",
      desc: "The misted isle of apples, where the Lady keeps her secrets.",
      minLevel: 10,
    },
    {
      id: "wastes",
      name: "The Wastes",
      desc: "The blighted land of the wounded king, and the road to Camlann.",
      minLevel: 20,
    },
  ];

  const QUESTS = [
    {
      id: "patrol",
      region: "camelot",
      name: "Patrol the Outer Walls",
      desc: "Walk the crumbling battlements.",
      energy: 3,
      gold: 18,
      xp: 28,
      minLevel: 1,
    },
    {
      id: "bandits",
      region: "camelot",
      name: "Drive Off Bandits",
      desc: "Clear the road to the ruined chapel.",
      energy: 5,
      gold: 35,
      xp: 48,
      minLevel: 1,
    },
    {
      id: "relics",
      region: "camelot",
      name: "Scavenge Relics",
      desc: "Search mossy tombs for forgotten coin.",
      energy: 7,
      gold: 60,
      xp: 75,
      minLevel: 2,
    },
    {
      id: "wyrm",
      region: "camelot",
      name: "Hunt the Marsh Wyrm",
      desc: "A lesser beast plagues the fen.",
      energy: 10,
      gold: 95,
      xp: 110,
      minLevel: 3,
    },
    {
      id: "siege",
      region: "camelot",
      name: "Hold the Broken Keep",
      desc: "Stand watch through the night.",
      energy: 12,
      gold: 140,
      xp: 155,
      minLevel: 5,
    },
    {
      id: "grail",
      region: "camelot",
      name: "Quest for the Lost Chalice",
      desc: "Venture deep into the old kingdom.",
      energy: 15,
      gold: 210,
      xp: 230,
      minLevel: 7,
    },
    // --- Avalon (Level 10+) ---
    {
      id: "mists",
      region: "avalon",
      name: "Cross the Mists",
      desc: "Pole a barge through fog that remembers every drowned oath.",
      energy: 14,
      gold: 260,
      xp: 270,
      minLevel: 10,
      cooldownMs: 150000,
    },
    {
      id: "lady",
      region: "avalon",
      name: "Parley with the Lady of the Lake",
      desc: "Kneel at the water's edge and answer her riddles truly.",
      energy: 16,
      gold: 320,
      xp: 320,
      minLevel: 11,
      cooldownMs: 165000,
    },
    {
      id: "groves",
      region: "avalon",
      name: "Guard the Apple Groves",
      desc: "Thieves from the mainland covet fruit that grants long life.",
      energy: 18,
      gold: 380,
      xp: 370,
      minLevel: 12,
      cooldownMs: 180000,
    },
    {
      id: "faerie",
      region: "avalon",
      name: "Break the Faerie Ring",
      desc: "Pull lost squires out of a dance that has lasted a century.",
      energy: 20,
      gold: 450,
      xp: 420,
      minLevel: 14,
      cooldownMs: 195000,
    },
    {
      id: "morgan",
      region: "avalon",
      name: "Unmask Morgan's Illusions",
      desc: "The sorceress weaves false castles. Find the true door.",
      energy: 22,
      gold: 540,
      xp: 480,
      minLevel: 16,
      cooldownMs: 210000,
    },
    {
      id: "scabbard",
      region: "avalon",
      name: "Recover the Lost Scabbard",
      desc: "The sheath that kept the king from bleeding lies somewhere on the isle.",
      energy: 24,
      gold: 640,
      xp: 550,
      minLevel: 18,
      cooldownMs: 225000,
    },
    // --- The Wastes (Level 20+) ---
    {
      id: "ashroad",
      region: "wastes",
      name: "Ride the Ashen Road",
      desc: "Nothing grows here. Even the crows travel in pairs.",
      energy: 20,
      gold: 600,
      xp: 560,
      minLevel: 20,
      cooldownMs: 210000,
    },
    {
      id: "unquiet",
      region: "wastes",
      name: "Lay the Unquiet Dead",
      desc: "Barrow-knights rise at dusk, still loyal to a dead cause.",
      energy: 23,
      gold: 720,
      xp: 650,
      minLevel: 21,
      cooldownMs: 225000,
    },
    {
      id: "warband",
      region: "wastes",
      name: "Scatter the Saxon Warband",
      desc: "Raiders burn what little the blight has left.",
      energy: 26,
      gold: 860,
      xp: 740,
      minLevel: 23,
      cooldownMs: 240000,
    },
    {
      id: "fisher",
      region: "wastes",
      name: "Attend the Fisher King",
      desc: "Sit with the wounded king and ask the question no one asked.",
      energy: 29,
      gold: 1000,
      xp: 830,
      minLevel: 25,
      cooldownMs: 255000,
    },
    {
      id: "camlann",
      region: "wastes",
      name: "Scout the Field of Camlann",
      desc: "Where the last battle waits. Learn the ground before it learns you.",
      energy: 32,
      gold: 1180,
      xp: 930,
      minLevel: 27,
      cooldownMs: 270000,
    },
    {
      id: "throne",
      region: "wastes",
      name: "Reclaim the Hollow Throne",
      desc: "A seat of grey stone at the end of the world, waiting for a rightful heir.",
      energy: 35,
      gold: 1400,
      xp: 1050,
      minLevel: 30,
      cooldownMs: 300000,
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
    // --- Avalon ---
    mists: {
      5: "The ferryman will not speak your name aloud; in Avalon, names are handles, and the mist has many hands. You learn to steer by the smell of apples and the sound of distant bells.",
      15: "The fog parts for your barge now, as it once parted for a dying king. Halfway across you see him — or his reflection — lying in state beneath the water. You do not stop. He would not want you to.",
      40: "Master of the Mists: the isle no longer hides from you. The ferryman hands you his pole and steps ashore for the first time in a hundred years. 'Someone must carry the next king,' he says. 'Practise.'",
    },
    lady: {
      5: "Her first riddle: 'What is kept by giving it away?' You answer 'a sword,' and the lake laughs. Wrong — but honest. She asks you to return tomorrow.",
      15: "The Lady shows you the hand that caught Excalibur — hers, pale and patient. 'Every blade goes home,' she says. 'Even yours, one day. Carry it well until then.'",
      40: "Master of the Parley: the Lady names you friend of the lake. Fish rise to your shadow; rain falls gently where you camp. She will not give you a sword. She gives you something harder — her trust.",
    },
    groves: {
      5: "A mainland thief begs mercy with an apple in each fist. One bite of Avalon fruit adds a year to a life, they say. You let him keep one. The other you plant at the grove's edge.",
      15: "The tree you planted has fruited overnight. The grove-wardens bow to you and whisper that the isle has begun to count you among its roots.",
      40: "Master of the Groves: no thief dares the orchard now. On the longest night the trees sing — a low hum like a harp string — and you understand they have been singing for Arthur all along.",
    },
    faerie: {
      5: "You drag a squire out of the ring. He swears he stepped in this morning; his armour is a century out of fashion. You find him a horse and do not tell him how long his lady has waited.",
      15: "The faerie court sends an envoy: a hare with silver eyes. It offers you one dance, no strings. You decline politely. It seems impressed that you knew to.",
      40: "Master of the Ring: the dance ends. Every lost squire walks home. The Faerie Queen leaves a single white rose on your saddle — a truce, or a warning. With the fair folk, it is always both.",
    },
    morgan: {
      5: "Morgan's castle has a hundred doors and one keyhole. You find it by watching where the cat will not walk. Inside is only a mirror, and your face in it looks older.",
      15: "She speaks to you at last, from every reflection at once. 'I was his sister before I was his enemy,' she says. 'Remember that, when the songs are written.'",
      40: "Master of Illusions: no glamour holds you now. Morgan drops her masks and shows you her true face — tired, grieving, fierce. 'Go to the Wastes,' she says. 'My son is waiting there.'",
    },
    scabbard: {
      5: "The scabbard was stolen by Morgan long ago, then lost by her too. Every cairn on the isle claims to hide it. Every cairn lies. You keep searching.",
      15: "You find a silver buckle worn smooth by a king's hip. Close, now. The wound on your arm from last week's quest closes as you hold it.",
      40: "Master of the Scabbard: it lies in a hollow oak, humble as a shepherd's sheath. You do not keep it. You bear it to the Lady, who weeps once and says, 'Now he may rest.'",
    },
    // --- The Wastes ---
    ashroad: {
      5: "The Ashen Road runs straight as a spear to the horizon. Your horse will not drink from the wells. Neither, after the first taste, will you.",
      15: "Travellers now follow your tracks through the ash. You leave cairns at the crossroads and water where you can. It is not much. In the Wastes, it is everything.",
      40: "Master of the Ashen Road: a single green shoot breaks the grey where you have ridden most. The blight is not lifting — but it has noticed you.",
    },
    unquiet: {
      5: "The barrow-knight salutes before he fights you. He still wears Arthur's colours, faded to bone. When he falls, he thanks you.",
      15: "You learn the names of the unquiet dead from their shields and carve them into a standing stone. Fewer rise each night. The dead, too, wish to be remembered.",
      40: "Master of the Barrows: the last of them kneels, offers his sword hilt-first, and crumbles to dust. The wind that follows smells, briefly, of summer in Camelot.",
    },
    warband: {
      5: "The Saxons fight like men with nothing left to lose — because they have nothing left. You spare the youngest and send him home with a loaf.",
      15: "A Saxon chief proposes truce: his people will leave the Wastes if yours will let them cross in peace. You shake his hand. Neither of you trusts the other. Both of you keep the word.",
      40: "Master of the Warband: the raids end. Saxon and Briton dig a well together at the edge of the blight. It is the strangest victory you have ever won, and the best.",
    },
    fisher: {
      5: "The Fisher King sits in his boat on a dead lake, wound weeping, line untouched. You sit beside him. Neither of you speaks. It seems to help.",
      15: "You ask at last: 'Lord, what ails you?' He smiles for the first time in years. 'Only the waiting,' he says. Far away, a river begins to run.",
      40: "Master of the Fisher King's Court: the king's wound closes. Where his tears fall, grass returns. 'The Grail was always the question,' he tells you. 'You asked it.'",
    },
    camlann: {
      5: "The Field of Camlann is quiet, as graves are quiet. You walk it at dawn and find arrowheads from a battle that has not yet happened.",
      15: "You map every ditch and hillock. In your dreams, two armies face each other here and a single adder stirs in the heather. You wake reaching for your sword.",
      40: "Master of Camlann: you know this field better than any living soul. When the last battle comes, you will not be surprised. That may be the only mercy fate allows.",
    },
    throne: {
      5: "The Hollow Throne is carved from a single grey stone. It is cold, and it is empty, and it is waiting — though not, you think, for you.",
      15: "You sit upon it once, in secret. For a heartbeat you see all of Logres, whole and green. Then only ash again. You do not sit there twice.",
      40: "Master of the Hollow Throne: you understand at last. The throne is not a prize. It is a promise — that the king will return when the land needs him most. You swear to keep it warm.",
    },
  };

  /** Legends written when a boss falls for the first time */
  const BOSS_LEGENDS = {
    green_knight:
      "The Green Knight's head rolls across the Yule-hall floor — and he stoops, lifts it by the hair, and laughs. 'A year and a day,' says the head. 'Then it is my turn.' You have won nothing but a debt of honor, and you have never been prouder.",
    mordred:
      "On the Field of Camlann, Mordred falls at last, Clarent shattered beneath him. With his last breath he whispers not a curse but a name — his father's. The ravens circle once and leave. The long night of Logres is ending, though no song will call it a victory.",
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
    {
      id: "faerie_champion",
      name: "Faerie Champion",
      desc: "Avalon's duellist; blade of glass, grin of a cat.",
      stamina: 14,
      power: 140,
      gold: 200,
      xp: 200,
      dmgMin: 26,
      dmgMax: 44,
      cooldownMs: 120000,
      minLevel: 11,
    },
    {
      id: "outrider",
      name: "Mordred's Outrider",
      desc: "Black-mailed scout of the traitor prince, out of the Wastes.",
      stamina: 16,
      power: 230,
      gold: 380,
      xp: 330,
      dmgMin: 34,
      dmgMax: 56,
      cooldownMs: 150000,
      minLevel: 20,
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
      region: "camelot",
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
      region: "camelot",
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
      region: "camelot",
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
      region: "camelot",
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
    {
      id: "apple_orchard",
      region: "avalon",
      name: "Isle Apple Orchard",
      desc: "A walled orchard on Avalon's shore. Healers pay dearly for the fruit.",
      cost: 3000,
      minLevel: 10,
      cycleSec: 180,
      baseGold: 140,
      upgradeCost: [3200, 4800],
      upgradeGoldAdd: [60, 90],
      maxLevel: 2,
    },
    {
      id: "salt_fort",
      region: "wastes",
      name: "Salt Road Fort",
      desc: "The only safe waystation in the Wastes. Caravans pay any toll.",
      cost: 8000,
      minLevel: 20,
      cycleSec: 240,
      baseGold: 360,
      upgradeCost: [8000, 12000],
      upgradeGoldAdd: [150, 220],
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
    // Boss uniques (weight 0 = never from random rolls)
    {
      id: "green_girdle",
      name: "Green Girdle",
      slot: "relic",
      desc: "Boss unique: +15 defense, +5% XP (passive)",
      weight: 0,
      unique: true,
      effect: { defense: 15, xpMult: 0.05 },
    },
    {
      id: "clarent",
      name: "Clarent",
      slot: "weapon",
      desc: "Boss unique: +30 fight power, +5 defense",
      weight: 0,
      unique: true,
      effect: { attack: 30, defense: 5 },
    },
  ];

  /**
   * Collections — one set per region. Pieces drop from quests in that region (~15%),
   * fight wins (~10%, any unlocked region) and are guaranteed from bosses.
   * Redeem once (consumes one of each piece) for a permanent bonus.
   */
  const COLLECTIONS = [
    {
      id: "round_table",
      region: "camelot",
      name: "Arms of the Round Table",
      bonusDesc: "+10 attack, +10 defense",
      bonus: { attack: 10, defense: 10 },
      pieces: [
        { id: "rt_shard", name: "Round Table Splinter", weight: 30 },
        { id: "rt_key", name: "Kay's Seneschal Key", weight: 25 },
        { id: "rt_gauntlet", name: "Bedivere's Gauntlet", weight: 20 },
        { id: "rt_pentangle", name: "Gawain's Pentangle Boss", weight: 15 },
        { id: "rt_signet", name: "Arthur's Signet Ring", weight: 10 },
      ],
    },
    {
      id: "grail",
      region: "avalon",
      name: "Relics of the Grail",
      bonusDesc: "+10 max Energy, +5 max Stamina",
      bonus: { energyMax: 10, staminaMax: 5 },
      pieces: [
        { id: "gr_veil", name: "Lady's Veil", weight: 30 },
        { id: "gr_apple", name: "Golden Apple of Avalon", weight: 25 },
        { id: "gr_paten", name: "Silver Paten", weight: 20 },
        { id: "gr_lance", name: "Tip of the Bleeding Lance", weight: 15 },
        { id: "gr_light", name: "Grail's Light", weight: 10 },
      ],
    },
    {
      id: "pendragon",
      region: "wastes",
      name: "Regalia of Pendragon",
      bonusDesc: "+10% gold, +10% XP",
      bonus: { goldMult: 0.1, xpMult: 0.1 },
      pieces: [
        { id: "pd_banner", name: "Red Dragon Banner", weight: 30 },
        { id: "pd_arrow", name: "Camlann Arrowhead", weight: 25 },
        { id: "pd_torque", name: "Uther's Torque", weight: 20 },
        { id: "pd_staff", name: "Merlin's Hazel Staff", weight: 15 },
        { id: "pd_crown", name: "Crown of Logres", weight: 10 },
      ],
    },
  ];

  /**
   * Bosses — shared HP pool whittled by Stamina strikes; HP persists and slowly regenerates.
   * After a kill the boss returns after respawnMs at full HP.
   */
  const BOSSES = [
    {
      id: "green_knight",
      name: "The Green Knight",
      desc: "A giant in green who offers the beheading game. He regrows — slowly.",
      minLevel: 12,
      maxHp: 2400,
      stamina: 5,
      regenPerMin: 30,
      respawnMs: 30 * 60 * 1000,
      respawnLabel: "a year and a day (30m)",
      dmgMin: 6,
      dmgMax: 14,
      strikeGold: 15,
      strikeXp: 10,
      gold: 2500,
      xp: 1000,
      lootId: "green_girdle",
      collectionId: "round_table",
    },
    {
      id: "mordred",
      name: "Mordred",
      desc: "The traitor prince holds Camlann with Clarent in hand. End the long night.",
      minLevel: 25,
      maxHp: 10000,
      stamina: 8,
      regenPerMin: 45,
      respawnMs: 60 * 60 * 1000,
      respawnLabel: "60m",
      dmgMin: 12,
      dmgMax: 26,
      strikeGold: 40,
      strikeXp: 25,
      gold: 8000,
      xp: 3000,
      lootId: "clarent",
      collectionId: "pendragon",
    },
  ];

  /** Named knights — special recruits (count toward band size, not the hire cap) */
  const NAMED_KNIGHTS = [
    {
      id: "gawain",
      name: "Sir Gawain",
      desc: "Nephew of the king, strongest at noon. +25% damage to the Green Knight.",
      minLevel: 8,
      cost: 1500,
      attack: 10,
      defense: 5,
      bossDmg: { green_knight: 0.25 },
    },
    {
      id: "percival",
      name: "Sir Percival",
      desc: "The innocent who found the Grail castle. +5% XP from everything.",
      minLevel: 15,
      cost: 4000,
      attack: 8,
      defense: 8,
      xpMult: 0.05,
    },
    {
      id: "lancelot",
      name: "Sir Lancelot",
      desc: "Greatest lance of the Round Table. +10% damage to every boss.",
      minLevel: 22,
      cost: 9000,
      attack: 20,
      defense: 10,
      bossDmgAll: 0.1,
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
      region: "camelot",
      collections: {},
      collectionsRedeemed: {},
      bosses: {},
      band: { recruits: 0, named: {}, rallyReadyAt: 0 },
      saveVersion: SAVE_VERSION,
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
    let defense = 0;
    let goldMult = 0;
    let xpMult = 0;

    function applyEffect(eff) {
      if (!eff) return;
      if (eff.attack) attack += eff.attack;
      if (eff.defense) defense += eff.defense;
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

    return { attack: attack, defense: defense, goldMult: goldMult, xpMult: xpMult };
  }

  // --- Regions ---

  function getRegion(regionId) {
    return REGIONS.find(function (r) {
      return r.id === regionId;
    });
  }

  function regionUnlocked(region) {
    return !!region && state.level >= region.minLevel;
  }

  function currentRegion() {
    const r = getRegion(state.region);
    return regionUnlocked(r) ? r : REGIONS[0];
  }

  function getQuest(questId) {
    return QUESTS.find(function (q) {
      return q.id === questId;
    });
  }

  // --- Collections ---

  function getCollection(setId) {
    return COLLECTIONS.find(function (c) {
      return c.id === setId;
    });
  }

  function findPiece(pieceId) {
    for (let i = 0; i < COLLECTIONS.length; i++) {
      const p = COLLECTIONS[i].pieces.find(function (x) {
        return x.id === pieceId;
      });
      if (p) return { set: COLLECTIONS[i], piece: p };
    }
    return null;
  }

  function pieceCount(pieceId) {
    return (state.collections && state.collections[pieceId]) || 0;
  }

  function collectionComplete(set) {
    return set.pieces.every(function (p) {
      return pieceCount(p.id) > 0;
    });
  }

  function collectionRedeemed(setId) {
    return !!(state.collectionsRedeemed && state.collectionsRedeemed[setId]);
  }

  /** Sum of permanent bonuses from redeemed sets */
  function collectionBonuses() {
    const b = { attack: 0, defense: 0, energyMax: 0, staminaMax: 0, goldMult: 0, xpMult: 0 };
    COLLECTIONS.forEach(function (set) {
      if (!collectionRedeemed(set.id)) return;
      for (const k in set.bonus) {
        if (Object.prototype.hasOwnProperty.call(b, k)) b[k] += set.bonus[k];
      }
    });
    return b;
  }

  /** Weighted roll; preferMissing biases toward pieces not yet owned (boss drops) */
  function rollCollectionPiece(set, preferMissing) {
    let pool = set.pieces;
    if (preferMissing) {
      const missing = set.pieces.filter(function (p) {
        return pieceCount(p.id) <= 0;
      });
      if (missing.length) pool = missing;
    }
    const total = pool.reduce(function (sum, p) {
      return sum + p.weight;
    }, 0);
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight;
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  function grantCollectionPiece(set, piece) {
    if (!state.collections) state.collections = {};
    state.collections[piece.id] = (state.collections[piece.id] || 0) + 1;
    const n = state.collections[piece.id];
    addLog(
      "Collection: found " +
        piece.name +
        " (" +
        set.name +
        ")" +
        (n > 1 ? " — duplicate ×" + n + "." : "!")
    );
    if (n === 1 && collectionComplete(set) && !collectionRedeemed(set.id)) {
      addLog(set.name + " is complete! Redeem it in Collections.");
    }
  }

  // --- Knight band ---

  function bandState() {
    if (!state.band || typeof state.band !== "object") {
      state.band = { recruits: 0, named: {}, rallyReadyAt: 0 };
    }
    if (typeof state.band.recruits !== "number") state.band.recruits = 0;
    if (!state.band.named || typeof state.band.named !== "object") state.band.named = {};
    if (typeof state.band.rallyReadyAt !== "number") state.band.rallyReadyAt = 0;
    return state.band;
  }

  function bandCap() {
    return Math.min(BAND_CAP_MAX, BAND_CAP_BASE + state.level);
  }

  function namedKnightsOwned() {
    const b = bandState();
    return NAMED_KNIGHTS.filter(function (k) {
      return !!b.named[k.id];
    });
  }

  function bandSize() {
    return bandState().recruits + namedKnightsOwned().length;
  }

  function hireCost() {
    return BAND_HIRE_BASE + bandState().recruits * BAND_HIRE_STEP;
  }

  function rallyRemaining() {
    return Math.max(0, bandState().rallyReadyAt - Date.now());
  }

  function bandBonuses() {
    const b = bandState();
    let attack = b.recruits * BAND_ATTACK_PER_RECRUIT;
    let defense = b.recruits * BAND_DEFENSE_PER_RECRUIT;
    let xpMult = 0;
    namedKnightsOwned().forEach(function (k) {
      attack += k.attack || 0;
      defense += k.defense || 0;
      xpMult += k.xpMult || 0;
    });
    return { attack: attack, defense: defense, xpMult: xpMult };
  }

  function bossDamageBonus(bossId) {
    let m = 0;
    namedKnightsOwned().forEach(function (k) {
      if (k.bossDmg && k.bossDmg[bossId]) m += k.bossDmg[bossId];
      if (k.bossDmgAll) m += k.bossDmgAll;
    });
    return m;
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
    m += collectionBonuses().goldMult;
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
    m += collectionBonuses().xpMult;
    m += bandBonuses().xpMult;
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

  /** Attack rating without the fight roll: level + shop + gear + band + collections */
  function attackRating() {
    const eq = collectEquipEffects();
    return (
      state.level * 8 +
      attackBonusFromShop() +
      eq.attack +
      bandBonuses().attack +
      collectionBonuses().attack
    );
  }

  /** Defense rating: soaks a share of fight and boss damage */
  function defenseRating() {
    const eq = collectEquipEffects();
    return state.level * 3 + eq.defense + bandBonuses().defense + collectionBonuses().defense;
  }

  function soakDamage(dmg) {
    const def = defenseRating();
    return Math.max(1, Math.round(dmg * (1 - def / (def + DEFENSE_SOAK))));
  }

  function playerPower() {
    return attackRating() + randInt(-6, 6);
  }

  function foePower(foe) {
    return foe.power + randInt(-8, 8);
  }

  function syncMaxesFromLevel() {
    const cb = collectionBonuses();
    state.energyMax = BASE_ENERGY_MAX + (state.level - 1) * 2 + cb.energyMax;
    state.staminaMax = BASE_STAMINA_MAX + (state.level - 1) * 1 + cb.staminaMax;
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

  // --- Boss helpers ---

  function getBoss(bossId) {
    return BOSSES.find(function (b) {
      return b.id === bossId;
    });
  }

  function bossState(def) {
    if (!state.bosses || typeof state.bosses !== "object") state.bosses = {};
    let b = state.bosses[def.id];
    if (!b || typeof b !== "object") {
      b = state.bosses[def.id] = { hp: def.maxHp, kills: 0, respawnAt: 0, regenAccMs: 0 };
    }
    if (typeof b.hp !== "number" || b.hp > def.maxHp) b.hp = def.maxHp;
    if (typeof b.kills !== "number") b.kills = 0;
    if (typeof b.respawnAt !== "number") b.respawnAt = 0;
    if (typeof b.regenAccMs !== "number") b.regenAccMs = 0;
    return b;
  }

  function bossRespawnRemaining(def) {
    return Math.max(0, bossState(def).respawnAt - Date.now());
  }

  /** Respawn after cooldown; slow HP regen while alive */
  function accrueBoss(def, elapsedMs) {
    const b = bossState(def);
    if (b.respawnAt) {
      if (Date.now() >= b.respawnAt) {
        b.respawnAt = 0;
        b.hp = def.maxHp;
        b.regenAccMs = 0;
      }
      return;
    }
    if (b.hp >= def.maxHp) {
      b.regenAccMs = 0;
      return;
    }
    const msPerHp = 60000 / def.regenPerMin;
    b.regenAccMs += elapsedMs;
    const gained = Math.floor(b.regenAccMs / msPerHp);
    if (gained > 0) {
      b.regenAccMs -= gained * msPerHp;
      b.hp = Math.min(def.maxHp, b.hp + gained);
    }
  }

  function accrueAllBosses(elapsedMs) {
    BOSSES.forEach(function (def) {
      accrueBoss(def, elapsedMs);
    });
  }

  // --- Loot roll ---

  function rollLootDrop() {
    const pool = LOOT.filter(function (L) {
      return L.weight > 0; // boss uniques never roll randomly
    });
    const total = pool.reduce(function (s, L) {
      return s + L.weight;
    }, 0);
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight;
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
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
        saveVersion: SAVE_VERSION,
        lastTick: Date.now(),
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    } catch (e) {
      // ignore quota / private mode
    }
  }

  function load() {
    try {
      let raw = localStorage.getItem(SAVE_KEY);
      let migratedFrom = null;
      if (!raw) {
        // v0.3 and earlier saved under the legacy key — migrate (legacy copy is left untouched)
        for (let i = 0; i < LEGACY_SAVE_KEYS.length && !raw; i++) {
          raw = localStorage.getItem(LEGACY_SAVE_KEYS[i]);
          if (raw) migratedFrom = LEGACY_SAVE_KEYS[i];
        }
      }
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
      // v0.4 fields
      if (typeof state.level !== "number" || state.level < 1) state.level = 1;
      if (!state.collections || typeof state.collections !== "object") state.collections = {};
      if (!state.collectionsRedeemed || typeof state.collectionsRedeemed !== "object") {
        state.collectionsRedeemed = {};
      }
      if (!state.bosses || typeof state.bosses !== "object") state.bosses = {};
      BOSSES.forEach(function (def) {
        bossState(def);
      });
      bandState();
      if (!getRegion(state.region) || !regionUnlocked(getRegion(state.region))) {
        state.region = "camelot";
      }
      const oldVersion = typeof data.saveVersion === "number" ? data.saveVersion : 3;
      state.saveVersion = SAVE_VERSION;
      syncMaxesFromLevel();
      if (typeof state.stamina !== "number") state.stamina = state.staminaMax;
      if (typeof state.health !== "number") state.health = state.healthMax;
      state.energy = Math.min(state.energy, state.energyMax);
      state.stamina = Math.min(state.stamina, state.staminaMax);
      state.health = Math.min(Math.max(0, state.health), state.healthMax);
      clearFallenIfHealed();
      applyOfflineRegen();
      if (migratedFrom || oldVersion < SAVE_VERSION) {
        addLog(
          "Save migrated to v0.4 — Regions, Bosses, Knight Band and Collections are now open to you."
        );
        save();
      }
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
    accrueAllBosses(elapsed);
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
      REGIONS.forEach(function (r) {
        if (r.minLevel === state.level) {
          addLog("New region unlocked: " + r.name + "! Switch regions above the quest board.");
        }
      });
      BOSSES.forEach(function (b) {
        if (b.minLevel === state.level) {
          addLog(b.name + " will now face you. See Bosses.");
        }
      });
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
    const qSet = COLLECTIONS.find(function (c) {
      return c.region === (quest.region || "camelot");
    });
    if (qSet && Math.random() < COLLECTION_DROP_QUEST) {
      grantCollectionPiece(qSet, rollCollectionPiece(qSet, false));
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
        chip = soakDamage(randInt(1, Math.max(2, Math.floor(foe.dmgMin / 2))));
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
      if (Math.random() < COLLECTION_DROP_FIGHT) {
        const openSets = COLLECTIONS.filter(function (c) {
          return regionUnlocked(getRegion(c.region));
        });
        const fSet = openSets[randInt(0, openSets.length - 1)];
        if (fSet) grantCollectionPiece(fSet, rollCollectionPiece(fSet, false));
      }
      tryLevelUp();
    } else {
      const dmg = soakDamage(randInt(foe.dmgMin, foe.dmgMax));
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

  function setRegion(regionId) {
    const r = getRegion(regionId);
    if (!r) return;
    if (!regionUnlocked(r)) {
      addLog(r.name + " opens at Level " + r.minLevel + ".");
      render();
      return;
    }
    if (state.region === r.id) return;
    state.region = r.id;
    addLog("You ride for " + r.name + ".");
    save();
    render();
  }

  function doBossStrike(bossId) {
    const def = getBoss(bossId);
    if (!def) return;
    const b = bossState(def);
    if (state.level < def.minLevel) {
      addLog("You are not yet ready to face " + def.name + " (Level " + def.minLevel + ").");
      render();
      return;
    }
    const respawn = bossRespawnRemaining(def);
    if (respawn > 0) {
      addLog(def.name + " has not yet returned — " + formatCooldown(respawn) + " left.");
      render();
      return;
    }
    if (state.fallen || state.health <= 0) {
      addLog("You have fallen. Rest at the Chapel before facing " + def.name + ".");
      render();
      return;
    }
    if (state.stamina < def.stamina) {
      addLog("Not enough Stamina to strike " + def.name + ".");
      render();
      return;
    }

    state.stamina -= def.stamina;
    const roll = 0.85 + Math.random() * 0.3;
    const dmg = Math.max(1, Math.floor(attackRating() * roll * (1 + bossDamageBonus(def.id))));
    b.hp = Math.max(0, b.hp - dmg);
    const strikeGold = Math.floor(def.strikeGold * goldMultiplier());
    const strikeXp = Math.floor(def.strikeXp * xpMultiplier());
    state.gold += strikeGold;
    state.xp += strikeXp;

    if (b.hp <= 0) {
      b.kills += 1;
      b.respawnAt = Date.now() + def.respawnMs;
      b.regenAccMs = 0;
      const goldGain = Math.floor(def.gold * goldMultiplier());
      const xpGain = Math.floor(def.xp * xpMultiplier());
      state.gold += goldGain;
      state.xp += xpGain;
      addLog(
        "You strike " +
          def.name +
          " for " +
          dmg +
          " — and " +
          def.name +
          " falls! +" +
          (goldGain + strikeGold) +
          " gold, +" +
          (xpGain + strikeXp) +
          " XP. (kill #" +
          b.kills +
          ")"
      );
      const loot = getLootDef(def.lootId);
      if (loot) grantLoot(loot);
      const set = getCollection(def.collectionId);
      if (set) grantCollectionPiece(set, rollCollectionPiece(set, true));
      if (b.kills === 1 && BOSS_LEGENDS[def.id]) {
        state.storyUnlocks.push({
          questId: "boss_" + def.id,
          threshold: 0,
          rank: "Boss Slain",
          questName: def.name,
          text: BOSS_LEGENDS[def.id],
          at: Date.now(),
        });
        addLog("Legend unlocked (Boss Slain — " + def.name + "). See Legends below.");
      }
      addLog(def.name + " returns in " + def.respawnLabel + ".");
    } else {
      const counter = soakDamage(randInt(def.dmgMin, def.dmgMax));
      state.health = Math.max(0, state.health - counter);
      addLog(
        "You strike " +
          def.name +
          " for " +
          dmg +
          " (" +
          b.hp +
          "/" +
          def.maxHp +
          " HP left) — +" +
          strikeGold +
          " gold, +" +
          strikeXp +
          " XP. The counterblow deals " +
          counter +
          " damage."
      );
      if (state.health <= 0) {
        state.fallen = true;
        state.health = 0;
        addLog(def.name + " has laid you low. Rest at the Chapel; the wounds you dealt remain.");
      }
    }
    tryLevelUp();
    save();
    render();
  }

  function hireRecruit() {
    const band = bandState();
    const cap = bandCap();
    if (band.recruits >= cap) {
      addLog("Your band is at its cap (" + cap + "). Gain levels to lead more knights.");
      render();
      return;
    }
    const cost = hireCost();
    if (state.gold < cost) {
      addLog("Need " + cost + " gold to hire a sworn knight.");
      render();
      return;
    }
    state.gold -= cost;
    band.recruits += 1;
    addLog(
      "A sworn knight joins your band for " +
        cost +
        " gold. Band " +
        bandSize() +
        " (" +
        band.recruits +
        "/" +
        cap +
        " sworn)."
    );
    save();
    render();
  }

  function rallyRecruit() {
    const band = bandState();
    const cap = bandCap();
    if (band.recruits >= cap) {
      addLog("Your band is at its cap (" + cap + "). Gain levels to lead more knights.");
      render();
      return;
    }
    const left = rallyRemaining();
    if (left > 0) {
      addLog("The muster horn is still echoing — rally again in " + formatCooldown(left) + ".");
      render();
      return;
    }
    band.recruits += 1;
    band.rallyReadyAt = Date.now() + RALLY_COOLDOWN_MS;
    addLog(
      "You sound the muster horn; a wandering knight answers freely. Band " + bandSize() + "."
    );
    save();
    render();
  }

  function recruitNamed(knightId) {
    const k = NAMED_KNIGHTS.find(function (n) {
      return n.id === knightId;
    });
    if (!k) return;
    const band = bandState();
    if (band.named[k.id]) {
      addLog(k.name + " already rides with you.");
      render();
      return;
    }
    if (state.level < k.minLevel) {
      addLog(k.name + " will only follow a Level " + k.minLevel + " knight.");
      render();
      return;
    }
    if (state.gold < k.cost) {
      addLog("Need " + k.cost + " gold to win " + k.name + " to your banner.");
      render();
      return;
    }
    state.gold -= k.cost;
    band.named[k.id] = true;
    addLog(k.name + " swears to your banner! (+" + k.attack + " atk, +" + k.defense + " def)");
    save();
    render();
  }

  function redeemCollection(setId) {
    const set = getCollection(setId);
    if (!set) return;
    if (collectionRedeemed(set.id)) {
      addLog(set.name + " has already been redeemed.");
      render();
      return;
    }
    if (!collectionComplete(set)) {
      addLog(set.name + " is not complete yet.");
      render();
      return;
    }
    set.pieces.forEach(function (p) {
      state.collections[p.id] -= 1;
    });
    if (!state.collectionsRedeemed) state.collectionsRedeemed = {};
    state.collectionsRedeemed[set.id] = true;
    const oldEMax = state.energyMax;
    const oldSMax = state.staminaMax;
    syncMaxesFromLevel();
    state.energy += Math.max(0, state.energyMax - oldEMax);
    state.stamina += Math.max(0, state.staminaMax - oldSMax);
    addLog("Redeemed " + set.name + "! Permanent bonus: " + set.bonusDesc + ".");
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

  let lastTickSig = "";

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
    accrueAllBosses(dt);

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
    // Also refresh once when a cooldown ends or Energy/Stamina tick changes affordability
    const sig =
      state.energy + "|" + state.stamina + "|" + (state.fallen ? 1 : 0) + "|" + (rallyRemaining() > 0 ? 1 : 0);
    const sigChanged = sig !== lastTickSig;
    lastTickSig = sig;
    if (anyQuestCd || sigChanged) {
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
    if (anyFightCd || state.fallen || sigChanged) {
      renderFights();
    }

    // Refresh holdings pending display periodically
    renderHoldings();
    renderBosses();
    if (rallyRemaining() > 0 || sigChanged) {
      renderBand();
    }
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
    band: document.getElementById("stat-band"),
    bandCap: document.getElementById("stat-band-cap"),
    bandHint: document.getElementById("band-hint"),
    regionTabs: document.getElementById("region-tabs"),
    regionIntro: document.getElementById("region-intro"),
    bossList: document.getElementById("boss-list"),
    bandSummary: document.getElementById("band-summary"),
    bandList: document.getElementById("band-list"),
    collectionsList: document.getElementById("collections-list"),
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

    if (el.band) {
      el.band.textContent = String(bandSize());
      el.bandCap.textContent = String(bandCap() + NAMED_KNIGHTS.length);
      el.bandHint.textContent = "Atk " + attackRating() + " · Def " + defenseRating();
    }
  }

  function renderRegions() {
    if (!el.regionTabs) return;
    el.regionTabs.innerHTML = "";
    const cur = currentRegion();
    REGIONS.forEach(function (r) {
      const unlocked = regionUnlocked(r);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn region-tab" + (r.id === cur.id ? " active" : "");
      btn.setAttribute("data-region", r.id);
      btn.textContent = unlocked ? r.name : r.name + " (Lv " + r.minLevel + ")";
      btn.disabled = !unlocked;
      btn.addEventListener("click", function () {
        setRegion(r.id);
      });
      el.regionTabs.appendChild(btn);
    });
    if (el.regionIntro) el.regionIntro.textContent = cur.desc;
  }

  function renderQuests() {
    el.questList.innerHTML = "";
    const regionId = currentRegion().id;
    QUESTS.forEach(function (q) {
      if ((q.region || "camelot") !== regionId) return;
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

  function renderBosses() {
    if (!el.bossList) return;
    el.bossList.innerHTML = "";
    const isFallen = state.fallen || state.health <= 0;
    BOSSES.forEach(function (def) {
      const b = bossState(def);
      const locked = state.level < def.minLevel;
      const respawn = bossRespawnRemaining(def);
      const canAfford = state.stamina >= def.stamina;
      const pct = Math.max(0, Math.min(100, (b.hp / def.maxHp) * 100));
      const loot = getLootDef(def.lootId);
      const set = getCollection(def.collectionId);
      const bonus = bossDamageBonus(def.id);
      const card = document.createElement("article");
      card.className =
        "card boss-card" + (locked ? " locked" : "") + (respawn > 0 ? " cooling" : "");
      card.setAttribute("data-boss", def.id);
      card.innerHTML =
        '<div class="card-body">' +
        "<h3>" +
        escapeHtml(def.name) +
        (b.kills > 0 ? '<span class="badge">Slain ×' + b.kills + "</span>" : "") +
        (isFallen && !locked ? '<span class="badge fallen-badge">Fallen</span>' : "") +
        "</h3>" +
        '<p class="card-meta">' +
        escapeHtml(def.desc) +
        "</p>" +
        '<p class="card-meta">' +
        (respawn > 0
          ? '<span class="gate">Returns in ' + formatCooldown(respawn) + "</span>"
          : "HP " + b.hp + " / " + def.maxHp + " · regen " + def.regenPerMin + "/min") +
        "</p>" +
        '<div class="bar boss-bar" aria-hidden="true"><div class="bar-fill boss" style="width:' +
        (respawn > 0 ? 0 : pct) +
        '%"></div></div>' +
        '<p class="card-meta">' +
        '<span class="cost-stamina">' +
        def.stamina +
        " Stamina / strike</span> · " +
        "~" +
        Math.floor(attackRating() * (1 + bonus)) +
        " dmg" +
        (bonus ? ' <span class="mastery">(+' + Math.round(bonus * 100) + "% band)</span>" : "") +
        " · " +
        '<span class="cost-health">counter ' +
        def.dmgMin +
        "–" +
        def.dmgMax +
        "</span>" +
        (locked ? ' · <span class="gate">Requires Level ' + def.minLevel + "</span>" : "") +
        "</p>" +
        '<p class="card-meta">Kill: <span class="reward-gold">+' +
        Math.floor(def.gold * goldMultiplier()) +
        " gold</span> · " +
        '<span class="reward-xp">+' +
        Math.floor(def.xp * xpMultiplier()) +
        " XP</span> · " +
        escapeHtml(loot ? loot.name : "") +
        " + a piece of " +
        escapeHtml(set ? set.name : "") +
        " · returns after " +
        escapeHtml(def.respawnLabel) +
        "</p>" +
        "</div>";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      if (locked) {
        btn.textContent = "Locked";
      } else if (respawn > 0) {
        btn.textContent = "Wait " + formatCooldown(respawn);
      } else if (isFallen) {
        btn.textContent = "Fallen";
      } else {
        btn.textContent = "Strike";
      }
      btn.disabled = locked || respawn > 0 || isFallen || !canAfford;
      btn.addEventListener("click", function () {
        doBossStrike(def.id);
      });
      card.appendChild(btn);
      el.bossList.appendChild(card);
    });
  }

  function renderBand() {
    if (!el.bandList) return;
    const band = bandState();
    const cap = bandCap();
    const bb = bandBonuses();
    el.bandSummary.innerHTML =
      "<strong>Band:</strong> " +
      bandSize() +
      " (" +
      band.recruits +
      "/" +
      cap +
      " sworn knights, " +
      namedKnightsOwned().length +
      "/" +
      NAMED_KNIGHTS.length +
      " named) · <strong>+" +
      bb.attack +
      "</strong> atk · <strong>+" +
      bb.defense +
      "</strong> def" +
      (bb.xpMult ? " · +" + Math.round(bb.xpMult * 100) + "% XP" : "");

    el.bandList.innerHTML = "";
    const atCap = band.recruits >= cap;

    // Hire (gold)
    const hire = document.createElement("article");
    hire.className = "card";
    hire.innerHTML =
      '<div class="card-body"><h3>Hire a Sworn Knight</h3>' +
      '<p class="card-meta">Each sworn knight adds +' +
      BAND_ATTACK_PER_RECRUIT +
      " attack and +" +
      BAND_DEFENSE_PER_RECRUIT +
      " defense. Cap " +
      cap +
      " (grows +1 per level).</p>" +
      '<p class="card-meta"><span class="reward-gold">' +
      hireCost() +
      " gold</span>" +
      (atCap ? ' · <span class="gate">At cap</span>' : "") +
      "</p></div>";
    const hireBtn = document.createElement("button");
    hireBtn.type = "button";
    hireBtn.className = "btn btn-primary";
    hireBtn.id = "btn-hire";
    hireBtn.textContent = atCap ? "At cap" : "Hire";
    hireBtn.disabled = atCap || state.gold < hireCost();
    hireBtn.addEventListener("click", hireRecruit);
    hire.appendChild(hireBtn);
    el.bandList.appendChild(hire);

    // Rally (free, cooldown)
    const left = rallyRemaining();
    const rally = document.createElement("article");
    rally.className = "card" + (left > 0 ? " cooling" : "");
    rally.innerHTML =
      '<div class="card-body"><h3>Sound the Muster Horn</h3>' +
      '<p class="card-meta">A free recruit every ' +
      formatSeconds(RALLY_COOLDOWN_MS / 1000) +
      ". Counts toward the same cap.</p>" +
      '<p class="card-meta">' +
      (left > 0 ? '<span class="gate">Cooldown ' + formatCooldown(left) + "</span>" : "Ready") +
      "</p></div>";
    const rallyBtn = document.createElement("button");
    rallyBtn.type = "button";
    rallyBtn.className = "btn btn-primary";
    rallyBtn.id = "btn-rally";
    rallyBtn.textContent = atCap ? "At cap" : left > 0 ? "Wait " + formatCooldown(left) : "Rally";
    rallyBtn.disabled = atCap || left > 0;
    rallyBtn.addEventListener("click", rallyRecruit);
    rally.appendChild(rallyBtn);
    el.bandList.appendChild(rally);

    // Named knights
    NAMED_KNIGHTS.forEach(function (k) {
      const owned = !!band.named[k.id];
      const locked = state.level < k.minLevel && !owned;
      const card = document.createElement("article");
      card.className = "card" + (owned ? " owned" : "") + (locked ? " locked" : "");
      card.innerHTML =
        '<div class="card-body"><h3>' +
        escapeHtml(k.name) +
        (owned ? '<span class="badge">Sworn</span>' : "") +
        '<span class="badge slot-badge">named</span></h3>' +
        '<p class="card-meta">' +
        escapeHtml(k.desc) +
        "</p>" +
        '<p class="card-meta">+' +
        k.attack +
        " atk · +" +
        k.defense +
        " def" +
        (owned ? "" : ' · <span class="reward-gold">' + k.cost + " gold</span>") +
        (locked ? ' · <span class="gate">Requires Level ' + k.minLevel + "</span>" : "") +
        "</p></div>";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      if (owned) {
        btn.textContent = "Sworn";
        btn.disabled = true;
      } else {
        btn.textContent = locked ? "Locked" : "Recruit";
        btn.disabled = locked || state.gold < k.cost;
        btn.addEventListener("click", function () {
          recruitNamed(k.id);
        });
      }
      card.appendChild(btn);
      el.bandList.appendChild(card);
    });
  }

  function renderCollections() {
    if (!el.collectionsList) return;
    el.collectionsList.innerHTML = "";
    COLLECTIONS.forEach(function (set) {
      const region = getRegion(set.region);
      const redeemed = collectionRedeemed(set.id);
      const complete = collectionComplete(set);
      const have = set.pieces.filter(function (p) {
        return pieceCount(p.id) > 0;
      }).length;
      const card = document.createElement("article");
      card.className = "card collection-card" + (redeemed ? " owned" : "");
      card.setAttribute("data-set", set.id);
      const pieces = set.pieces
        .map(function (p) {
          const n = pieceCount(p.id);
          return (
            '<li class="piece' +
            (n > 0 ? " have" : "") +
            '">' +
            escapeHtml(p.name) +
            (n > 1 ? " ×" + n : n === 1 ? "" : " —") +
            "</li>"
          );
        })
        .join("");
      card.innerHTML =
        '<div class="card-body"><h3>' +
        escapeHtml(set.name) +
        (redeemed ? '<span class="badge">Redeemed</span>' : "") +
        '<span class="badge slot-badge">' +
        escapeHtml(region ? region.name : set.region) +
        "</span></h3>" +
        '<p class="card-meta">' +
        have +
        "/" +
        set.pieces.length +
        ' pieces · bonus: <span class="mastery">' +
        escapeHtml(set.bonusDesc) +
        "</span></p>" +
        '<ul class="piece-list">' +
        pieces +
        "</ul></div>";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      if (redeemed) {
        btn.textContent = "Redeemed";
        btn.disabled = true;
      } else {
        btn.textContent = complete ? "Redeem" : "Incomplete";
        btn.disabled = !complete;
        btn.addEventListener("click", function () {
          redeemCollection(set.id);
        });
      }
      card.appendChild(btn);
      el.collectionsList.appendChild(card);
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
        '<span class="badge slot-badge">' +
        escapeHtml((getRegion(def.region) || REGIONS[0]).name) +
        "</span>" +
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
      eq.defense +
      " def, +" +
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
      empty.textContent =
        "No loot yet. Complete quests (~22% drop chance) or win fights to find gear; bosses drop uniques.";
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
        "No legends yet. Reach mastery ranks (5 / 15 / 40 completions) on any quest, or slay a boss.";
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
    renderRegions();
    renderQuests();
    renderFights();
    renderBosses();
    renderHeals();
    renderBand();
    renderHoldings();
    renderInventory();
    renderCollections();
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
      "Welcome to Ruin Wars. Quests across three regions, The Lists, Bosses, your Knight Band, Holdings, loot and Collections await."
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
    REGIONS: REGIONS,
    COLLECTIONS: COLLECTIONS,
    BOSSES: BOSSES,
    NAMED_KNIGHTS: NAMED_KNIGHTS,
    SAVE_VERSION: SAVE_VERSION,
    attackRating: attackRating,
    defenseRating: defenseRating,
    bandCap: bandCap,
    hireCost: hireCost,
  };
})();
