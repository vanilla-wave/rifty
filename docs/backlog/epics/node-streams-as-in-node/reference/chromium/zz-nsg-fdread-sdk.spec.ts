// THROWAWAY (node-streams fd read probe, SDK): /tmp/nsg-chromium/fdread.cjs in the no-COI SDK toolchain
// sandbox (zz-nsg-sdk.spec.ts pattern), project root /nsgfd; sizes 1/4/16 MiB × readfilesync/readsync/fdread
// × 3 runs, 900 s cap per run. Rows appended to /tmp/nsg-chromium/out-fd/sdk.jsonl (workbench.jsonl shape).
import { appendFileSync, readFileSync } from 'node:fs';
import { type Page, test } from './fixtures/test.ts';

const OUT = '/tmp/nsg-chromium/out-fd/sdk.jsonl';
const root = process.cwd().replaceAll('\\', '/');

async function run(page: Page, command: string) {
  return page.evaluate(async (command) => {
    // biome-ignore lint/suspicious/noExplicitAny: probe spec, copied into tests/ to run
    const sb = (globalThis as unknown as { __nsgSandbox: any }).__nsgSandbox;
    const t0 = performance.now();
    const r = sb.project({ root: '/nsgfd' }).run(command);
    const first = await Promise.race([
      r.completion,
      new Promise((res) => setTimeout(() => res('timeout'), 900_000)),
    ]);
    const o = first === 'timeout' ? await r.stop() : first;
    return {
      timeout: first === 'timeout',
      exit: { code: o.exitCode, status: o.status },
      out: o.stdout,
      err: o.stderr,
      wallMs: Math.round(performance.now() - t0),
    };
  }, command);
}

test('fd read probe, SDK', async ({ page, browser }) => {
  test.setTimeout(6 * 3_600_000);
  await page.goto('/no-coi-harness.html');
  const vfs = await page.evaluate(
    async ({ root, source }) => {
      const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      const sb = await createSandbox({
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
        },
      });
      (globalThis as unknown as Record<string, unknown>).__nsgSandbox = sb;
      await sb.fs.writeFile('/nsgfd/fdread.cjs', source);
      return JSON.parse(JSON.stringify(sb.vfs));
    },
    { root, source: readFileSync('/tmp/nsg-chromium/fdread.cjs', 'utf8') },
  );
  try {
    const riftyNode = (await run(page, 'node -p process.version')).out.trim();
    console.log('chromium', browser.version(), 'rifty node', riftyNode, 'vfs', JSON.stringify(vfs));
    for (const mib of [1, 4, 16]) {
      const setup = await run(page, `node fdread.cjs setup ${mib}`);
      appendFileSync(
        OUT,
        `${JSON.stringify({ host: 'sdk', chromium: browser.version(), vfs, step: 'setup', mib, ...setup })}\n`,
      );
      for (const mode of ['readfilesync', 'readsync', 'fdread']) {
        for (const i of [1, 2, 3]) {
          const r = await run(page, `node fdread.cjs ${mode} ${mib}`);
          const json = /\{"mode".*\}/.exec(r.out)?.[0];
          const row = {
            host: 'sdk',
            chromium: browser.version(),
            vfs,
            mode,
            mib,
            run: i,
            timeout: r.timeout,
            exit: r.exit,
            wallMs: r.wallMs,
            guest: json ? JSON.parse(json) : null,
            out: json ? undefined : `${r.out}${r.err}`.slice(0, 400),
          };
          appendFileSync(OUT, `${JSON.stringify(row)}\n`);
          console.log(
            'sdk',
            mode,
            mib,
            i,
            r.timeout ? 'TIMEOUT' : '',
            json ?? `${r.out}${r.err}`.slice(0, 200),
            r.wallMs,
          );
        }
      }
    }
  } finally {
    await page.evaluate(() =>
      // biome-ignore lint/suspicious/noExplicitAny: probe spec, copied into tests/ to run
      (globalThis as unknown as { __nsgSandbox: any }).__nsgSandbox.dispose(),
    );
  }
});
