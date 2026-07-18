'use strict';

const express = require('express');
const store = require('./db');
const { homePage, notFoundPage } = require('./views');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.disable('x-powered-by');

store.seed();

/**
 * Accepts a user-supplied URL and returns the normalized form, or null if it
 * isn't a usable web address. Only http/https are allowed — javascript: and
 * data: URLs would otherwise turn every short link into an XSS vector.
 */
function normalizeUrl(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Be forgiving about a missing scheme: "example.com" -> "https://example.com".
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname.includes('.')) return null; // reject "https://foo"

  return parsed.toString();
}

function baseUrlFor(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// --- Homepage + dashboard -------------------------------------------------

app.get('/', (req, res) => {
  const result = req.query.code ? store.getLink(req.query.code) : null;
  res.send(homePage({
    links: store.allLinks(),
    result,
    error: req.query.error || null,
    baseUrl: baseUrlFor(req),
  }));
});

// --- JSON API -------------------------------------------------------------

app.post('/api/shorten', (req, res) => {
  const url = normalizeUrl(req.body && req.body.url);
  if (!url) {
    return res.status(400).json({ error: 'Please provide a valid http(s) URL.' });
  }

  const link = store.createLink(url);
  res.status(201).json({
    code: link.code,
    url: link.url,
    shortUrl: `${baseUrlFor(req)}/${link.code}`,
    clicks: link.clicks,
  });
});

// --- Form post (Post/Redirect/Get so a refresh doesn't re-submit) ---------

app.post('/shorten', (req, res) => {
  const url = normalizeUrl(req.body && req.body.url);
  if (!url) {
    return res.redirect(303, '/?error=' + encodeURIComponent("That doesn't look like a valid URL."));
  }
  const link = store.createLink(url);
  res.redirect(303, `/?code=${link.code}`);
});

// --- Redirect ------------------------------------------------------------

app.get('/:code', (req, res, next) => {
  const { code } = req.params;
  if (code.length !== store.CODE_LENGTH) return next();

  const link = store.getLink(code);
  if (!link) return next();

  store.recordClick(code);
  res.redirect(302, link.url);
});

// --- Styled 404 ----------------------------------------------------------

app.use((req, res) => {
  const code = req.path.slice(1);
  res.status(404).send(notFoundPage(code.includes('/') ? null : code));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Shortly running at http://localhost:${PORT}`);
  });
}

module.exports = app;
