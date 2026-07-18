// Tiny HTML view layer — no template engine needed.

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

const STYLE = `
  *,*::before,*::after{box-sizing:border-box}
  body{
    margin:0;min-height:100vh;display:grid;place-items:center;
    font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    background:#0f172a;color:#e2e8f0;padding:24px;
  }
  .card{
    width:100%;max-width:400px;background:#1e293b;border:1px solid #334155;
    border-radius:14px;padding:32px;box-shadow:0 20px 50px rgba(0,0,0,.45);
  }
  h1{margin:0 0 4px;font-size:24px;letter-spacing:-.02em}
  .sub{margin:0 0 24px;color:#94a3b8;font-size:14px}
  label{display:block;margin-bottom:6px;font-size:13px;font-weight:600;color:#cbd5e1}
  input{
    width:100%;padding:11px 13px;margin-bottom:16px;border-radius:8px;
    border:1px solid #475569;background:#0f172a;color:#e2e8f0;font-size:15px;
  }
  input:focus{outline:2px solid #6366f1;outline-offset:1px;border-color:#6366f1}
  button{
    width:100%;padding:12px;border:0;border-radius:8px;background:#6366f1;
    color:#fff;font-size:15px;font-weight:600;cursor:pointer;
  }
  button:hover{background:#4f46e5}
  .error{
    background:#450a0a;border:1px solid #b91c1c;color:#fecaca;
    padding:10px 13px;border-radius:8px;margin-bottom:18px;font-size:14px;
  }
  .alt{margin:20px 0 0;text-align:center;font-size:14px;color:#94a3b8}
  a{color:#a5b4fc;text-decoration:none}
  a:hover{text-decoration:underline}
  .hint{
    margin-top:18px;padding:10px 13px;border-radius:8px;background:#0f172a;
    border:1px dashed #334155;color:#94a3b8;font-size:13px;text-align:center;
  }
  .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #334155;font-size:14px}
  .row:last-child{border-bottom:0}
  .row span:first-child{color:#94a3b8}
  .logout{display:block;margin-top:24px;padding:11px;text-align:center;border-radius:8px;
    background:#334155;color:#e2e8f0;font-weight:600}
  .logout:hover{background:#475569;text-decoration:none}
`;

const page = (title, body) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;

const errorBox = (msg) => (msg ? `<div class="error">${esc(msg)}</div>` : '');

exports.signup = ({ error = '', username = '' } = {}) =>
  page('Sign up', `
    <h1>Create account</h1>
    <p class="sub">Pick a username and a password of at least 8 characters.</p>
    ${errorBox(error)}
    <form method="POST" action="/signup">
      <label for="username">Username</label>
      <input id="username" name="username" value="${esc(username)}" autocomplete="username" autofocus>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="new-password">
      <button type="submit">Sign up</button>
    </form>
    <p class="alt">Already registered? <a href="/login">Log in</a></p>
  `);

exports.login = ({ error = '', username = '' } = {}) =>
  page('Log in', `
    <h1>Welcome back</h1>
    <p class="sub">Log in to reach your dashboard.</p>
    ${errorBox(error)}
    <form method="POST" action="/login">
      <label for="username">Username</label>
      <input id="username" name="username" value="${esc(username)}" autocomplete="username" autofocus>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password">
      <button type="submit">Log in</button>
    </form>
    <p class="alt">No account? <a href="/signup">Sign up</a></p>
    <div class="hint">Demo account — <strong>demo</strong> / <strong>demo1234</strong></div>
  `);

exports.dashboard = (user) =>
  page('Dashboard', `
    <h1>Hi, ${esc(user.username)} 👋</h1>
    <p class="sub">You are signed in. This page is protected.</p>
    <div class="row"><span>Username</span><span>${esc(user.username)}</span></div>
    <div class="row"><span>Member since</span><span>${esc(user.created_at)} UTC</span></div>
    <a class="logout" href="/logout">Log out</a>
  `);
