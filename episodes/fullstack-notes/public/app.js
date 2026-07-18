'use strict';

// --------------------------------- state ---------------------------------

let notes = [];
let query = '';
let editingId = null;
let signingUp = false;

const $ = (sel) => document.querySelector(sel);

const authEl = $('#auth');
const appEl = $('#app');
const gridEl = $('#grid');
const emptyEl = $('#empty');
const searchEl = $('#search');
const composer = $('#composer');

// ---------------------------------- api ----------------------------------

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || 'Something went wrong');
  return data;
}

// -------------------------------- helpers --------------------------------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// Escape FIRST, then wrap matches — so note text can never inject markup.
function highlight(text, q) {
  const safe = escapeHtml(text);
  if (!q) return safe;
  const needle = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(needle, 'gi'), (m) => `<mark>${m}</mark>`);
}

function timeAgo(sqlUtc) {
  // SQLite hands back "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker.
  const then = new Date(sqlUtc.replace(' ', 'T') + 'Z');
  const secs = Math.max(0, (Date.now() - then.getTime()) / 1000);

  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const visible = () => {
  const q = query.trim().toLowerCase();
  if (!q) return notes;
  return notes.filter(
    (n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)
  );
};

// -------------------------------- rendering -------------------------------

function render() {
  const list = visible();
  gridEl.innerHTML = '';

  if (!list.length) {
    emptyEl.hidden = false;
    emptyEl.textContent = query.trim()
      ? `No notes match “${query.trim()}”.`
      : 'No notes yet — write your first one above.';
    return;
  }
  emptyEl.hidden = true;

  for (const note of list) {
    gridEl.appendChild(note.id === editingId ? editCard(note) : viewCard(note));
  }
}

function viewCard(note) {
  const card = document.createElement('article');
  card.className = 'card' + (note.pinned ? ' pinned' : '');

  const q = query.trim();

  const pin = document.createElement('button');
  pin.className = 'pin-btn';
  pin.textContent = '📌';
  pin.title = note.pinned ? 'Unpin' : 'Pin to top';
  pin.setAttribute('aria-label', pin.title);
  pin.onclick = () => togglePin(note);
  card.appendChild(pin);

  if (note.title) {
    const h = document.createElement('h3');
    h.innerHTML = highlight(note.title, q);
    card.appendChild(h);
  }

  if (note.body) {
    const p = document.createElement('p');
    p.innerHTML = highlight(note.body, q);
    card.appendChild(p);
  }

  const foot = document.createElement('div');
  foot.className = 'card-foot';

  const stamp = document.createElement('span');
  stamp.className = 'stamp';
  stamp.textContent = timeAgo(note.updatedAt);
  foot.appendChild(stamp);

  const edit = document.createElement('button');
  edit.className = 'icon-btn';
  edit.textContent = 'Edit';
  edit.onclick = () => { editingId = note.id; render(); };
  foot.appendChild(edit);

  const del = document.createElement('button');
  del.className = 'icon-btn danger';
  del.textContent = 'Delete';
  del.onclick = () => remove(note);
  foot.appendChild(del);

  card.appendChild(foot);

  // Clicking the card body is the fastest path into an inline edit.
  card.onclick = (e) => {
    if (e.target.closest('button')) return;
    editingId = note.id;
    render();
  };

  return card;
}

function editCard(note) {
  const card = document.createElement('article');
  card.className = 'card editing' + (note.pinned ? ' pinned' : '');

  const title = document.createElement('input');
  title.className = 'edit-title';
  title.value = note.title;
  title.placeholder = 'Title';

  const body = document.createElement('textarea');
  body.className = 'edit-body';
  body.value = note.body;
  body.placeholder = 'Take a note…';
  body.rows = Math.min(14, Math.max(3, note.body.split('\n').length + 1));

  const foot = document.createElement('div');
  foot.className = 'card-foot';

  const save = document.createElement('button');
  save.className = 'icon-btn';
  save.style.color = 'var(--accent)';
  save.textContent = 'Save';
  save.onclick = () => commit();

  const cancel = document.createElement('button');
  cancel.className = 'icon-btn';
  cancel.textContent = 'Cancel';
  cancel.onclick = () => { editingId = null; render(); };

  foot.append(save, cancel);
  card.append(title, body, foot);

  async function commit() {
    const patch = { title: title.value.trim(), body: body.value };
    editingId = null;

    if (patch.title === note.title && patch.body === note.body) return render();

    const updated = await api('PUT', `/api/notes/${note.id}`, patch);
    replaceNote(updated);
    resort();
    render();
  }

  const keys = (e) => {
    if (e.key === 'Escape') { editingId = null; render(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
  };
  title.onkeydown = keys;
  body.onkeydown = keys;

  // Focus after the node is in the document.
  setTimeout(() => {
    body.focus();
    body.setSelectionRange(body.value.length, body.value.length);
  }, 0);

  return card;
}

// ------------------------------ note actions ------------------------------

function replaceNote(updated) {
  const i = notes.findIndex((n) => n.id === updated.id);
  if (i !== -1) notes[i] = updated;
}

// Mirrors the server's ORDER BY: pinned first, then most recently updated.
// updated_at only has second resolution, so id breaks ties — same as the SQL.
function resort() {
  notes.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const byTime = b.updatedAt.localeCompare(a.updatedAt);
    return byTime !== 0 ? byTime : b.id - a.id;
  });
}

async function togglePin(note) {
  const updated = await api('PUT', `/api/notes/${note.id}`, { pinned: !note.pinned });
  replaceNote(updated);
  resort();
  render();
}

async function remove(note) {
  await api('DELETE', `/api/notes/${note.id}`);
  notes = notes.filter((n) => n.id !== note.id);
  render();
}

async function createNote() {
  const title = $('#new-title').value.trim();
  const body = $('#new-body').value;
  if (!title && !body.trim()) return closeComposer();

  const created = await api('POST', '/api/notes', { title, body });
  notes.unshift(created);
  resort();
  closeComposer();
  render();
}

function closeComposer() {
  $('#new-title').value = '';
  $('#new-body').value = '';
  $('#new-body').style.height = 'auto';
  composer.classList.remove('open');
}

// --------------------------------- auth ----------------------------------

function showAuthError(msg) {
  const el = $('#auth-error');
  el.textContent = msg;
  el.hidden = !msg;
}

function setAuthMode(signup) {
  signingUp = signup;
  $('#auth-title').textContent = signup ? 'Create your account' : 'Welcome back';
  $('#auth-sub').textContent = signup
    ? 'Your notes stay private to you.'
    : 'Sign in to open your notebook.';
  $('#auth-submit').textContent = signup ? 'Create account' : 'Sign in';
  $('#auth-switch-text').textContent = signup ? 'Already have an account?' : 'New here?';
  $('#auth-toggle').textContent = signup ? 'Sign in' : 'Create an account';
  $('#password').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
  showAuthError('');
}

async function enterApp(username) {
  $('#who').textContent = username;
  authEl.hidden = true;
  appEl.hidden = false;

  notes = await api('GET', '/api/notes');
  render();
}

// -------------------------------- wiring ---------------------------------

$('#auth-form').onsubmit = async (e) => {
  e.preventDefault();
  showAuthError('');
  const username = $('#username').value.trim();
  const password = $('#password').value;

  try {
    const { username: name } = await api(
      'POST',
      signingUp ? '/api/signup' : '/api/login',
      { username, password }
    );
    $('#password').value = '';
    await enterApp(name);
  } catch (err) {
    showAuthError(err.message);
  }
};

$('#auth-toggle').onclick = () => setAuthMode(!signingUp);

$('#logout').onclick = async () => {
  await api('POST', '/api/logout');
  notes = [];
  query = '';
  searchEl.value = '';
  appEl.hidden = true;
  authEl.hidden = false;
  setAuthMode(false);
  $('#username').value = '';
  $('#password').value = '';
};

searchEl.oninput = (e) => {
  query = e.target.value;
  render();
};

composer.addEventListener('focusin', () => composer.classList.add('open'));
$('#new-save').onclick = createNote;
$('#new-cancel').onclick = closeComposer;

// Grow the composer with its content.
$('#new-body').addEventListener('input', (e) => {
  e.target.style.height = 'auto';
  e.target.style.height = e.target.scrollHeight + 'px';
});

$('#new-body').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) createNote();
  if (e.key === 'Escape') closeComposer();
});

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (e.key === '/' && !typing) {
    e.preventDefault();
    searchEl.focus();
  }
});

// Resume an existing session on load, otherwise show the sign-in card.
(async () => {
  setAuthMode(false);
  try {
    const me = await api('GET', '/api/me');
    await enterApp(me.username);
  } catch {
    authEl.hidden = false;
  }
})();
