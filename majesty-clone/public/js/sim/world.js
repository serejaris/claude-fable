// Map generation, passability, A* pathfinding, fog of war, visibility, entity factories.
// Pure data + free functions. No DOM. state._cache holds transient (non-serialized) data.

import { TILE, MAP_W, MAP_H, CLASSES, MONSTERS, BUILDINGS, LAIR_TYPES, ECON,
  monsterHp, START_GOLD, XP } from './data.js';
import { rand, randRange, randInt, pick, gaussian, clamp } from './rng.js';
import { heroName, traitLabel } from './names.js';

export const T_GRASS = 0, T_TREE = 1, T_ROCK = 2;

export const tileAt = (state, tx, ty) =>
  (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) ? T_ROCK : state.tiles[ty * MAP_W + tx];

export function isPassable(state, tx, ty) {
  if (tileAt(state, tx, ty) !== T_GRASS) return false;
  return !blockedByBuilding(state, tx, ty);
}

function blockedByBuilding(state, tx, ty) {
  const key = ty * MAP_W + tx;
  return cache(state).buildGrid.has(key);
}

export function cache(state) {
  if (!state._cache) state._cache = { buildGrid: new Map(), visMonsters: new Set(), visTick: -1 };
  return state._cache;
}

export function rebuildBuildGrid(state) {
  const g = cache(state).buildGrid;
  g.clear();
  for (const b of state.buildings) {
    const def = BUILDINGS[b.type];
    for (let dy = 0; dy < def.h; dy++)
      for (let dx = 0; dx < def.w; dx++)
        g.set((b.ty + dy) * MAP_W + (b.tx + dx), b.id);
  }
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const txOf = px => Math.floor(px / TILE);
export const centerOf = (tx, ty) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });

// ---------- map generation ----------

export function newGame(seed) {
  const state = {
    version: 1, seed, rngState: seed >>> 0, tick: 0,
    gold: START_GOLD, nextId: 1,
    tiles: new Array(MAP_W * MAP_H).fill(T_GRASS),
    fog: new Array(MAP_W * MAP_H).fill(0), // 0 unexplored, 1 explored
    buildings: [], heroes: [], monsters: [], lairs: [], flags: [], goldPiles: [], graves: [],
    director: { nextWaveAt: 75, intensity: 0, relaxUntil: 0, wave: 0 },
    stats: { faucets: 0, drains: 0, heroDeaths: 0, monsterKills: 0, taxes: 0, minuteLog: [] },
    result: null, // 'win' | 'lose'
    events: [],   // transient feed for UI/effects, trimmed each tick
  };

  // scatter tree clusters, keep center clear
  const cx = MAP_W / 2, cy = MAP_H / 2;
  for (let i = 0; i < 38; i++) {
    const tx = randInt(state, 2, MAP_W - 3), ty = randInt(state, 2, MAP_H - 3);
    if (Math.hypot(tx - cx, ty - cy) < 9) continue;
    const size = randInt(state, 1, 4);
    for (let j = 0; j < size * 2; j++) {
      const ox = tx + randInt(state, -2, 2), oy = ty + randInt(state, -2, 2);
      if (ox > 0 && oy > 0 && ox < MAP_W - 1 && oy < MAP_H - 1 && Math.hypot(ox - cx, oy - cy) >= 9)
        state.tiles[oy * MAP_W + ox] = rand(state) < 0.85 ? T_TREE : T_ROCK;
    }
  }

  // palace at center
  addBuilding(state, 'palace', Math.floor(cx) - 1, Math.floor(cy) - 1, true);

  // lairs ringed around the map at increasing difficulty, angle-spread
  const baseAngle = randRange(state, 0, Math.PI * 2);
  LAIR_TYPES.forEach((lt, i) => {
    const angle = baseAngle + (i / LAIR_TYPES.length) * Math.PI * 2 + randRange(state, -0.25, 0.25);
    const r = 19 + (MONSTERS[lt.mon].level >= 6 ? 8 : i * 1.3) + randRange(state, 0, 2);
    let tx = Math.round(cx + Math.cos(angle) * r), ty = Math.round(cy + Math.sin(angle) * r);
    tx = clamp(tx, 2, MAP_W - 3); ty = clamp(ty, 2, MAP_H - 3);
    clearArea(state, tx, ty, 2);
    const c = centerOf(tx, ty);
    state.lairs.push({
      id: state.nextId++, kind: 'lair', type: lt.mon, label: lt.label,
      tx, ty, x: c.x, y: c.y, hp: lt.hp, maxHp: lt.hp, cap: lt.cap,
      bornTick: 0, nextGuardAt: 0, discovered: false,
    });
  });

  rebuildBuildGrid(state);
  revealAround(state, Math.floor(cx), Math.floor(cy), 10);
  return state;
}

function clearArea(state, tx, ty, r) {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const x = tx + dx, y = ty + dy;
      if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) state.tiles[y * MAP_W + x] = T_GRASS;
    }
}

// ---------- factories ----------

export function addBuilding(state, type, tx, ty, free = false) {
  const def = BUILDINGS[type];
  if (!free) {
    if (state.gold < def.cost) return null;
    state.gold -= def.cost;
    state.stats.drains += def.cost;
  }
  const c = centerOf(tx, ty);
  const b = {
    id: state.nextId++, kind: 'building', type, tx, ty,
    x: tx * TILE + def.w * TILE / 2, y: ty * TILE + def.h * TILE / 2,
    hp: def.hp, maxHp: def.hp, incomeAt: 0,
  };
  state.buildings.push(b);
  rebuildBuildGrid(state);
  revealAround(state, tx, ty, def.sight);
  return b;
}

export function canPlace(state, type, tx, ty) {
  const def = BUILDINGS[type];
  if (def.max && state.buildings.filter(b => b.type === type).length >= def.max) return false;
  for (let dy = 0; dy < def.h; dy++)
    for (let dx = 0; dx < def.w; dx++) {
      const x = tx + dx, y = ty + dy;
      if (tileAt(state, x, y) !== T_GRASS || blockedByBuilding(state, x, y)) return false;
      for (const l of state.lairs) if (Math.hypot(l.tx - x, l.ty - y) < 4) return false;
    }
  // must be near existing kingdom (within 8 tiles of another building)
  return state.buildings.some(b => Math.hypot(b.tx - tx, b.ty - ty) <= 8);
}

export function hireHero(state, guild) {
  const clsKey = BUILDINGS[guild.type].hires;
  const cls = CLASSES[clsKey];
  const roster = state.heroes.filter(h => h.home === guild.id).length
    + state.graves.filter(g => g.home === guild.id).length;
  if (roster >= BUILDINGS[guild.type].cap || state.gold < cls.cost) return null;
  state.gold -= cls.cost;
  state.stats.drains += cls.cost;
  const traits = {
    courage: clamp(gaussian(state, cls.traits.courage, 0.15), 0.05, 0.95),
    greed: clamp(gaussian(state, cls.traits.greed, 0.15), 0.05, 0.95),
    diligence: clamp(gaussian(state, cls.traits.diligence, 0.15), 0.05, 0.95),
  };
  const h = {
    id: state.nextId++, kind: 'hero', cls: clsKey,
    name: heroName(state), label: traitLabel(traits, cls.traits),
    level: 1, xp: 0, hp: cls.hp(1), maxHp: cls.hp(1),
    x: guild.x + randRange(state, -10, 10), y: guild.y + TILE,
    prevX: guild.x, prevY: guild.y,
    gold: ECON.heroStartGold, potions: 0, weaponTier: 0, armorTier: 0,
    traits, home: guild.id, intent: 'reporting for duty',
    action: null, thinkAt: state.tick + randInt(state, 0, 10),
    atkAt: 0, ignore: {}, kills: 0,
  };
  state.heroes.push(h);
  state.events.push({ t: 'hire', id: h.id });
  return h;
}

export function spawnMonster(state, type, x, y, level = null, mode = 'guard', lairId = null) {
  const def = MONSTERS[type];
  const L = level ?? def.level;
  const m = {
    id: state.nextId++, kind: 'monster', type, level: L,
    hp: monsterHp(L), maxHp: monsterHp(L),
    x, y, prevX: x, prevY: y, mode, lairId,
    atkAt: 0, targetId: null, wanderAt: 0, damagers: [],
  };
  state.monsters.push(m);
  return m;
}

// ---------- fog & visibility ----------

export function revealAround(state, tx, ty, r) {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = tx + dx, y = ty + dy;
      if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && !state.fog[y * MAP_W + x]) {
        state.fog[y * MAP_W + x] = 1;
        state._fogStamp = (state._fogStamp || 0) + 1; // renderer redraws dirty tiles on change
        (state._fogDirty || (state._fogDirty = [])).push(y * MAP_W + x);
      }
    }
}

export const isExplored = (state, tx, ty) =>
  tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H && state.fog[ty * MAP_W + tx] === 1;

// recompute which monsters are currently seen by the kingdom (heroes + buildings)
export function updateVisibility(state) {
  const c = cache(state);
  if (c.visTick === state.tick) return;
  c.visTick = state.tick;
  c.visMonsters.clear();
  const watchers = [];
  for (const h of state.heroes) watchers.push({ x: h.x, y: h.y, r: CLASSES[h.cls].sight * TILE });
  for (const b of state.buildings) watchers.push({ x: b.x, y: b.y, r: BUILDINGS[b.type].sight * TILE });
  for (const m of state.monsters) {
    for (const w of watchers) {
      if (Math.hypot(m.x - w.x, m.y - w.y) <= w.r) { c.visMonsters.add(m.id); break; }
    }
  }
  // heroes reveal fog and discover lairs
  for (const h of state.heroes) {
    revealAround(state, txOf(h.x), txOf(h.y), CLASSES[h.cls].sight);
  }
  for (const l of state.lairs) {
    if (!l.discovered && isExplored(state, l.tx, l.ty)) {
      l.discovered = true;
      state.events.push({ t: 'discover', id: l.id, label: l.label });
    }
  }
}

export const isMonsterVisible = (state, m) => cache(state).visMonsters.has(m.id);

// ---------- A* pathfinding (tile grid) ----------

export function findPath(state, fromX, fromY, toX, toY) {
  const sx = txOf(fromX), sy = txOf(fromY);
  let gx = txOf(toX), gy = txOf(toY);
  if (sx === gx && sy === gy) return [{ x: toX, y: toY }];
  // if goal blocked, find nearest passable neighbor
  if (!isPassable(state, gx, gy)) {
    let found = null;
    outer: for (let r = 1; r <= 3; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
          if (isPassable(state, gx + dx, gy + dy)) { found = [gx + dx, gy + dy]; break outer; }
    if (!found) return null;
    [gx, gy] = found;
  }
  const open = [{ x: sx, y: sy, g: 0, f: 0, parent: null }];
  const seen = new Map([[sy * MAP_W + sx, 0]]);
  let iterations = 0;
  while (open.length && iterations++ < 1800) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.x === gx && cur.y === gy) {
      const path = [];
      for (let n = cur; n; n = n.parent) path.push(centerOf(n.x, n.y));
      path.reverse();
      path.shift(); // current tile
      smoothPath(state, path, fromX, fromY);
      if (path.length === 0) path.push(centerOf(gx, gy));
      return path;
    }
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!isPassable(state, nx, ny)) continue;
      if (dx && dy && (!isPassable(state, cur.x + dx, cur.y) || !isPassable(state, cur.x, cur.y + dy))) continue;
      const g = cur.g + (dx && dy ? 1.414 : 1);
      const key = ny * MAP_W + nx;
      if (seen.has(key) && seen.get(key) <= g) continue;
      seen.set(key, g);
      open.push({ x: nx, y: ny, g, f: g + Math.hypot(gx - nx, gy - ny), parent: cur });
    }
  }
  return null; // unreachable or budget exceeded
}

function smoothPath(state, path, fromX, fromY) {
  // drop intermediate waypoints with line of sight
  let i = 0;
  let px = fromX, py = fromY;
  while (i < path.length - 1) {
    if (hasLOS(state, px, py, path[i + 1].x, path[i + 1].y)) path.splice(i, 1);
    else { px = path[i].x; py = path[i].y; i++; }
  }
}

export function hasLOS(state, x0, y0, x1, y1) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (TILE / 2));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (!isPassable(state, txOf(x0 + (x1 - x0) * t), txOf(y0 + (y1 - y0) * t))) return false;
  }
  return true;
}

// move entity along its path; returns true when path finished. Tracks stuck-ness.
export function moveAlong(state, e, path, speed, dt) {
  if (!path || path.length === 0) return true;
  const wp = path[0];
  const d = Math.hypot(wp.x - e.x, wp.y - e.y);
  const step = speed * dt;
  if (d <= step) {
    e.x = wp.x; e.y = wp.y;
    path.shift();
    return path.length === 0;
  }
  e.x += ((wp.x - e.x) / d) * step;
  e.y += ((wp.y - e.y) / d) * step;
  return false;
}

// effective combat power for threat estimates: power = HP * DPS
export function heroPower(h) {
  const cls = CLASSES[h.cls];
  const dmg = cls.dmg(h.level) * (1 + ECON.weaponBonus * h.weaponTier);
  return h.hp * (dmg / cls.atkCd);
}

export function monsterPower(m) {
  const dmg = monsterDmgOf(m);
  return m.hp * (dmg / MONSTER_ATK_CD_LOCAL);
}

// local re-exports to avoid circular import noise
import { monsterDmg as _mDmg, MONSTER_ATK_CD as MONSTER_ATK_CD_LOCAL } from './data.js';
export const monsterDmgOf = m => _mDmg(m.level);

export const aliveLairs = state => state.lairs.filter(l => l.hp > 0);
export const palace = state => state.buildings.find(b => b.type === 'palace');
