import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
const config = JSON.parse(await readFile(process.env.LIVEWORK_HOST_CONFIG || new URL('../../sample/Library/LiveWork/host.json', import.meta.url), 'utf8'));
const snapshot = async () => JSON.parse(await readFile('../.artifacts/sample-live.json', 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, timeout = 30000) { const end = Date.now() + timeout; while (Date.now() < end) { try { const s = await snapshot(); if (f(s)) return s; } catch {} await sleep(100); } throw new Error('Unity condition timed out: ' + JSON.stringify(await snapshot())); }
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
const page = await context.newPage(), errors = [], report = [];
page.on('pageerror', e => errors.push(e.message));
const videoReady = () => page.waitForFunction(() => { const v = document.getElementById('video'); return v.videoWidth > 0 && v.readyState >= 2 && v.srcObject; }, null, { timeout: 30000 });
const status = name => expect(page.locator('#status')).toHaveText(name, { timeout: 30000 });
const record = name => { report.push(name); console.log('PASS', name); };
const fixture = `../${process.env.LIVEWORK_TEST_PROJECT || 'sample'}/Assets/ReloadFixture.cs`;
try {
  await page.goto(`http://127.0.0.1:${config.port}`);
  await page.locator('#code').fill(config.code); await page.locator('#pairing button').click();
  await page.waitForFunction(() => ['stopped', 'playing'].includes(document.getElementById('status').textContent));
  // Start with fresh scene listeners; an earlier development compile can discard
  // the sample's runtime-created UnityEvent callbacks while leaving Play active.
  if (await page.locator('#play').getAttribute('aria-label') === 'Stop') { await page.locator('#play').click(); await status('stopped'); }
  await page.locator('#play').click(); await status('playing'); await videoReady();
  await page.locator('#pause').click(); await status('paused'); await sleep(300); const frames = (await snapshot()).frames;
  await page.reload(); await status('paused'); await videoReady(); assert.equal((await snapshot()).frames, frames); record('reconnect while paused without advancing gameplay');
  await page.locator('#preset').selectOption('1280x720'); await until(s => s.width === 1280 && s.height === 720); await videoReady();
  assert.equal((await snapshot()).frames, frames); record('resize while paused without advancing gameplay');
  await page.locator('#pause').click(); await status('playing'); await videoReady();
  await page.waitForFunction(() => document.getElementById('video').videoWidth === 1280 && document.getElementById('video').videoHeight === 720);
  const beforeTap = (await snapshot()).clicks;
  const buttonPoint = await page.locator('#stage').evaluate(el => {
    const v = document.getElementById('video'), r = el.getBoundingClientRect(), scale = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
    return { x: r.x + r.width / 2, y: r.y + (r.height - v.videoHeight * scale) / 2 + v.videoHeight * scale * .892 };
  });
  await page.touchscreen.tap(buttonPoint.x, buttonPoint.y); await until(s => s.clicks === beforeTap + 1); await sleep(300);
  assert.equal((await snapshot()).clicks, beforeTap + 1); record('touch UI fires once in Both mode');
  await writeFile('../.artifacts/reload-scene', ''); await sleep(1500); await videoReady();
  await page.locator('#stage').focus(); await page.keyboard.down('d'); await until(s => s.key); await page.keyboard.up('d'); record('scene change keeps video/input');
  await writeFile(fixture, 'public static class LiveWorkReloadFixture { public const int Value = 1; }\n'); await writeFile('../.artifacts/refresh-sample', '');
  await sleep(1500); await status('playing'); await videoReady();
  await page.locator('#stage').focus(); await page.keyboard.down('d'); await until(s => s.key); await page.keyboard.up('d'); await until(s => !s.key); record('script compile/domain reload reconnects video and input');
  await page.getByRole('button', { name: 'Stop', exact: true }).click(); await status('stopped');
  await writeFile(fixture, 'public static class LiveWorkReloadFixture { THIS_IS_A_COMPILE_ERROR }\n'); await writeFile('../.artifacts/refresh-sample', '');
  await status('error'); await page.locator('#play').click(); await sleep(800); assert.equal((await snapshot()).playing, false); record('compile errors cannot report successful Play');
  await writeFile(fixture, 'public static class LiveWorkReloadFixture { public const int Value = 2; }\n'); await writeFile('../.artifacts/refresh-sample', '');
  await status('stopped'); await page.locator('#play').click(); await status('playing'); await videoReady(); record('recover after fixing compile error');
  assert.deepEqual(errors, []); record('no browser errors during recovery');
} catch (error) { console.log('ERRORS', errors); if (!page.isClosed()) await page.screenshot({ path: '../.artifacts/recovery-failure.png' }); throw error; }
finally { await writeFile(fixture, 'public static class LiveWorkReloadFixture { public const int Value = 2; }\n'); await writeFile('../.artifacts/recovery-report.json', JSON.stringify(report, null, 2)); await browser.close(); }
