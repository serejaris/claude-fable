const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const TICK_MS = 50;            // 20 Hz state broadcast
const ROUND_MS = 3 * 60 * 1000;
const ROUND_BREAK_MS = 7000;
const RESPAWN_MS = 3000;
const MAX_HP = 100;

const SPAWNS = [
  [-30, 0, -30], [30, 0, -30], [-30, 0, 30], [30, 0, 30],
  [0, 0, -32], [0, 0, 32], [-32, 0, 0], [32, 0, 0],
  [-12, 0, -12], [12, 0, 12], [-12, 0, 12], [12, 0, -12],
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

function randomSpawn() {
  return SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
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
      const [sx, sy, sz] = randomSpawn();
      player = {
        id: nextId++, name,
        color: ['#d9a24b', '#4b8bd9', '#6bc25e', '#c25e5e', '#9b6bd9', '#d9d24b'][Math.floor(Math.random() * 6)],
        x: sx, y: sy, z: sz, ry: 0, rx: 0,
        hp: MAX_HP, kills: 0, deaths: 0, dead: false,
      };
      room.players.set(player.id, player);
      room.sockets.set(player.id, ws);
      ws.send(JSON.stringify({
        t: 'init', id: player.id, spawn: [sx, sy, sz],
        players: [...room.players.values()].map(publicPlayer),
        roundEndsAt: room.roundEndsAt, now: Date.now(),
      }));
      broadcast(room, { t: 'joined', player: publicPlayer(player) }, player.id);
      return;
    }
    if (!player || !room) return;

    switch (msg.t) {
      case 'state':
        if (player.dead) break;
        player.x = +msg.x || 0; player.y = +msg.y || 0; player.z = +msg.z || 0;
        player.ry = +msg.ry || 0; player.rx = +msg.rx || 0;
        break;
      case 'shoot': // tracer/sound relay
        broadcast(room, { t: 'shoot', id: player.id, o: msg.o, d: msg.d }, player.id);
        break;
      case 'hit': {
        if (room.breakUntil > Date.now()) break;
        const target = room.players.get(+msg.target);
        if (!target || target.dead || player.dead) break;
        const dmg = msg.head ? 100 : 30;
        target.hp -= dmg;
        if (target.hp <= 0) {
          target.hp = 0; target.dead = true;
          target.deaths++; player.kills++;
          broadcast(room, { t: 'die', id: target.id, by: player.id, head: !!msg.head });
          setTimeout(() => {
            if (!room.players.has(target.id)) return;
            const [sx, sy, sz] = randomSpawn();
            target.hp = MAX_HP; target.dead = false;
            target.x = sx; target.y = sy; target.z = sz;
            broadcast(room, { t: 'respawn', id: target.id, spawn: [sx, sy, sz] });
          }, RESPAWN_MS);
        } else {
          broadcast(room, { t: 'hp', id: target.id, hp: target.hp, by: player.id });
        }
        break;
      }
      case 'chatping':
        broadcast(room, { t: 'chatping', id: player.id }, player.id);
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
        for (const p of room.players.values()) {
          p.kills = 0; p.deaths = 0; p.hp = MAX_HP; p.dead = false;
          const [sx, sy, sz] = randomSpawn();
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
