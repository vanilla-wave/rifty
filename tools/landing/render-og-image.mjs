#!/usr/bin/env node
// Renders apps/landing/public/og-image.svg → og-image.png (1200×630) and
// apple-touch-icon.svg → apple-touch-icon.png (180×180) through headless Chromium with
// the landing's self-hosted fonts, so the share card uses the same Archivo Black /
// Inter / Roboto Mono the page does. Run after editing either SVG:
//   node tools/landing/render-og-image.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(new URL('../..', import.meta.url).pathname);
const publicDir = resolve(root, 'apps/landing/public');
const fontsDir = resolve(root, 'apps/landing/src/assets/fonts');

const face = (family, file, weight) =>
  `@font-face{font-family:"${family}";src:url("${pathToFileURL(resolve(fontsDir, file)).href}") format("woff2");font-weight:${weight};}`;
const html = (svg, width, height) => `<!doctype html><html><head><meta charset="utf-8"><style>
${face('Archivo Black', 'archivo-black-latin-v23.woff2', '400')}
${face('Inter', 'inter-latin-v20.woff2', '100 900')}
${face('Roboto Mono', 'roboto-mono-latin-v31.woff2', '100 700')}
html,body{margin:0;background:#15171d;width:${width}px;height:${height}px;overflow:hidden}
svg{display:block}
</style></head><body>${svg}</body></html>`;

const browser = await chromium.launch();
async function render(svgFile, pngFile, width, height) {
  const svg = readFileSync(resolve(publicDir, svgFile), 'utf8');
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html(svg, width, height), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height } });
  await page.close();
  writeFileSync(resolve(publicDir, pngFile), png);
  console.log(`${pngFile} written (${png.length} bytes)`);
}
await render('og-image.svg', 'og-image.png', 1200, 630);
await render('apple-touch-icon.svg', 'apple-touch-icon.png', 180, 180);
await browser.close();
