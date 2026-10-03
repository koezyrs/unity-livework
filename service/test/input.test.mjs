import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inputGate, pointInVideo } from '../public/input.js';

const fakeChannel = (bufferedAmount = 0) => ({
  readyState: 'open', bufferedAmount, sent: [],
  send(msg) { this.sent.push(JSON.parse(msg)); }
});

test('input gate sends every message directly on an idle channel', () => {
  let revision = 1;
  const ch = fakeChannel();
  const gate = inputGate(() => ch, (channel, data) => channel.send(JSON.stringify({ v: 1, revision, ...data })));
  gate.attach(ch);
  assert.equal(ch.bufferedAmountLowThreshold, 32768, 'attach arms the low-water mark');
  assert.equal(typeof ch.onbufferedamountlow, 'function');
  gate.send({ type: 'touch', id: 1, phase: 'began' });
  gate.send({ type: 'touch', id: 1, phase: 'moved' });
  assert.deepEqual(ch.sent, [
    { v: 1, revision: 1, type: 'touch', id: 1, phase: 'began' },
    { v: 1, revision: 1, type: 'touch', id: 1, phase: 'moved' }
  ]);
});

test('congestion drops merged moves but never gesture boundaries, keys or heartbeats', () => {
  let revision = 1;
  const ch = fakeChannel(65536);
  const gate = inputGate(() => ch, (channel, data) => channel.send(JSON.stringify({ v: 1, revision, ...data })));
  gate.attach(ch);
  gate.send({ type: 'touch', id: 1, phase: 'moved' });
  gate.send({ type: 'mouse', x: .5, y: .5, buttons: 0, dx: 0, dy: 0, scroll: 0 });
  assert.equal(ch.sent.length, 0, 'moves are shed while the buffer is over the limit');
  gate.send({ type: 'touch', id: 1, phase: 'began' }, true);
  gate.send({ type: 'key', code: 'KeyA', down: true }, true);
  gate.send({ type: 'heartbeat' }, true);
  assert.equal(ch.sent.length, 3, 'boundaries are delivered even while congested');
  ch.bufferedAmount = 100;
  ch.onbufferedamountlow();
  gate.send({ type: 'touch', id: 1, phase: 'ended' }, true);
  // Sends are stamped with the revision known at delivery time, not when queued.
  revision = 2;
  gate.send({ type: 'touch', id: 1, phase: 'moved' });
  assert.deepEqual(ch.sent[3], { v: 1, revision: 1, type: 'touch', id: 1, phase: 'ended' });
  assert.deepEqual(ch.sent[4], { v: 1, revision: 2, type: 'touch', id: 1, phase: 'moved' });
});

test('a full buffer keeps boundary order and pauses moves until the low-water event', () => {
  const ch = fakeChannel(65536);
  const gate = inputGate(() => ch, (channel, data) => channel.send(JSON.stringify({ v: 1, revision: 1, ...data })));
  gate.attach(ch);
  gate.send({ type: 'touch', id: 2, phase: 'began' }, true);
  gate.send({ type: 'touch', id: 2, phase: 'moved' });
  gate.send({ type: 'touch', id: 2, phase: 'ended' }, true);
  gate.send({ type: 'touch', id: 2, phase: 'moved' });
  assert.deepEqual(ch.sent.map(m => m.phase), ['began', 'ended'], 'boundaries keep order while moves wait');
  ch.bufferedAmount = 0;
  ch.onbufferedamountlow();
  gate.send({ type: 'touch', id: 2, phase: 'moved' });
  assert.deepEqual(ch.sent.map(m => m.phase), ['began', 'ended', 'moved'], 'moves resume after the buffer drains');
});

test('a closed channel drops input and a new channel starts clean', () => {
  let ch = fakeChannel(65536);
  const gate = inputGate(() => ch, (channel, data) => channel.send(JSON.stringify({ v: 1, revision: 1, ...data })));
  gate.attach(ch);
  gate.send({ type: 'touch', id: 1, phase: 'moved' });
  assert.equal(ch.sent.length, 0, 'moves are shed and the gate pauses');
  ch.readyState = 'closing';
  gate.send({ type: 'touch', id: 1, phase: 'began' }, true);
  assert.equal(ch.sent.length, 0, 'a closed channel drops input');
  ch = fakeChannel();
  gate.attach(ch);
  gate.send({ type: 'touch', id: 1, phase: 'moved' });
  assert.deepEqual(ch.sent, [{ v: 1, revision: 1, type: 'touch', id: 1, phase: 'moved' }],
    'a fresh channel is never treated as congested');
});
test('a touch that starts just outside the video rect is clamped into it', () => {
  // The browser clamps began positions (input.js); the shared math must agree on both edges.
  const rect = { left: 0, top: 0, width: 1000, height: 1000 }, video = [720, 1280];
  assert.deepEqual(pointInVideo(0, 500, rect, ...video, true), { x: 0, y: .5 }, 'left edge clamps to zero');
  assert.deepEqual(pointInVideo(1100, 900, rect, ...video, true), { x: 1, y: .9 }, 'right/bottom edges clamp to one');
  assert.equal(pointInVideo(0, 500, rect, ...video), null, 'unclamped callers still map only the video content');
});
