'use strict';

/**
 * Read the live renderer DOM over the Chrome DevTools Protocol.
 *
 * Screenshots lie about small text. This asks the renderer directly.
 *
 *   ./node_modules/.bin/electron . --remote-debugging-port=9222
 *   node scripts/probe.js                       # dump DOM text
 *   node scripts/probe.js "OUTPUT ON"           # assert substring, exit 1 on miss
 *   node scripts/probe.js --shot /tmp/w.png     # also capture the window
 *
 * Attaches with Node's global WebSocket (Node >= 22, Electron bundles it).
 */

const fs = require('node:fs');
const path = require('node:path');

const CDP_PORT = process.env.CDP_PORT || 9222;

async function targets() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
  if (!res.ok) throw new Error(`CDP HTTP ${res.status} — is the app running with --remote-debugging-port?`);
  return res.json();
}

function cdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('CDP socket error')));
  });

  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    const waiter = pending.get(msg.id);
    if (waiter) { pending.delete(msg.id); waiter(msg); }
  });

  return {
    ready,
    send(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve) => pending.set(id, resolve));
    },
    close() { socket.close(); },
  };
}

(async () => {
  const args = process.argv.slice(2);
  const shotIndex = args.indexOf('--shot');
  const shotPath = shotIndex >= 0 ? args[shotIndex + 1] : null;
  if (shotIndex >= 0) args.splice(shotIndex, 2);
  const expect = args.find((a) => !a.startsWith('--')) || null;

  const list = await targets();
  // The app page is the one served from localhost, not the devtools frontend.
  const page = list.find((t) => t.type === 'page' && /127\.0\.0\.1|localhost/.test(t.url))
    || list.find((t) => t.type === 'page');
  if (!page) throw new Error(`no page target: ${list.map((t) => t.url).join(', ')}`);

  const conn = cdp(page.webSocketDebuggerUrl);
  await conn.ready;

  const result = await conn.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      url: location.href,
      title: document.title,
      text: document.body.innerText,
    })`,
    returnByValue: true,
    awaitPromise: true,
  });

  const payload = JSON.parse(result.result.result.value);
  console.log('URL      :', payload.url);
  console.log('TITLE    :', payload.title);
  console.log('BODYCHARS:', payload.text.length);
  console.log('--- body text ---');
  console.log(payload.text);

  if (shotPath) {
    const shot = await conn.send('Page.captureScreenshot', { format: 'png' });
    if (shot.result && shot.result.data) {
      fs.writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'));
      console.log(`\nscreenshot: ${shotPath}`);
    }
  }

  conn.close();

  if (expect) {
    const hit = payload.text.includes(expect);
    console.log(`\nassert "${expect}": ${hit ? 'PASS' : 'FAIL'}`);
    if (!hit) process.exit(1);
  }
})().catch((err) => {
  console.error('probe failed:', err.message);
  process.exit(1);
});
