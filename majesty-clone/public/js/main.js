// Boot, fixed-timestep loop (Fix Your Timestep), input, event->vfx wiring.

import { SIM_DT, TILE, BUILDINGS, ECON, CLASSES } from './sim/data.js';
import { newGame, addBuilding, canPlace, hireHero, txOf, dist } from './sim/world.js';
import { tick } from './sim/update.js';
import { placeFlag, boostFlag, removeFlag } from './sim/economy.js';
import { createRenderer } from './render/renderer.js';
import { createUI } from './ui/ui.js';
import { saveGame, loadGame, hasSave, clearSave } from './save.js';
import { createAudio } from './audio.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

const game = {
  state: null,
  view: { selected: null, mode: null, hoverTile: null, canPlaceHere: false },
  speed: 1,
  debug: DEBUG,
};

const vfx = [];
const inflowLog = []; // {tick, amount} — поступления в казну для индикатора «+N/мин»
function logInflow(state, amount) {
  if (amount > 0) inflowLog.push({ tick: state.tick, amount });
}
function incomeRate(state) {
  const horizon = 600; // 60 сим-секунд
  while (inflowLog.length && inflowLog[0].tick < state.tick - horizon) inflowLog.shift();
  const sum = inflowLog.reduce((s, e) => s + e.amount, 0);
  const span = Math.min(state.tick, horizon) || 1;
  return Math.round(sum * (600 / span));
}
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
    if (h) ui.chronicle(`⚔ ${h.name} — ${CLASSES[h.cls].label} — на службе (${h.label})`, 'good');
  },
  flagOn(target) {
    const f = placeFlag(game.state, 'attack', { x: target.x, y: target.y, targetId: target.id });
    if (f) game.view.selected = { kind: 'flag', id: f.id };
  },
  boost(f) { boostFlag(game.state, f); },
  unflag(f) { removeFlag(game.state, f); },
};

const audio = createAudio();
window.__audio = audio;

// громкость по положению события: на экране — полная, за экраном — приглушённо/тихо
function sfxVol(e, base = 1, offscreenFactor = 0) {
  if (e.x === undefined) return base;
  const s = renderer.worldToScreen(e.x, e.y);
  const { vw, vh } = renderer.viewSize;
  const onscreen = s.x > -80 && s.x < vw + 80 && s.y > -80 && s.y < vh + 80;
  return onscreen ? base : base * offscreenFactor;
}

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
  inflowLog.length = 0;
  game.hintedMarket = false;
  renderer.prerender(game.state);
  renderer.camera.x = 32 * TILE; renderer.camera.y = 32 * TILE; renderer.camera.zoom = 1;
  if (!loaded && !localStorage.getItem('majesty-clone-helped')) {
    ui.showHelp();
    try { localStorage.setItem('majesty-clone-helped', '1'); } catch { /* ignore */ }
  }
  if (loaded) ui.toast('Летопись восстановлена.');
}
boot(((Math.random() * 1e9) | 0) >>> 0);

// ---------- sim events -> vfx + chronicle ----------

function consumeEvents(state) {
  for (const e of state.events) {
    switch (e.t) {
      case 'hit':
        audio.play(e.cls === 'wizard' ? 'hit_magic' : e.ranged ? 'hit_ranged' : 'hit_melee', sfxVol(e, 0.45));
        if (e.ranged) {
          const from = state.heroes.find(h => h.id === e.from) || state.buildings.find(b => b.id === e.from);
          if (from) vfx.push({ kind: 'arrow', x: from.x, y: from.y - 8, x2: e.x, y2: e.y, color: e.cls === 'wizard' ? '#7d8fe0' : '#7a6a4f', t0: performance.now(), dur: 130 });
        }
        vfx.push({ kind: 'text', text: `-${Math.round(e.dmg)}`, x: e.x + (Math.random() - 0.5) * 10, y: e.y - 8, color: '#e8e0c8', t0: performance.now(), dur: 600 });
        break;
      case 'death':
        audio.play('monster_death', sfxVol(e, 0.55));
        vfx.push({ kind: 'flash', x: e.x, y: e.y, color: '#8d2f23', t0: performance.now(), dur: 400 });
        break;
      case 'hero-death':
        audio.play('hero_death', sfxVol(e, 0.9, 0.5));
        vfx.push({ kind: 'text', text: `☠ ${e.name}`, x: e.x, y: e.y - 10, color: '#d65b4a', big: true, t0: performance.now(), dur: 1600 });
        ui.chronicle(`☠ ${e.name} пал в бою`, 'bad');
        break;
      case 'levelup':
        audio.play('levelup', sfxVol(e, 0.6, 0.25));
        vfx.push({ kind: 'text', text: `✦ Уровень ${e.level}`, x: e.x, y: e.y - 18, color: '#e9c95a', big: true, t0: performance.now(), dur: 1300 });
        break;
      case 'bounty':
      case 'pickup':
        audio.play('coin', sfxVol(e, 0.5));
        vfx.push({ kind: 'text', text: `+${e.amount} зол.`, x: e.x, y: e.y - 12, color: '#e9c95a', t0: performance.now(), dur: 900 });
        break;
      case 'purchase': {
        logInflow(state, e.tax);
        audio.play(e.item === 'potion' ? 'potion' : 'anvil', sfxVol(e, 0.7, 0.2));
        // покупка должна быть видна: герой реально проапгрейдился
        const labels = { weapon: '⚔ новое оружие!', armor: '🛡 новая броня!', potion: '🧪 зелье' };
        vfx.push({ kind: 'text', text: labels[e.item] || 'покупка', x: e.x, y: e.y - 14, color: '#e9c95a', big: e.item !== 'potion', t0: performance.now(), dur: 1500 });
        vfx.push({ kind: 'text', text: `налог +${e.tax} зол.`, x: e.x, y: e.y - 30, color: '#b8d178', t0: performance.now(), dur: 1000 });
        if (e.item !== 'potion') ui.chronicle(`${labels[e.item]} ${e.name} потратился в кузнице (${e.price} зол.)`, 'good');
        break;
      }
      case 'dues':
        logInflow(state, e.amount);
        audio.play('coin', sfxVol(e, 0.35));
        vfx.push({ kind: 'text', text: `десятина +${e.amount} зол.`, x: e.x, y: e.y - 22, color: '#b8d178', t0: performance.now(), dur: 1100 });
        break;
      case 'income':
        logInflow(state, e.amount);
        vfx.push({ kind: 'text', text: `+${e.amount}`, x: e.x, y: e.y - 16, color: 'rgba(233,201,90,0.75)', t0: performance.now(), dur: 900 });
        break;
      case 'discover':
        audio.play('discover', 0.65);
        ui.chronicle(`🗺 Разведчики доносят: обнаружено — ${e.label}!`, 'warn');
        break;
      case 'lair-down':
        audio.play('lair_down', 0.95);
        vfx.push({ kind: 'text', text: `⚑ ${e.label} — уничтожено!`, x: e.x, y: e.y - 16, color: '#e9c95a', big: true, t0: performance.now(), dur: 2200 });
        ui.chronicle(`⚑ ${e.label} — уничтожено!`, 'good');
        break;
      case 'wave':
        if (e.size >= 3) audio.play('wave', 0.7);
        if (e.size >= 3) ui.chronicle(`⚠ К королевству идёт отряд (${e.size})`, 'bad');
        break;
      case 'building-down':
        audio.play('lair_down', 0.6);
        ui.chronicle(`🔥 ${BUILDINGS[e.type].label}: здание разрушено`, 'bad');
        vfx.push({ kind: 'flash', x: e.x, y: e.y, color: '#d4742c', t0: performance.now(), dur: 700 });
        break;
      case 'flag':
        audio.play('flag', 0.7);
        break;
      case 'revive':
        audio.play('hire', 0.65);
        break;
      case 'decline':
        vfx.push({ kind: 'text', text: 'не стоит того…', x: e.x, y: e.y - 16, color: '#d8c9a3', t0: performance.now(), dur: 1300 });
        break;
      case 'hire':
        audio.play('hire', 0.75);
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

let resultPlayed = false;

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
  // one-time nudge: economy needs a market (the most common "slow economy" mistake)
  if (!game.hintedMarket && game.state.tick > 900 && !game.state.result
    && !game.state.buildings.some(b => b.type === 'market')) {
    game.hintedMarket = true;
    ui.chronicle('💡 Казна растёт медленно: постройте Рынок и Дома — это основа дохода', 'warn');
  }
  // autosave every 30 sim-seconds
  if (game.state.tick - lastAutosave > 300 && !game.state.result) {
    lastAutosave = game.state.tick;
    saveGame(game.state);
  }
  if (game.state.result && !resultPlayed) { resultPlayed = true; audio.play(game.state.result === 'win' ? 'win' : 'lose', 1); }
  if (!game.state.result) resultPlayed = false;
  game.incomeRate = incomeRate(game.state);
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

// ---------- audio unlock + UI clicks ----------

const unlockOnce = () => { audio.unlock(); };
window.addEventListener('pointerdown', unlockOnce, { once: false });
window.addEventListener('keydown', unlockOnce, { once: false });
document.getElementById('overlay').addEventListener('click', e => {
  if (e.target.closest('button')) audio.play('click', 0.4);
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
  if (e.key === '4') game.speed = 8;
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
      if (b) { audio.play('build', 0.8); ui.chronicle(`🏗 ${BUILDINGS[type].label}: построено`, 'good'); }
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
