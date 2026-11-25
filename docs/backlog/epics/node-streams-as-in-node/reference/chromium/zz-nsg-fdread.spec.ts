// THROWAWAY (node-streams Chromium fd read probe): /tmp/nsg-chromium/fdread.cjs in the COI Workbench,
// ephemeral and OPFS-backed ('required'); sizes 1/4/16 MiB, fs.read(fd) loop / readSync loop / readFileSync,
// 3 runs each, 900 s cap per run. Rows appended to /tmp/nsg-chromium/out-fd/workbench.jsonl.
import { appendFileSync, readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';
import {
  bootOwner,
  closeOwner,
  execLine,
  gotoHarness,
  sealedWorkbenchFixtureUrl,
  writeOwnerFile,
} from './fixtures.ts';

const OUT = '/tmp/nsg-chromium/out-fd/workbench.jsonl';
const CAP_MS = 900_000;

async function runCapped(page: Page, line: string) {
  return page.evaluate(
    async ({ fixtureUrl, line, cap }) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      // biome-ignore lint/suspicious/noExplicitAny: probe spec, copied into tests/ to run
      const g = globalThis as unknown as { __nsgTerm?: any };
      g.__nsgTerm ??= fixture.currentProject().terminals.open();
      const t = g.__nsgTerm;
      let out = '';
      const detach = t.attach((c: string) => {
        out += c;
      });
      const t0 = performance.now();
      try {
        const r = t.run(line);
        const first = await Promise.race([
          r.exited,
          new Promise((res) => setTimeout(() => res('timeout'), cap)),
        ]);
        if (first === 'timeout') {
          await r.stop();
          const e = await r.exited;
          await r.close();
          return { timeout: true, exit: e, out, wallMs: Math.round(performance.now() - t0) };
        }
        await r.close();
        return { timeout: false, exit: first, out, wallMs: Math.round(performance.now() - t0) };
      } finally {
        detach();
      }
    },
    { fixtureUrl: sealedWorkbenchFixtureUrl, line, cap: CAP_MS },
  );
}

for (const persistence of (process.env.NSG_PERSIST ?? 'ephemeral,required').split(',') as (
  | 'ephemeral'
  | 'required'
)[]) {
  test(`fd read probe, ${persistence}`, async ({ page, browser }) => {
    test.setTimeout(6 * 3_600_000);
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: `bu-nsg-fdread-${persistence}-${Date.now().toString(36)}`,
      template: 'hidden-empty',
      persistence,
    });
    try {
      const storage = await page.evaluate(async (fixtureUrl) => {
        const fixture = await import(/* @vite-ignore */ fixtureUrl);
        return fixture.currentWorkbench().snapshot().storage;
      }, sealedWorkbenchFixtureUrl);
      const install = await execLine(page, 'npm install');
      expect(install.exit, install.out).toBe(0);
      await writeOwnerFile(
        page,
        '/scratch/fdread.cjs',
        readFileSync('/tmp/nsg-chromium/fdread.cjs', 'utf8'),
      );
      const sizes = (process.env.NSG_SIZES ?? '1,4,16').split(',').map(Number);
      for (const mib of sizes) {
        const setup = await runCapped(page, `node fdread.cjs setup ${mib}`);
        appendFileSync(
          OUT,
          `${JSON.stringify({ chromium: browser.version(), persistence, storage, step: 'setup', mib, ...setup })}\n`,
        );
        for (const mode of ['readfilesync', 'readsync', 'fdread']) {
          for (const run of [1, 2, 3]) {
            const r = await runCapped(page, `node fdread.cjs ${mode} ${mib}`);
            const json = /\{"mode".*\}/.exec(r.out)?.[0];
            const row = {
              chromium: browser.version(),
              persistence,
              mode,
              mib,
              run,
              timeout: r.timeout,
              exit: r.exit,
              wallMs: r.wallMs,
              guest: json ? JSON.parse(json) : null,
              out: json ? undefined : r.out.replaceAll('\r', '').slice(0, 400),
            };
            appendFileSync(OUT, `${JSON.stringify(row)}\n`);
            console.log(
              persistence,
              mode,
              mib,
              run,
              r.timeout ? 'TIMEOUT' : '',
              json ?? r.out.slice(0, 200),
              r.wallMs,
            );
          }
        }
      }
    } finally {
      await closeOwner(page);
    }
  });
}
