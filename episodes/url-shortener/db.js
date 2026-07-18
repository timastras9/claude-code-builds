'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'links.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS links (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT    NOT NULL UNIQUE,
    url        TEXT    NOT NULL,
    clicks     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_links_clicks ON links(clicks DESC);
`);

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CODE_LENGTH = 6;

const statements = {
  insert: db.prepare('INSERT INTO links (code, url, clicks) VALUES (?, ?, ?)'),
  byCode: db.prepare('SELECT * FROM links WHERE code = ?'),
  byUrl: db.prepare('SELECT * FROM links WHERE url = ?'),
  bumpClicks: db.prepare('UPDATE links SET clicks = clicks + 1 WHERE code = ?'),
  all: db.prepare('SELECT * FROM links ORDER BY clicks DESC, id DESC'),
  count: db.prepare('SELECT COUNT(*) AS n FROM links'),
};

function randomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

// Collisions are vanishingly rare at this scale, but a unique code is a
// correctness requirement — retry until we find one that isn't taken.
function uniqueCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomCode();
    if (!statements.byCode.get(code)) return code;
  }
  throw new Error('could not generate a unique short code');
}

function createLink(url) {
  // Shortening the same URL twice returns the same link rather than
  // fragmenting click counts across duplicate codes.
  const existing = statements.byUrl.get(url);
  if (existing) return existing;

  const code = uniqueCode();
  statements.insert.run(code, url, 0);
  return statements.byCode.get(code);
}

function getLink(code) {
  return statements.byCode.get(code);
}

function recordClick(code) {
  return statements.bumpClicks.run(code).changes > 0;
}

function allLinks() {
  return statements.all.all();
}

const SEEDS = [
  ['gh4Kp2', 'https://github.com/anthropics/claude-code', 1284],
  ['dOcs91', 'https://docs.claude.com/en/docs/claude-code/overview', 763],
  ['nEws77', 'https://news.ycombinator.com', 429],
  ['xKcd12', 'https://xkcd.com/1319/', 158],
];

function seed() {
  if (statements.count.get().n > 0) return;
  const insertAll = db.transaction((rows) => {
    for (const [code, url, clicks] of rows) statements.insert.run(code, url, clicks);
  });
  insertAll(SEEDS);
}

module.exports = { db, createLink, getLink, recordClick, allLinks, seed, CODE_LENGTH };
