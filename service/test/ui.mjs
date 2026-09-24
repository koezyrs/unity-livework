import { chromium, expect } from '@playwright/test';
import { WebSocket } from 'ws';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createLiveWork } from '../server.mjs';

await mkdir('../.artifacts', { recursive: true });
const app = await createLiveWork({ port: 0, code: '123456' });
const url = `http://127.0.0.1:${app.port}`;
const editor = new WebSocket(`ws://127.0.0.1:${app.port}/editor?token=${app.hostToken}`);
await new Promise((resolve, reject) => { editor.once('open', resolve); editor.once('error', reject); });
let state = { v: 1, type: 'state', state: 'stopped', isPlaying: false, isPaused: false, width: 1280, height: 720, quality: 'balanced', streaming: false, frame: 0, revision: 0 };
const commands = [];
editor.on('message', bytes => {
  const msg = JSON.parse(bytes);
  if (msg.type !== 'command') return;
  commands.push(msg);
  if (msg.command === 'Play') Object.assign(state, { state: 'playing', isPlaying: true });
  if (msg.command === 'Stop') Object.assign(state, { state: 'stopped', isPlaying: false, isPaused: false });
  if (msg.command === 'Pause') Object.assign(state, { state: 'paused', isPaused: true });
  if (msg.command === 'Resume') Object.assign(state, { state: 'playing', isPaused: false });
  if (msg.command === 'Step') state.frame++;
  if (msg.command === 'SetResolution') Object.assign(state, { width: msg.width, height: msg.height });
  if (msg.command === 'SetStreamQuality') state.quality = msg.quality;
  editor.send(JSON.stringify(state));
  editor.send(JSON.stringify({ v: 1, type: 'result', id: msg.id, ok: true }));
});
editor.send(JSON.stringify(state));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
async function screenshot(name) { await page.screenshot({ path: '../.artifacts/ui-' + name + '.png' }); }
async function fit() {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  for (const button of await page.locator('#workspace button:visible').all()) {
    const box = await button.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44);
  }
}
try {
  await page.goto(url);
  await expect(page.locator('#workspace')).toBeHidden();
  await screenshot('pairing-desktop');
  await page.locator('#code').fill('000000'); await page.locator('#connectButton').click();
  await expect(page.locator('#pairError')).toHaveText('Incorrect pairing code');
  await page.goto(url + '/#pair=invalid');
  await expect.poll(() => new URL(page.url()).hash).toBe('');
  await expect(page.locator('#pairError')).toContainText('invalid');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url); await screenshot('pairing-mobile');
  await page.goto(url + '/#pair=123456');
  await expect(page.locator('#workspace')).toBeVisible();
  assert.equal(new URL(page.url()).hash, '');
  await expect(page.locator('.transport button')).toHaveCount(3);
  await expect(page.locator('#step')).toBeDisabled();
  await fit(); await screenshot('workspace-mobile');
  const rival = await browser.newPage();
  await rival.goto(url + '/#pair=123456');
  await expect(rival.locator('#pairError')).toContainText('Another browser'); await rival.close();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Stop');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#pause')).toHaveAttribute('aria-label', 'Resume');
  await page.locator('#step').click();
  await expect.poll(() => state.frame).toBe(1);
  await page.locator('#pause').click();
  await page.locator('#preset').selectOption('720x1280');
  await expect.poll(() => state.width).toBe(720);
  await expect(page.locator('#dimensions')).toBeHidden();
  await page.locator('#preset').selectOption('custom');
  await page.locator('#width').fill('1920'); await page.locator('#height').fill('1920');
  await page.locator('#resize').click();
  await expect(page.locator('#resolutionError')).toContainText('2,073,600');
  await page.locator('#width').fill('800'); await page.locator('#height').fill('600'); await page.locator('#resize').click();
  await expect.poll(() => state.width).toBe(800);
  await expect(page.locator('#dimensions')).toBeHidden();
  await expect(page.locator('#quality')).toHaveValue('balanced');
  await page.locator('#quality').selectOption('smooth');
  await expect.poll(() => state.quality).toBe('smooth');
  await expect(page.locator('#quality')).toBeEnabled();
  await page.locator('#mute').click(); await expect(page.locator('#mute')).toHaveAttribute('aria-label', 'Mute');
  assert.equal(await page.locator('#video').evaluate(v => v.muted), false);
  await page.locator('#mute').click();
  await page.locator('#fullscreen').click();
  await expect(page.locator('#exitFullscreen')).toBeVisible();
  await page.locator('#exitFullscreen').click();
  await expect(page.locator('#exitFullscreen')).toBeHidden();
  await page.reload(); await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#status')).toHaveText('playing');
  for (const [name, size] of [['desktop', [1440, 1000]], ['landscape', [844, 390]], ['narrow', [320, 568]]]) {
    await page.setViewportSize({ width: size[0], height: size[1] }); await fit(); await screenshot('workspace-' + name);
    const geometry = await page.locator('.transport').boundingBox();
    const settings = await page.locator('#settings').boundingBox();
    assert.ok(Math.abs(geometry.y - settings.y) < 1, 'Controls must remain on one row');
    if (size[0] > 700) assert.ok(Math.abs(geometry.x + geometry.width / 2 - size[0] / 2) < 1, 'Transport must be centered');
    assert.ok(settings.x >= geometry.x + geometry.width, 'Settings must not overlap transport');
  }
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('stopped');
  state = { ...state, state: 'reloading' }; editor.send(JSON.stringify(state));
  await expect(page.locator('#play')).toBeDisabled();
  state = { ...state, state: 'stopped' }; editor.send(JSON.stringify(state));
  await expect(page.locator('#play')).toBeEnabled();
  await app.close();
  await expect(page.locator('#status')).toHaveText('offline');
  await expect(page.locator('#play')).toBeDisabled();
  assert.deepEqual(errors, []);
  console.log('PASS: pairing, QR, exclusive control, transport, resolution validation, audio, fullscreen, reconnect and responsive layouts.');
  console.log('Commands:', commands.map(c => c.command).join(', '));
} finally { await browser.close(); editor.close(); await app.close(); }
