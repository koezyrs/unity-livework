import { chromium, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const config = JSON.parse(await readFile(process.env.LIVEWORK_HOST_CONFIG || new URL('../../sample/Library/LiveWork/host.json', import.meta.url), 'utf8'));
const snapshot = async () => JSON.parse(await readFile('../.artifacts/sample-live.json', 'utf8'));
async function until(predicate, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const s = await snapshot(); if (predicate(s)) return s; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error(`Unity condition timed out; snapshot=${JSON.stringify(await snapshot())}`);
}
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
const page = await context.newPage(); const errors = [], report = [];
page.on('pageerror', e => errors.push(e.message));
const videoReady = () => page.waitForFunction(() => { const v = document.getElementById('video'); return v.videoWidth > 0 && v.readyState >= 2 && v.srcObject; }, null, { timeout: 30000 });
const status = name => expect(page.locator('#status')).toHaveText(name, { timeout: 30000 });
const record = (name, details = true) => { report.push({ name, details }); console.log('PASS', name, JSON.stringify(details)); };
try {
  await page.goto(`http://127.0.0.1:${config.port}`);
  await page.locator('#code').fill(config.code); await page.locator('#pairing button').click();
  await page.waitForFunction(() => ['stopped', 'playing'].includes(document.getElementById('status').textContent));
  if (await page.locator('#play').getAttribute('aria-label') === 'Play') await page.locator('#play').click();
  await status('playing'); await videoReady(); record('video and audio tracks', await page.locator('#video').evaluate(v => v.srcObject.getTracks().map(t => t.kind)));
  await page.locator('#stage').focus(); await page.keyboard.down('d'); await until(s => s.key); await page.keyboard.up('d'); await until(s => !s.key); record('remote keyboard down/up');
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await until(s => s.mouse); await page.mouse.up(); await until(s => !s.mouse); record('remote mouse down/up');
  const before = await snapshot();
  // 1280x720 video: bottom button center is normalized (0.5, 0.892).
  const clickPoint = await page.locator('#stage').evaluate(el => {
    const v = document.getElementById('video'), r = el.getBoundingClientRect(); const scale = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
    return { x: r.x + r.width / 2, y: r.y + (r.height - v.videoHeight * scale) / 2 + v.videoHeight * scale * .892 };
  });
  await page.mouse.click(clickPoint.x, clickPoint.y); await until(s => s.clicks === before.clicks + 1); record('uGUI click exactly once in Both mode');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width * .4, y: box.y + box.height * .5, id: 1 }, { x: box.x + box.width * .6, y: box.y + box.height * .5, id: 2 }] });
  await until(s => s.touches === 2 && s.legacyTouches === 2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await until(s => s.touches === 0 && s.legacyTouches === 0); record('multi-touch received by Input System and Legacy');
  await page.locator('#pause').click(); await status('paused'); await new Promise(r => setTimeout(r, 350));
  const paused = await snapshot(); await new Promise(r => setTimeout(r, 500)); assert.equal((await snapshot()).frames, paused.frames);
  await page.locator('#step').click(); const stepped = await until(s => s.frames > paused.frames); assert.equal(stepped.frames, paused.frames + 1); assert.equal(stepped.paused, true); record('Pause and exactly one frame', { before: paused.frames, after: stepped.frames });
  await page.screenshot({ path: '../.artifacts/livework-paused.png' });
  await page.locator('#pause').click(); await status('playing');
  await page.locator('#menu').click(); await page.getByRole('tab', { name: 'Settings' }).click(); await page.locator('#preset').selectOption('720x1280'); await page.locator('#closeSettings').click(); await until(s => s.width === 720 && s.height === 1280); await videoReady();
  await page.waitForFunction(() => document.getElementById('video').videoHeight > document.getElementById('video').videoWidth); record('portrait resolution and video reconnect');
  await page.setViewportSize({ width: 412, height: 915 }); await page.screenshot({ path: '../.artifacts/livework-mobile.png' });
  await page.reload(); await status('playing'); await videoReady(); record('browser reload and authenticated reconnect');
  await page.getByRole('button', { name: 'Stop', exact: true }).click(); await status('stopped'); await until(s => !s.playing); record('Stop keeps control connection alive');
  await page.locator('#play').click(); await status('playing'); await videoReady(); record('Play reconnect after domain reload');
  await page.locator('#stage').focus(); await page.keyboard.down('d'); await until(s => s.key); await page.close(); await until(s => !s.key); record('disconnect clears held input');
  assert.deepEqual(errors, []); record('no browser JS errors');
} catch (error) {
  if (!page.isClosed()) await page.screenshot({ path: '../.artifacts/workflow-failure.png' });
  console.log('ERRORS', errors); throw error;
} finally {
  await writeFile('../.artifacts/workflow-report.json', JSON.stringify(report, null, 2)); await browser.close();
}
