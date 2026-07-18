'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7, // one week
    },
  })
);
app.use(express.static(path.join(__dirname, 'public')));

// ---- helpers ---------------------------------------------------------------

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not signed in' });
  next();
}

// Loads a note only if it belongs to the caller. Ownership is part of the
// WHERE clause, so a wrong id and someone else's id fail the same way.
function ownedNote(userId, noteId) {
  return db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(noteId, userId);
}

const shape = (n) => ({
  id: n.id,
  title: n.title,
  body: n.body,
  pinned: !!n.pinned,
  updatedAt: n.updated_at,
});

// ---- auth ------------------------------------------------------------------

app.post('/api/signup', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const taken = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (taken) return res.status(409).json({ error: 'That username is taken' });

  const hash = bcrypt.hashSync(password, 10);
  const id = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, hash).lastInsertRowid;

  req.session.userId = id;
  res.status(201).json({ username });
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  // Same message either way — don't leak which usernames exist.
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Wrong username or password' });
  }

  req.session.userId = user.id;
  res.json({ username: user.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not signed in' });
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  res.json({ username: user.username });
});

// ---- notes -----------------------------------------------------------------

app.get('/api/notes', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  const rows = q
    ? db
        .prepare(
          `SELECT * FROM notes
           WHERE user_id = ? AND (title LIKE @like OR body LIKE @like)
           ORDER BY pinned DESC, updated_at DESC, id DESC`
        )
        .all(req.session.userId, { like: `%${q}%` })
    : db
        .prepare(
          `SELECT * FROM notes WHERE user_id = ?
           ORDER BY pinned DESC, updated_at DESC, id DESC`
        )
        .all(req.session.userId);

  res.json(rows.map(shape));
});

app.post('/api/notes', requireAuth, (req, res) => {
  const title = String(req.body.title || '').trim();
  const body = String(req.body.body || '');

  if (!title && !body.trim()) return res.status(400).json({ error: 'Note is empty' });

  const id = db
    .prepare(`INSERT INTO notes (user_id, title, body) VALUES (?, ?, ?)`)
    .run(req.session.userId, title, body).lastInsertRowid;

  res.status(201).json(shape(ownedNote(req.session.userId, id)));
});

app.put('/api/notes/:id', requireAuth, (req, res) => {
  const note = ownedNote(req.session.userId, req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });

  // Only touch the fields that were actually sent.
  const title = req.body.title === undefined ? note.title : String(req.body.title).trim();
  const body = req.body.body === undefined ? note.body : String(req.body.body);
  const pinned = req.body.pinned === undefined ? note.pinned : req.body.pinned ? 1 : 0;

  db.prepare(
    `UPDATE notes SET title = ?, body = ?, pinned = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`
  ).run(title, body, pinned, note.id, req.session.userId);

  res.json(shape(ownedNote(req.session.userId, note.id)));
});

app.delete('/api/notes/:id', requireAuth, (req, res) => {
  const result = db
    .prepare('DELETE FROM notes WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.session.userId);

  if (result.changes === 0) return res.status(404).json({ error: 'Note not found' });
  res.json({ ok: true });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Notes running on http://localhost:${PORT}`));
}

module.exports = app;
