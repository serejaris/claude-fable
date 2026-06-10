// Single source of all balance numbers (GDD §Tech: "весь баланс в одном data-файле").
// Formulas from research: linear stats -> quadratic effective power.

export const TILE = 32;
export const MAP_W = 64;
export const MAP_H = 64;
export const SIM_DT = 0.1; // 10 Hz fixed timestep
export const START_GOLD = 1500;

export const XP = {
  next: L => Math.round(60 * Math.pow(1.35, L - 1)), // XP to go from L to L+1
  monster: L => Math.round(15 * Math.pow(L, 1.5)),
  cap: 10,
};

export const CLASSES = {
  warrior: {
    label: 'Воин', cost: 250, color: '#c84b4b',
    hp: L => 50 + 16 * L, dmg: L => 6 + 2.5 * L,
    range: 28, speed: 55, atkCd: 1.0, sight: 6,
    traits: { courage: 0.7, greed: 0.5, diligence: 0.5 },
    // affinity multipliers per action family
    affinity: { fight: 1.2, lair: 1.1, explore: 0.7, gold: 0.8 },
  },
  ranger: {
    label: 'Следопыт', cost: 300, color: '#4ba35a',
    hp: L => 35 + 10 * L, dmg: L => 5 + 2.2 * L,
    range: 130, speed: 72, atkCd: 1.0, sight: 8,
    traits: { courage: 0.5, greed: 0.4, diligence: 0.8 },
    affinity: { fight: 0.9, lair: 0.9, explore: 1.4, gold: 0.7 },
  },
  wizard: {
    label: 'Маг', cost: 400, color: '#5a6fd6',
    hp: L => 34 + 9 * L, dmg: L => 14 + 6 * L, // burst per hit, slow cadence
    range: 115, speed: 60, atkCd: 2.0, sight: 7, // faster than goblin: fleeing must be survivable
    traits: { courage: 0.3, greed: 0.6, diligence: 0.5 },
    affinity: { fight: 0.9, lair: 1.0, explore: 0.6, gold: 0.9 },
  },
  rogue: {
    label: 'Плут', cost: 200, color: '#9b59b6',
    hp: L => 30 + 9 * L, dmg: L => 5 + 2.4 * L, // dagger dps: equal-level threat ratio dips below the decline gate
    range: 26, speed: 68, atkCd: 0.7, sight: 7,
    traits: { courage: 0.3, greed: 0.9, diligence: 0.7 },
    affinity: { fight: 1.0, lair: 0.8, explore: 1.3, gold: 1.5 },
  },
};

export const MONSTERS = {
  rat:      { label: 'Крыса', level: 1, speed: 60, color: '#8d7250' },
  goblin:   { label: 'Гоблин',    level: 2, speed: 58, color: '#6f8f3e' },
  spider:   { label: 'Паук',    level: 3, speed: 66, color: '#4a4458' },
  wolf:     { label: 'Волк', level: 4, speed: 70, color: '#7a7d85' },
  troll:    { label: 'Тролль',     level: 6, speed: 45, color: '#4e7a5c', regen: 2 },
  minotaur: { label: 'Минотавр',  level: 8, speed: 52, color: '#a8623c' },
};
export const monsterHp = L => 30 + 13 * L;
export const monsterDmg = L => 4 + 2.2 * L;
export const monsterGold = L => 8 * L;
export const MONSTER_ATK_CD = 1.0;
export const MONSTER_SIGHT = 5; // tiles

export const LAIR_TYPES = [
  { mon: 'rat',      hp: 250, cap: 3, label: 'Крысиная нора' },
  { mon: 'goblin',   hp: 300, cap: 3, label: 'Лагерь гоблинов' },
  { mon: 'spider',   hp: 320, cap: 3, label: 'Паучье гнездо' },
  { mon: 'wolf',     hp: 350, cap: 2, label: 'Волчье логово' },
  { mon: 'troll',    hp: 450, cap: 2, label: 'Пещера тролля' },
  { mon: 'minotaur', hp: 600, cap: 2, label: 'Логово минотавра' },
];
export const LAIR_TREASURE = 150; // gold dropped + per level bonus
export const LAIR_GUARD_RESPAWN = 25; // s between local guard spawns
export const LAIR_LEVELUP_EVERY = 420; // s alive -> +1 monster level
export const LAIR_LEVELUP_CAP = 3;     // escalation ceiling: endgame must stay winnable

export const BUILDINGS = {
  palace:    { label: 'Дворец',          cost: 0,   hp: 1100, w: 2, h: 2, sight: 8, income: 12 }, // royal trickle: economy can never fully stall
  house:     { label: 'Дом',           cost: 80,  hp: 120, w: 1, h: 1, sight: 3, income: 5, max: 8 },
  market:    { label: 'Рынок',     cost: 350, hp: 250, w: 1, h: 1, sight: 4, income: 20 },
  blacksmith:{ label: 'Кузница',      cost: 400, hp: 250, w: 1, h: 1, sight: 4 },
  guild_warrior: { label: 'Гильдия воинов', cost: 350, hp: 300, w: 1, h: 1, sight: 4, hires: 'warrior', cap: 3 },
  guild_ranger:  { label: 'Гильдия следопытов',  cost: 350, hp: 300, w: 1, h: 1, sight: 4, hires: 'ranger', cap: 3 },
  guild_wizard:  { label: 'Гильдия магов',  cost: 450, hp: 300, w: 1, h: 1, sight: 4, hires: 'wizard', cap: 3 },
  guild_rogue:   { label: 'Гильдия плутов',   cost: 300, hp: 300, w: 1, h: 1, sight: 4, hires: 'rogue', cap: 3 },
};

export const ECON = {
  taxRate: 0.3,            // share of hero purchases reaching treasury
  incomeEvery: 8,          // s between passive income ticks
  potionPrice: 25,
  potionHealFrac: 0.5,     // of maxHp
  weaponPrices: [100, 300, 600],   // tier 1..3, hero-paid (t3 must be reachable in a 30-min life)
  armorPrices: [150, 450, 800],
  weaponBonus: 0.22,       // +dmg multiplier per tier
  armorBonus: 0.12,        // incoming damage reduction per tier
  flagMin: 20,
  flagStep: 50,
  revivePerLevel: 8,       // revive cost = 8 * L*(L+1)/2 (triangular): 8g at L1, 120g at L5
  goldDespawn: 90,         // s before dropped gold despawns
  heroStartGold: 15,
};

export const DIRECTOR = {
  // base ramp offset by the 5-min grace; capped by kingdom strength in director.js
  budget: tMin => 8 + 1.2 * Math.pow(Math.max(tMin - 4, 0), 1.2), // points, monster cost = level
  graceBudget: tMin => 2 + tMin * 0.5, // tiny onboarding raids: rats at the gates
  waveEvery: [60, 90],     // s
  graceTime: 300,          // s before full raid waves (0-5 min: onboarding)
  graceWaveEvery: [50, 70],
  guardLeash: 8,           // tiles: lair guards don't chase beyond this
  intensityDecay: 0.05,    // per s
  relaxThreshold: 0.5,
  relaxTime: [30, 45],     // s
};

export const AI = {
  thinkEvery: [1.0, 2.0],    // s, staggered per hero
  commitMargin: 1.2,         // new action must beat current by 20%
  noise: 0.02,
  targetCooldown: 8,         // s ignore abandoned targets
  bountyNorm: 100,           // bounty utility caps at this value
  distWeight: 0.3,
  fleeBase: 0.6,             // flee when threat > fleeBase + courage (brave heroes stand longer)
  healBase: 0.30,            // retreat when hp% < healBase + healCowardice*(1-courage)
  healCowardice: 0.20,
  bucketThreshold: 0.12,     // min score to accept action from a bucket
  guildHealRate: 0.04,       // maxHp frac per s while resting at guild
  shopGoldMin: 25,           // hero considers shopping above this
};

export const SAVE_VERSION = 1;
