const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');

const db = require('./db');
const views = require('./views');

const app = express();
const PORT = process.env.PORT || 3000;
const MIN_PASSWORD = 8;

app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 },
  })
);

const findByName = db.prepare('SELECT * FROM users WHERE username = ?');
const findById = db.prepare('SELECT * FROM users WHERE id = ?');
const insertUser = db.prepare(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);

// Gate for protected routes: send anonymous visitors to /login.
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  const user = findById.get(req.session.userId);
  if (!user) {
    // Session outlived the row it points at.
    return req.session.destroy(() => res.redirect('/login'));
  }
  req.user = user;
  next();
}

app.get('/', (req, res) =>
  res.redirect(req.session.userId ? '/dashboard' : '/login')
);

app.get('/signup', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.send(views.signup());
});

app.post('/signup', async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  if (!username || !password) {
    return res
      .status(400)
      .send(views.signup({ error: 'Username and password are both required.', username }));
  }
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(username)) {
    return res.status(400).send(
      views.signup({
        error: 'Username must be 3-32 characters: letters, numbers, _ or - only.',
        username,
      })
    );
  }
  if (password.length < MIN_PASSWORD) {
    return res.status(400).send(
      views.signup({
        error: `Password is too weak — use at least ${MIN_PASSWORD} characters.`,
        username,
      })
    );
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const { lastInsertRowid } = insertUser.run(username, hash);
    req.session.userId = lastInsertRowid;
    res.redirect('/dashboard');
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res
        .status(409)
        .send(views.signup({ error: 'That username is already taken.', username }));
    }
    console.error(err);
    res.status(500).send(views.signup({ error: 'Something went wrong. Try again.', username }));
  }
});

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.send(views.login());
});

app.post('/login', async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const user = findByName.get(username);

  // Same message either way, so this can't be used to enumerate usernames.
  const ok = user && (await bcrypt.compare(password, user.password_hash));
  if (!ok) {
    return res
      .status(401)
      .send(views.login({ error: 'Incorrect username or password.', username }));
  }

  // New session id on login — blocks session fixation.
  req.session.regenerate((err) => {
    if (err) {
      console.error(err);
      return res.status(500).send(views.login({ error: 'Something went wrong. Try again.', username }));
    }
    req.session.userId = user.id;
    res.redirect('/dashboard');
  });
});

app.get('/dashboard', requireLogin, (req, res) => {
  res.send(views.dashboard(req.user));
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

app.use((req, res) => res.status(404).send('Not found'));

if (require.main === module) {
  app.listen(PORT, () => console.log(`Auth server running on http://localhost:${PORT}`));
}

module.exports = app;
