'use strict';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

const STYLES = `
  :root {
    --bg: #0f1115;
    --panel: #171a21;
    --line: #262b36;
    --text: #e7e9ee;
    --muted: #8b93a7;
    --accent: #6ee7a8;
    --accent-dim: #2f9e6b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 48px 20px 80px;
    background: radial-gradient(1200px 600px at 50% -10%, #1b2130 0%, var(--bg) 60%);
    color: var(--text);
    font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
    min-height: 100vh;
  }
  .wrap { max-width: 780px; margin: 0 auto; }
  header { text-align: center; margin-bottom: 36px; }
  h1 { font-size: 34px; letter-spacing: -0.02em; margin: 0 0 8px; }
  h1 span { color: var(--accent); }
  .sub { color: var(--muted); margin: 0; }
  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 22px;
    margin-bottom: 26px;
  }
  form { display: flex; gap: 10px; }
  input[type=url] {
    flex: 1;
    padding: 13px 15px;
    border-radius: 9px;
    border: 1px solid var(--line);
    background: #0f1218;
    color: var(--text);
    font-size: 15px;
    outline: none;
  }
  input[type=url]:focus { border-color: var(--accent-dim); }
  button {
    padding: 13px 22px;
    border: 0;
    border-radius: 9px;
    background: var(--accent);
    color: #08140d;
    font-weight: 650;
    font-size: 15px;
    cursor: pointer;
  }
  button:hover { background: #8af0bd; }
  .result {
    margin-top: 18px;
    padding: 15px 17px;
    border: 1px solid var(--accent-dim);
    border-radius: 10px;
    background: rgba(110, 231, 168, 0.07);
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }
  .result a { color: var(--accent); font-size: 18px; font-weight: 600; text-decoration: none; }
  .result .target { color: var(--muted); font-size: 13px; width: 100%; word-break: break-all; }
  .copy {
    margin-left: auto;
    padding: 7px 14px;
    font-size: 13px;
    background: transparent;
    border: 1px solid var(--accent-dim);
    color: var(--accent);
  }
  .copy:hover { background: rgba(110, 231, 168, 0.12); }
  .error {
    margin-top: 16px;
    padding: 12px 15px;
    border-radius: 9px;
    border: 1px solid #6b2b32;
    background: rgba(220, 80, 95, 0.1);
    color: #ff9aa5;
    font-size: 14px;
  }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.09em; color: var(--muted); margin: 0 0 14px; }
  table { width: 100%; border-collapse: collapse; }
  th {
    text-align: left;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--muted);
    padding: 0 10px 10px;
    border-bottom: 1px solid var(--line);
  }
  td { padding: 13px 10px; border-bottom: 1px solid #1e222b; vertical-align: middle; }
  tr:last-child td { border-bottom: 0; }
  .code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--accent); text-decoration: none; }
  .code:hover { text-decoration: underline; }
  .url { color: var(--muted); max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .clicks { text-align: right; font-variant-numeric: tabular-nums; font-weight: 650; }
  .empty { color: var(--muted); text-align: center; padding: 26px 0; }
  .center { text-align: center; }
  .big { font-size: 82px; font-weight: 750; letter-spacing: -0.04em; color: var(--accent); margin: 0; }
  .back { display: inline-block; margin-top: 22px; color: var(--accent); text-decoration: none; font-weight: 600; }
  .back:hover { text-decoration: underline; }
`;

function layout(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`;
}

function homePage({ links, result, error, baseUrl }) {
  let resultHtml = '';
  if (result) {
    const shortUrl = `${baseUrl}/${result.code}`;
    resultHtml = `
      <div class="result">
        <a href="${escapeHtml(shortUrl)}" id="short-link">${escapeHtml(shortUrl)}</a>
        <button class="copy" type="button" onclick="
          navigator.clipboard.writeText(document.getElementById('short-link').textContent);
          this.textContent='Copied';
        ">Copy</button>
        <div class="target">&rarr; ${escapeHtml(result.url)}</div>
      </div>`;
  }

  const errorHtml = error ? `<div class="error">${escapeHtml(error)}</div>` : '';

  const rows = links.length
    ? links.map((l) => `
        <tr>
          <td><a class="code" href="/${escapeHtml(l.code)}">/${escapeHtml(l.code)}</a></td>
          <td class="url" title="${escapeHtml(l.url)}">${escapeHtml(l.url)}</td>
          <td class="clicks">${l.clicks}</td>
        </tr>`).join('')
    : '<tr><td colspan="3" class="empty">No links yet — shorten one above.</td></tr>';

  return layout('Shortly — URL Shortener', `
    <header>
      <h1>Short<span>ly</span></h1>
      <p class="sub">Paste a long URL, get a short one. Watch the clicks roll in.</p>
    </header>

    <div class="card">
      <form method="POST" action="/shorten">
        <input type="url" name="url" placeholder="https://example.com/a/very/long/link" required autofocus>
        <button type="submit">Shorten</button>
      </form>
      ${errorHtml}
      ${resultHtml}
    </div>

    <div class="card">
      <h2>Dashboard</h2>
      <table>
        <thead><tr><th>Short code</th><th>Destination</th><th class="clicks">Clicks</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `);
}

function notFoundPage(code) {
  return layout('404 — Link not found', `
    <div class="card center">
      <p class="big">404</p>
      <h1>Link not found</h1>
      <p class="sub">
        ${code ? `No link exists for <strong>/${escapeHtml(code)}</strong>.` : 'That page does not exist.'}
        It may have expired, or the code was mistyped.
      </p>
      <a class="back" href="/">&larr; Back to Shortly</a>
    </div>
  `);
}

module.exports = { homePage, notFoundPage, escapeHtml };
