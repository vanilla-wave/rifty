// THROWAWAY (node-streams row-ownership timings): /tmp/nsg-chromium/streamprobe.cjs over streamplan.mjs in
// the COI Workbench, ephemeral VFS, project root /home/project, @TMP@ = /tmp. env NSG_ROUTE, NSG_OUT (rows.jsonl).
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

const ROUTE = process.env.NSG_ROUTE ?? 'unknown';
const OUT = process.env.NSG_OUT ?? '/tmp/nsg-chromium/out-d/rows.jsonl';
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
          return { timeout: true, exit: e, out };
        }
        await r.close();
        return { timeout: false, exit: first, out };
      } finally {
        detach();
      }
    },
    { fixtureUrl: sealedWorkbenchFixtureUrl, line, cap: CAP_MS },
  );
}

test('stream probe rows', async ({ page, browser }) => {
  test.setTimeout(4 * 3_600_000);
  const { plan } = (await import('/tmp/nsg-chromium/streamplan.mjs')) as {
    plan: { case: string; mib: number; run: number; argv: string[] }[];
  };
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: `bu-nsg-streamprobe-${ROUTE}`,
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  try {
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    const version = (await execLine(page, 'node -p process.version')).out.trim();
    await writeOwnerFile(
      page,
      '/scratch/streamprobe.cjs',
      readFileSync('/tmp/nsg-chromium/streamprobe.cjs', 'utf8'),
    );
    for (const step of plan) {
      const argv = step.argv.map((a) => a.replace('@TMP@', '/tmp'));
      const r = await runCapped(page, `node streamprobe.cjs ${argv.join(' ')}`);
      const json = /\{"mode".*\}/.exec(r.out)?.[0];
      const g = json ? JSON.parse(json) : null;
      const row = {
        route: ROUTE,
        host: `workbench Chromium ${browser.version()} rifty ${version}`,
        case: step.case,
        mib: step.mib,
        run: step.run,
        ms: g?.ms ?? null,
        ticks: g?.ticks ?? null,
        sha256: g?.sha256 ?? null,
        bytes: g?.bytes ?? g?.size ?? null,
        exit: r.timeout ? 'timeout (900 s)' : (r.exit.code ?? `signal ${r.exit.signal}`),
        ...(g
          ? {}
          : {
              out: r.out
                .replaceAll('\r', '')
                .replaceAll('/home/project', '<project>')
                .slice(0, 300),
            }),
      };
      appendFileSync(OUT, `${JSON.stringify(row)}\n`);
      console.log(JSON.stringify(row));
    }
  } finally {
    await closeOwner(page);
  }
});
