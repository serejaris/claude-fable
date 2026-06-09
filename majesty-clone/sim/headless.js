// Headless balance run: node sim/headless.js [--minutes 30] [--seed 42]
// A scripted "player bot" builds the kingdom and places flags so the sim
// exercises the full loop without a browser. Prints per-minute metrics.

import { newGame, addBuilding, canPlace, hireHero, aliveLairs, palace } from '../public/js/sim/world.js';
import { tick } from '../public/js/sim/update.js';
import { placeFlag, boostFlag } from '../public/js/sim/economy.js';
import { reviveHero } from '../public/js/sim/combat.js';
import { BUILDINGS, CLASSES, MAP_W, MAP_H, TILE } from '../public/js/sim/data.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? +args[i + 1] : dflt;
};
const minutes = opt('minutes', 30);
const seed = opt('seed', 42);
const verbose = args.includes('--verbose');

const state = newGame(seed);
state._headless = true;

// --- scripted player bot ---
const BUILD_ORDER = ['guild_warrior', 'market', 'guild_ranger', 'house', 'guild_rogue', 'blacksmith',
  'guild_wizard', 'house', 'house', 'house', 'house', 'house'];
let buildIdx = 0;

function botAct(state) {
  const p = palace(state);
  // hires before construction: heroes ARE the kingdom
  for (const b of state.buildings) {
    const def = BUILDINGS[b.type];
    if (def.hires && state.gold >= CLASSES[def.hires].cost) hireHero(state, b);
  }
  // build next in order when affordable
  if (buildIdx < BUILD_ORDER.length) {
    const type = BUILD_ORDER[buildIdx];
    const reserve = buildIdx < 2 ? 0 : 100;
    if (state.gold >= BUILDINGS[type].cost + reserve) {
      const spot = findSpot(state, type, p);
      if (spot) {
        addBuilding(state, type, spot.tx, spot.ty);
        buildIdx++;
      }
    }
  }
  // revive fallen heroes when affordable
  for (const g of [...state.graves]) {
    if (state.gold > 50 + 8 * g.level * (g.level + 1) / 2) reviveHero(state, g);
  }
  // emergency defense: big bounty on raiders reaching the palace
  const pal = palace(state);
  const raiderAtGates = state.monsters.find(m => m.mode === 'raid' && pal && Math.hypot(m.x - pal.x, m.y - pal.y) < 8 * TILE);
  if (raiderAtGates && !state.flags.some(f => f.defense) && state.gold > 140) {
    const f = placeFlag(state, 'attack', { x: raiderAtGates.x, y: raiderAtGates.y, targetId: raiderAtGates.id });
    if (f) { f.defense = true; boostFlag(state, f); boostFlag(state, f); }
  }
  // keep an attack flag on the weakest discovered lair
  const discovered = aliveLairs(state).filter(l => l.discovered);
  if (discovered.length && state.flags.length < 2 && state.gold > 200) {
    const target = discovered.sort((a, b) => a.maxHp - b.maxHp)[0];
    const f = placeFlag(state, 'attack', { x: target.x, y: target.y, targetId: target.id });
    if (f) for (let i = 0; i < 4; i++) boostFlag(state, f);
  }
  // boost stale flags
  for (const f of state.flags) {
    if ((f.responders || 0) === 0 && state.gold > 400 && state.tick % 300 === 0) boostFlag(state, f);
  }
  // explore flag early to find lairs
  if (state.tick === 600 && state.flags.length === 0) {
    const f = placeFlag(state, 'explore', { x: (MAP_W / 4) * TILE, y: (MAP_H / 4) * TILE });
    if (f) boostFlag(state, f);
  }
}

function findSpot(state, type, p) {
  // spiral out from palace
  for (let r = 3; r < 14; r++) {
    for (let a = 0; a < 16; a++) {
      const angle = (a / 16) * Math.PI * 2;
      const tx = Math.round(p.tx + Math.cos(angle) * r);
      const ty = Math.round(p.ty + Math.sin(angle) * r);
      if (tx > 1 && ty > 1 && tx < MAP_W - 2 && ty < MAP_H - 2 && canPlace(state, type, tx, ty)) return { tx, ty };
    }
  }
  return null;
}

// --- run ---
const totalTicks = minutes * 600;
const t0 = Date.now();
for (let i = 0; i < totalTicks; i++) {
  if (state.tick % 10 === 0) botAct(state);
  tick(state);
  state.events.length = 0; // headless does not consume events
  if (state.result) break;
}
const elapsed = Date.now() - t0;

// --- report ---
console.log(`\n=== majesty-clone headless run: seed ${seed}, ${minutes} min target, ${(elapsed / 1000).toFixed(1)}s wall ===`);
console.log('min | gold  | faucet | drain | tax  | heroes avgL | deaths kills | mons lairs | int');
for (const r of state.stats.minuteLog) {
  console.log(
    String(r.min).padStart(3) + ' | ' + String(r.gold).padStart(5) + ' | ' +
    String(r.faucets).padStart(6) + ' | ' + String(r.drains).padStart(5) + ' | ' +
    String(r.taxes).padStart(4) + ' | ' + String(r.heroes).padStart(6) + ' ' + String(r.avgLevel).padStart(4) + ' | ' +
    String(r.deaths).padStart(6) + ' ' + String(r.kills).padStart(5) + ' | ' +
    String(r.monsters).padStart(4) + ' ' + String(r.lairs).padStart(5) + ' | ' + r.intensity
  );
}
const last = state.stats.minuteLog.at(-1) || {};
console.log(`\nresult: ${state.result || 'timeout'} at min ${(state.tick / 600).toFixed(1)}`);
console.log(`heroes: ${state.heroes.length} alive, avg level ${last.avgLevel || 0}, ${state.stats.heroDeaths} deaths`);
console.log(`economy: treasury ${state.gold}, faucets ${state.stats.faucets}, drains ${state.stats.drains}, drain/faucet ${(state.stats.drains / Math.max(state.stats.faucets, 1)).toFixed(2)}`);
console.log(`lairs left: ${aliveLairs(state).length}/${state.lairs.length}, monster kills ${state.stats.monsterKills}`);
if (verbose) {
  for (const h of state.heroes) console.log(`  ${h.name} (${h.cls} L${h.level}, ${h.label}) hp ${Math.round(h.hp)}/${h.maxHp} gold ${h.gold} — ${h.intent}`);
}

// determinism self-check: same seed twice must match
const s2 = newGame(seed);
for (let i = 0; i < 3000; i++) { tick(s2); s2.events.length = 0; }
const s3 = newGame(seed);
for (let i = 0; i < 3000; i++) { tick(s3); s3.events.length = 0; }
const sig = s => JSON.stringify([s.tick, s.gold, s.rngState, s.monsters.length, s.heroes.length]);
console.log(`determinism: ${sig(s2) === sig(s3) ? 'OK' : 'BROKEN — ' + sig(s2) + ' vs ' + sig(s3)}`);
