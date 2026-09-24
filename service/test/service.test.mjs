import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createLiveWork } from '../server.mjs';
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
