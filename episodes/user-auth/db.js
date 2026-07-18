const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

// DB_PATH lets the test suite run against a throwaway database.
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'auth.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Seed the demo account once.
const demo = db.prepare('SELECT id FROM users WHERE username = ?').get('demo');
if (!demo) {
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
    'demo',
    bcrypt.hashSync('demo1234', 12)
  );
}

module.exports = db;
