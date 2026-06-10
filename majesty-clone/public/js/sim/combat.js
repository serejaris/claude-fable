// Damage, deaths, XP, gold drops, bounty payouts.

import { CLASSES, ECON, XP, monsterGold } from './data.js';
import { rand, randRange } from './rng.js';
import { dist, rebuildBuildGrid } from './world.js';

export function heroDamage(h) {
  const cls = CLASSES[h.cls];
  return cls.dmg(h.level) * (1 + ECON.weaponBonus * h.weaponTier);
}

export function heroAttack(state, h, target) {
  const cls = CLASSES[h.cls];
  if (state.tick * 0.1 < h.atkAt) return;
  h.atkAt = state.tick * 0.1 + cls.atkCd;
  const dmg = heroDamage(h);
  target.hp -= dmg;
  if (target.kind === 'monster' && !target.damagers.includes(h.id)) target.damagers.push(h.id);
  if (target.kind === 'lair') target.lastHitTick = state.tick; // wakes the garrison

  state.events.push({ t: 'hit', from: h.id, to: target.id, dmg, x: target.x, y: target.y, ranged: cls.range > 40, cls: h.cls });
  if (target.hp <= 0) {
    if (target.kind === 'monster') killMonster(state, target, h);
    else if (target.kind === 'lair') destroyLair(state, target);
  }
}

export function monsterAttack(state, m, target, dmgAmount) {
  let dmg = dmgAmount;
  if (target.kind === 'hero') {
    dmg *= (1 - ECON.armorBonus * target.armorTier);
    bumpIntensity(state, 0.06);
  }
  target.hp -= dmg;
  state.events.push({ t: 'hit', from: m.id, to: target.id, dmg, x: target.x, y: target.y });
  if (target.hp <= 0) {
    if (target.kind === 'hero') killHero(state, target);
    else if (target.kind === 'building') destroyBuilding(state, target);
  }
}

export function killMonster(state, m, killer) {
  m.hp = 0;
  state.stats.monsterKills++;
  // gold drop
  const gold = monsterGold(m.level);
  state.goldPiles.push({ id: state.nextId++, x: m.x + randRange(state, -8, 8), y: m.y + randRange(state, -8, 8), amount: gold, despawnAt: state.tick * 0.1 + ECON.goldDespawn });
  state.stats.faucets += gold;
  // xp split among damagers
  const xp = XP.monster(m.level);
  const damagers = state.heroes.filter(h => m.damagers.includes(h.id) && h.hp > 0);
  const share = Math.max(1, Math.round(xp / Math.max(damagers.length, 1)));
  for (const h of damagers) grantXp(state, h, share);
  if (killer && killer.kind === 'hero') killer.kills++;
  // bounty payout for attack flags on this monster
  for (const f of state.flags) {
    if (f.targetId === m.id) payFlag(state, f, m);
  }
  state.flags = state.flags.filter(f => f.targetId !== m.id);
  state.events.push({ t: 'death', kindWas: 'monster', x: m.x, y: m.y, id: m.id });
}

export function destroyLair(state, lair) {
  lair.hp = 0;
  const treasure = 150 + 40 * (lair.bornLevelBonus || 0) + 25 * Math.round(lair.maxHp / 100);
  state.goldPiles.push({ id: state.nextId++, x: lair.x, y: lair.y, amount: treasure, despawnAt: state.tick * 0.1 + ECON.goldDespawn * 2 });
  state.stats.faucets += treasure;
  for (const f of state.flags) if (f.targetId === lair.id) payFlag(state, f, lair);
  state.flags = state.flags.filter(f => f.targetId !== lair.id);
  // monsters of this lair scatter (stop respawning); xp bonus to nearby heroes
  for (const h of state.heroes) if (dist(h, lair) < 250) grantXp(state, h, XP.monster(4));
  state.events.push({ t: 'lair-down', id: lair.id, label: lair.label, x: lair.x, y: lair.y });
}

export function payFlag(state, f, deadTarget) {
  // bounty split among living heroes near the kill; if nobody close, refund treasury
  const near = state.heroes.filter(h => h.hp > 0 && dist(h, deadTarget) < 260);
  if (near.length === 0) { state.gold += f.bounty; return; }
  const share = Math.floor(f.bounty / near.length);
  for (const h of near) {
    h.gold += share;
    state.events.push({ t: 'bounty', id: h.id, amount: share, x: h.x, y: h.y });
  }
}

export function grantXp(state, h, amount) {
  if (h.level >= XP.cap) return;
  h.xp += amount;
  const cls = CLASSES[h.cls];
  while (h.level < XP.cap && h.xp >= XP.next(h.level)) {
    h.xp -= XP.next(h.level);
    h.level++;
    h.maxHp = cls.hp(h.level);
    h.hp = h.maxHp; // level-up = full heal
    state.events.push({ t: 'levelup', id: h.id, level: h.level, x: h.x, y: h.y });
  }
}

export function killHero(state, h) {
  h.hp = 0;
  state.stats.heroDeaths++;
  // 60% of carried gold spills on the ground (lootable), 40% is lost — drain without a death spiral
  const spill = Math.floor(h.gold * 0.6);
  if (spill > 0) state.goldPiles.push({ id: state.nextId++, x: h.x, y: h.y, amount: spill, despawnAt: state.tick * 0.1 + ECON.goldDespawn * 2 });
  state.stats.drains += h.gold - spill;
  state.graves.push({
    id: state.nextId++, heroId: h.id, name: h.name, cls: h.cls, level: h.level,
    label: h.label, traits: h.traits, home: h.home, x: h.x, y: h.y,
  });
  state.heroes = state.heroes.filter(x => x.id !== h.id);
  bumpIntensity(state, 0.35);
  state.events.push({ t: 'hero-death', name: h.name, x: h.x, y: h.y });
}

export function reviveHero(state, grave) {
  const cost = ECON.revivePerLevel * grave.level * (grave.level + 1) / 2; // triangular: 8g L1, 120g L5
  if (state.gold < cost) return null;
  const guild = state.buildings.find(b => b.id === grave.home) || state.buildings[0];
  if (!guild) return null;
  const homeId = state.buildings.some(b => b.id === grave.home) ? grave.home : guild.id;
  state.gold -= cost;
  state.stats.drains += cost;
  const cls = CLASSES[grave.cls];
  const h = {
    id: state.nextId++, kind: 'hero', cls: grave.cls, name: grave.name, label: grave.label,
    level: grave.level, xp: 0, hp: Math.round(cls.hp(grave.level) * 0.5), maxHp: cls.hp(grave.level),
    x: guild.x, y: guild.y + 24, prevX: guild.x, prevY: guild.y,
    gold: 0, potions: 0, weaponTier: 0, armorTier: 0,
    traits: grave.traits, home: homeId, intent: 'вернулся с того света',
    action: null, thinkAt: state.tick + 5, atkAt: 0, ignore: {}, kills: 0,
  };
  state.heroes.push(h);
  state.graves = state.graves.filter(g => g.id !== grave.id);
  state.events.push({ t: 'revive', id: h.id, name: h.name });
  return h;
}

export function destroyBuilding(state, b) {
  b.hp = 0;
  state.buildings = state.buildings.filter(x => x.id !== b.id);
  state.events.push({ t: 'building-down', type: b.type, x: b.x, y: b.y });
  if (b.type === 'palace') state.result = 'lose';
  // heroes (and graves) of a destroyed guild lose their home
  for (const h of state.heroes) if (h.home === b.id) h.home = null;
  for (const g of state.graves) if (g.home === b.id) g.home = null;
  rebuildBuildGrid(state);
}

export function bumpIntensity(state, amount) {
  state.director.intensity = Math.min(1, state.director.intensity + amount);
}

// Palace guards: weak ranged defense so early rats can't freely chew the kingdom
export function updateDefenses(state) {
  const now = state.tick * 0.1;
  for (const b of state.buildings) {
    if (b.type !== 'palace' && b.type !== 'guild_warrior') continue;
    if (now < (b.defAt || 0)) continue;
    const range = 5 * 32;
    let best = null, bestD = Infinity;
    for (const m of state.monsters) {
      if (m.hp <= 0) continue;
      const d = dist(b, m);
      if (d < range && d < bestD) { best = m; bestD = d; }
    }
    if (best) {
      b.defAt = now + 1.4;
      best.hp -= 12;
      state.events.push({ t: 'hit', from: b.id, to: best.id, dmg: 12, x: best.x, y: best.y, ranged: true, cls: 'tower' });
      if (best.hp <= 0) killMonster(state, best, null);
    }
  }
}
