// Monster behavior: guard near lair, raid the kingdom, aggro what's in sight.

import { MONSTERS, MONSTER_SIGHT, MONSTER_ATK_CD, TILE, SIM_DT, monsterDmg, DIRECTOR } from './data.js';
import { rand, randRange } from './rng.js';
import { dist, findPath, moveAlong, palace, isPassable, txOf } from './world.js';
import { monsterAttack } from './combat.js';

export function updateMonsters(state) {
  const now = state.tick * SIM_DT;
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    m.prevX = m.x; m.prevY = m.y;
    const def = MONSTERS[m.type];
    if (def.regen) m.hp = Math.min(m.maxHp, m.hp + def.regen * SIM_DT);

    // acquire target: nearest hero in sight; raiders also target buildings.
    // Guards are leashed to their lair so heroes can disengage from failed assaults.
    let target = acquireTarget(state, m);
    if (target && m.mode === 'guard') {
      const lair = state.lairs.find(l => l.id === m.lairId);
      if (lair && Math.hypot(m.x - lair.x, m.y - lair.y) > DIRECTOR.guardLeash * TILE) target = null;
    }
    m.targetId = target ? target.id : null;

    if (target) {
      const d = dist(m, target);
      const range = target.kind === 'building' ? 34 : 26;
      if (d <= range) {
        if (now >= m.atkAt) {
          m.atkAt = now + MONSTER_ATK_CD;
          monsterAttack(state, m, target, monsterDmg(m.level));
        }
      } else {
        chase(state, m, target, def.speed);
      }
      continue;
    }

    if (m.mode === 'raid') {
      const p = palace(state);
      if (p) chase(state, m, p, def.speed * 0.9);
      continue;
    }

    // leashed guard far from home: walk back
    if (m.mode === 'guard') {
      const lair = state.lairs.find(l => l.id === m.lairId);
      if (lair && Math.hypot(m.x - lair.x, m.y - lair.y) > DIRECTOR.guardLeash * TILE) {
        chase(state, m, lair, def.speed * 0.8);
        continue;
      }
    }

    // guard: wander near lair
    if (now >= m.wanderAt) {
      m.wanderAt = now + randRange(state, 2, 6);
      const lair = state.lairs.find(l => l.id === m.lairId);
      const cx = lair ? lair.x : m.x, cy = lair ? lair.y : m.y;
      m.wanderX = cx + randRange(state, -3 * TILE, 3 * TILE);
      m.wanderY = cy + randRange(state, -3 * TILE, 3 * TILE);
    }
    if (m.wanderX !== undefined) {
      const d = Math.hypot(m.wanderX - m.x, m.wanderY - m.y);
      if (d > 4) stepIfPassable(state, m, (m.wanderX - m.x) / d, (m.wanderY - m.y) / d, def.speed * 0.5);
    }
  }
  // dead monsters cleanup
  state.monsters = state.monsters.filter(m => m.hp > 0);
}

function acquireTarget(state, m) {
  const sight = MONSTER_SIGHT * TILE * (m.mode === 'raid' ? 1.4 : 1);
  let best = null, bestD = Infinity;
  for (const h of state.heroes) {
    if (h.hp <= 0) continue;
    const d = dist(m, h);
    if (d < sight && d < bestD) { best = h; bestD = d; }
  }
  if (m.mode === 'raid') {
    for (const b of state.buildings) {
      const d = dist(m, b);
      if (d < sight * 1.2 && d * 0.7 < bestD) { best = b; bestD = d * 0.7; } // prefer buildings on raids
    }
  }
  return best;
}

function chase(state, m, target, speed) {
  // monsters use straight-line steering with simple path fallback
  if (!m._path || (state.tick % 20 === 0)) {
    const d = dist(m, target);
    if (d > TILE * 3) {
      m._path = findPath(state, m.x, m.y, target.x, target.y);
    } else m._path = null;
  }
  if (m._path && m._path.length) {
    moveAlong(state, m, m._path, speed, SIM_DT);
  } else {
    const d = dist(m, target);
    if (d > 1) stepIfPassable(state, m, (target.x - m.x) / d, (target.y - m.y) / d, speed);
  }
}

// straight-line steering respects terrain: no tunneling through trees/rocks/buildings.
// Buildings are attackable, so a blocked step against a building tile is fine to stop on.
function stepIfPassable(state, m, nx, ny, speed) {
  const px = m.x + nx * speed * SIM_DT, py = m.y + ny * speed * SIM_DT;
  if (isPassable(state, txOf(px), txOf(py))) { m.x = px; m.y = py; return; }
  // try sliding along one axis
  if (isPassable(state, txOf(px), txOf(m.y))) { m.x = px; return; }
  if (isPassable(state, txOf(m.x), txOf(py))) { m.y = py; }
}
