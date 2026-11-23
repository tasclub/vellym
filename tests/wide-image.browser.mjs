// Run after npm run build: node tests/wide-image.browser.mjs
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';

const root = await mkdtemp(path.join(tmpdir(), 'wide-image-'));
let browser, server, staticServer;
try {
  await mkdir(path.join(root, 'content'));
  await mkdir(path.join(root, 'assets'));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  for (const [name, width, height] of [['wide', 3000, 1000], ['small', 200, 100]]) {
    const data = await page.evaluate(([w,h]) => { const c = document.createElement('canvas'); c.width=w; c.height=h; c.getContext('2d').fillRect(0,0,w,h); return c.toDataURL('image/png').split(',')[1]; }, [width,height]);
    await writeFile(path.join(root, 'assets', `${name}.png`), Buffer.from(data, 'base64'));
  }
  await writeFile(path.join(root, 'content/page.yaml'), `apiVersion: vellym.tasclub.com/v1
kind: Page
metadata:
  name: page
  title: Images
spec:
  locale: en
  blocks:
    - id: body
      type: rich-text
      content: |
        ![Wide](asset:wide.png)

        ![Small](asset:small.png)

        [![Linked](asset:wide.png)](https://example.com)
`);
  const config = path.join(root, 'vellym.config.yaml');
  await writeFile(config, 'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist\nui:\n  language: en\ni18n:\n  defaultLocale: en\nplugins: []\n');
  server = spawn(process.execPath, ['packages/vellym/dist/cli.mjs', 'dev', '--config', config, '--port', '4197']);
  let output = ''; server.stdout.on('data', d => output += d); server.stderr.on('data', d => output += d);
  for (let n=0;;n++) { try { if ((await fetch('http://127.0.0.1:4197/api/v1/repository')).ok) break; } catch {} if (n>100) throw Error(output); await new Promise(r => setTimeout(r,100)); }
  async function checkReader(url) {
    await page.goto(url, { waitUntil: 'networkidle' });
    const zoom = page.getByRole('button', { name: 'Zoom image: Wide' });
    await expect(zoom).toBeVisible();
    const metrics = await zoom.locator('img').evaluate(img => ({ width: img.clientWidth, height: img.clientHeight, natural: img.naturalWidth, naturalHeight: img.naturalHeight, parent: img.closest('section').clientWidth, scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(metrics.width).toBeLessThanOrEqual(metrics.parent); expect(metrics.scroll).toBeLessThanOrEqual(metrics.viewport);
    expect(Math.abs(metrics.width/metrics.height/(metrics.natural/metrics.naturalHeight)-1)).toBeLessThan(.01);
    expect(await page.getByRole('img', {name:'Small'}).evaluate(i => i.clientWidth)).toBe(200);
    await expect(page.getByRole('button', {name:'Zoom image: Small'})).toHaveCount(0);
    await expect(page.locator('a').filter({has: page.getByRole('img', {name:'Linked'})})).toHaveAttribute('href', 'https://example.com');
    await expect(page.getByRole('button', {name:'Zoom image: Linked'})).toHaveCount(0);
    await zoom.click(); const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
    expect(await dialog.locator('img').evaluate(i => i.clientWidth)).toBe(3000);
    expect(await dialog.locator('[class*=image-full-scroll]').evaluate(e => e.scrollWidth > e.clientWidth)).toBe(true);
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(zoom).toBeFocused();
    await zoom.click(); await dialog.getByRole('button', {name:'Close'}).click(); await expect(zoom).toBeFocused();
  }
  await checkReader('http://127.0.0.1:4197/en/pages/page/');
  await page.getByRole('button', {name:'Edit', exact:true}).click();
  const editorImage = page.locator('.ProseMirror img[alt="Wide"]'); await expect(editorImage).toBeVisible();
  expect(await editorImage.evaluate(i => i.getBoundingClientRect().width <= i.closest('.ProseMirror').getBoundingClientRect().width)).toBe(true);
  const build = execFileSync(process.execPath, ['packages/vellym/dist/cli.mjs', 'build', '--config', config, '--json'], { encoding:'utf8' });
  const dist = JSON.parse(build).data.outputDir;
  staticServer = createServer(async (req,res) => { try { let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(dist, p); const data = await readFile(f); const ext = path.extname(f); res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'})[ext] || 'application/octet-stream'); res.end(data); } catch { res.writeHead(404).end(); } });
  await new Promise(r => staticServer.listen(0, '127.0.0.1', r));
  await checkReader(`http://127.0.0.1:${staticServer.address().port}/pages/page/`);
  console.log('Wide images: reader, zoom, links, editor and static output passed');
} finally { await browser?.close(); server?.kill(); staticServer?.close(); await rm(root, { recursive:true, force:true }); }
