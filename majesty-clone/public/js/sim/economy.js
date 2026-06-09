// Passive income (faucets), gold pile lifecycle, flag placement, minute-level balance logging.

import { BUILDINGS, ECON, SIM_DT } from './data.js';

export function updateEconomy(state) {
  const now = state.tick * SIM_DT;
  for (const b of state.buildings) {
    const def = BUILDINGS[b.type];
    if (!def.income) continue;
    if (now >= b.incomeAt) {
      b.incomeAt = now + ECON.incomeEvery;
      state.gold += def.income;
      state.stats.faucets += def.income;
      state.events.push({ t: 'income', amount: def.income, x: b.x, y: b.y });
    }
  }
  // gold piles despawn
  state.goldPiles = state.goldPiles.filter(g => now < g.despawnAt);

  // minute log for balance tuning (headless reads this)
  if (state.tick % 600 === 0 && state.tick > 0) {
    state.stats.minuteLog.push({
      min: state.tick / 600,
      gold: state.gold,
      faucets: state.stats.faucets,
      drains: state.stats.drains,
      taxes: state.stats.taxes,
      heroes: state.heroes.length,
      avgLevel: avg(state.heroes.map(h => h.level)),
      deaths: state.stats.heroDeaths,
      kills: state.stats.monsterKills,
      monsters: state.monsters.length,
      lairs: state.lairs.filter(l => l.hp > 0).length,
      intensity: +state.director.intensity.toFixed(2),
    });
  }
}

const avg = arr => arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 0;

// flag placement / boost. Canon: bounty only goes UP, removal burns the gold.
export function placeFlag(state, flagType, opts) {
  if (state.gold < ECON.flagMin) return null;
  state.gold -= ECON.flagMin;
  const f = {
    id: state.nextId++, kind: 'flag', flagType,
    bounty: ECON.flagMin,
    x: opts.x, y: opts.y, targetId: opts.targetId || null,
  };
  state.flags.push(f);
  state.events.push({ t: 'flag', id: f.id });
  return f;
}

export function boostFlag(state, flag) {
  if (state.gold < ECON.flagStep) return false;
  state.gold -= ECON.flagStep;
  flag.bounty += ECON.flagStep;
  return true;
}

export function removeFlag(state, flag) {
  // burns the bounty — a flag is a bet, not an order
  state.flags = state.flags.filter(f => f.id !== flag.id);
  state.stats.drains += flag.bounty;
}

// attack flags follow their target
export function updateFlags(state) {
  for (const f of state.flags) {
    if (f.flagType !== 'attack' || !f.targetId) continue;
    const t = state.monsters.find(m => m.id === f.targetId) || state.lairs.find(l => l.id === f.targetId);
    if (t) { f.x = t.x; f.y = t.y; }
  }
  // count responders (for "N heroes responding" UI)
  for (const f of state.flags) {
    f.responders = state.heroes.filter(h =>
      h.action && (h.action.targetId === f.id || h.action.targetId === f.targetId)).length;
  }
}
