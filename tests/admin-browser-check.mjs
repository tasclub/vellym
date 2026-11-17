import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';

const root = await mkdtemp('/tmp/opencode/vellym-admin-');
await mkdir(path.join(root, 'content'));
await writeFile(path.join(root, 'vellym.config.yaml'), 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\nplugins: []\n');
const reservation = createServer().listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
const server = spawn(process.execPath, ['packages/vellym/dist/cli.mjs', 'dev', '--config', path.join(root, 'vellym.config.yaml'), '--port', String(port)]);
let browser;
try {
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${url}/api/v1/bootstrap`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:320,height:800}, deviceScaleFactor:1});
  await page.goto(url);
  await page.getByRole('button', {name: /^Settings/}).click();
  await page.getByRole('heading', {name: 'Settings & admin details'}).waitFor();
  const summary = page.locator('summary').filter({hasText:'Bulk-add URL names'});
  const marker = summary.locator('span[aria-hidden="true"]');
  assert(await marker.isVisible());
  const before = await marker.evaluate(el => getComputedStyle(el).transform);
  await summary.click();
  assert(await summary.locator('..').evaluate(el => el.open));
  assert.notEqual(await marker.evaluate(el => getComputedStyle(el).transform), before);
  const text = await page.locator('main').innerText();
  assert(!/[\u3040-\u30ff\u3400-\u9fff]/u.test(text.replace('日本語', '')), 'Japanese text in English UI');
  await page.screenshot({path:'/tmp/opencode/vellym-admin-en.png', fullPage:true});
  console.log('English settings, visible marker and open state: passed');
} finally {
  await browser?.close();
  server.kill();
}
