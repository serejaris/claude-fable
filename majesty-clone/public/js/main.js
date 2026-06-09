// Boot, fixed-timestep loop (Fix Your Timestep), input, event->vfx wiring.

import { SIM_DT, TILE, BUILDINGS, ECON, CLASSES } from './sim/data.js';
import { newGame, addBuilding, canPlace, hireHero, txOf, dist } from './sim/world.js';
import { tick } from './sim/update.js';
import { placeFlag, boostFlag, removeFlag } from './sim/economy.js';
import { createRenderer } from './render/renderer.js';
import { createUI } from './ui/ui.js';
import { saveGame, loadGame, hasSave, clearSave } from './save.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

const game = {
  state: null,
  view: { selected: null, mode: null, hoverTile: null, canPlaceHere: false },
  speed: 1,
  debug: DEBUG,
};

const vfx = [];
const renderer = createRenderer($('terrain'), $('entities'), $('effects'));
function $(id) { return document.getElementById(id); }

const actions = {
  setMode(m) { game.view.mode = m; },
  setSpeed(s) { game.speed = s; },
  save() { saveGame(game.state); },
  newGame() {
    clearSave();
    boot(((Math.random() * 1e9) | 0) >>> 0, true);
  },
  hire(guild) {
    const h = hireHero(game.state, guild);
    if (h) ui.chronicle(`⚔ ${h.name} the ${CLASSES[h.cls].label} joins (${h.label})`, 'good');
  },
  flagOn(target) {
    const f = placeFlag(game.state, 'attack', { x: target.x, y: target.y, targetId: target.id });
    if (f) game.view.selected = { kind: 'flag', id: f.id };
  },
  boost(f) { boostFlag(game.state, f); },
  unflag(f) { removeFlag(game.state, f); },
};

const ui = createUI(game, actions);
window.__game = game; // debug/playtest handle
window.__actions = actions;

let lastAutosave = 0;

function boot(seed, fresh = false) {
  const loaded = !fresh && hasSave() ? loadGame() : null;
  game.state = loaded || newGame(seed);
  game.state._debugAI = DEBUG;
  game.view.selected = null;
  game.view.mode = null;
  lastAutosave = 0;
  renderer.prerender(game.state);
  renderer.camera.x = 32 * TILE; renderer.camera.y = 32 * TILE; renderer.camera.zoom = 1;
  if (!loaded && !localStorage.getItem('majesty-clone-helped')) {
    ui.showHelp();
    try { localStorage.setItem('majesty-clone-helped', '1'); } catch { /* ignore */ }
  }
  if (loaded) ui.toast('Chronicle restored.');
}
boot(((Math.random() * 1e9) | 0) >>> 0);

// ---------- sim events -> vfx + chronicle ----------

function consumeEvents(state) {
  for (const e of state.events) {
    switch (e.t) {
      case 'hit':
        if (e.ranged) {
          const from = state.heroes.find(h => h.id === e.from) || state.buildings.find(b => b.id === e.from);
          if (from) vfx.push({ kind: 'arrow', x: from.x, y: from.y - 8, x2: e.x, y2: e.y, color: e.cls === 'wizard' ? '#7d8fe0' : '#7a6a4f', t0: performance.now(), dur: 130 });
        }
        vfx.push({ kind: 'text', text: `-${Math.round(e.dmg)}`, x: e.x + (Math.random() - 0.5) * 10, y: e.y - 8, color: '#e8e0c8', t0: performance.now(), dur: 600 });
        break;
      case 'death':
        vfx.push({ kind: 'flash', x: e.x, y: e.y, color: '#8d2f23', t0: performance.now(), dur: 400 });
        break;
      case 'hero-death':
        vfx.push({ kind: 'text', text: `☠ ${e.name}`, x: e.x, y: e.y - 10, color: '#d65b4a', big: true, t0: performance.now(), dur: 1600 });
        ui.chronicle(`☠ ${e.name} has fallen`, 'bad');
        break;
      case 'levelup':
        vfx.push({ kind: 'text', text: `✦ Level ${e.level}`, x: e.x, y: e.y - 18, color: '#e9c95a', big: true, t0: performance.now(), dur: 1300 });
        break;
      case 'bounty':
      case 'pickup':
        vfx.push({ kind: 'text', text: `+${e.amount}g`, x: e.x, y: e.y - 12, color: '#e9c95a', t0: performance.now(), dur: 900 });
        break;
      case 'purchase':
        vfx.push({ kind: 'text', text: `tax +${e.tax}g`, x: e.x, y: e.y - 20, color: '#b8d178', t0: performance.now(), dur: 1000 });
        break;
      case 'dues':
        vfx.push({ kind: 'text', text: `dues +${e.amount}g`, x: e.x, y: e.y - 22, color: '#b8d178', t0: performance.now(), dur: 1100 });
        break;
      case 'income':
        if (Math.random() < 0.3) vfx.push({ kind: 'text', text: `+${e.amount}g`, x: e.x, y: e.y - 16, color: 'rgba(233,201,90,0.7)', t0: performance.now(), dur: 800 });
        break;
      case 'discover':
        ui.chronicle(`🗺 Scouts report: ${e.label} discovered!`, 'warn');
        break;
      case 'lair-down':
        vfx.push({ kind: 'text', text: `⚑ ${e.label} destroyed!`, x: e.x, y: e.y - 16, color: '#e9c95a', big: true, t0: performance.now(), dur: 2200 });
        ui.chronicle(`⚑ ${e.label} destroyed!`, 'good');
        break;
      case 'wave':
        if (e.size >= 3) ui.chronicle(`⚠ A warband approaches (${e.size})`, 'bad');
        break;
      case 'building-down':
        ui.chronicle(`🔥 ${BUILDINGS[e.type].label} destroyed`, 'bad');
        vfx.push({ kind: 'flash', x: e.x, y: e.y, color: '#d4742c', t0: performance.now(), dur: 700 });
        break;
      case 'decline':
        vfx.push({ kind: 'text', text: 'not worth it…', x: e.x, y: e.y - 16, color: '#d8c9a3', t0: performance.now(), dur: 1300 });
        break;
      case 'hire':
        break;
      case 'relax':
        break;
    }
  }
  state.events.length = 0;
}

// ---------- game loop ----------

let last = performance.now();
let acc = 0;

function frame(now) {
  let dt = Math.min(now - last, 250); // clamp: no spiral of death
  last = now;
  acc += dt * game.speed;
  let steps = 0;
  while (acc >= SIM_DT * 1000 && steps < 30) {
    tick(game.state);
    consumeEvents(game.state);
    steps++;
    acc -= SIM_DT * 1000;
  }
  // autosave every 30 sim-seconds
  if (game.state.tick - lastAutosave > 300 && !game.state.result) {
    lastAutosave = game.state.tick;
    saveGame(game.state);
  }
  const alpha = Math.min(acc / (SIM_DT * 1000), 1);
  updateHover();
  renderer.draw(game.state, alpha, game.view, vfx);
  ui.update(game.state);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && !game.state.result) saveGame(game.state); // a finished game is not worth restoring
  last = performance.now();
});

// ---------- input ----------

const stage = $('effects'); // top canvas receives events
let dragging = false, dragMoved = false, dragStart = null, camStart = null;
let mouse = { x: 0, y: 0 };

stage.addEventListener('pointerdown', e => {
  dragging = true; dragMoved = false;
  dragStart = { x: e.clientX, y: e.clientY };
  camStart = { x: renderer.camera.x, y: renderer.camera.y };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', e => {
  mouse = { x: e.clientX, y: e.clientY };
  if (dragging) {
    const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) dragMoved = true;
    if (dragMoved) {
      renderer.camera.x = camStart.x - dx / renderer.camera.zoom;
      renderer.camera.y = camStart.y - dy / renderer.camera.zoom;
    }
  }
});
stage.addEventListener('pointerup', e => {
  dragging = false;
  if (dragMoved) return;
  handleClick(e.clientX, e.clientY);
});
stage.addEventListener('dblclick', e => {
  if (game.view.mode) return; // an armed tool owns the clicks — no surprise flags
  const w = renderer.screenToWorld(e.clientX, e.clientY);
  const hit = hitTest(w.x, w.y);
  if (hit && (hit.kind === 'monster' || hit.kind === 'lair')) actions.flagOn(hit.ref);
  else if (!hit) {
    const f = placeFlag(game.state, 'explore', { x: w.x, y: w.y });
    if (f) game.view.selected = { kind: 'flag', id: f.id };
  }
});
stage.addEventListener('wheel', e => {
  e.preventDefault();
  const z = renderer.camera.zoom * (e.deltaY > 0 ? 0.9 : 1.11);
  renderer.camera.zoom = Math.max(0.45, Math.min(2.2, z));
}, { passive: false });

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); game.speed = game.speed === 0 ? 1 : 0; }
  if (e.key === '1') game.speed = 1;
  if (e.key === '2') game.speed = 2;
  if (e.key === '3') game.speed = 4;
  if (e.key === 'Escape') { game.view.mode = null; game.view.selected = null; }
  const pan = 28 / renderer.camera.zoom;
  if (e.key === 'ArrowLeft' || e.key === 'a') renderer.camera.x -= pan;
  if (e.key === 'ArrowRight' || e.key === 'd') renderer.camera.x += pan;
  if (e.key === 'ArrowUp' || e.key === 'w') renderer.camera.y -= pan;
  if (e.key === 'ArrowDown' || e.key === 's') renderer.camera.y += pan;
});

function updateHover() {
  const w = renderer.screenToWorld(mouse.x, mouse.y);
  const tx = txOf(w.x), ty = txOf(w.y);
  game.view.hoverTile = { tx, ty };
  if (game.view.mode && game.view.mode.startsWith('build:')) {
    game.view.canPlaceHere = canPlace(game.state, game.view.mode.slice(6), tx, ty);
  }
}

function handleClick(sx, sy) {
  const state = game.state;
  const w = renderer.screenToWorld(sx, sy);
  const mode = game.view.mode;

  if (mode && mode.startsWith('build:')) {
    const type = mode.slice(6);
    const tx = txOf(w.x), ty = txOf(w.y);
    if (canPlace(state, type, tx, ty) && state.gold >= BUILDINGS[type].cost) {
      const b = addBuilding(state, type, tx, ty);
      if (b) ui.chronicle(`🏗 ${BUILDINGS[type].label} built`, 'good');
      if (!BUILDINGS[type].max) game.view.mode = null;
    }
    return;
  }
  if (mode === 'flag:attack') {
    const hit = hitTest(w.x, w.y);
    if (hit && (hit.kind === 'monster' || hit.kind === 'lair')) {
      actions.flagOn(hit.ref);
      game.view.mode = null;
    }
    return;
  }
  if (mode === 'flag:explore') {
    const f = placeFlag(state, 'explore', { x: w.x, y: w.y });
    if (f) { game.view.selected = { kind: 'flag', id: f.id }; game.view.mode = null; }
    return;
  }

  const hit = hitTest(w.x, w.y);
  game.view.selected = hit ? { kind: hit.kind, id: hit.ref.id } : null;
}

function hitTest(wx, wy) {
  const state = game.state;
  const pt = { x: wx, y: wy };
  for (const f of state.flags) if (dist(pt, { x: f.x, y: f.y - 18 }) < 20) return { kind: 'flag', ref: f };
  for (const h of state.heroes) if (dist(pt, h) < 15) return { kind: 'hero', ref: h };
  for (const m of state.monsters) {
    if (state._cache && state._cache.visMonsters.has(m.id) && dist(pt, m) < 14) return { kind: 'monster', ref: m };
  }
  for (const l of state.lairs) if (l.discovered && l.hp > 0 && dist(pt, l) < 22) return { kind: 'lair', ref: l };
  for (const b of state.buildings) {
    const def = BUILDINGS[b.type];
    if (wx >= b.tx * TILE - 2 && wx <= (b.tx + def.w) * TILE + 2 && wy >= b.ty * TILE - 10 && wy <= (b.ty + def.h) * TILE + 2)
      return { kind: 'building', ref: b };
  }
  return null;
}
