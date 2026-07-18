const el = (id) => document.getElementById(id);

const loginView = el('login');
const loginForm = el('login-form');
const loginError = el('login-error');
const appView = el('app');
const messagesEl = el('messages');
const usersEl = el('users');
const userCountEl = el('user-count');
const typingEl = el('typing');
const inputEl = el('input');
const composer = el('composer');
const roomListEl = el('room-list');
const roomTitleEl = el('room-title');
const statusEl = el('status');

const AVATAR_COLORS = [
  '#5b74f0', '#e0699b', '#57b894', '#e6a94f', '#c86fd8',
  '#4aa8d8', '#e0894f', '#7c8ce0',
];

let ws = null;
let me = '';
let room = 'General';
let pickedRoom = 'General';
const typingUsers = new Map(); // username -> timeout id

function colorFor(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function avatar(name, cls = '') {
  const span = document.createElement('span');
  span.className = `avatar ${cls}`.trim();
  span.style.background = colorFor(name);
  span.textContent = name.slice(0, 2).toUpperCase();
  return span;
}

function clockOf(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function atBottom() {
  const slack = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  return slack < 120;
}

function scrollDown() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderSystem(msg) {
  const div = document.createElement('div');
  div.className = 'system';
  div.textContent = msg.text;
  return div;
}

function renderMessage(msg) {
  const mine = msg.username === me;

  const row = document.createElement('div');
  row.className = `row ${mine ? 'mine' : 'theirs'}`;

  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap';

  const meta = document.createElement('div');
  meta.className = 'meta';

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = mine ? 'You' : msg.username;
  name.style.color = colorFor(msg.username);

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = clockOf(msg.ts);

  meta.append(name, time);

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = msg.text;

  wrap.append(meta, bubble);
  row.append(avatar(msg.username), wrap);
  return row;
}

function addMessage(msg) {
  const stick = atBottom();
  messagesEl.append(
    msg.type === 'system' ? renderSystem(msg) : renderMessage(msg)
  );
  if (stick) scrollDown();
}

function renderUsers(users) {
  usersEl.replaceChildren();
  userCountEl.textContent = users.length;

  for (const name of users) {
    const li = document.createElement('li');
    if (name === me) li.className = 'self';
    const label = document.createElement('span');
    label.textContent = name === me ? `${name} (you)` : name;
    li.append(avatar(name), label);
    usersEl.append(li);
  }
}

function renderTyping() {
  const names = [...typingUsers.keys()].filter((n) => n !== me);
  if (names.length === 0) {
    typingEl.textContent = '';
  } else if (names.length === 1) {
    typingEl.textContent = `${names[0]} is typing…`;
  } else if (names.length === 2) {
    typingEl.textContent = `${names[0]} and ${names[1]} are typing…`;
  } else {
    typingEl.textContent = 'Several people are typing…';
  }
}

function markTyping(username, isTyping) {
  const existing = typingUsers.get(username);
  if (existing) clearTimeout(existing);

  if (!isTyping) {
    typingUsers.delete(username);
  } else {
    // Self-expire in case the stop event never arrives.
    typingUsers.set(
      username,
      setTimeout(() => {
        typingUsers.delete(username);
        renderTyping();
      }, 4000)
    );
  }
  renderTyping();
}

function renderRoomList(rooms) {
  roomListEl.replaceChildren();
  for (const name of rooms) {
    const btn = document.createElement('button');
    btn.className = `room-btn ${name === room ? 'active' : ''}`.trim();
    btn.textContent = `# ${name}`;
    btn.addEventListener('click', () => switchRoom(name));
    roomListEl.append(btn);
  }
}

function switchRoom(name) {
  if (name === room || !ws || ws.readyState !== WebSocket.OPEN) return;
  typingUsers.forEach((id) => clearTimeout(id));
  typingUsers.clear();
  renderTyping();
  ws.send(JSON.stringify({ type: 'join', username: me, room: name }));
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.addEventListener('open', () => {
    statusEl.textContent = 'connected';
    statusEl.classList.add('live');
    ws.send(JSON.stringify({ type: 'join', username: me, room: pickedRoom }));
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'joined':
        room = msg.room;
        me = msg.username;
        el('me-name').textContent = me;
        const mine = el('me-avatar');
        mine.style.background = colorFor(me);
        mine.textContent = me.slice(0, 2).toUpperCase();
        roomTitleEl.textContent = room;
        inputEl.placeholder = `Message #${room}`;
        renderRoomList(msg.rooms);
        messagesEl.replaceChildren();
        msg.history.forEach(addMessage);
        scrollDown();
        inputEl.focus();
        break;

      case 'message':
      case 'system':
        if (msg.room === room) {
          if (msg.type === 'message') markTyping(msg.username, false);
          addMessage(msg);
        }
        break;

      case 'users':
        if (msg.room === room) renderUsers(msg.users);
        break;

      case 'typing':
        if (msg.room === room) markTyping(msg.username, msg.typing);
        break;

      case 'error':
        loginError.textContent = msg.error;
        break;
    }
  });

  ws.addEventListener('close', () => {
    statusEl.textContent = 'reconnecting…';
    statusEl.classList.remove('live');
    setTimeout(connect, 1500);
  });
}

// ---------- typing signal ----------

let typingSent = false;
let typingTimer = null;

function signalTyping() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  if (!typingSent) {
    typingSent = true;
    ws.send(JSON.stringify({ type: 'typing', typing: true }));
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 1800);
}

function stopTyping() {
  clearTimeout(typingTimer);
  if (!typingSent) return;
  typingSent = false;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'typing', typing: false }));
  }
}

// ---------- wiring ----------

el('room-picker').addEventListener('click', (e) => {
  const chip = e.target.closest('.room-chip');
  if (!chip) return;
  pickedRoom = chip.dataset.room;
  for (const c of el('room-picker').children) {
    c.classList.toggle('active', c === chip);
  }
});

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = el('username').value.trim();
  if (!name) {
    loginError.textContent = 'Pick a username first.';
    return;
  }
  me = name;
  room = pickedRoom;
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  connect();
});

composer.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'message', text }));
  inputEl.value = '';
  stopTyping();
});

inputEl.addEventListener('input', () => {
  if (inputEl.value.trim()) signalTyping();
  else stopTyping();
});
