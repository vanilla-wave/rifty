// THROWAWAY (node-streams Chromium baseline): /tmp/nsg-chromium/programs/*.cjs as `node <program>` in the
// no-COI SDK toolchain sandbox (tests/no-coi/node-file-parity.spec.ts pattern). Layout: /nsg/node_modules
// (exceljs closure) + /nsg/<name>/<name>.cjs, `project({ root: '/nsg/<name>' }).run('node <name>.cjs')`.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { expect, test } from './fixtures/test.ts';

const PROGRAMS = '/tmp/nsg-chromium/programs';
const CLOSURE = '/tmp/nsg-chromium/closure.json';
const OUT = '/tmp/nsg-chromium/out/chromium-sdk.json';
const root = process.cwd().replaceAll('\\', '/');

test('nsg programs in Chromium no-COI SDK', async ({ page, browser }) => {
  test.setTimeout(3_600_000);
  const only = process.env.NSG_ONLY;
  const names = readdirSync(PROGRAMS)
    .filter((n) => n.endsWith('.cjs') && (!only || n.includes(only)))
    .sort();
  await page.goto('/no-coi-harness.html');
  await page.evaluate(
    async ({ root }) => {
      const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      const g = globalThis as unknown as Record<string, unknown>;
      g.__nsgSandbox = await createSandbox({
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
        },
      });
    },
    { root },
  );
  const results: Record<string, unknown> = {};
  try {
    if (names.some((n) => n.startsWith('c-'))) {
      const closure = Object.entries(
        JSON.parse(readFileSync(CLOSURE, 'utf8')) as Record<string, string>,
      );
      let written = 0;
      for (let i = 0; i < closure.length; i += 400) {
        written += await page.evaluate(
          async (entries) => {
            // biome-ignore lint/suspicious/noExplicitAny: probe spec, copied into tests/ to run
            const sb = (globalThis as unknown as { __nsgSandbox: any }).__nsgSandbox;
            for (const [rel, b64] of entries) {
              const bin = atob(b64);
              const bytes = new Uint8Array(bin.length);
              for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
              await sb.fs.writeFile(`/nsg/${rel}`, bytes);
            }
            return entries.length;
          },
          closure.slice(i, i + 400),
        );
      }
      expect(written).toBe(closure.length);
    }
    const riftyNode = await page.evaluate(async () => {
      // biome-ignore lint/suspicious/noExplicitAny: probe spec, copied into tests/ to run
      const sb = (globalThis as unknown as { __nsgSandbox: any }).__nsgSandbox;
      await sb.fs.writeFile('/nsg/.keep', '');
      return (
        await sb.project({ root: '/nsg' }).run('node -p process.version').completion
      ).stdout.trim();
    });
    for (const file of names) {
      const name = file.replace(/\.cjs$/, '');
      const t0 = Date.now();
      const r = await page.evaluate(
        async ({ name, file, source }) => {
          // biome-ignore lint/suspicious/noExplicitAny: probe spec, copied into tests/ to run
          const sb = (globalThis as unknown as { __nsgSandbox: any }).__nsgSandbox;
          await sb.fs.writeFile(`/nsg/${name}/${file}`, source);
          const run = sb.project({ root: `/nsg/${name}` }).run(`node ${file}`);
          const first = await Promise.race([
            run.completion,
            new Promise((res) => setTimeout(() => res('timeout'), 180_000)),
          ]);
          if (first === 'timeout') {
            const o = await run.stop();
            return {
              timeout: true,
              stdout: o.stdout,
              stderr: o.stderr,
              exitCode: o.exitCode,
              status: o.status,
            };
          }
          return {
            timeout: false,
            stdout: first.stdout,
            stderr: first.stderr,
            exitCode: first.exitCode,
            status: first.status,
          };
        },
        { name, file, source: readFileSync(`${PROGRAMS}/${file}`, 'utf8') },
      );
      results[name] = { ...r, ms: Date.now() - t0 };
      console.log(name, r.status, r.exitCode, r.timeout ? 'TIMEOUT' : '', Date.now() - t0, 'ms');
      writeFileSync(
        OUT,
        JSON.stringify({ chromium: browser.version(), riftyNode, results }, null, 1),
      );
    }
  } finally {
    await page.evaluate(() =>
      // biome-ignore lint/suspicious/noExplicitAny: probe spec, copied into tests/ to run
      (globalThis as unknown as { __nsgSandbox: any }).__nsgSandbox.dispose(),
    );
  }
});
