// Read-only browser check: host must already be playing in the intended project.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const config = JSON.parse(await readFile(process.env.LIVEWORK_HOST_CONFIG || new URL('../../sample/Library/LiveWork/host.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, hasTouch: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.LIVEWORK_TEST_URL || `http://127.0.0.1:${config.port}`);
  await page.locator('#code').fill(config.code); await page.locator('#pairing button').click();
  await expect(page.locator('#status')).toHaveText('playing', { timeout: 30000 });
  await page.waitForFunction(() => { const v = document.getElementById('video'); return v.videoWidth > 0 && v.readyState >= 2; }, null, { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '../.artifacts/installed-project.png' });
  const result = { media: await page.locator('#video').evaluate(v => ({ width: v.videoWidth, height: v.videoHeight, tracks: v.srcObject.getTracks().map(t => t.kind) })), errors };
  await writeFile('../.artifacts/installed-report.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result)); expect(errors).toEqual([]);
} finally { await browser.close(); }
