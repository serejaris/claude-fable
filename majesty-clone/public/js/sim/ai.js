// Hero AI: advertisements -> utility scoring with priority buckets -> execution mini-FSM.
// Personality (courage/greed/diligence) enters ONLY as utility weights — never as code branches.
// Buckets: SURVIVAL > COMBAT > FLAGS > NEEDS > AMBIENT.

import { CLASSES, ECON, AI, BUILDINGS, MAP_W, MAP_H, TILE, SIM_DT } from './data.js';
import { rand, randRange, randInt, clamp } from './rng.js';
import { dist, findPath, moveAlong, heroPower, monsterPower, isMonsterVisible,
  updateVisibility, isExplored, centerOf, txOf, palace, isPassable } from './world.js';
import { heroAttack, grantXp } from './combat.js';

const MAP_DIAG = Math.hypot(MAP_W * TILE, MAP_H * TILE);

export function updateHeroes(state) {
  updateVisibility(state);
  const now = state.tick * SIM_DT;
  for (const h of state.heroes) {
    if (h.hp <= 0) continue;
    h.prevX = h.x; h.prevY = h.y;

    // --- survival overrides, checked every tick (not only on think) ---
    if (survivalCheck(state, h, now)) { executeAction(state, h, now); continue; }

    // staggered think: re-decide on schedule or when idle
    if (state.tick >= h.thinkAt || !h.action) {
      think(state, h, now);
      h.thinkAt = state.tick + Math.round(randRange(state, AI.thinkEvery[0], AI.thinkEvery[1]) / SIM_DT);
    }
    executeAction(state, h, now);
  }
}

// ---------- survival bucket ----------

// threat a hero tolerates before fleeing: brave heroes stand longer
const fearTolerance = h => AI.fleeBase + h.traits.courage; // 0.6-base: rogue ~0.8, warrior ~1.3

function survivalCheck(state, h, now) {
  if (h.action && (h.action.type === 'flee' || h.action.type === 'retreat')) return true;
  const threat = localThreat(state, h);
  const cls = CLASSES[h.cls];

  if (threat > fearTolerance(h)) {
    // cornered heroes fight: no flee-loop at the doorstep of home
    const home = state.buildings.find(b => b.id === h.home) || palace(state);
    if (!home || dist(h, home) > 100) {
      setAction(state, h, { type: 'flee' }, `fleeing! (outmatched ${threat.toFixed(1)}x)`);
      return true;
    }
  }
  const healAt = AI.healBase + AI.healCowardice * (1 - h.traits.courage);
  if (h.hp / h.maxHp < healAt) {
    if (h.potions > 0) {
      h.potions--;
      h.hp = Math.min(h.maxHp, h.hp + h.maxHp * ECON.potionHealFrac);
      state.events.push({ t: 'potion', id: h.id, x: h.x, y: h.y });
      return false;
    }
    setAction(state, h, { type: 'retreat' }, 'retreating to heal');
    return true;
  }
  return false;
}

// sum power of monsters engaging me vs mine
function localThreat(state, h) {
  let enemyPower = 0;
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    const d = dist(h, m);
    if (d < 140 && (m.targetId === h.id || d < 70)) enemyPower += monsterPower(m);
  }
  if (enemyPower === 0) return 0;
  let allyPower = heroPower(h);
  for (const other of state.heroes) {
    if (other.id !== h.id && other.hp > 0 && dist(h, other) < 120) allyPower += heroPower(other) * 0.6;
  }
  return enemyPower / allyPower;
}

// ---------- think: gather advertisements, score by bucket ----------

function think(state, h, now) {
  const cls = CLASSES[h.cls];
  const candidates = [];
  const debug = state._debugAI ? [] : null;

  // -- COMBAT bucket: visible monsters (fight back has priority via engagement bonus).
  // Monsters attacking kingdom buildings are a global alarm — every hero hears of it.
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    const attackingKingdom = m.targetId && state.buildings.some(b => b.id === m.targetId);
    // ignore-cooldown never silences an active threat to the hero or the kingdom
    if (isIgnored(h, m.id, now) && !attackingKingdom && m.targetId !== h.id) continue;
    if (!attackingKingdom) {
      if (!isMonsterVisible(state, m)) continue;
      const dd = dist(h, m);
      if (dd > cls.sight * TILE * 2.2) continue;
    }
    const d = dist(h, m);
    const threat = monsterPower(m) / heroPower(h);
    const bounty = flagBountyOn(state, m.id);
    const engaged = m.targetId === h.id ? 0.35 : 0;
    const alarm = attackingKingdom ? 0.45 + 0.3 * h.traits.courage : 0;
    const crowding = crowdPenalty(state, h, m.id, 3);
    const score = bucketScore(state, h, {
      base: 0.35 * cls.affinity.fight + engaged + alarm,
      bounty, threat, d,
      novelty: 0,
    }) * crowding;
    candidates.push({ bucket: 2, score, type: 'fight', targetId: m.id, why: `fight ${m.type}` });
    if (debug) debug.push({ what: `fight ${m.type} L${m.level}${attackingKingdom ? ' (alarm)' : ''}`, score, threat: threat.toFixed(2), d: Math.round(d), bounty });
  }

  // -- FLAGS bucket: explicit player rewards
  for (const f of state.flags) {
    if (isIgnored(h, f.id, now)) continue;
    const d = dist(h, f);
    const crowding = crowdPenalty(state, h, f.id, f.flagType === 'attack' ? 6 : 2);
    let threat = 0;
    if (f.flagType === 'attack') {
      const target = state.monsters.find(m => m.id === f.targetId) || state.lairs.find(l => l.id === f.targetId);
      if (!target || target.hp <= 0) continue;
      threat = (target.kind === 'monster' ? monsterPower(target) : lairThreat(state, target)) / heroPower(h);
    }
    const score = bucketScore(state, h, {
      base: 0.15, bounty: f.bounty, threat, d, novelty: 0,
    }) * crowding;
    candidates.push({ bucket: 2, score, type: 'flag', targetId: f.id, why: `${f.flagType} flag ${f.bounty}g` });
    if (debug) debug.push({ what: `${f.flagType}-flag ${f.bounty}g`, score, threat: threat.toFixed(2), d: Math.round(d) });
  }

  // -- discovered lairs (ambient aggression, mostly for brave classes)
  for (const l of state.lairs) {
    if (l.hp <= 0 || !l.discovered || isIgnored(h, l.id, now)) continue;
    const d = dist(h, l);
    const threat = lairThreat(state, l) / heroPower(h);
    const bounty = flagBountyOn(state, l.id);
    const score = bucketScore(state, h, {
      base: 0.18 * cls.affinity.lair, bounty, threat, d, novelty: 0.1,
    }) * crowdPenalty(state, h, l.id, 3);
    candidates.push({ bucket: bounty > 0 ? 2 : 4, score, type: 'lair', targetId: l.id, why: `assault ${l.label}` });
    if (debug) debug.push({ what: `lair ${l.label}`, score, threat: threat.toFixed(2), d: Math.round(d), bounty });
  }

  // -- gold piles (greed)
  for (const g of state.goldPiles) {
    if (isIgnored(h, g.id, now)) continue;
    const d = dist(h, g);
    if (d > cls.sight * TILE * 2.5) continue;
    const score = (0.25 + 0.6 * h.traits.greed) * cls.affinity.gold
      * Math.min(g.amount / 60, 1)
      * (1 - AI.distWeight * d / (cls.sight * TILE * 2.5))
      * crowdPenalty(state, h, g.id, 1);
    candidates.push({ bucket: 2, score, type: 'pickup', targetId: g.id, why: `grab ${g.amount}g` });
    if (debug) debug.push({ what: `gold ${g.amount}`, score, d: Math.round(d) });
  }

  // -- NEEDS: shopping (potions, upgrades), resting
  needsCandidates(state, h, candidates, debug);

  // -- AMBIENT: explore frontier (diligence), patrol home
  ambientCandidates(state, h, candidates, debug, now);

  // pick best with bucket priority + commitment hysteresis + noise
  for (const c of candidates) c.score = Math.max(0, c.score + (rand(state) - 0.5) * 2 * AI.noise);
  candidates.sort((a, b) => a.bucket - b.bucket || b.score - a.score);

  let chosen = null;
  let bucket = -1;
  for (const c of candidates) {
    if (bucket !== -1 && c.bucket !== bucket) break; // earlier bucket had a winner
    if (c.score >= AI.bucketThreshold) { chosen = chooseSoft(state, candidates.filter(x => x.bucket === c.bucket && x.score >= AI.bucketThreshold)); bucket = c.bucket; break; }
  }
  if (debug) { h._debug = debug.sort((a, b) => b.score - a.score).slice(0, 6); }

  if (!chosen) { idleAction(state, h); return; }

  // commitment: keep current action unless new beats it by margin
  if (h.action && h.action.score && sameAction(h.action, chosen) === false) {
    if (chosen.score < h.action.score * AI.commitMargin && actionStillValid(state, h)) return;
    // abandoning a target -> short cooldown so we don't dither back
    if (h.action.targetId) h.ignore[h.action.targetId] = now + AI.targetCooldown;
  }
  startAction(state, h, chosen, now);
}

function chooseSoft(state, group) {
  // softmax-ish over top-3: weighted pick gives behavioral variety without chaos
  const top = group.slice(0, 3);
  const total = top.reduce((s, c) => s + Math.exp(c.score / 0.2), 0);
  let r = rand(state) * total;
  for (const c of top) {
    r -= Math.exp(c.score / 0.2);
    if (r <= 0) return c;
  }
  return top[0];
}

// core utility: greed/courage/diligence as weights (GDD §AI)
function bucketScore(state, h, { base, bounty, threat, d, novelty }) {
  const u = base
    + h.traits.greed * Math.min((bounty || 0) / AI.bountyNorm, 1)
    + h.traits.courage * (1 - Math.min(threat, 2)) * 0.5
    + h.traits.diligence * (novelty || 0)
    - AI.distWeight * (d / (MAP_DIAG * 0.5));
  // fear dampens utility past personal tolerance — but a huge bounty still tempts
  // the greedy enough to walk over and look (the decline happens up close, visibly)
  if (threat > AI.fleeBase + h.traits.courage) {
    return u * ((bounty || 0) >= 200 ? 0.35 * h.traits.greed : 0.05);
  }
  return u;
}

function lairThreat(state, l) {
  let p = 180 + l.maxHp * 0.35; // structure + garrison estimate
  for (const m of state.monsters) if (m.lairId === l.id && m.hp > 0) p += monsterPower(m) * 0.6;
  return p;
}

function flagBountyOn(state, targetId) {
  const f = state.flags.find(f => f.targetId === targetId);
  return f ? f.bounty : 0;
}

function crowdPenalty(state, h, targetId, slots) {
  const claimed = state.heroes.filter(o => o.id !== h.id && o.action && o.action.targetId === targetId).length;
  return claimed >= slots ? 0.05 : 1 - (claimed / slots) * 0.6;
}

const isIgnored = (h, id, now) => h.ignore[id] && h.ignore[id] > now;

function needsCandidates(state, h, candidates, debug) {
  const market = state.buildings.find(b => b.type === 'market');
  const smith = state.buildings.find(b => b.type === 'blacksmith');
  // potion shopping: smart self-care
  if (market && h.gold >= ECON.potionPrice && h.potions < 3) {
    const urgency = 1 - h.hp / h.maxHp + 0.25;
    const score = 0.3 * urgency + 0.15 * h.traits.greed;
    candidates.push({ bucket: 2, score, type: 'shop', targetId: market.id, item: 'potion', why: 'buy potion' });
    if (debug) debug.push({ what: 'buy potion', score });
  }
  // gear upgrades when rich
  if (smith) {
    const wPrice = ECON.weaponPrices[h.weaponTier];
    const aPrice = ECON.armorPrices[h.armorTier];
    if (wPrice && h.gold >= wPrice) {
      candidates.push({ bucket: 2, score: 0.5, type: 'shop', targetId: smith.id, item: 'weapon', why: `buy weapon t${h.weaponTier + 1}` });
      if (debug) debug.push({ what: `weapon t${h.weaponTier + 1}`, score: 0.45 });
    } else if (aPrice && h.gold >= aPrice) {
      candidates.push({ bucket: 2, score: 0.45, type: 'shop', targetId: smith.id, item: 'armor', why: `buy armor t${h.armorTier + 1}` });
    }
  }
  // rest at guild when scuffed and nothing urgent
  if (h.hp < h.maxHp * 0.85 && h.home) {
    candidates.push({ bucket: 2, score: 0.3 * (1 - h.hp / h.maxHp) + 0.1, type: 'rest', targetId: h.home, why: 'rest at guild' });
  }
}

function ambientCandidates(state, h, candidates, debug, now) {
  // explore: pick a frontier point (unexplored tile near explored edge)
  const target = frontierPoint(state, h);
  if (target) {
    const score = 0.12 + 0.4 * h.traits.diligence * CLASSES[h.cls].affinity.explore;
    candidates.push({ bucket: 4, score, type: 'explore', x: target.x, y: target.y, why: 'exploring' });
    if (debug) debug.push({ what: 'explore frontier', score });
  }
  candidates.push({ bucket: 4, score: 0.16, type: 'patrol', why: 'patrolling' });
}

function frontierPoint(state, h) {
  // sample random tiles, prefer unexplored near hero
  let best = null, bestScore = -1;
  for (let i = 0; i < 14; i++) {
    const tx = randInt(state, 1, MAP_W - 2), ty = randInt(state, 1, MAP_H - 2);
    if (isExplored(state, tx, ty)) continue;
    const c = centerOf(tx, ty);
    const d = Math.hypot(c.x - h.x, c.y - h.y);
    const score = 1 - d / MAP_DIAG;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

// ---------- execution mini-FSM: moveTo -> doAction ----------

function setAction(state, h, action, intent) {
  if (h.action && h.action.type === action.type && h.action.targetId === action.targetId) return;
  h.action = { ...action, path: null, stuckTicks: 0, lastX: h.x, lastY: h.y };
  h.intent = intent;
}

function startAction(state, h, chosen, now) {
  if (h.action && sameAction(h.action, chosen)) { h.action.score = chosen.score; return; }
  h.action = { ...chosen, path: null, stuckTicks: 0 };
  const intents = {
    fight: () => `hunting ${nameOfTarget(state, chosen.targetId)}`,
    flag: () => `answering the call (${flagOf(state, chosen.targetId)?.bounty || 0}g)`,
    lair: () => `assaulting ${nameOfTarget(state, chosen.targetId)}`,
    pickup: () => 'grabbing loot',
    shop: () => chosen.item === 'potion' ? 'going shopping (potion)' : `going shopping (${chosen.item})`,
    rest: () => 'heading home to rest',
    explore: () => 'wandering into the unknown',
    patrol: () => 'patrolling',
  };
  h.intent = (intents[chosen.type] || (() => chosen.why))();
}

const sameAction = (a, b) => a.type === b.type && a.targetId === b.targetId && a.item === b.item;

function nameOfTarget(state, id) {
  const m = state.monsters.find(m => m.id === id); if (m) return `a ${m.type}`;
  const l = state.lairs.find(l => l.id === id); if (l) return l.label;
  return 'a foe';
}
const flagOf = (state, id) => state.flags.find(f => f.id === id);

function actionStillValid(state, h) {
  const a = h.action;
  if (!a) return false;
  if (a.targetId) {
    if (a.type === 'fight') { const m = state.monsters.find(m => m.id === a.targetId); return !!m && m.hp > 0; }
    if (a.type === 'lair') { const l = state.lairs.find(l => l.id === a.targetId); return !!l && l.hp > 0; }
    if (a.type === 'flag') return !!flagOf(state, a.targetId);
    if (a.type === 'pickup') return state.goldPiles.some(g => g.id === a.targetId);
    if (a.type === 'shop' || a.type === 'rest') return state.buildings.some(b => b.id === a.targetId);
  }
  return true;
}

function executeAction(state, h, now) {
  const a = h.action;
  if (!a) return;
  const cls = CLASSES[h.cls];

  if (!actionStillValid(state, h)) { h.action = null; h.thinkAt = state.tick; return; }

  switch (a.type) {
    case 'flee': {
      const home = state.buildings.find(b => b.id === h.home) || palace(state);
      const safe = !state.monsters.some(m => m.hp > 0 && dist(h, m) < 200 && m.targetId === h.id);
      if (!home || (safe && dist(h, home) < 300)) { h.action = null; h.intent = 'catching breath'; return; }
      partingShot(state, h, cls);
      goToward(state, h, home.x, home.y, cls.speed * 1.3);
      if (dist(h, home) < 50) { h.action = null; }
      return;
    }
    case 'retreat': {
      const home = state.buildings.find(b => b.id === h.home) || palace(state);
      if (!home) { h.action = null; return; }
      if (dist(h, home) < 60) {
        if (!a.paidDues && h.gold > 60) {
          const dues = Math.floor(h.gold * 0.4);
          h.gold -= dues;
          state.gold += dues;
          state.stats.taxes += dues;
          a.paidDues = true;
          state.events.push({ t: 'dues', id: h.id, amount: dues, x: home.x, y: home.y });
        }
        h.hp = Math.min(h.maxHp, h.hp + h.maxHp * AI.guildHealRate * SIM_DT);
        h.intent = 'resting at home';
        if (h.hp >= h.maxHp * 0.95) h.action = null;
        return;
      }
      partingShot(state, h, cls);
      goToward(state, h, home.x, home.y, cls.speed);
      return;
    }
    case 'fight': {
      const m = state.monsters.find(m => m.id === a.targetId);
      attackTarget(state, h, m, cls);
      return;
    }
    case 'lair': {
      const l = state.lairs.find(l => l.id === a.targetId);
      attackTarget(state, h, l, cls);
      return;
    }
    case 'flag': {
      const f = flagOf(state, a.targetId);
      if (f.flagType === 'attack') {
        const target = state.monsters.find(m => m.id === f.targetId) || state.lairs.find(l => l.id === f.targetId);
        if (!target || target.hp <= 0) { h.action = null; return; }
        attackTarget(state, h, target, cls);
      } else {
        // explore flag: reach the point
        if (dist(h, f) < 30) {
          completeExploreFlag(state, f);
          h.action = null;
        } else goToward(state, h, f.x, f.y, cls.speed);
      }
      return;
    }
    case 'pickup': {
      const g = state.goldPiles.find(g => g.id === a.targetId);
      if (dist(h, g) < 20) {
        h.gold += g.amount;
        state.goldPiles = state.goldPiles.filter(x => x.id !== g.id);
        state.events.push({ t: 'pickup', id: h.id, amount: g.amount, x: h.x, y: h.y });
        h.action = null;
      } else goToward(state, h, g.x, g.y, cls.speed);
      return;
    }
    case 'shop': {
      const b = state.buildings.find(b => b.id === a.targetId);
      if (dist(h, b) < 45) { doPurchase(state, h, a.item); h.action = null; }
      else goToward(state, h, b.x, b.y, cls.speed);
      return;
    }
    case 'rest': {
      const b = state.buildings.find(b => b.id === a.targetId);
      if (dist(h, b) < 55) {
        if (!a.paidDues && h.gold > 60) {
          // guild dues: heroes declare earnings when home (Majesty's 60/40 split)
          const dues = Math.floor(h.gold * 0.4);
          h.gold -= dues;
          state.gold += dues;
          state.stats.taxes += dues;
          a.paidDues = true;
          state.events.push({ t: 'dues', id: h.id, amount: dues, x: b.x, y: b.y });
        }
        h.intent = 'resting at guild';
        h.hp = Math.min(h.maxHp, h.hp + h.maxHp * AI.guildHealRate * SIM_DT);
        if (h.hp >= h.maxHp) h.action = null;
      } else goToward(state, h, b.x, b.y, cls.speed);
      return;
    }
    case 'explore': {
      if (goToward(state, h, a.x, a.y, cls.speed)) h.action = null;
      return;
    }
    case 'idle':
      return;
    case 'patrol': {
      if (!a.x) {
        const home = state.buildings.find(b => b.id === h.home) || palace(state);
        a.x = home.x + randRange(state, -120, 120);
        a.y = home.y + randRange(state, -120, 120);
      }
      if (goToward(state, h, a.x, a.y, cls.speed * 0.7)) h.action = null;
      return;
    }
    default:
      h.action = null;
  }
}

function attackTarget(state, h, target, cls) {
  const d = dist(h, target);
  const range = cls.range + (target.kind === 'lair' ? 24 : 0);
  // the signature moment: walk up, look at it, decide it is not worth dying for
  if (d < 220 && d > range) {
    const power = target.kind === 'monster' ? monsterPower(target) : lairThreat(state, target);
    if (power / heroPower(h) > fearTolerance(h) + 0.15) {
      const now = state.tick * SIM_DT;
      h.ignore[target.id] = now + AI.targetCooldown * 2;
      if (h.action && h.action.targetId) h.ignore[h.action.targetId] = now + AI.targetCooldown * 2;
      h.action = null;
      h.intent = `too dangerous for me (L${h.level})`;
      state.events.push({ t: 'decline', id: h.id, x: h.x, y: h.y });
      return;
    }
  }
  if (d <= range) {
    // ranged kiting: while the shot is on cooldown, back away from a closing monster
    if (cls.range > 60 && target.kind === 'monster' && d < range * 0.6 && state.tick * SIM_DT < h.atkAt) {
      kiteStep(state, h, target, cls.speed);
      return;
    }
    heroAttack(state, h, target);
  } else {
    goToward(state, h, target.x, target.y, cls.speed);
  }
}

function kiteStep(state, h, threat, speed) {
  const d = dist(h, threat) || 1;
  const nx = h.x + ((h.x - threat.x) / d) * speed * SIM_DT;
  const ny = h.y + ((h.y - threat.y) / d) * speed * SIM_DT;
  if (isPassable(state, txOf(nx), txOf(ny))) { h.x = nx; h.y = ny; }
}

// ranged heroes shoot back at pursuers while withdrawing
function partingShot(state, h, cls) {
  if (cls.range <= 60) return;
  let best = null, bestD = Infinity;
  for (const m of state.monsters) {
    if (m.hp <= 0 || m.targetId !== h.id) continue;
    const d = dist(h, m);
    if (d <= cls.range && d < bestD) { best = m; bestD = d; }
  }
  if (best) heroAttack(state, h, best);
}

// pathfollowing with stuck detection + re-path. Returns true on arrival.
function goToward(state, h, x, y, speed) {
  const a = h.action;
  if (!a.path || a.pathToX !== x || a.pathToY !== y) {
    a.path = findPath(state, h.x, h.y, x, y);
    a.pathToX = x; a.pathToY = y;
    if (!a.path) { // unreachable -> give up on this action
      if (a.targetId) h.ignore[a.targetId] = state.tick * SIM_DT + AI.targetCooldown;
      h.action = null;
      return false;
    }
  }
  const before = { x: h.x, y: h.y };
  const done = moveAlong(state, h, a.path, speed, SIM_DT);
  if (Math.hypot(h.x - before.x, h.y - before.y) < speed * SIM_DT * 0.3) {
    a.stuckTicks = (a.stuckTicks || 0) + 1;
    if (a.stuckTicks > 10) { a.path = null; a.stuckTicks = 0; } // re-path
  } else a.stuckTicks = 0;
  return done;
}

function doPurchase(state, h, item) {
  let price = 0;
  if (item === 'potion') {
    price = ECON.potionPrice;
    if (h.gold < price) return;
    h.potions++;
  } else if (item === 'weapon') {
    price = ECON.weaponPrices[h.weaponTier];
    if (!price || h.gold < price) return;
    h.weaponTier++;
  } else if (item === 'armor') {
    price = ECON.armorPrices[h.armorTier];
    if (!price || h.gold < price) return;
    h.armorTier++;
  }
  h.gold -= price;
  const tax = Math.round(price * ECON.taxRate);
  state.gold += tax;
  state.stats.taxes += tax;
  state.stats.drains += price - tax;
  state.events.push({ t: 'purchase', id: h.id, item, price, tax, x: h.x, y: h.y });
}

export function completeExploreFlag(state, f) {
  const near = state.heroes.filter(h => h.hp > 0 && dist(h, f) < 160);
  if (near.length) {
    const share = Math.floor(f.bounty / near.length);
    for (const h of near) {
      h.gold += share;
      state.events.push({ t: 'bounty', id: h.id, amount: share, x: h.x, y: h.y });
    }
  } else state.gold += f.bounty;
  state.flags = state.flags.filter(x => x.id !== f.id);
  state.events.push({ t: 'flag-done', x: f.x, y: f.y });
}

function idleAction(state, h) {
  // a persistent no-op action: without it the `!h.action` clause re-runs think every tick
  h.action = { type: 'idle' };
  h.intent = 'idling about';
}
