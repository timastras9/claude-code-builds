// Two real WebSocket clients proving messages flow between them.
const WebSocket = require('ws');

const URL = process.env.CHAT_URL || 'ws://localhost:3000';
const checks = [];

function check(name, pass, detail = '') {
  checks.push({ name, pass, detail });
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}

// Resolves once a frame satisfying `match` arrives, else rejects on timeout.
function waitFor(ws, match, label, ms = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`timed out waiting for ${label}`));
    }, ms);

    function onMessage(raw) {
      const msg = JSON.parse(raw);
      if (!match(msg)) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(msg);
    }

    ws.on('message', onMessage);
  });
}

function open(url) {
  const ws = new WebSocket(url);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

const send = (ws, payload) => ws.send(JSON.stringify(payload));

(async () => {
  console.log(`\nConnecting two clients to ${URL}\n`);

  // --- alice joins General ---
  const alice = await open(URL);
  const aliceJoined = waitFor(alice, (m) => m.type === 'joined', 'alice joined');
  send(alice, { type: 'join', username: 'alice', room: 'General' });
  const aJoin = await aliceJoined;
  check('alice joins General', aJoin.room === 'General', `room=${aJoin.room}`);
  check(
    'server advertises three rooms',
    JSON.stringify(aJoin.rooms) === JSON.stringify(['General', 'Dev', 'Random'])
  );

  // --- bob joins the same room; alice sees the system message + roster ---
  const aliceSeesBobJoin = waitFor(
    alice,
    (m) => m.type === 'system' && m.text.includes('bob'),
    'join system message'
  );
  const aliceSeesRoster = waitFor(
    alice,
    (m) => m.type === 'users' && m.users.includes('bob'),
    'roster with bob'
  );

  const bob = await open(URL);
  const bobJoined = waitFor(bob, (m) => m.type === 'joined', 'bob joined');
  send(bob, { type: 'join', username: 'bob', room: 'General' });
  await bobJoined;

  const joinNote = await aliceSeesBobJoin;
  check('alice sees bob join', joinNote.text === 'bob joined General', joinNote.text);

  const roster = await aliceSeesRoster;
  check(
    'online sidebar lists both users',
    roster.users.length === 2 && roster.users.includes('alice'),
    roster.users.join(', ')
  );

  // --- the core claim: a message from alice reaches bob ---
  const bobGetsMessage = waitFor(
    bob,
    (m) => m.type === 'message' && m.username === 'alice',
    "alice's message"
  );
  send(alice, { type: 'message', text: 'hello bob' });
  const got = await bobGetsMessage;
  check('alice -> bob message delivered', got.text === 'hello bob', `"${got.text}"`);

  // --- and back the other way ---
  const aliceGetsReply = waitFor(
    alice,
    (m) => m.type === 'message' && m.username === 'bob',
    "bob's reply"
  );
  send(bob, { type: 'message', text: 'hey alice' });
  const reply = await aliceGetsReply;
  check('bob -> alice message delivered', reply.text === 'hey alice', `"${reply.text}"`);

  // --- typing indicator ---
  const aliceSeesTyping = waitFor(
    alice,
    (m) => m.type === 'typing' && m.username === 'bob' && m.typing === true,
    'typing indicator'
  );
  send(bob, { type: 'typing', typing: true });
  const typing = await aliceSeesTyping;
  check('typing indicator relayed', typing.username === 'bob');

  // --- room isolation: carol in Dev must not receive General traffic ---
  const carol = await open(URL);
  const carolJoined = waitFor(carol, (m) => m.type === 'joined', 'carol joined');
  send(carol, { type: 'join', username: 'carol', room: 'Dev' });
  await carolJoined;

  let leaked = false;
  carol.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.type === 'message' && m.text === 'General only') leaked = true;
  });
  send(alice, { type: 'message', text: 'General only' });
  await new Promise((r) => setTimeout(r, 400));
  check('rooms are isolated', !leaked, leaked ? 'message crossed rooms' : 'no leak');

  // --- history replay: a newcomer receives the last 50 messages ---
  const dave = await open(URL);
  const daveJoined = waitFor(dave, (m) => m.type === 'joined', 'dave joined');
  send(dave, { type: 'join', username: 'dave', room: 'General' });
  const dJoin = await daveJoined;
  const texts = dJoin.history.filter((m) => m.type === 'message').map((m) => m.text);
  check(
    'history replayed to newcomer',
    texts.includes('hello bob') && texts.includes('hey alice'),
    `${dJoin.history.length} entries`
  );
  // Overflow the log in an untouched room, then confirm the cap really trims.
  const flooder = await open(URL);
  const flooderJoined = waitFor(flooder, (m) => m.type === 'joined', 'flooder joined');
  send(flooder, { type: 'join', username: 'flooder', room: 'Random' });
  await flooderJoined;

  for (let i = 1; i <= 60; i++) {
    send(flooder, { type: 'message', text: `flood ${i}` });
  }
  // Wait until the 60th has been echoed back, so the server has processed all.
  await waitFor(
    flooder,
    (m) => m.type === 'message' && m.text === 'flood 60',
    'final flood message'
  );

  const late = await open(URL);
  const lateJoined = waitFor(late, (m) => m.type === 'joined', 'late joined');
  send(late, { type: 'join', username: 'late', room: 'Random' });
  const lJoin = await lateJoined;

  check(
    'history capped at exactly 50',
    lJoin.history.length === 50,
    `${lJoin.history.length} entries after 60 messages`
  );

  const floodTexts = lJoin.history.filter((m) => m.type === 'message').map((m) => m.text);
  check(
    'cap drops oldest, keeps newest',
    floodTexts.includes('flood 60') && !floodTexts.includes('flood 1'),
    `oldest kept: ${floodTexts[0]}`
  );

  flooder.close();
  late.close();

  // --- leave message on disconnect ---
  const aliceSeesLeave = waitFor(
    alice,
    (m) => m.type === 'system' && m.text.includes('bob left'),
    'leave system message'
  );
  bob.close();
  const leaveNote = await aliceSeesLeave;
  check('leave message broadcast', leaveNote.text === 'bob left General', leaveNote.text);

  for (const ws of [alice, carol, dave]) ws.close();

  const failed = checks.filter((c) => !c.pass);
  console.log(
    `\n${checks.length - failed.length}/${checks.length} checks passed\n`
  );
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(`\nTEST ERROR: ${err.message}\n`);
  process.exit(1);
});
