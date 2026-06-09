// Difficulty director: lair guards, raid waves on a threat budget, L4D-style intensity pacing.

import { DIRECTOR, MONSTERS, LAIR_LEVELUP_EVERY, LAIR_LEVELUP_CAP, LAIR_GUARD_RESPAWN, SIM_DT, TILE } from './data.js';
import { rand, randRange, randInt, pick } from './rng.js';
import { spawnMonster, aliveLairs, dist } from './world.js';
import { monsterAttack } from './combat.js';
import { monsterDmg } from './data.js';

export function updateDirector(state) {
  const now = state.tick * SIM_DT;
  const d = state.director;

  // intensity decay
  d.intensity = Math.max(0, d.intensity - DIRECTOR.intensityDecay * SIM_DT);

  // local lair guards: each living lair keeps its garrison topped up.
  // A lair under attack is NOT a free pinata: it stings its attackers and pours out defenders.
  for (const lair of aliveLairs(state)) {
    const underAttack = lair.lastHitTick && state.tick - lair.lastHitTick < 100;
    if (underAttack) {
      lair.nextGuardAt = Math.min(lair.nextGuardAt, now + 4);
      if (now >= (lair.stingAt || 0)) {
        let best = null, bestD = Infinity;
        for (const h of state.heroes) {
          const dd = dist(lair, h);
          if (dd < 90 && dd < bestD) { best = h; bestD = dd; }
        }
        if (best) {
          lair.stingAt = now + 1.4;
          monsterAttack(state, { id: lair.id, x: lair.x, y: lair.y, kind: 'monster' }, best, monsterDmg(lairLevel(state, lair)) * 0.9);
        }
      }
    }
    if (now < lair.nextGuardAt) continue;
    const garrison = state.monsters.filter(m => m.lairId === lair.id && m.mode === 'guard').length;
    if (garrison < lair.cap + (underAttack ? 2 : 0)) {
      lair.nextGuardAt = now + LAIR_GUARD_RESPAWN + randRange(state, -5, 5);
      const level = lairLevel(state, lair);
      spawnMonster(state, lair.type,
        lair.x + randRange(state, -TILE, TILE), lair.y + randRange(state, -TILE, TILE),
        level, 'guard', lair.id);
    } else {
      lair.nextGuardAt = now + 5;
    }
  }

  // prowlers: a steady trickle of beatable monsters wandering toward the kingdom —
  // the XP faucet that keeps heroes fed (Majesty's roaming rats). Only lairs whose
  // monsters the current roster could plausibly beat send prowlers.
  const avgL = state.heroes.length
    ? state.heroes.reduce((s, h) => s + h.level, 0) / state.heroes.length : 1;
  const timeLock = 1 + Math.floor(now / 240);       // unlock +1 prowler level every 4 min
  const prowlCap = Math.min(avgL + 1, timeLock);
  const raidersOut = state.monsters.filter(m => m.mode === 'raid').length;
  for (const lair of aliveLairs(state)) {
    if (now < (lair.nextProwlAt || 0)) continue;
    if (state.heroes.length === 0
      || raidersOut >= Math.max(2, state.heroes.length * 1.5)) { lair.nextProwlAt = now + 20; continue; }
    const out = state.monsters.filter(m => m.lairId === lair.id && m.mode === 'raid').length;
    if (out >= 2) { lair.nextProwlAt = now + 15; continue; }
    lair.nextProwlAt = now + randRange(state, 30, 50);
    // strong lairs send weaker scouts instead of going silent — the XP faucet never dries up
    const level = Math.min(lairLevel(state, lair), Math.max(Math.round(prowlCap), 1));
    spawnMonster(state, lair.type,
      lair.x + randRange(state, -TILE, TILE), lair.y + randRange(state, -TILE, TILE),
      level, 'raid', lair.id);
  }

  // relax phase pauses all raids
  if (now < d.relaxUntil) return;
  if (d.intensity > DIRECTOR.relaxThreshold) {
    d.relaxUntil = now + randRange(state, DIRECTOR.relaxTime[0], DIRECTOR.relaxTime[1]);
    state.events.push({ t: 'relax' });
    return;
  }
  if (now < d.nextWaveAt) return;

  // onboarding (grace) period: tiny waves from the weakest lairs only
  const grace = now < DIRECTOR.graceTime;
  const every = grace ? DIRECTOR.graceWaveEvery : DIRECTOR.waveEvery;
  d.nextWaveAt = now + randRange(state, every[0], every[1]);
  d.wave++;
  let budget = grace ? DIRECTOR.graceBudget(now / 60) : DIRECTOR.budget(now / 60);
  // director never overwhelms beyond what the kingdom could plausibly handle
  const kingdomPower = (4 + state.heroes.reduce((s, h) => s + h.level, 0)) * 0.7;
  budget = Math.min(budget, kingdomPower);
  let lairs = aliveLairs(state);
  if (grace) lairs = lairs.sort((a, b) => MONSTERS[a.type].level - MONSTERS[b.type].level).slice(0, 2);
  else {
    const fitting = lairs.filter(l => lairLevel(state, l) <= avgL + 3);
    // if only over-leveled lairs remain, the weakest one still raids (no silent stalemate)
    lairs = fitting.length ? fitting
      : lairs.sort((a, b) => lairLevel(state, a) - lairLevel(state, b)).slice(0, 1);
  }
  if (lairs.length === 0) return;

  // spend the budget: each monster costs its level in points
  let spawned = 0;
  let guard = 0;
  while (budget > 0 && guard++ < 40) {
    const lair = pick(state, lairs);
    const level = lairLevel(state, lair);
    if (level > budget && spawned > 0) break;
    const m = spawnMonster(state, lair.type,
      lair.x + randRange(state, -TILE * 2, TILE * 2), lair.y + randRange(state, -TILE * 2, TILE * 2),
      level, 'raid', lair.id);
    budget -= level;
    spawned++;
  }
  if (spawned) state.events.push({ t: 'wave', n: d.wave, size: spawned });
}

// lairs escalate +1 monster level per LAIR_LEVELUP_EVERY alive, capped so endgame stays winnable
export function lairLevel(state, lair) {
  const ageMin = (state.tick * SIM_DT - lair.bornTick * SIM_DT) / 60;
  const bonus = Math.min(Math.floor((ageMin * 60) / LAIR_LEVELUP_EVERY), LAIR_LEVELUP_CAP);
  lair.bornLevelBonus = bonus;
  return MONSTERS[lair.type].level + bonus;
}
