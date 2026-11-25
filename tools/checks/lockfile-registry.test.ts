import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXEMPT, checkLockfileRegistry, repoPaths } from './lockfile-registry.mjs';

const FOREIGN = 'https://registry.example.invalid';
const NPM = 'https://registry.npmjs.org';

const packageLock = (origin: string, minified = false) => {
  const lock = {
    name: 'fixture',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'fixture', dependencies: { ms: '2.1.3', debug: '4.4.1' } },
      'node_modules/ms': {
        version: '2.1.3',
        resolved: `${origin}/ms/-/ms-2.1.3.tgz`,
        integrity: 'sha512-x',
        funding: { url: 'https://github.com/sponsors/someone' },
      },
      'node_modules/debug': {
        version: '4.4.1',
        resolved: `${origin}/debug/-/debug-4.4.1.tgz`,
        integrity: 'sha512-y',
      },
      'node_modules/local': { resolved: 'file:../local', link: true },
    },
  };
  return minified ? JSON.stringify(lock) : `${JSON.stringify(lock, null, 2)}\n`;
};

const pnpmLock = (origin: string) => `lockfileVersion: '9.0'

packages:

  ms@2.1.3:
    resolution: {integrity: sha512-x, tarball: ${origin}/ms/-/ms-2.1.3.tgz}

  debug@4.4.1:
    resolution:
      integrity: sha512-y
      tarball: ${origin}/debug/-/debug-4.4.1.tgz
    deprecated: Package no longer supported. Contact Support at https://www.npmjs.com/support for more info.
`;

const yarnLock = (origin: string) => `# yarn lockfile v1

ms@^2.1.3:
  version "2.1.3"
  resolved "${origin}/ms/-/ms-2.1.3.tgz#abc"
  integrity sha512-x
`;

const snapshot = (origin: string) =>
  gzipSync(
    JSON.stringify({
      version: 3,
      templateId: 'vite',
      lockfile: packageLock(origin),
      nodeModules: {},
    }),
  );

const corpusSeed = (origin: string) =>
  JSON.stringify({ 'package.json': '{"name":"seed"}', 'package-lock.json': packageLock(origin) });

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lockfile-registry-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function put(path: string, bytes: string | Buffer) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), bytes);
  return path;
}

const sha256 = (path: string) =>
  createHash('sha256')
    .update(readFileSync(join(root, path)))
    .digest('hex');

function check(paths: string[], exempt: { path: string; sha256: string }[] = []) {
  return checkLockfileRegistry(root, paths, exempt);
}

describe('committed lockfiles pin only registry.npmjs.org', () => {
  it('passes clean locks of every format; funding, file: and deprecation URLs are not addresses', () => {
    const paths = [
      put('a/package-lock.json', packageLock(NPM)),
      put('b/npm-shrinkwrap.json', packageLock(NPM, true)),
      put('c/pnpm-lock.yaml', pnpmLock(NPM)),
      put('d/yarn.lock', yarnLock(NPM)),
      put('apps/playground/public/snapshots/x-node-modules.json.gz', snapshot(NPM)),
      put('tsconfig.json', '{ // jsonc\n "compilerOptions": {} }'),
    ];
    expect(check(paths)).toEqual({ violations: [], carriers: 5, exempted: 0 });
  });

  it.each([
    ['package-lock.json', packageLock(FOREIGN), 2],
    ['npm-shrinkwrap.json', packageLock(FOREIGN, true), 2],
    ['pnpm-lock.yaml', pnpmLock(FOREIGN), 2],
    ['yarn.lock', yarnLock(FOREIGN), 1],
  ])('refuses %s on a foreign host with file, line count and host', (name, text, lines) => {
    const path = put(`fixture/${name}`, text);
    expect(check([path]).violations).toEqual([
      `${path}: ${lines} address line(s) on registry.example.invalid (allowed: ${NPM})`,
    ]);
  });

  it.each([
    ['test fixture (PR #266)', 'tests/e2e/fixtures/npm-lock-replay/next/package-lock.json'],
    [
      'backlog reference probe (PR #430, #443)',
      'docs/backlog/x/reference/probe/deps/package-lock.json',
    ],
  ])('refuses a %s lock', (_, path) => {
    put(path, packageLock(FOREIGN));
    expect(check([path]).violations).toEqual([
      `${path}: 2 address line(s) on registry.example.invalid (allowed: ${NPM})`,
    ]);
  });

  it('refuses a baked dependency snapshot whose embedded lockfile is foreign', () => {
    const path = put(
      'apps/playground/public/snapshots/next-node-modules.json.gz',
      snapshot(FOREIGN),
    );
    expect(check([path]).violations).toEqual([
      `${path}#/lockfile: 2 address line(s) on registry.example.invalid (allowed: ${NPM})`,
    ]);
  });

  it('finds a lock by content form in a new .json.gz anywhere, whatever its key', () => {
    const doc = { runs: [{ diff: { before: packageLock(FOREIGN), after: 'plain text' } }] };
    const path = put('some/new/dir/evidence.json.gz', gzipSync(JSON.stringify(doc)));
    expect(check([path]).violations).toEqual([
      `${path}#/runs/0/diff/before: 2 address line(s) on registry.example.invalid (allowed: ${NPM})`,
    ]);
  });

  it('finds a text lock embedded under a lockfile-named key', () => {
    const path = put(
      'seed/project.json',
      JSON.stringify({ 'app/pnpm-lock.yaml': pnpmLock(FOREIGN) }),
    );
    expect(check([path]).violations).toEqual([
      `${path}#/app~1pnpm-lock.yaml: 2 address line(s) on registry.example.invalid (allowed: ${NPM})`,
    ]);
  });

  it('a foreign host on a non-https scheme or a git dependency is refused too', () => {
    const lock = packageLock('http://registry.npmjs.org').replace(
      'file:../local',
      'git+ssh://git@github.com/o/local.git#abc',
    );
    const path = put('x/package-lock.json', lock);
    expect(check([path]).violations).toEqual([
      `${path}: 2 address line(s) on registry.npmjs.org (allowed: ${NPM})`,
      `${path}: 1 address line(s) on github.com (allowed: ${NPM})`,
    ]);
  });
});

describe('declared exemptions cover exact bytes only', () => {
  const CASES = 'tools/agent-bench/corpus/cases';

  it('an exempt frozen seed passes and is counted; a new 15th case is refused', () => {
    const frozen = put(`${CASES}/frozen/project.json`, corpusSeed(FOREIGN));
    const added = put(`${CASES}/added/project.json`, corpusSeed(FOREIGN));
    const result = check([frozen, added], [{ path: frozen, sha256: sha256(frozen) }]);
    expect(result.exempted).toBe(1);
    expect(result.violations).toEqual([
      `${added}#/package-lock.json: 2 address line(s) on registry.example.invalid (allowed: ${NPM})`,
    ]);
  });

  it('a changed exempt seed fails its row even when its new lock is clean', () => {
    const path = put(`${CASES}/frozen/project.json`, corpusSeed(FOREIGN));
    const row = { path, sha256: sha256(path) };
    put(path, corpusSeed(NPM));
    const { violations, exempted } = check([path], [row]);
    expect(exempted).toBe(0);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/exemption pinned sha256 .* changed bytes are not exempt/u);
  });

  it('a changed exempt seed that is still foreign reports both the row and the lock', () => {
    const path = put(`${CASES}/frozen/project.json`, corpusSeed(FOREIGN));
    const row = { path, sha256: sha256(path) };
    put(path, corpusSeed(`${FOREIGN}/x`));
    expect(check([path], [row]).violations).toHaveLength(2);
  });

  it('a row for a deleted file is refused (the list cannot rot)', () => {
    expect(check([], [{ path: `${CASES}/gone/project.json`, sha256: '0'.repeat(64) }])).toEqual({
      violations: [`${CASES}/gone/project.json: exemption row for a missing file — drop the row`],
      carriers: 0,
      exempted: 0,
    });
  });

  it('every corpus seed row pins the frozen inputsSha256 of its manifest case', () => {
    const manifests = ['core-v1', 'boundary-v1'].flatMap(
      (name) =>
        (
          JSON.parse(readFileSync(`tools/agent-bench/corpus/${name}.json`, 'utf8')) as {
            cases: { id: string; inputsSha256: string }[];
          }
        ).cases,
    );
    const pinned = new Map(manifests.map((c) => [`${CASES}/${c.id}/project.json`, c.inputsSha256]));
    const seeds = EXEMPT.filter((row) => row.path.startsWith(`${CASES}/`));
    expect(seeds).toHaveLength(14);
    for (const row of seeds) expect(row.sha256, row.path).toBe(pinned.get(row.path));
  });
});

describe('the repository tree', () => {
  it('passes with all 19 declared exemptions matching (14 corpus seeds, 5 evidence archives)', () => {
    const { violations, exempted } = checkLockfileRegistry(process.cwd(), repoPaths());
    expect(violations).toEqual([]);
    expect(EXEMPT).toHaveLength(19);
    expect(exempted).toBe(19);
  });

  it('the CLI names the exemption count on green and carrier, count, host on red', () => {
    const run = (cwd: string) =>
      spawnSync(process.execPath, [join(process.cwd(), 'tools/checks/lockfile-registry.mjs')], {
        cwd,
        encoding: 'utf8',
      });
    const green = run(process.cwd());
    expect(green.status).toBe(0);
    expect(green.stdout).toMatch(/19\/19 declared exemption\(s\)/u);

    // A docs-only change: an untracked, unignored lock under docs/ is scanned (git ls-files --others).
    execFileSync('git', ['init', '-q'], { cwd: root });
    put('docs/backlog/x/reference/probe/package-lock.json', packageLock(FOREIGN));
    const red = run(root);
    expect(red.status).toBe(1);
    expect(red.stderr).toContain(
      'docs/backlog/x/reference/probe/package-lock.json: 2 address line(s) on registry.example.invalid',
    );
    expect(red.stderr).toMatch(/0\/19 declared exemption\(s\)/u);
  });
});
