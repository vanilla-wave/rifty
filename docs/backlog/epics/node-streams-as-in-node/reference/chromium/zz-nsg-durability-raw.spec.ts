// THROWAWAY (node-streams Chromium durability fact): a guest writes 4 MiB of distinct bytes through
// fs.createWriteStream, end(), on 'finish' (or 'close') prints sha256 and process.exit(0); the page then
// reloads at once (variants: no flush / awaitDurability before reload), the OPFS-backed ('required')
// Workbench reopens and the file is read back (size + sha256) by the page and by a guest.
import { appendFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  bootOwner,
  execLine,
  flushOwnerDurable,
  gotoHarness,
  sealedWorkbenchFixtureUrl,
  writeOwnerFile,
} from './fixtures.ts';

const OUT = '/tmp/nsg-chromium/out/durability.jsonl';
const WRITER = `const fs=require('node:fs'),crypto=require('node:crypto');
const ev=process.argv[2];const N=4*1024*1024;const buf=Buffer.alloc(N);
let x=0x12345678;for(let i=0;i<N;i++){x=(Math.imul(x,1103515245)+12345)>>>0;buf[i]=x>>>24;}
const ws=fs.createWriteStream('dur.bin');
for(let o=0;o<N;o+=65536)ws.write(buf.subarray(o,o+65536));
ws.end();
ws.on(ev,()=>{console.log('event',ev,'sha256',crypto.createHash('sha256').update(buf).digest('hex'),'bytesWritten',ws.bytesWritten);process.exit(0);});
ws.on('error',e=>{console.log('error',e.code,e.message);process.exit(1);});`;
const READER = `const fs=require('node:fs'),crypto=require('node:crypto');
try{const b=fs.readFileSync('dur.bin');console.log('guest size',b.length,'sha256',crypto.createHash('sha256').update(b).digest('hex'));}
catch(e){console.log('guest read error',e.code);}`;

async function pageRead(page: import('@playwright/test').Page) {
  return page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    try {
      const read = await fixture.currentProject().files.readFile('/dur.bin');
      const bytes: Uint8Array = read.bytes;
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      return {
        size: bytes.length,
        sha256: Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join(''),
      };
    } catch (error) {
      return { error: String((error as Error)?.message ?? error) };
    }
  }, sealedWorkbenchFixtureUrl);
}

for (const ev of ['finish', 'close'] as const) {
  for (const flush of ['raw'] as const) {
    for (const i of [1, 2, 3]) {
      test(`durability ${ev} flush=${flush} run ${i}`, async ({ page, browser }) => {
        test.setTimeout(300_000);
        const boot = {
          workspaceId: `bu-nsg-dur-${ev}-${flush}-${i}-${Date.now().toString(36)}`,
          template: 'hidden-empty' as const,
          persistence: 'required' as const,
        };
        await gotoHarness(page);
        await bootOwner(page, boot);
        const storage = await page.evaluate(async (fixtureUrl) => {
          const fixture = await import(/* @vite-ignore */ fixtureUrl);
          return fixture.currentWorkbench().snapshot().storage;
        }, sealedWorkbenchFixtureUrl);
        const install = await execLine(page, 'npm install');
        expect(install.exit, install.out).toBe(0);
        await writeOwnerFile(page, '/scratch/writer.cjs', WRITER);
        await writeOwnerFile(page, '/scratch/reader.cjs', READER);
        await flushOwnerDurable(page); // scripts + install durable before the measured write
        const before = await pageRead(page);
        const run = await execLine(page, `node writer.cjs ${ev}`);
        const preReload = 'not read (raw: reload right after exit)';
        const tReload = Date.now();
        await page.reload();
        await expect(page.locator('#browser-unit-harness')).toHaveAttribute('data-status', 'ready');
        await bootOwner(page, boot);
        const afterPage = await pageRead(page);
        const guest = await execLine(page, 'node reader.cjs');
        const row = {
          chromium: browser.version(),
          ev,
          flush,
          run: i,
          storage,
          before,
          writer: { exit: run.exit, out: run.out.replaceAll('\r', '').trim() },
          preReload,
          reloadMs: Date.now() - tReload,
          afterPage,
          afterGuest: { exit: guest.exit, out: guest.out.replaceAll('\r', '').trim() },
        };
        appendFileSync(OUT, `${JSON.stringify(row)}\n`);
        console.log(JSON.stringify(row));
      });
    }
  }
}
