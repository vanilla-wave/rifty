// THROWAWAY (node-streams closure carriers, Workbench): the 5 exceljs-closure programs in /tmp/nsg-<name>
// of the guest, seeded the zlib carrier's way (closure-files.ts closureFiles; fixtures/zlib-scenario.ts
// serveSteps body + UNPACK by a guest `node`). Run: `cd /tmp/nsg-<name> && node <name>.cjs > <project>/nsgout/<name>.stdout`.
// env NSG_OUT: output dir (raw.json, seed-timing.log.txt).
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { type Page, expect, test } from '@playwright/test';
import { closureFiles } from '../../packages/isolate-host/tests/closure-files.ts';
import {
  bootOwner,
  closeOwner,
  execLine,
  gotoHarness,
  sealedWorkbenchFixtureUrl,
  writeOwnerFile,
} from './fixtures.ts';
import { STEP_URL, UNPACK, serveSteps } from './fixtures/zlib-scenario.ts';

const PROGRAMS = '/tmp/nsg-chromium/programs-c';
const OUT = process.env.NSG_OUT ?? '/tmp/nsg-chromium/out-c/unknown';
const CAP_MS = 900_000;
// The zlib carrier's runner shape (tests/browser-unit/zlib-scenario.spec.ts RUNNER): a project-root `node`
// spawns `node <argv>` with cwd /tmp/<dir> and piped stdio (a shell `node` from /tmp is refused:
// "package tree readiness is not published"), prints both streams and the status as one JSON line.
const RUNNER = `const { spawn } = require('node:child_process');
const [dir, ...argv] = process.argv.slice(2);
const child = spawn('node', argv, { cwd: require('node:path').resolve(dir), stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8').on('data', (c) => { stdout += c; });
child.stderr.setEncoding('utf8').on('data', (c) => { stderr += c; });
child.on('close', (exitCode, signal) => {
  process.stdout.write('@@NS' + JSON.stringify({ stdout, stderr, exitCode, signal }) + 'NS@@\\n');
});
`;

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

test('nsg closure programs in Workbench /tmp', async ({ page, browser }) => {
  test.setTimeout(3 * 3_600_000);
  mkdirSync(OUT, { recursive: true });
  const log = (line: string) => {
    appendFileSync(`${OUT}/seed-timing.log.txt`, `${line}\n`);
    console.log(line);
  };
  const closure = closureFiles(
    'exceljs',
    realpathSync('packages/isolate-host/node_modules/exceljs'),
  );
  let closureBytes = 0;
  for (const b of closure.values()) closureBytes += b.byteLength;
  const names = readdirSync(PROGRAMS)
    .filter((n) => n.endsWith('.cjs'))
    .sort()
    .map((n) => n.replace(/\.cjs$/, ''));
  const steps = new Map(
    names.map((name) => [
      name,
      { files: new Map([...closure, [`${name}.cjs`, readFileSync(`${PROGRAMS}/${name}.cjs`)]]) },
    ]),
  );
  await serveSteps(page, () => steps as never);
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-nsg-closure-tmp',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  const results: Record<string, unknown> = {};
  try {
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    const version = await execLine(page, 'node -p process.version');
    await writeOwnerFile(page, '/scratch/zunpack.cjs', UNPACK);
    await writeOwnerFile(page, '/scratch/nsgrun.cjs', RUNNER);
    log(
      `chromium ${browser.version()}; closure ${closure.size} files ${closureBytes} bytes (+1 program file per step)`,
    );
    for (const name of names) {
      const dir = `nsg-${name}`;
      const t0 = Date.now();
      const bodyBytes = await page.evaluate(
        async ({ fixtureUrl, url, path }) => {
          const fixture = await import(/* @vite-ignore */ fixtureUrl);
          const body = new Uint8Array(await (await fetch(url)).arrayBuffer());
          await fixture.currentProject().files.writeFile(path, body, { expectedVersion: null });
          return body.byteLength;
        },
        { fixtureUrl: sealedWorkbenchFixtureUrl, url: `${STEP_URL}${name}`, path: `/${dir}.bin` },
      );
      const t1 = Date.now();
      const unpack = await execLine(page, `node zunpack.cjs ${dir}.bin /tmp/${dir}`);
      expect(unpack.exit, unpack.out).toBe(0);
      const t2 = Date.now();
      log(
        `${name}: body ${bodyBytes} B fetch+writeFile ${t1 - t0} ms; guest unpack (${steps.get(name)?.files.size} files) ${t2 - t1} ms; seed total ${t2 - t0} ms`,
      );
      const t3 = Date.now();
      const run = await runCapped(page, `node nsgrun.cjs /tmp/${dir} ${name}.cjs`);
      const ms = Date.now() - t3;
      const json = /@@NS(.*)NS@@/su.exec(run.out)?.[1];
      const child = json === undefined ? null : JSON.parse(json);
      results[name] = {
        timeout: run.timeout,
        runnerExit: run.exit,
        runnerOut: json === undefined ? run.out : undefined,
        stdout: child?.stdout ?? '',
        stderr: child?.stderr ?? run.out,
        exitCode: child === null ? 'no result' : (child.exitCode ?? `signal ${child.signal}`),
        ms,
      };
      log(
        `${name}: run ${ms} ms exit ${child === null ? 'no result' : child.exitCode}${run.timeout ? ' TIMEOUT' : ''}`,
      );
      writeFileSync(
        `${OUT}/raw.json`,
        JSON.stringify(
          { chromium: browser.version(), riftyNode: version.out.trim(), results },
          null,
          1,
        ),
      );
    }
  } finally {
    await closeOwner(page);
  }
});
