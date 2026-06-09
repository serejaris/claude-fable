const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const TICK_MS = 50;            // 20 Hz state broadcast
const ROUND_MS = 5 * 60 * 1000;
const ROUND_BREAK_MS = 7000;
const RESPAWN_MS = 3000;
const MAX_HP = 100;
const KILL_TARGET = 20;
const MEDKIT_HEAL = 50;
const MEDKIT_RESPAWN_MS = 25000;
const SPAWN_PROT_MS = 1500;

// [x, z, y?] — must match client MEDKITS (map v2: doors, catwalk base, B yard, A approach, long, tunnels)
const MEDKITS = [
  [0, -2], [8, -15], [-50, -44], [52, -31], [62, -8], [-59.5, 35],
];

// map v2: T zone south (z>0), CT zone north (z<0)
const SPAWNS = [
  [-14, 0, 56], [-5, 0, 56], [4, 0, 56], [12, 0, 57], [24, 0, 57], [-10, 0, 62], [8, 0, 62], [17, 0, 62],
  [-12, 0, -62], [-6, 0, -62], [0, 0, -62], [6, 0, -62], [12, 0, -62], [-9, 0, -57], [3, 0, -57], [15, 0, -57],
];

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map(); // name -> Room
let nextId = 1;

function getRoom(name) {
  let room = rooms.get(name);
  if (!room) {
    room = {
      name,
      players: new Map(), // id -> player
      sockets: new Map(), // id -> ws
      roundEndsAt: Date.now() + ROUND_MS,
      breakUntil: 0,
      medkits: MEDKITS.map(() => ({ downUntil: 0 })),
    };
    rooms.set(name, room);
  }
  return room;
}

function broadcast(room, msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const [id, ws] of room.sockets) {
    if (id !== exceptId && ws.readyState === 1) ws.send(data);
  }
}

// farthest-from-enemies spawn, random among top-3 ties — no more spawning into a camper's crosshair
function pickSpawn(room, me) {
  let best = [], bd = -1;
  for (const s of SPAWNS) {
    let d = 1e9;
    for (const p of room.players.values()) {
      if (p.dead || p === me) continue;
      const dx = p.x - s[0], dz = p.z - s[2];
      d = Math.min(d, dx * dx + dz * dz);
    }
    if (d > bd + 1) { bd = d; best = [s]; }
    else if (d > bd - 1) best.push(s);
  }
  return best[Math.floor(Math.random() * best.length)] || SPAWNS[0];
}

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, color: p.color,
    x: p.x, y: p.y, z: p.z, ry: p.ry, rx: p.rx,
    hp: p.hp, kills: p.kills, deaths: p.deaths, dead: p.dead,
  };
}

wss.on('connection', (ws) => {
  let player = null;
  let room = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.t === 'join' && !player) {
      const roomName = String(msg.room || 'dust').slice(0, 24).replace(/[^\w-]/g, '') || 'dust';
      const name = String(msg.name || 'player').slice(0, 16) || 'player';
      room = getRoom(roomName);
      const [sx, sy, sz] = pickSpawn(room, null);
      player = {
        id: nextId++, name,
        color: ['#d9a24b', '#4b8bd9', '#6bc25e', '#c25e5e', '#9b6bd9', '#d9d24b'][Math.floor(Math.random() * 6)],
        x: sx, y: sy, z: sz, ry: 0, rx: 0,
        hp: MAX_HP, kills: 0, deaths: 0, dead: false,
        protUntil: Date.now() + SPAWN_PROT_MS,
      };
      room.players.set(player.id, player);
      room.sockets.set(player.id, ws);
      ws.send(JSON.stringify({
        t: 'init', id: player.id, spawn: [sx, sy, sz],
        players: [...room.players.values()].map(publicPlayer),
        medkits: room.medkits.map(m => m.downUntil > Date.now() ? 0 : 1),
        roundEndsAt: room.roundEndsAt, now: Date.now(),
      }));
      broadcast(room, { t: 'joined', player: publicPlayer(player) }, player.id);
      return;
    }
    if (!player || !room) return;

    switch (msg.t) {
      case 'state': {
        if (player.dead) break;
        player.x = +msg.x || 0; player.y = +msg.y || 0; player.z = +msg.z || 0;
        player.ry = +msg.ry || 0; player.rx = +msg.rx || 0;
        if (player.hp < MAX_HP && !(room.breakUntil > Date.now())) {
          for (let i = 0; i < MEDKITS.length; i++) {
            const mk = room.medkits[i];
            if (!mk || mk.downUntil) continue;
            const [mx, mz, my] = MEDKITS[i];
            const dx = player.x - mx, dz = player.z - mz, dy = player.y - (my || 0);
            if (dx * dx + dz * dz < 2.2 && Math.abs(dy) < 1.6) {
              mk.downUntil = Date.now() + MEDKIT_RESPAWN_MS;
              player.hp = Math.min(MAX_HP, player.hp + MEDKIT_HEAL);
              broadcast(room, { t: 'medkit', i, id: player.id, hp: player.hp });
              break;
            }
          }
        }
        break;
      }
      case 'shoot': // tracer/sound relay
        broadcast(room, { t: 'shoot', id: player.id, o: msg.o, d: msg.d }, player.id);
        break;
      case 'hit': {
        const now = Date.now();
        if (room.breakUntil > now) break;
        if (now - (player.lastHitMsg || 0) < 95) break; // fire-rate cap, devtools-proof
        player.lastHitMsg = now;
        const target = room.players.get(+msg.target);
        if (!target || target.dead || player.dead) break;
        if (now < target.protUntil) break;
        const dmg = msg.head ? 100 : 30;
        target.hp -= dmg;
        if (target.hp <= 0) {
          target.hp = 0; target.dead = true;
          target.deaths++; player.kills++;
          player.streak = (player.streak || 0) + 1;
          target.streak = 0;
          broadcast(room, { t: 'die', id: target.id, by: player.id, head: !!msg.head, streak: player.streak });
          if (player.kills >= KILL_TARGET) room.roundEndsAt = Date.now();
          setTimeout(() => {
            if (!room.players.has(target.id)) return;
            const [sx, sy, sz] = pickSpawn(room, target);
            target.hp = MAX_HP; target.dead = false;
            target.protUntil = Date.now() + SPAWN_PROT_MS;
            target.x = sx; target.y = sy; target.z = sz;
            broadcast(room, { t: 'respawn', id: target.id, spawn: [sx, sy, sz] });
          }, RESPAWN_MS);
        } else {
          broadcast(room, { t: 'hp', id: target.id, hp: target.hp, by: player.id });
        }
        break;
      }
      case 'chatping':
        broadcast(room, { t: 'chatping', id: player.id, n: +msg.n || 0 }, player.id);
        break;
    }
  });

  ws.on('close', () => {
    if (!player || !room) return;
    room.players.delete(player.id);
    room.sockets.delete(player.id);
    broadcast(room, { t: 'left', id: player.id });
    if (room.players.size === 0) rooms.delete(room.name);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    // round lifecycle
    if (room.breakUntil) {
      if (now >= room.breakUntil) {
        room.breakUntil = 0;
        room.roundEndsAt = now + ROUND_MS;
        for (const m of room.medkits) m.downUntil = 0;
        for (const p of room.players.values()) {
          p.kills = 0; p.deaths = 0; p.hp = MAX_HP; p.dead = false; p.streak = 0;
          p.protUntil = now + SPAWN_PROT_MS;
          const [sx, sy, sz] = pickSpawn(room, p);
          p.x = sx; p.y = sy; p.z = sz;
          const ws = room.sockets.get(p.id);
          if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'roundstart', spawn: [sx, sy, sz], roundEndsAt: room.roundEndsAt, now }));
        }
      }
    } else if (now >= room.roundEndsAt) {
      room.breakUntil = now + ROUND_BREAK_MS;
      const scores = [...room.players.values()]
        .map(p => ({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths }))
        .sort((a, b) => b.kills - a.kills);
      broadcast(room, { t: 'roundend', scores, breakMs: ROUND_BREAK_MS });
    }
    // medkit respawns
    for (let i = 0; i < room.medkits.length; i++) {
      const mk = room.medkits[i];
      if (mk.downUntil && now >= mk.downUntil) { mk.downUntil = 0; broadcast(room, { t: 'medkitup', i }); }
    }
    // state tick
    if (room.players.size > 0) {
      broadcast(room, {
        t: 'states', now,
        players: [...room.players.values()].map(p => ({ id: p.id, x: p.x, y: p.y, z: p.z, ry: p.ry, rx: p.rx, hp: p.hp, dead: p.dead, kills: p.kills, deaths: p.deaths })),
      });
    }
  }
}, TICK_MS);

server.listen(PORT, () => console.log(`dust-arena listening on :${PORT}`));
