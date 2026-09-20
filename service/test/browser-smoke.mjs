import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const config = JSON.parse(await readFile(new URL('../.local/host.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
try {
  await page.goto(process.env.LIVEWORK_TEST_URL || `http://127.0.0.1:${config.port}`);
  await page.locator('#code').fill(config.code);
  await page.locator('#pairing button').click();
  await page.locator('#play').waitFor({ state: 'visible' });
  await page.waitForFunction(() => ['stopped', 'playing'].includes(document.getElementById('status').textContent), null, { timeout: 15000 });
  if (await page.locator('#play').isEnabled()) await page.locator('#play').click();
  await page.waitForFunction(() => document.getElementById('video').videoWidth > 0 && document.getElementById('video').readyState >= 2, null, { timeout: 60000 });
  await page.screenshot({ path: '../.artifacts/livework-desktop.png' });
  console.log('VIDEO', await page.locator('#video').evaluate(v => ({ width: v.videoWidth, height: v.videoHeight, state: v.readyState, tracks: v.srcObject.getTracks().map(t => t.kind) })));
  console.log('STATUS', await page.locator('#status').textContent());
  const audio = await page.locator('#video').evaluate(async v => {
    const ctx = new AudioContext(); await ctx.resume();
    const source = ctx.createMediaStreamSource(v.srcObject), analyser = ctx.createAnalyser(); source.connect(analyser);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
    source.disconnect(); await ctx.close(); return rms;
  });
  if (audio < .0001) throw new Error(`No audible signal received: rms=${audio}`);
  console.log('AUDIO_RMS', audio);
  console.log('STATS', await page.locator('#stats').textContent());
  console.log('ERRORS', JSON.stringify(errors));
} catch (error) {
  await page.screenshot({ path: '../.artifacts/livework-failure.png' });
  console.log('STATUS', await page.locator('#status').textContent()); console.log('MESSAGE', await page.locator('#message').textContent()); console.log('ERRORS', JSON.stringify(errors));
  throw error;
} finally { await browser.close(); }
