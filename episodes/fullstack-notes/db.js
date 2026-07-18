'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'notes.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL DEFAULT '',
    pinned     INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, pinned DESC, updated_at DESC, id DESC);
`);

// ---- seed the demo user ----------------------------------------------------

const SAMPLE_NOTES = [
  {
    title: 'Welcome to Notes',
    body: 'This is your private notebook. Every note here belongs to your account and nobody else can read it.\n\nTry editing this note — just click the text.',
    pinned: 1,
  },
  {
    title: 'Keyboard shortcuts',
    body: '/  focus the search box\nEsc  cancel an inline edit\nCmd/Ctrl + Enter  save the note you are editing',
    pinned: 1,
  },
  {
    title: 'Grocery list',
    body: 'Coffee beans (the dark roast)\nOlive oil\nLemons\nSourdough\nParmesan',
    pinned: 0,
  },
  {
    title: 'Reading queue',
    body: 'Designing Data-Intensive Applications — ch. 5 onward\nThe Pragmatic Programmer — reread the chapter on orthogonality\nA Philosophy of Software Design',
    pinned: 0,
  },
  {
    title: 'Deploy checklist',
    body: '1. Run the full test suite\n2. Tag the release\n3. Back up the database\n4. Ship it\n5. Watch the error dashboard for 15 minutes',
    pinned: 0,
  },
  {
    title: 'Ideas',
    body: 'A CLI that turns a git log into a changelog nobody has to rewrite by hand.\nA tiny tool that reminds me which branches are already merged.',
    pinned: 0,
  },
];

function seed() {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('demo');
  if (existing) return;

  const hash = bcrypt.hashSync('demo1234', 10);
  const userId = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run('demo', hash).lastInsertRowid;

  const insert = db.prepare(
    `INSERT INTO notes (user_id, title, body, pinned, updated_at)
     VALUES (?, ?, ?, ?, datetime('now', ?))`
  );

  // Stagger updated_at so the grid has a natural, believable ordering.
  SAMPLE_NOTES.forEach((n, i) => {
    insert.run(userId, n.title, n.body, n.pinned, `-${i * 37} minutes`);
  });
}

seed();

module.exports = db;
