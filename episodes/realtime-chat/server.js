const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const ROOMS = ['General', 'Dev', 'Random'];
const HISTORY_LIMIT = 50;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// room -> array of the last HISTORY_LIMIT messages
const history = new Map(ROOMS.map((r) => [r, []]));

function remember(room, msg) {
  const log = history.get(room);
  log.push(msg);
  if (log.length > HISTORY_LIMIT) log.shift();
}

function peersIn(room) {
  return [...wss.clients].filter(
    (c) => c.readyState === c.OPEN && c.room === room
  );
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(room, payload, { except } = {}) {
  for (const peer of peersIn(room)) {
    if (peer !== except) send(peer, payload);
  }
}

function rosterOf(room) {
  return peersIn(room)
    .map((c) => c.username)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function pushRoster(room) {
  broadcast(room, { type: 'users', room, users: rosterOf(room) });
}

// A chat/system message as stored and replayed.
function makeMessage(kind, room, fields) {
  return { type: kind, room, ts: Date.now(), ...fields };
}

function clean(str, max) {
  return String(str ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

wss.on('connection', (ws) => {
  ws.username = null;
  ws.room = null;
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join': {
        const username = clean(msg.username, 24);
        const room = ROOMS.includes(msg.room) ? msg.room : ROOMS[0];
        if (!username) {
          send(ws, { type: 'error', error: 'A username is required.' });
          return;
        }

        // Leaving a previous room is a rejoin, not a disconnect.
        if (ws.room) leaveRoom(ws);

        ws.username = username;
        ws.room = room;

        send(ws, {
          type: 'joined',
          room,
          username,
          rooms: ROOMS,
          history: history.get(room),
        });

        const note = makeMessage('system', room, {
          text: `${username} joined ${room}`,
        });
        remember(room, note);
        broadcast(room, note, { except: ws });
        pushRoster(room);
        break;
      }

      case 'message': {
        if (!ws.room || !ws.username) return;
        const text = clean(msg.text, 2000);
        if (!text) return;

        const chat = makeMessage('message', ws.room, {
          username: ws.username,
          text,
        });
        remember(ws.room, chat);
        broadcast(ws.room, chat);
        break;
      }

      case 'typing': {
        if (!ws.room || !ws.username) return;
        broadcast(
          ws.room,
          {
            type: 'typing',
            room: ws.room,
            username: ws.username,
            typing: Boolean(msg.typing),
          },
          { except: ws }
        );
        break;
      }
    }
  });

  ws.on('close', () => leaveRoom(ws));
});

function leaveRoom(ws) {
  const { room, username } = ws;
  if (!room || !username) return;

  ws.room = null;

  // Stop any typing bubble the departing user left behind.
  broadcast(room, { type: 'typing', room, username, typing: false });

  const note = makeMessage('system', room, {
    text: `${username} left ${room}`,
  });
  remember(room, note);
  broadcast(room, note);
  pushRoster(room);
}

// Drop half-open sockets so the roster stays honest.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`Chat server listening on http://localhost:${PORT}`);
});
