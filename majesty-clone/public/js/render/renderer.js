// Three stacked canvases: terrain (prerendered offscreen, fog as parchment),
// entities (redrawn each frame), effects (floating text, flashes).
// The world is a hand-drawn map that paints itself in as heroes explore.

import { TILE, MAP_W, MAP_H, CLASSES, MONSTERS, BUILDINGS } from '../sim/data.js';
import { T_GRASS, T_TREE, T_ROCK, isExplored } from '../sim/world.js';

const W_PX = MAP_W * TILE, H_PX = MAP_H * TILE;

export function createRenderer(terrainC, entityC, effectC) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const camera = { x: W_PX / 2, y: H_PX / 2, zoom: 1.0 };
  let fogVersion = -1;

  // offscreen: painted terrain (static) + parchment (static)
  const terrainOff = document.createElement('canvas');
  terrainOff.width = W_PX; terrainOff.height = H_PX;
  const parchOff = document.createElement('canvas');
  parchOff.width = W_PX; parchOff.height = H_PX;
  // composed = parchment with explored holes filled by terrain
  const composedOff = document.createElement('canvas');
  composedOff.width = W_PX; composedOff.height = H_PX;

  let vw = 0, vh = 0;

  function resize() {
    vw = terrainC.clientWidth; vh = terrainC.clientHeight;
    for (const c of [terrainC, entityC, effectC]) {
      c.width = Math.round(vw * dpr); c.height = Math.round(vh * dpr);
    }
  }
  window.addEventListener('resize', () => { resize(); });
  resize();

  // ---------- static prerenders ----------

  function prerender(state, rngSeed = 7) {
    let r = rngSeed;
    const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;

    // parchment: warm blank map with faint hatching
    const p = parchOff.getContext('2d');
    p.fillStyle = '#d8c9a3';
    p.fillRect(0, 0, W_PX, H_PX);
    for (let i = 0; i < 9000; i++) {
      p.fillStyle = `rgba(${120 + rnd() * 60 | 0},${100 + rnd() * 50 | 0},60,${0.03 + rnd() * 0.05})`;
      p.fillRect(rnd() * W_PX, rnd() * H_PX, 2 + rnd() * 5, 1 + rnd() * 3);
    }
    p.strokeStyle = 'rgba(110,85,50,0.10)';
    p.lineWidth = 1;
    for (let i = 0; i < 220; i++) {
      const x = rnd() * W_PX, y = rnd() * H_PX, len = 18 + rnd() * 50;
      p.beginPath(); p.moveTo(x, y); p.lineTo(x + len, y + (rnd() - 0.5) * 10); p.stroke();
    }

    // terrain painting
    const t = terrainOff.getContext('2d');
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const tile = state.tiles[ty * MAP_W + tx];
        const x = tx * TILE, y = ty * TILE;
        const v = rnd();
        if (tile === T_GRASS) {
          t.fillStyle = ['#7a9456', '#74904f', '#80995c', '#6f8b4c'][(v * 4) | 0];
          t.fillRect(x, y, TILE, TILE);
          if (v > 0.75) { t.fillStyle = 'rgba(60,80,35,0.35)'; t.fillRect(x + v * 20, y + v * 16, 3, 2); }
          if (v < 0.12) { t.fillStyle = 'rgba(220,225,190,0.3)'; t.fillRect(x + 8 + v * 80, y + 12, 2, 2); }
        } else if (tile === T_TREE) {
          t.fillStyle = '#5d7a44';
          t.fillRect(x, y, TILE, TILE);
          // little painted tree
          t.fillStyle = '#3c5530';
          t.beginPath(); t.arc(x + 16, y + 14, 9 + v * 3, 0, 7); t.fill();
          t.fillStyle = '#2e4425';
          t.beginPath(); t.arc(x + 16 + (v - 0.5) * 6, y + 11, 6, 0, 7); t.fill();
          t.fillStyle = '#5a4630';
          t.fillRect(x + 14, y + 20, 4, 7);
        } else {
          t.fillStyle = '#8a8678';
          t.fillRect(x, y, TILE, TILE);
          t.fillStyle = '#6e6a5e';
          t.beginPath(); t.arc(x + 16, y + 16, 10, 0, 7); t.fill();
          t.fillStyle = '#7d7a6c';
          t.beginPath(); t.arc(x + 12, y + 12, 5, 0, 7); t.fill();
        }
      }
    }
    // soft grid wash
    t.strokeStyle = 'rgba(0,0,0,0.04)';
    for (let i = 0; i <= MAP_W; i++) { t.beginPath(); t.moveTo(i * TILE, 0); t.lineTo(i * TILE, H_PX); t.stroke(); }
    for (let i = 0; i <= MAP_H; i++) { t.beginPath(); t.moveTo(0, i * TILE); t.lineTo(W_PX, i * TILE); t.stroke(); }
    fogVersion = -1; // force compose
  }

  function composeFog(state) {
    const c = composedOff.getContext('2d');
    c.drawImage(parchOff, 0, 0);
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        if (state.fog[ty * MAP_W + tx]) drawFogTile(c, state, tx, ty, false);
      }
    }
    for (let ty = 0; ty < MAP_H; ty++)
      for (let tx = 0; tx < MAP_W; tx++)
        if (state.fog[ty * MAP_W + tx]) drawFogEdges(c, state, tx, ty);
    if (state._fogDirty) state._fogDirty.length = 0;
  }

  // incremental: redraw only newly revealed tiles (+ explored neighbors, to clear stale edges)
  function composeFogDirty(state) {
    const c = composedOff.getContext('2d');
    const dirty = state._fogDirty.splice(0);
    const touched = new Set();
    for (const idx of dirty) {
      const tx = idx % MAP_W, ty = (idx / MAP_W) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = tx + dx, y = ty + dy;
          if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && state.fog[y * MAP_W + x]) touched.add(y * MAP_W + x);
        }
    }
    for (const idx of touched) drawFogTile(c, state, idx % MAP_W, (idx / MAP_W) | 0, true);
    for (const idx of touched) drawFogEdges(c, state, idx % MAP_W, (idx / MAP_W) | 0);
  }

  function drawFogTile(c, state, tx, ty, clear) {
    if (clear) c.clearRect(tx * TILE, ty * TILE, TILE, TILE);
    c.drawImage(terrainOff, tx * TILE, ty * TILE, TILE, TILE, tx * TILE, ty * TILE, TILE, TILE);
  }

  function drawFogEdges(c, state, tx, ty) {
    c.strokeStyle = 'rgba(80,60,35,0.5)';
    c.lineWidth = 2;
    const x = tx * TILE, y = ty * TILE;
    if (ty > 0 && !state.fog[(ty - 1) * MAP_W + tx]) { c.beginPath(); c.moveTo(x, y); c.lineTo(x + TILE, y); c.stroke(); }
    if (ty < MAP_H - 1 && !state.fog[(ty + 1) * MAP_W + tx]) { c.beginPath(); c.moveTo(x, y + TILE); c.lineTo(x + TILE, y + TILE); c.stroke(); }
    if (tx > 0 && !state.fog[ty * MAP_W + tx - 1]) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + TILE); c.stroke(); }
    if (tx < MAP_W - 1 && !state.fog[ty * MAP_W + tx + 1]) { c.beginPath(); c.moveTo(x + TILE, y); c.lineTo(x + TILE, y + TILE); c.stroke(); }
  }

  // ---------- coordinate transforms ----------

  const screenToWorld = (sx, sy) => ({
    x: camera.x + (sx - vw / 2) / camera.zoom,
    y: camera.y + (sy - vh / 2) / camera.zoom,
  });
  const worldToScreen = (wx, wy) => ({
    x: (wx - camera.x) * camera.zoom + vw / 2,
    y: (wy - camera.y) * camera.zoom + vh / 2,
  });

  function clampCamera() {
    const hw = vw / 2 / camera.zoom, hh = vh / 2 / camera.zoom;
    camera.x = Math.max(hw - 100, Math.min(W_PX - hw + 100, camera.x));
    camera.y = Math.max(hh - 100, Math.min(H_PX - hh + 100, camera.y));
  }

  function applyCam(ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(vw / 2, vh / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
  }

  // ---------- per-frame draw ----------

  const lerp = (a, b, t) => a + (b - a) * t;

  function draw(state, alpha, view, vfx) {
    clampCamera();
    // fog redraw only when exploration changed; incremental when possible
    const fogSum = state._fogStamp ?? 0;
    if (fogVersion !== fogSum) {
      if (fogVersion === -1 || !state._fogDirty) composeFog(state);
      else composeFogDirty(state);
      fogVersion = fogSum;
    }

    const tc = terrainC.getContext('2d');
    tc.setTransform(1, 0, 0, 1, 0, 0);
    tc.clearRect(0, 0, terrainC.width, terrainC.height);
    applyCam(tc);
    tc.imageSmoothingEnabled = camera.zoom < 1;
    tc.drawImage(composedOff, 0, 0);

    const ec = entityC.getContext('2d');
    ec.setTransform(1, 0, 0, 1, 0, 0);
    ec.clearRect(0, 0, entityC.width, entityC.height);
    applyCam(ec);

    drawBuildings(ec, state, view);
    drawLairs(ec, state);
    drawGoldPiles(ec, state);
    drawFlags(ec, state);
    drawMonsters(ec, state, alpha);
    drawHeroes(ec, state, alpha, view);

    // placement ghost
    if (view.mode && view.mode.startsWith('build:') && view.hoverTile) {
      const type = view.mode.slice(6);
      const def = BUILDINGS[type];
      ec.globalAlpha = 0.55;
      ec.fillStyle = view.canPlaceHere ? '#7fb96a' : '#c25b4e';
      ec.fillRect(view.hoverTile.tx * TILE, view.hoverTile.ty * TILE, def.w * TILE, def.h * TILE);
      ec.globalAlpha = 1;
    }

    const fc = effectC.getContext('2d');
    fc.setTransform(1, 0, 0, 1, 0, 0);
    fc.clearRect(0, 0, effectC.width, effectC.height);
    applyCam(fc);
    drawVfx(fc, vfx, state);
  }

  // ---------- entity painters ----------

  function drawBuildings(c, state, view) {
    for (const b of state.buildings) {
      const def = BUILDINGS[b.type];
      const x = b.tx * TILE, y = b.ty * TILE, w = def.w * TILE, h = def.h * TILE;
      c.save();
      // shadow
      c.fillStyle = 'rgba(40,30,15,0.25)';
      c.fillRect(x + 3, y + h - 6, w, 8);
      if (b.type === 'palace') {
        c.fillStyle = '#cfc5ae'; c.fillRect(x + 4, y + 14, w - 8, h - 18);
        c.fillStyle = '#9d9277'; c.fillRect(x + 4, y + 14, w - 8, 6);
        // towers
        for (const ox of [2, w - 16]) {
          c.fillStyle = '#bfb39a'; c.fillRect(x + ox, y + 4, 14, h - 8);
          c.fillStyle = '#7e3f3a';
          c.beginPath(); c.moveTo(x + ox - 2, y + 6); c.lineTo(x + ox + 7, y - 8); c.lineTo(x + ox + 16, y + 6); c.fill();
        }
        c.fillStyle = '#7e3f3a';
        c.beginPath(); c.moveTo(x + 14, y + 16); c.lineTo(x + w / 2, y); c.lineTo(x + w - 14, y + 16); c.fill();
        // banner
        c.strokeStyle = '#574a33'; c.beginPath(); c.moveTo(x + w / 2, y); c.lineTo(x + w / 2, y - 14); c.stroke();
        c.fillStyle = '#caa53d';
        c.beginPath(); c.moveTo(x + w / 2, y - 14); c.lineTo(x + w / 2 + 11, y - 10); c.lineTo(x + w / 2, y - 6); c.fill();
        c.fillStyle = '#4c3a28'; c.fillRect(x + w / 2 - 5, y + h - 16, 10, 12); // gate
      } else {
        const palettes = {
          house: ['#c9b896', '#8b6f4e'], market: ['#d2b078', '#9c5a36'], blacksmith: ['#9a9186', '#54473b'],
          guild_warrior: ['#c08f80', '#7e3f3a'], guild_ranger: ['#a8bb8a', '#4f6e3d'],
          guild_wizard: ['#9fa8cc', '#46508c'], guild_rogue: ['#b5a0bf', '#5d4470'],
        };
        const [wall, roof] = palettes[b.type] || ['#c9b896', '#8b6f4e'];
        c.fillStyle = wall; c.fillRect(x + 3, y + 12, w - 6, h - 14);
        c.fillStyle = roof;
        c.beginPath(); c.moveTo(x, y + 14); c.lineTo(x + w / 2, y); c.lineTo(x + w, y + 14); c.fill();
        c.fillStyle = 'rgba(35,25,15,0.65)';
        c.fillRect(x + w / 2 - 3, y + h - 11, 6, 9);
        if (def.hires) { // guild sigil
          c.fillStyle = '#f3ead2';
          c.beginPath(); c.arc(x + w / 2, y + 19, 5, 0, 7); c.fill();
          c.fillStyle = CLASSES[def.hires].color;
          c.beginPath(); c.arc(x + w / 2, y + 19, 3.4, 0, 7); c.fill();
        }
      }
      // hp bar when damaged
      if (b.hp < b.maxHp) hpBar(c, x + 2, y - 6, w - 4, b.hp / b.maxHp);
      if (view.selected && view.selected.kind === 'building' && view.selected.id === b.id) selRing(c, b.x, b.y, Math.max(w, h) * 0.7);
      c.restore();
    }
  }

  function drawLairs(c, state) {
    for (const l of state.lairs) {
      if (!l.discovered || l.hp <= 0) continue;
      const x = l.x, y = l.y;
      c.fillStyle = 'rgba(40,30,15,0.3)';
      c.beginPath(); c.ellipse(x, y + 10, 18, 7, 0, 0, 7); c.fill();
      // mound with maw
      c.fillStyle = '#6e5b43';
      c.beginPath(); c.arc(x, y, 17, Math.PI, 0); c.fill();
      c.fillStyle = '#4a3c2c';
      c.beginPath(); c.arc(x, y + 2, 11, Math.PI, 0); c.fill();
      c.fillStyle = '#191210';
      c.beginPath(); c.arc(x, y + 4, 7, Math.PI, 0); c.fill();
      // monster sigil
      c.fillStyle = MONSTERS[l.type].color;
      c.beginPath(); c.arc(x, y - 12, 4, 0, 7); c.fill();
      if (l.hp < l.maxHp) hpBar(c, x - 16, y - 24, 32, l.hp / l.maxHp);
    }
  }

  function drawGoldPiles(c, state) {
    for (const g of state.goldPiles) {
      c.fillStyle = '#d9a826';
      c.beginPath(); c.arc(g.x, g.y, 4 + Math.min(g.amount / 80, 3), 0, 7); c.fill();
      c.fillStyle = '#f4cf5e';
      c.beginPath(); c.arc(g.x - 2, g.y - 2, 2, 0, 7); c.fill();
    }
  }

  function drawFlags(c, state) {
    for (const f of state.flags) {
      const { x, y } = f;
      c.strokeStyle = '#4c3a28'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 26); c.stroke();
      c.fillStyle = f.flagType === 'attack' ? '#b23a30' : '#3a6db2';
      c.beginPath(); c.moveTo(x, y - 26); c.lineTo(x + 16, y - 21); c.lineTo(x, y - 16); c.fill();
      c.fillStyle = '#1d1408';
      c.font = 'bold 10px Alegreya, serif';
      c.textAlign = 'center';
      c.fillText(`${f.bounty} з.`, x + 1, y - 29);
      if (f.responders) {
        c.fillStyle = '#3d2f1c';
        c.font = '9px Alegreya, serif';
        c.fillText(`⚑${f.responders}`, x + 1, y + 10);
      }
    }
  }

  function drawMonsters(c, state, alpha) {
    for (const m of state.monsters) {
      if (!state._cache || !state._cache.visMonsters.has(m.id)) continue;
      const x = lerp(m.prevX, m.x, alpha), y = lerp(m.prevY, m.y, alpha);
      const def = MONSTERS[m.type];
      const r = 7 + m.level * 0.7;
      c.fillStyle = 'rgba(30,20,10,0.3)';
      c.beginPath(); c.ellipse(x, y + r * 0.8, r * 0.9, r * 0.35, 0, 0, 7); c.fill();
      c.fillStyle = def.color;
      // bestiary shapes per type
      if (m.type === 'rat' || m.type === 'wolf') {
        c.beginPath(); c.ellipse(x, y, r * 1.2, r * 0.75, 0, 0, 7); c.fill();
        c.beginPath(); c.arc(x + r, y - r * 0.3, r * 0.45, 0, 7); c.fill(); // head
        c.strokeStyle = def.color; c.lineWidth = 2;
        c.beginPath(); c.moveTo(x - r, y); c.quadraticCurveTo(x - r * 1.8, y - 3, x - r * 1.6, y + 4); c.stroke(); // tail
      } else if (m.type === 'spider') {
        c.beginPath(); c.arc(x, y, r * 0.8, 0, 7); c.fill();
        c.strokeStyle = def.color; c.lineWidth = 1.5;
        for (let i = 0; i < 4; i++) {
          const a = -0.7 + i * 0.45;
          c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * r * 1.7, y + Math.sin(a) * r * 1.7); c.stroke();
          c.beginPath(); c.moveTo(x, y); c.lineTo(x - Math.cos(a) * r * 1.7, y + Math.sin(a) * r * 1.7); c.stroke();
        }
      } else {
        // humanoid blob: goblin / troll / minotaur
        c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
        c.beginPath(); c.arc(x, y - r * 0.9, r * 0.55, 0, 7); c.fill();
        if (m.type === 'minotaur') {
          c.strokeStyle = '#e8e0c8'; c.lineWidth = 2;
          c.beginPath(); c.moveTo(x - r * 0.5, y - r * 1.2); c.quadraticCurveTo(x - r, y - r * 1.8, x - r * 0.4, y - r * 1.9); c.stroke();
          c.beginPath(); c.moveTo(x + r * 0.5, y - r * 1.2); c.quadraticCurveTo(x + r, y - r * 1.8, x + r * 0.4, y - r * 1.9); c.stroke();
        }
      }
      // eyes
      c.fillStyle = '#1d1408';
      c.beginPath(); c.arc(x + 2, y - 2, 1.3, 0, 7); c.fill();
      hpBar(c, x - 12, y - r - 9, 24, m.hp / m.maxHp, '#a33');
      c.fillStyle = 'rgba(29,20,8,0.85)';
      c.font = '8px Alegreya, serif'; c.textAlign = 'center';
      c.fillText(`ур.${m.level}`, x, y - r - 12);
    }
  }

  function drawHeroes(c, state, alpha, view) {
    for (const h of state.heroes) {
      const x = lerp(h.prevX, h.x, alpha), y = lerp(h.prevY, h.y, alpha);
      const cls = CLASSES[h.cls];
      const moving = Math.abs(h.x - h.prevX) + Math.abs(h.y - h.prevY) > 0.3;
      const bob = moving ? Math.sin(performance.now() / 90 + h.id) * 1.5 : 0;
      c.fillStyle = 'rgba(30,20,10,0.3)';
      c.beginPath(); c.ellipse(x, y + 8, 7, 3, 0, 0, 7); c.fill();
      // body: tabard in class color
      c.fillStyle = cls.color;
      c.beginPath();
      c.moveTo(x - 5, y + 7 + bob * 0.3);
      c.lineTo(x - 4, y - 4 + bob); c.lineTo(x + 4, y - 4 + bob); c.lineTo(x + 5, y + 7 + bob * 0.3);
      c.closePath(); c.fill();
      // head
      c.fillStyle = '#e8cfa8';
      c.beginPath(); c.arc(x, y - 8 + bob, 4.5, 0, 7); c.fill();
      // class hat/helm
      if (h.cls === 'wizard') {
        c.fillStyle = '#3c4687';
        c.beginPath(); c.moveTo(x - 6, y - 10 + bob); c.lineTo(x, y - 20 + bob); c.lineTo(x + 6, y - 10 + bob); c.fill();
      } else if (h.cls === 'warrior') {
        c.fillStyle = '#a8a8b0';
        c.beginPath(); c.arc(x, y - 9 + bob, 4.5, Math.PI, 0); c.fill();
      } else if (h.cls === 'ranger') {
        c.fillStyle = '#3d5731';
        c.beginPath(); c.arc(x, y - 10 + bob, 4.5, Math.PI * 1.1, -0.1); c.fill();
      } else {
        c.fillStyle = '#42304f';
        c.fillRect(x - 4.5, y - 12 + bob, 9, 3);
      }
      // weapon hint
      c.strokeStyle = '#5b5246'; c.lineWidth = 1.5;
      if (h.cls === 'ranger') { c.beginPath(); c.arc(x + 7, y - 2 + bob, 5, -1.2, 1.2); c.stroke(); }
      else if (h.cls === 'warrior') { c.beginPath(); c.moveTo(x + 6, y + 3 + bob); c.lineTo(x + 10, y - 9 + bob); c.stroke(); }
      // level pips
      c.fillStyle = '#caa53d';
      for (let i = 0; i < Math.min(h.level, 10); i++) c.fillRect(x - 10 + i * 2.2, y + 11, 1.6, 2.5);
      hpBar(c, x - 10, y - 17 + bob, 20, h.hp / h.maxHp);
      if (view.selected && view.selected.kind === 'hero' && view.selected.id === h.id) {
        selRing(c, x, y, 14);
        // intent bubble for selected hero
        c.font = 'italic 10px Alegreya, serif';
        const tw = c.measureText(h.intent).width;
        c.fillStyle = 'rgba(243,234,210,0.92)';
        c.strokeStyle = '#8a7341';
        const bx = x - tw / 2 - 6, by = y - 38;
        c.beginPath(); c.roundRect(bx, by, tw + 12, 16, 4); c.fill(); c.stroke();
        c.fillStyle = '#3d2f1c'; c.textAlign = 'center';
        c.fillText(h.intent, x, by + 11);
      }
    }
  }

  function hpBar(c, x, y, w, frac, color = '#5f9e48') {
    if (frac >= 1) return;
    c.fillStyle = 'rgba(20,12,5,0.7)';
    c.fillRect(x, y, w, 3);
    c.fillStyle = frac > 0.45 ? color : '#c25b30';
    c.fillRect(x, y, w * Math.max(frac, 0), 3);
  }

  function selRing(c, x, y, r) {
    c.strokeStyle = '#caa53d';
    c.lineWidth = 2;
    c.setLineDash([5, 4]);
    c.beginPath(); c.arc(x, y, r, performance.now() / 800, performance.now() / 800 + Math.PI * 2); c.stroke();
    c.setLineDash([]);
  }

  function drawVfx(c, vfx, state) {
    const now = performance.now();
    for (let i = vfx.length - 1; i >= 0; i--) {
      const v = vfx[i];
      const t = (now - v.t0) / v.dur;
      if (t >= 1) { vfx.splice(i, 1); continue; }
      if (v.kind === 'text') {
        c.globalAlpha = 1 - t;
        c.font = `${v.big ? 'bold 14px' : 'bold 11px'} Alegreya, serif`;
        c.textAlign = 'center';
        c.strokeStyle = 'rgba(20,12,5,0.6)'; c.lineWidth = 2.5;
        c.strokeText(v.text, v.x, v.y - t * 26);
        c.fillStyle = v.color;
        c.fillText(v.text, v.x, v.y - t * 26);
        c.globalAlpha = 1;
      } else if (v.kind === 'flash') {
        c.globalAlpha = (1 - t) * 0.7;
        c.fillStyle = v.color;
        c.beginPath(); c.arc(v.x, v.y, 6 + t * 10, 0, 7); c.fill();
        c.globalAlpha = 1;
      } else if (v.kind === 'arrow') {
        const ax = v.x + (v.x2 - v.x) * t, ay = v.y + (v.y2 - v.y) * t;
        c.strokeStyle = v.color; c.lineWidth = 2;
        c.beginPath(); c.moveTo(ax, ay);
        c.lineTo(ax - (v.x2 - v.x) * 0.08, ay - (v.y2 - v.y) * 0.08); c.stroke();
      }
    }
  }

  return { camera, draw, prerender, screenToWorld, worldToScreen, resize, get viewSize() { return { vw, vh }; } };
}
