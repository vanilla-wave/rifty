// THROWAWAY (node-streams Chromium baseline): runs /tmp/nsg-chromium/programs/*.cjs as `node <program>`
// in the COI Workbench (owner + kernel, ephemeral VFS). Layout: /home/project/nsg/node_modules (exceljs
// closure) + /home/project/nsg/<name>/<name>.cjs, cwd = program dir, stdout redirected to a VFS file.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  bootOwner,
  closeOwner,
  execLine,
  gotoHarness,
  readOwnerFile,
  removeOwnerPath,
  sealedWorkbenchFixtureUrl,
  writeOwnerFile,
} from './fixtures.ts';

const PROGRAMS = '/tmp/nsg-chromium/programs';
const CLOSURE = '/tmp/nsg-chromium/closure.json';
const OUT = '/tmp/nsg-chromium/out/chromium-workbench.json';
const UNPACK = `const fs=require('node:fs'),path=require('node:path');
let n=0;for(const c of [process.argv[2]]){
const m=JSON.parse(fs.readFileSync(path.join(__dirname,c),'utf8'));
for(const [rel,b64] of Object.entries(m)){const p=path.join(__dirname,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.from(b64,'base64'));n++;}
fs.unlinkSync(path.join(__dirname,c));}
console.log('unpacked',n);`;

test('nsg programs in Chromium Workbench', async ({ page, browser }) => {
  test.setTimeout(3_600_000);
  const only = process.env.NSG_ONLY;
  const names = readdirSync(PROGRAMS)
    .filter((n) => n.endsWith('.cjs') && (!only || n.includes(only)))
    .sort();
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-nsg-chromium',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  const results: Record<string, unknown> = {};
  try {
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    const version = await execLine(page, 'node -p process.version');
    const userAgent = await page.evaluate(() => navigator.userAgent);
    if (names.some((n) => n.startsWith('c-'))) {
      const closure = Object.entries(
        JSON.parse(readFileSync(CLOSURE, 'utf8')) as Record<string, string>,
      );
      let chunk: Record<string, string> = {};
      let size = 0;
      let index = 0;
      const chunks: string[] = [];
      const flush = async () => {
        const t = Date.now();
        chunks.push(`.closure-${String(index).padStart(3, '0')}.json`);
        await writeOwnerFile(
          page,
          `/scratch/nsg/.closure-${String(index++).padStart(3, '0')}.json`,
          JSON.stringify(chunk),
        );
        console.log('chunk', index, Object.keys(chunk).length, 'files', Date.now() - t, 'ms');
        chunk = {};
        size = 0;
      };
      for (const [rel, b64] of closure) {
        chunk[rel] = b64;
        size += b64.length;
        if (size > 4_000_000) await flush();
      }
      if (size > 0) await flush();
      await writeOwnerFile(page, '/scratch/nsg/unpack.cjs', UNPACK);
      let total = 0;
      for (const c of chunks) {
        const t = Date.now();
        const unpack = await execLine(page, `node nsg/unpack.cjs ${c}`);
        expect(unpack.exit, unpack.out).toBe(0);
        total += Number(/unpacked (\d+)/.exec(unpack.out)?.[1]);
        console.log('unpack', c, unpack.out.trim(), Date.now() - t, 'ms');
      }
      expect(total).toBe(closure.length);
    }
    for (const file of names) {
      const name = file.replace(/\.cjs$/, '');
      await writeOwnerFile(
        page,
        `/scratch/nsg/${name}/${file}`,
        readFileSync(`${PROGRAMS}/${file}`, 'utf8'),
      );
      const line = `cd /home/project/nsg/${name} && node ${file} > ../${name}.stdout`;
      const t0 = Date.now();
      const run = await page.evaluate(
        async ({ fixtureUrl, line }) => {
          const fixture = await import(/* @vite-ignore */ fixtureUrl);
          // biome-ignore lint/suspicious/noExplicitAny: probe spec, copied into tests/ to run
          // biome-ignore lint/suspicious/noExplicitAny: probe spec, copied into tests/ to run
          const g = globalThis as unknown as { __nsgTerm?: any };
          g.__nsgTerm ??= fixture.currentProject().terminals.open();
          const t = g.__nsgTerm;
          let out = '';
          const detach = t.attach((c: string) => {
            out += c;
          });
          try {
            const r = t.run(line);
            const first = await Promise.race([
              r.exited,
              new Promise((res) => setTimeout(() => res('timeout'), 180_000)),
            ]);
            if (first === 'timeout') {
              await r.stop();
              const e = await r.exited;
              await r.close();
              return { timeout: true, exit: e, out };
            }
            await r.close();
            return { timeout: false, exit: first, out };
          } finally {
            detach();
          }
        },
        { fixtureUrl: sealedWorkbenchFixtureUrl, line },
      );
      const stdout = await readOwnerFile(page, `/scratch/nsg/${name}.stdout`);
      results[name] = { ...run, stdout, ms: Date.now() - t0 };
      console.log(
        name,
        JSON.stringify(run.exit),
        run.timeout ? 'TIMEOUT' : '',
        Date.now() - t0,
        'ms',
      );
      await execLine(page, 'cd /home/project');
      await removeOwnerPath(page, `/scratch/nsg/${name}`, true).catch(() => {});
      writeFileSync(
        OUT,
        JSON.stringify(
          { chromium: browser.version(), userAgent, riftyNode: version.out.trim(), results },
          null,
          1,
        ),
      );
    }
  } finally {
    await closeOwner(page);
  }
});
