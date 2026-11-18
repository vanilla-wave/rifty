/**
 * Goal isolate-guest-embed, scenario 1–2 (I1, I3, I4): the packed export
 * installs alone and brings no native addon; the README's custom-integration
 * block, with the consumer's own isolated-vm and nothing internal of rifty,
 * runs the isolate-host corpus like `node -e`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { CORPUS, type Outcome, parityView } from '../../isolate-host/tests/corpus.ts';
import { nodeEval } from '../../isolate-host/tests/support.ts';

/**
 * Unhandled rejections whose reason isolated-vm cannot copy out: the guest
 * controls the reason, the embedder sends `UNCOPYABLE_REJECTION` instead.
 * Compared on stdout + status, as in `runCode` parity (Node's wording differs).
 */
const UNCOPYABLE = ['Promise.reject({ f() {} })', 'Promise.reject(Symbol())', 'Promise.reject(1)'];

/** RED until the export lands (map item 1): then `it`. */
const carrier = it.fails;

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'isolate-guest-embedder-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));
const env = { PATH: process.env.PATH ?? '' };

let installed: Promise<string> | undefined;
/** The packed export, installed alone into a clean project. */
function install(): Promise<string> {
  installed ??= (async () => {
    if (!existsSync(join(PACKAGE_DIR, 'package.json'))) throw new Error('no export package');
    const packDir = join(work, 'pack');
    execFileSync('pnpm', ['pack', '--pack-destination', packDir], {
      cwd: PACKAGE_DIR,
      stdio: 'pipe',
    });
    const tarball = readdirSync(packDir).find((f) => f.endsWith('.tgz'));
    if (tarball === undefined) throw new Error('no tarball');
    const app = join(work, 'app');
    execFileSync('mkdir', ['-p', app]);
    writeFileSync(
      join(app, 'package.json'),
      JSON.stringify({ name: 'embedder', private: true, type: 'module' }),
    );
    execFileSync('npm', ['install', '--no-audit', '--no-fund', join(packDir, tarball)], {
      cwd: app,
      stdio: 'pipe',
    });
    return app;
  })();
  return installed;
}

let ran: Promise<Record<string, Outcome>> | undefined;
/** The README embedder over the whole corpus, in one plain-node process. */
function runCorpus(): Promise<Record<string, Outcome>> {
  ran ??= (async () => {
    const app = await install();
    // The consumer's own isolated-vm, installed after the I3 check.
    execFileSync('npm', ['install', '--no-audit', '--no-fund', 'isolated-vm@7.0.2'], {
      cwd: app,
      stdio: 'pipe',
    });
    const readme = readFileSync(join(PACKAGE_DIR, 'README.md'), 'utf8');
    const example = /```js\n([\s\S]*?)```/.exec(readme)?.[1];
    if (example === undefined) throw new Error('README has no js block');
    // Only the public export, the consumer's own isolated-vm and Node builtins.
    const specifiers = [...example.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
      (m) => m[1],
    );
    const foreign = specifiers.filter(
      (s) =>
        !['@riftydev/isolate-guest', '@riftydev/isolate-guest/guest.js', 'isolated-vm'].includes(
          s as string,
        ) && !(s as string).startsWith('node:'),
    );
    if (foreign.length > 0) throw new Error(`README embedder imports ${foreign.join(', ')}`);
    writeFileSync(join(app, 'embed.mjs'), example);
    writeFileSync(
      join(app, 'rows.json'),
      JSON.stringify([...CORPUS.map((r) => [r.label, r.code]), ...UNCOPYABLE.map((c) => [c, c])]),
    );
    writeFileSync(
      join(app, 'driver.mjs'),
      `import { readFileSync } from 'node:fs';
import { run } from './embed.mjs';
const out = {};
for (const [label, code] of JSON.parse(readFileSync('rows.json', 'utf8'))) {
  const { stdout, stderr, exitCode } = await run(code);
  out[label] = { stdout, stderr, exitCode };
}
process.stdout.write(JSON.stringify(out));
`,
    );
    const out = execFileSync(process.execPath, ['--no-node-snapshot', 'driver.mjs'], {
      cwd: app,
      encoding: 'utf8',
      env,
      timeout: 180_000,
    });
    return JSON.parse(out) as Record<string, Outcome>;
  })();
  return ran;
}

describe('the packed export (I3)', () => {
  carrier(
    'installs alone, declares no dependency, imports and resolves its bundle without isolated-vm',
    async () => {
      const app = await install();
      const manifest = JSON.parse(
        readFileSync(join(app, 'node_modules/@riftydev/isolate-guest/package.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(manifest.dependencies ?? {}).toEqual({});
      expect(manifest.peerDependencies ?? {}).toEqual({});
      expect(manifest.optionalDependencies ?? {}).toEqual({});
      expect(existsSync(join(app, 'node_modules/isolated-vm'))).toBe(false);
      const scripts = (manifest.scripts ?? {}) as Record<string, unknown>;
      expect(['preinstall', 'install', 'postinstall'].filter((k) => k in scripts)).toEqual([]);
      const files = (
        readdirSync(join(app, 'node_modules/@riftydev/isolate-guest'), {
          recursive: true,
        }) as string[]
      ).filter((f) => f.endsWith('.node'));
      expect(files).toEqual([]);
      const probe = `
      const root = await import('@riftydev/isolate-guest');
      const { statSync } = await import('node:fs');
      const bundle = statSync(new URL(import.meta.resolve('@riftydev/isolate-guest/guest.js')));
      const native = process.report.getReport().sharedObjects.filter((p) => p.endsWith('.node'));
      console.log(JSON.stringify({ exports: Object.keys(root).sort(), bundle: bundle.size > 1e6, native }));`;
      const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
        cwd: app,
        encoding: 'utf8',
        env,
      });
      expect(JSON.parse(out)).toEqual({
        exports: ['IMPORT_GAP', 'UNCOPYABLE_REJECTION', 'createHostBridge', 'exitStatus'],
        bundle: true,
        native: [],
      });
    },
    240_000,
  );
});

describe('the README embedder runs the corpus like node -e (I1, I4)', () => {
  for (const row of CORPUS) {
    const test = row.ceiling === undefined ? carrier : it.fails;
    test(row.ceiling === undefined
      ? row.label
      : `${row.label} — ceiling: ${row.ceiling}`, async () => {
      const raw = nodeEval(row.code);
      expect(raw.signal, 'oracle must exit on its own').toBeNull();
      const result = (await runCorpus())[row.label];
      expect(result).toBeDefined();
      expect(parityView(row, result as Outcome)).toEqual(
        parityView(row, { stdout: raw.stdout, stderr: raw.stderr, exitCode: raw.code }),
      );
    }, 240_000);
  }
});

describe('unhandled rejections with uncopyable reasons fail the run as in Node (I1)', () => {
  for (const code of UNCOPYABLE) {
    carrier(
      code,
      async () => {
        const oracle = nodeEval(code);
        const result = (await runCorpus())[code];
        expect({ stdout: result?.stdout, exitCode: result?.exitCode }).toEqual({
          stdout: oracle.stdout,
          exitCode: oracle.code,
        });
      },
      240_000,
    );
  }
});

describe('the README states the contract (I4)', () => {
  // The prose is review-read; this pins that every contract name is documented.
  carrier(
    'names every bridge function, both guest entry points, both embedder hooks and the unstable status',
    () => {
      const readme = readFileSync(join(PACKAGE_DIR, 'README.md'), 'utf8');
      const names = [
        'write',
        'timerStart',
        'timerClear',
        'now',
        'random',
        'timeOrigin',
        'run',
        'fire',
        'rejection',
        'onUnhandledRejection',
        'importModuleDynamically',
        'UNCOPYABLE_REJECTION',
        'IMPORT_GAP',
        'exitStatus',
        'close',
        '7.0.2',
        '6.2.0',
      ];
      expect(names.filter((n) => !readme.includes(`\`${n}`))).toEqual([]);
      expect(readme).toMatch(/unstable/i);
    },
  );
});
