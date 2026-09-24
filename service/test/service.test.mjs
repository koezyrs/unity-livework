import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createLiveWork, createTrust, tailscale } from '../server.mjs';
import { pointInVideo } from '../public/input.js';

const open = (url, options) => new Promise((resolve, reject) => { const ws = new WebSocket(url, options); ws.once('open', () => resolve(ws)); ws.once('error', reject); });
const message = (ws, predicate = () => true) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { ws.off('message', handler); reject(new Error('Message timed out')); }, 2000);
  const handler = bytes => { const data = JSON.parse(bytes); if (predicate(data)) { clearTimeout(timer); ws.off('message', handler); resolve(data); } };
  ws.on('message', handler);
});

test('pairing, exclusive control, command validation, and reconnect without replay', async () => {
  const app = await createLiveWork({ port: 0, code: '123456' });
  const url = `http://127.0.0.1:${app.port}`, wsurl = `ws://127.0.0.1:${app.port}`;
  const pair = code => fetch(`${url}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  try {
    assert.equal((await pair('wrong')).status, 401);
    assert.equal((await pair('éééééé')).status, 401);
    await assert.rejects(open(`${wsurl}/control`));
    await assert.rejects(open(`${wsurl}/editor?token=wrong`));
    const res = await pair('123456'); assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const options = { headers: { Cookie: cookie } };
    const control = await open(`${wsurl}/control`, options);
    await assert.rejects(open(`${wsurl}/control`, options));
    assert.equal((await pair('123456')).status, 409);
    let reply = message(control, m => m.id === 'offline');
    control.send(JSON.stringify({ v: 1, type: 'command', command: 'Play', id: 'offline' }));
    assert.equal((await reply).ok, false);
    const editor = await open(`${wsurl}/editor?token=${app.hostToken}`);
    const state = message(control, m => m.type === 'state');
    editor.send(JSON.stringify({ v: 1, type: 'state', state: 'stopped', width: 1280, height: 720 }));
    assert.equal((await state).state, 'stopped');
    reply = message(control, m => m.id === 'badsize');
    control.send(JSON.stringify({ v: 1, type: 'command', command: 'SetResolution', id: 'badsize', width: 999999, height: 721 }));
    assert.equal((await reply).ok, false);
    reply = message(control, m => m.id === 'badquality');
    control.send(JSON.stringify({ v: 1, type: 'command', command: 'SetStreamQuality', id: 'badquality', quality: 'ultra' }));
    assert.equal((await reply).ok, false);
    const forwarded = message(editor, m => m.type === 'command');
    control.send(JSON.stringify({ v: 1, type: 'command', command: 'Play', id: 'play1' }));
    assert.equal((await forwarded).id, 'play1');
    reply = message(control, m => m.id === 'play1');
    editor.send(JSON.stringify({ v: 1, type: 'result', id: 'play1', ok: true }));
    assert.equal((await reply).ok, true);
    const reset = message(editor, m => m.type === 'resetInput');
    control.close(); assert.equal((await reset).v, 1);
    const again = await open(`${wsurl}/control`, options);
    assert.equal(app.server.listening, true);
    again.close(); editor.close();
  } finally { await app.close(); }
});

// The service sends its first messages as soon as the socket opens, so collect them from the start.
const connect = (url, options) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url, options); ws.first = [];
  const keep = bytes => ws.first.push(JSON.parse(bytes));
  ws.on('message', keep);
  ws.once('open', () => setTimeout(() => { ws.off('message', keep); resolve(ws); }, 100)); ws.once('error', reject);
});

test('forward scenes and logs, replay them on reconnect, and validate scene commands', async () => {
  const app = await createLiveWork({ port: 0, code: '123456' });
  const url = `http://127.0.0.1:${app.port}`, wsurl = `ws://127.0.0.1:${app.port}`;
  try {
    const res = await fetch(`${url}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '123456' }) });
    const options = { headers: { Cookie: res.headers.get('set-cookie').split(';')[0] } };
    const editor = await open(`${wsurl}/editor?token=${app.hostToken}`);
    editor.send(JSON.stringify({ v: 1, type: 'scenes', scenes: [{ path: 'Assets/Main.unity', name: 'Main', inBuild: true }, { path: 'Assets/notes.txt', name: 'Bad' }, { path: 'Assets/Other.unity', name: 'Other' }] }));
    const long = 'x'.repeat(5000);
    editor.send(JSON.stringify({ v: 1, type: 'logs', entries: [{ level: 'info', message: 'first', stack: '', time: 1 }, { level: 'fatal', message: 'dropped' }, { level: 'error', message: long, stack: long + long, time: 2 }] }));
    for (let i = 0; i < 6; i++) editor.send(JSON.stringify({ v: 1, type: 'logs', entries: Array.from({ length: 100 }, (_, n) => ({ level: 'info', message: `bulk ${i}-${n}`, stack: '' })) }));
    await new Promise(resolve => setTimeout(resolve, 200));
    let control = await connect(`${wsurl}/control`, options);
    const scenes = control.first.find(m => m.type === 'scenes'), logs = control.first.find(m => m.type === 'logs');
    assert.deepEqual(scenes.scenes.map(s => s.path), ['Assets/Main.unity', 'Assets/Other.unity']);
    assert.equal(scenes.truncated, true);
    assert.equal(logs.replay, true);
    assert.equal(logs.entries.length, 500);
    assert.equal(logs.entries.at(-1).message, 'bulk 5-99');
    assert.ok(logs.entries.every((e, i) => i === 0 || e.seq === logs.entries[i - 1].seq + 1));
    control.close(); await new Promise(resolve => setTimeout(resolve, 100));
    editor.send(JSON.stringify({ v: 1, type: 'logs', entries: [{ level: 'error', message: long, stack: long + long }] }));
    control = await connect(`${wsurl}/control`, options);
    const replay = control.first.find(m => m.type === 'logs');
    assert.equal(replay.entries.at(-1).message.length, 4000);
    assert.equal(replay.entries.at(-1).stack.length, 8000);
    const live = message(control, m => m.type === 'logs' && !m.replay);
    editor.send(JSON.stringify({ v: 1, type: 'logs', entries: [{ level: 'warning', message: 'live' }] }));
    assert.equal((await live).entries[0].message, 'live');
    const secret = message(control, m => m.type === 'logs' && !m.replay);
    editor.send(JSON.stringify({ v: 1, type: 'logs', entries: [{ level: 'info', message: `Signaling: Connecting WS ws://127.0.0.1/signal/editor?token=${app.hostToken}`, stack: `at ${app.hostToken}` }] }));
    const hidden = (await secret).entries[0];
    assert.ok(!hidden.message.includes(app.hostToken) && !hidden.stack.includes(app.hostToken), 'Logs must not reveal the host token');
    assert.match(hidden.message, /token=\[host token\]$/);
    for (const command of ['Play', 'SelectScene']) {
      for (const [id, scene] of [['unknown', 'Assets/Missing.unity'], ['notscene', 'Assets/notes.txt'], ['number', 5]]) {
        const reply = message(control, m => m.id === command + id);
        control.send(JSON.stringify({ v: 1, type: 'command', command, id: command + id, scene }));
        assert.equal((await reply).ok, false, command + id);
      }
    }
    const missing = message(control, m => m.id === 'noscene');
    control.send(JSON.stringify({ v: 1, type: 'command', command: 'SelectScene', id: 'noscene' }));
    assert.equal((await missing).ok, false);
    const selected = message(editor, m => m.type === 'command');
    control.send(JSON.stringify({ v: 1, type: 'command', command: 'SelectScene', id: 'select', scene: 'Assets/Main.unity' }));
    assert.equal((await selected).scene, 'Assets/Main.unity');
    const forwarded = message(editor, m => m.type === 'command');
    control.send(JSON.stringify({ v: 1, type: 'command', command: 'Play', id: 'scene', scene: 'Assets/Other.unity' }));
    assert.equal((await forwarded).scene, 'Assets/Other.unity');
    control.close(); editor.close();
  } finally { await app.close(); }
});

test('reject cross-origin pairing and websocket requests', async () => {
  const app = await createLiveWork({ port: 0, code: '123456' });
  try {
    const response = await fetch(`http://127.0.0.1:${app.port}/api/pair`, { method: 'POST', headers: { Origin: 'https://attacker.invalid' }, body: '{"code":"123456"}' });
    assert.equal(response.status, 403);
    await assert.rejects(open(`ws://127.0.0.1:${app.port}/editor?token=${app.hostToken}`, { origin: 'https://attacker.invalid' }));
  } finally { await app.close(); }
});

test('map only the video content, with portrait/landscape letterboxing', () => {
  const rect = { left: 0, top: 0, width: 1000, height: 1000 };
  assert.equal(pointInVideo(500, 0, rect, 1280, 720), null);
  assert.deepEqual(pointInVideo(500, 500, rect, 1280, 720), { x: .5, y: .5 });
  assert.equal(pointInVideo(0, 500, rect, 720, 1280), null);
  assert.deepEqual(pointInVideo(0, 500, rect, 720, 1280, true), { x: 0, y: .5 });
  assert.equal(pointInVideo(0, 0, rect, 0, 0), null);
});

test('shutdown requires the host token, closes clients and releases its port', async () => {
  const app = await createLiveWork({ port: 0, code: '123456' });
  const base = `http://127.0.0.1:${app.port}`;
  try {
    assert.equal((await fetch(base + '/api/shutdown')).status, 405);
    assert.equal((await fetch(base + '/api/shutdown', { method: 'POST' })).status, 403);
    assert.equal((await fetch(base + '/api/shutdown', { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status, 403);
    assert.equal((await fetch(base + '/api/shutdown', { method: 'POST', headers: { Authorization: `Bearer ${app.hostToken}`, Origin: 'https://attacker.invalid' } })).status, 403);
    const editor = await open(`ws://127.0.0.1:${app.port}/editor?token=${app.hostToken}`);
    const disconnected = new Promise(resolve => editor.once('close', resolve));
    const response = await fetch(base + '/api/shutdown', { method: 'POST', headers: { Authorization: `Bearer ${app.hostToken}` } });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
    await disconnected; await app.close();
    assert.equal(app.server.listening, false);
    const restarted = await createLiveWork({ port: app.port });
    await restarted.close();
  } finally { await app.close(); }
});

test('trust only loopback and the networks of the chosen connection mode', async () => {
  const lan = createTrust(['192.168.1.0/24']);
  assert.equal(lan('127.0.0.1'), true);
  assert.equal(lan('::1'), true);
  assert.equal(lan('192.168.1.42'), true);
  assert.equal(lan('::ffff:192.168.1.42'), true);
  assert.equal(lan('192.168.2.42'), false);
  assert.equal(lan('100.100.1.1'), false);
  assert.equal(lan(undefined), false);
  const tail = createTrust(tailscale);
  assert.equal(tail('100.64.0.1'), true);
  assert.equal(tail('100.127.255.254'), true);
  assert.equal(tail('100.128.0.1'), false);
  assert.equal(tail('fd7a:115c:a1e0::1'), true);
  assert.equal(tail('192.168.1.42'), false);
  const app = await createLiveWork({ port: 0, code: '123456', mode: 'lan', trust: ['10.0.0.0/8'] });
  try {
    assert.equal(app.mode, 'lan');
    assert.deepEqual(app.trust, ['10.0.0.0/8']);
    assert.equal((await fetch(`http://127.0.0.1:${app.port}/api/health`)).status, 200);
  } finally { await app.close(); }
});
