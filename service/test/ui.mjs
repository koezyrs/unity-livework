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
async function settled() { await page.locator('.sheet').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished))); }
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
  await page.addInitScript(() => {
    // Records whether the pairing form ever appears while a QR link connects.
    const watch = () => { if (document.getElementById('connect')?.hidden === false) window.connectShown = true; requestAnimationFrame(watch); };
    requestAnimationFrame(watch);
  });
  await page.goto(url + '/#pair=123456');
  await expect(page.locator('#workspace')).toBeVisible();
  assert.equal(await page.evaluate(() => window.connectShown ?? false), false, 'QR pairing must not flash the pairing form');
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
  await expect(page.locator('#settings')).toBeHidden();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#settingsTitle')).toHaveText('Settings');
  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('#menu')).toHaveAttribute('aria-expanded', 'true');
  await settled(); await screenshot('settings-mobile');
  await expect(page.locator('#preset')).toHaveValue('1280x720');
  // Periodic state updates must not rewrite the select; an open list on Android redraws on every change.
  await page.locator('#preset').evaluate(el => { window.presetChanges = 0; new MutationObserver(list => { window.presetChanges += list.length; }).observe(el, { subtree: true, childList: true, attributes: true, characterData: true }); });
  for (let i = 0; i < 3; i++) { state = { ...state, frame: state.frame + 1 }; editor.send(JSON.stringify(state)); }
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.presetChanges), 0, 'State updates must not touch the resolution select');
  await page.locator('#preset').selectOption('720x1280');
  await expect.poll(() => state.width).toBe(720);
  await expect(page.locator('#preset')).toHaveValue('720x1280');
  await expect(page.locator('#dimensions')).toBeHidden();
  await page.locator('#preset').selectOption('custom');
  await expect(page.locator('#dimensions')).toBeVisible();
  await page.locator('#width').fill('1920'); await page.locator('#height').fill('1920');
  await page.locator('#resize').click();
  await expect(page.locator('#resolutionError')).toContainText('2,073,600');
  await page.locator('#width').fill('800'); await page.locator('#height').fill('600'); await page.locator('#resize').click();
  await expect.poll(() => state.width).toBe(800);
  await expect(page.locator('#dimensions')).toBeHidden();
  await expect(page.locator('#preset')).toHaveValue('current');
  await expect(page.locator('#currentOption')).toHaveText('800 × 600 · Custom');
  await expect(page.getByLabel('Balanced')).toBeChecked();
  await page.locator('.choice', { hasText: 'Smooth' }).click();
  await expect.poll(() => state.quality).toBe('smooth');
  await expect(page.getByLabel('Smooth')).toBeEnabled();
  await expect(page.getByLabel('Smooth')).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings')).toBeHidden();
  await expect(page.locator('#menu')).toBeFocused();
  await page.locator('#menu').click(); await expect(page.locator('#settings')).toBeVisible();
  await page.locator('#closeSettings').click(); await expect(page.locator('#settings')).toBeHidden();
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
    const actions = await page.locator('.view-actions').boundingBox();
    assert.ok(Math.abs(geometry.y - actions.y) < 1, 'Controls must remain on one row');
    if (size[0] > 700) assert.ok(Math.abs(geometry.x + geometry.width / 2 - size[0] / 2) < 1, 'Transport must be centered');
    assert.ok(actions.x >= geometry.x + geometry.width, 'View actions must not overlap transport');
    const menu = await page.locator('#menu').boundingBox();
    assert.ok(size[0] - (menu.x + menu.width) <= 20, 'Menu must sit at the right edge');
    await page.locator('#menu').click(); await expect(page.locator('#settings')).toBeVisible();
    await settled(); await fit(); await screenshot('settings-' + name);
    const sheet = await page.locator('.sheet').boundingBox();
    assert.ok(sheet.x + sheet.width <= size[0] + 1, 'Settings must fit on screen');
    await page.locator('#closeSettings').click();
  }
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('stopped');
  state = { ...state, state: 'reloading' }; editor.send(JSON.stringify(state));
  await expect(page.locator('#play')).toBeDisabled();
  state = { ...state, state: 'stopped' }; editor.send(JSON.stringify(state));
  await expect(page.locator('#play')).toBeEnabled();
  // A short Editor disconnect must not show the "not connected" error at once.
  editor.close();
  await expect(page.locator('#status')).toHaveText('connecting');
  await expect(page.locator('#overlayText')).toHaveText('Starting video…');
  await app.close();
  await expect(page.locator('#status')).toHaveText('offline');
  await expect(page.locator('#play')).toBeDisabled();
  assert.deepEqual(errors, []);
  console.log('PASS: pairing, QR, exclusive control, transport, resolution validation, audio, fullscreen, reconnect and responsive layouts.');
  console.log('Commands:', commands.map(c => c.command).join(', '));
} finally { await browser.close(); editor.close(); await app.close(); }
