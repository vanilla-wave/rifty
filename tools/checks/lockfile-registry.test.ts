import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXEMPT, checkLockfileRegistry, repoPaths } from './lockfile-registry.mjs';

const FOREIGN = 'https://registry.example.invalid';
const NPM = 'https://registry.npmjs.org';
const ALLOWED = '(allowed: registry.npmjs.org, loopback, *.test)';
const onHost = (carrier: string, n: number, host = 'https://registry.example.invalid') =>
  `${carrier}: ${n} address line(s) on ${host} ${ALLOWED}`;
const unreadable = (carrier: string, n: number, value: string) =>
  `${carrier}: ${n} unreadable address value(s) ${JSON.stringify(value)} (neither a URL nor a declared non-network form: file:, link:, workspace:, github:, rifty:, relative path)`;
const gitDep = (carrier: string, n: number, host: string) =>
  `${carrier}: ${n} git dependency address(es) on ${host} (git/URL dependencies are not allowed in committed locks: the host may be internal)`;

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
    expect(check([path]).violations).toEqual([onHost(path, lines)]);
  });

  it.each([
    ['test fixture (PR #266)', 'tests/e2e/fixtures/npm-lock-replay/next/package-lock.json'],
    [
      'backlog reference probe (PR #430, #443)',
      'docs/backlog/x/reference/probe/deps/package-lock.json',
    ],
  ])('refuses a %s lock', (_, path) => {
    put(path, packageLock(FOREIGN));
    expect(check([path]).violations).toEqual([onHost(path, 2)]);
  });

  it('refuses a baked dependency snapshot whose embedded lockfile is foreign', () => {
    const path = put(
      'apps/playground/public/snapshots/next-node-modules.json.gz',
      snapshot(FOREIGN),
    );
    expect(check([path]).violations).toEqual([onHost(`${path}#/lockfile`, 2)]);
  });

  it('finds a lock by content form in a new .json.gz anywhere, whatever its key', () => {
    const doc = { runs: [{ diff: { before: packageLock(FOREIGN), after: 'plain text' } }] };
    const path = put('some/new/dir/evidence.json.gz', gzipSync(JSON.stringify(doc)));
    expect(check([path]).violations).toEqual([onHost(`${path}#/runs/0/diff/before`, 2)]);
  });

  it('finds a text lock embedded under a lockfile-named key', () => {
    const path = put(
      'seed/project.json',
      JSON.stringify({ 'app/pnpm-lock.yaml': pnpmLock(FOREIGN) }),
    );
    expect(check([path]).violations).toEqual([onHost(`${path}#/app~1pnpm-lock.yaml`, 2)]);
  });

  it('a foreign host on a non-https scheme or a git dependency is refused too', () => {
    const lock = packageLock('http://registry.npmjs.org').replace(
      'file:../local',
      'git+ssh://git@github.com/o/local.git#abc',
    );
    const path = put('x/package-lock.json', lock);
    expect(check([path]).violations).toEqual([
      onHost(path, 2, 'http://registry.npmjs.org'),
      gitDep(path, 1, 'github.com'),
    ]);
  });
});

describe('a lock written as a JSON object is a carrier too (B1)', () => {
  const lockObject = (origin: string) => JSON.parse(packageLock(origin)) as object;

  it('an object with lockfileVersion at any depth', () => {
    const doc = { cases: [{ name: 'empty', lock: lockObject(FOREIGN) }] };
    const path = put('docs/backlog/x/reference/native-output.json', JSON.stringify(doc));
    expect(check([path]).violations).toEqual([onHost(`${path}#/cases/0/lock`, 2)]);
  });

  it('a whole lock under a non-lock file name', () => {
    const path = put('tests/fixtures/expected-lock.json', packageLock(FOREIGN));
    expect(check([path]).violations).toEqual([onHost(path, 2)]);
  });

  it('a baked snapshot whose lockfile is an object', () => {
    const bytes = gzipSync(JSON.stringify({ version: 3, lockfile: lockObject(FOREIGN) }));
    const path = put('apps/playground/public/snapshots/obj-node-modules.json.gz', bytes);
    expect(check([path]).violations).toEqual([onHost(`${path}#/lockfile`, 2)]);
  });

  it('an object under a lockfile-named key, even without lockfileVersion', () => {
    const doc = {
      files: {
        'package-lock.json': { packages: { 'node_modules/ms': { resolved: `${FOREIGN}/ms.tgz` } } },
      },
    };
    const path = put('seed/project.json', JSON.stringify(doc));
    expect(check([path]).violations).toEqual([onHost(`${path}#/files/package-lock.json`, 1)]);
  });

  it('npm v1 nested dependencies are walked', () => {
    const v1 = {
      lockfileVersion: 1,
      dependencies: {
        a: { resolved: `${NPM}/a.tgz`, dependencies: { b: { resolved: `${FOREIGN}/b.tgz` } } },
      },
    };
    const path = put('v1/package-lock.json', JSON.stringify(v1));
    expect(check([path]).violations).toEqual([onHost(path, 1)]);
  });
});

describe('allowed hosts: npmjs origin by parsed URL, loopback and .test (manager decision 2026-11-26)', () => {
  const lockAt = (url: string) =>
    JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/ms': { resolved: url } } });
  const verdict = (url: string) => {
    const path = put('x/package-lock.json', lockAt(url));
    return check([path]).violations;
  };

  it.each([
    'https://registry.npmjs.org/ms/-/ms-2.1.3.tgz',
    'https://REGISTRY.npmjs.org/ms/-/ms-2.1.3.tgz',
    'https://registry.npmjs.org:443/ms/-/ms-2.1.3.tgz',
    'http://127.0.0.1:57562/ms/-/ms-2.1.3.tgz',
    'http://127.8.9.10/ms.tgz',
    'http://localhost:4873/ms.tgz',
    'http://[::1]:4873/ms.tgz',
    'https://registry.test/ms/-/ms-2.1.3.tgz',
  ])('%s passes', (url) => {
    expect(verdict(url)).toEqual([]);
  });

  it.each([
    ['https://registry.npmjs.org.evil/ms.tgz', 'https://registry.npmjs.org.evil'],
    ['https://registry.npmjs.org@evil.example/ms.tgz', 'https://<userinfo>@evil.example'],
    ['https://user:pw@registry.npmjs.org/ms.tgz', 'https://<userinfo>@registry.npmjs.org'],
    ['https://registry.npmjs.org:8443/ms.tgz', 'https://registry.npmjs.org:8443'],
    ['https://registry.test.evil/ms.tgz', 'https://registry.test.evil'],
    ['http://localhost.evil/ms.tgz', 'http://localhost.evil'],
    ['http://127.0.0.1.evil/ms.tgz', 'http://127.0.0.1.evil'],
    ['https://registry.internal/ms.tgz', 'https://registry.internal'],
    ['https://registry.example.invalid/ms.tgz', 'https://registry.example.invalid'],
  ])('%s is refused', (url, host) => {
    const [violation] = verdict(url);
    expect(violation).toBe(onHost('x/package-lock.json', 1, host));
  });

  it.each([
    // The whole value is parsed: a fragment cut at ' } , or a missing // would hide the host.
    [
      "https://registry.npmjs.org'x@evil.invalid/ms/-/ms-2.1.3.tgz",
      'https://<userinfo>@evil.invalid',
    ],
    [
      'https://registry.npmjs.org}@evil.invalid/ms/-/ms-2.1.3.tgz',
      'https://<userinfo>@evil.invalid',
    ],
    ['https:evil.invalid/ms/-/ms-2.1.3.tgz', 'https://evil.invalid'],
    ['https:\\\\evil.invalid\\a.tgz', 'https://evil.invalid'],
  ])('reviewer form %s is refused in a lock object', (url, host) => {
    expect(verdict(url)).toEqual([onHost('x/package-lock.json', 1, host)]);
  });

  it.each([
    'file:../local',
    'link:../local',
    'workspace:*',
    'packages/foo',
    '../foo',
    'github:o/x#abc',
  ])('declared non-network form %s passes', (value) => {
    expect(verdict(value)).toEqual([]);
  });

  // 127.evil.1.1.1: WHATWG rejects a host whose last label is numeric but not IPv4.
  it.each(['//evil.invalid/ms.tgz', 'http://[bad/ms.tgz', 'http://127.evil.1.1.1/ms.tgz'])(
    'an address value that is no URL nor a non-network form is red: %s',
    (value) => {
      expect(verdict(value)).toEqual([unreadable('x/package-lock.json', 1, value)]);
    },
  );

  it('a leading space does not hide a scheme', () => {
    expect(verdict(' https://evil.invalid/a.tgz')).toEqual([
      onHost('x/package-lock.json', 1, 'https://evil.invalid'),
    ]);
  });

  it('a scp-form git address (no scheme) is a git dependency, not a path', () => {
    expect(verdict('git@evil.invalid:o/r.git#abc')).toEqual([
      gitDep('x/package-lock.json', 1, 'evil.invalid'),
    ]);
  });

  it('git dependencies are refused with a reason; github: shorthand is not a URL', () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/a': { resolved: 'git+ssh://git@github.com/o/a.git#abc' },
        'node_modules/b': { resolved: 'git+https://git.corp.example/o/b.git#abc' },
        'node_modules/c': { resolved: 'github:o/c#abc' },
      },
    });
    const path = put('g/package-lock.json', lock);
    expect(check([path]).violations).toEqual([
      gitDep(path, 1, 'github.com'),
      gitDep(path, 1, 'git.corp.example'),
    ]);
  });
});

describe('pnpm and yarn locks', () => {
  it('pnpm canonical forms are read: flow resolution, quoted keys, git repo', () => {
    const yaml = `lockfileVersion: '9.0'
packages:
  "ms@2.1.3":
    resolution: {integrity: sha512-x, "tarball": ${FOREIGN}/ms.tgz}
  dep@1.0.0:
    resolution: {type: git, repo: https://git.corp.example/o/dep, commit: abc}
`;
    const path = put('p/pnpm-lock.yaml', yaml);
    expect(check([path]).violations).toEqual([
      onHost(path, 1),
      gitDep(path, 1, 'git.corp.example'),
    ]);
  });

  // Manager decision 2026-11-26: text locks are read only in the form a package manager writes;
  // any other notation around an address key is red, never interpreted.
  it.each([
    [
      'escape in double quotes',
      '      tarball: "https://registry.npmjs.org\\x40evil.invalid/ms.tgz"',
    ],
    ['escaped quote', '      tarball: "https://registry.npmjs.org\\"@evil.invalid/ms.tgz"'],
    ["'' in single quotes", "      tarball: 'https://registry.npmjs.org''@evil.invalid/ms.tgz'"],
    ['value on the next line', '      tarball:\n        https://evil.invalid/ms.tgz'],
    [
      'continuation line',
      '      tarball: https://registry.npmjs.org\n        @evil.invalid/ms.tgz',
    ],
    ['tag (block)', '      tarball: !!str https://evil.invalid/ms.tgz'],
    ['explicit key', '      ? tarball\n      : https://evil.invalid/ms.tgz'],
    ['block scalar', '      tarball: >-\n        https://evil.invalid/ms.tgz'],
    ['anchor', '      tarball: &a https://evil.invalid/ms.tgz'],
    ['alias', '      tarball: *a'],
  ])('pnpm non-canonical address notation is red: %s', (_, entry) => {
    const path = put('n/pnpm-lock.yaml', `packages:\n  ms@2.1.3:\n    resolution:\n${entry}\n`);
    const [violation, ...rest] = check([path]).violations;
    expect(rest).toEqual([]);
    expect(violation).toMatch(
      /^n\/pnpm-lock\.yaml: 1 non-canonical address entr\(y\|ies\) .* regenerate the lock with its package manager$/u,
    );
  });

  it.each([
    ['tag on the key', 'resolution: {integrity: x, !!str tarball: https://evil.invalid/ms.tgz}'],
    ['explicit key', 'resolution: {integrity: x, ? tarball: https://evil.invalid/ms.tgz}'],
    ['mapping as an address value', 'tarball: {url: https://evil.invalid/ms.tgz}'],
  ])('pnpm non-canonical flow notation is red: %s', (_, entry) => {
    const path = put('n2/pnpm-lock.yaml', `packages:\n  ms@2.1.3:\n    ${entry}\n`);
    const violations = check([path]).violations;
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/non-canonical address/u);
  });

  it('pnpm non-canonical in a flow mapping is red: tag', () => {
    const path = put(
      'n/pnpm-lock.yaml',
      'packages:\n  ms@2.1.3:\n    resolution: {integrity: x, tarball: !!str https://evil.invalid/ms.tgz}\n',
    );
    expect(check([path]).violations).toHaveLength(1);
    expect(check([path]).violations[0]).toMatch(/non-canonical address/u);
  });

  it('a quoted } inside a flow mapping does not hide the next key', () => {
    const path = put(
      'q/pnpm-lock.yaml',
      'packages:\n  ms@2.1.3:\n    resolution: {a: "x}", tarball: https://evil.invalid/ms.tgz}\n',
    );
    expect(check([path]).violations).toEqual([onHost(path, 1, 'https://evil.invalid')]);
  });

  it.each([
    ['userinfo', 'resolved "https://registry.npmjs.org@evil.invalid/ms.tgz"', 'host'],
    [
      'escaped quote',
      'resolved "https://registry.npmjs.org\\"@evil.invalid/ms.tgz"',
      'non-canonical',
    ],
  ])('yarn v1 %s form is red', (_, entry, kind) => {
    const path = put('y1/yarn.lock', `ms@^2.1.3:\n  version "2.1.3"\n  ${entry}\n`);
    const violations = check([path]).violations;
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(
      kind === 'host' ? 'on https://<userinfo>@evil.invalid' : 'non-canonical address',
    );
  });

  it.each([
    'exec:./gen.js',
    'portal:../y',
    'patch:z@npm%3A1.0.0#./p.patch::locator=w%40workspace%3A.',
  ])('yarn berry local descriptor %s carries no host', (range) => {
    const path = put(
      'b2/yarn.lock',
      `"x@${range}":\n  version: 1.0.0\n  resolution: "x@${range}"\n`,
    );
    expect(check([path]).violations).toEqual([]);
  });

  it.each([
    ["https://registry.npmjs.org'x@evil.invalid/ms.tgz", 'https://<userinfo>@evil.invalid'],
    ['https://registry.npmjs.org}@evil.invalid/ms.tgz', 'https://<userinfo>@evil.invalid'],
    ['https:evil.invalid/ms.tgz', 'https://evil.invalid'],
  ])('reviewer form %s is refused in yarn.lock and pnpm-lock.yaml (block value)', (url, host) => {
    const yarn = put('r/yarn.lock', `ms@^2.1.3:\n  resolved "${url}"\n`);
    const pnpm = put(
      'r/pnpm-lock.yaml',
      `packages:\n  ms@2.1.3:\n    resolution:\n      tarball: ${url}\n`,
    );
    expect(check([yarn, pnpm]).violations).toEqual([onHost(yarn, 1, host), onHost(pnpm, 1, host)]);
  });

  it("pnpm flow value keeps ' inside a plain scalar", () => {
    const path = put(
      'f/pnpm-lock.yaml',
      "packages:\n  ms@2.1.3:\n    resolution: {integrity: x, tarball: https://registry.npmjs.org'x@evil.invalid/ms.tgz}\n",
    );
    expect(check([path]).violations).toEqual([onHost(path, 1, 'https://<userinfo>@evil.invalid')]);
  });

  it('a pnpm flow value ends at , or } as YAML reads it', () => {
    const path = put(
      'e/pnpm-lock.yaml',
      'packages:\n  ms@2.1.3:\n    resolution: {tarball: http://localhost:4873, integrity: sha512-x}\n',
    );
    expect(check([path]).violations).toEqual([]);
  });

  it('pnpm: a single-quoted key and a block-form repo: line are read', () => {
    const yaml = `packages:
  ms@2.1.3:
    'resolution': {tarball: ${FOREIGN}/ms.tgz}
  dep@1.0.0:
    resolution:
      type: git
      repo: https://git.corp.example/o/dep
      commit: abc
`;
    const path = put('q/pnpm-lock.yaml', yaml);
    expect(check([path]).violations).toEqual([
      onHost(path, 1),
      gitDep(path, 1, 'git.corp.example'),
    ]);
  });

  it('yarn berry npm: descriptors carry no host', () => {
    const path = put(
      'b/yarn.lock',
      '"ms@npm:^2.1.3":\n  version: 2.1.3\n  resolution: "ms@npm:2.1.3"\n',
    );
    expect(check([path]).violations).toEqual([]);
  });

  it('yarn berry (YAML) resolution URLs are addresses', () => {
    const berry = `__metadata:
  version: 8
"ms@https://registry.example.invalid/ms.tgz":
  version: 2.1.3
  resolution: "ms@${FOREIGN}/ms.tgz"
`;
    const path = put('y/yarn.lock', berry);
    expect(check([path]).violations).toEqual([onHost(path, 1)]);
  });
});

describe('robustness', () => {
  it('strips a BOM before parsing', () => {
    const path = put('bom/package-lock.json', `﻿${packageLock(FOREIGN)}`);
    expect(check([path]).violations).toEqual([onHost(path, 2)]);
  });

  it('a lockfile by name that does not parse is red with the right advice', () => {
    const path = put('broken/package-lock.json', '{ "lockfileVersion": 3, ');
    const [violation] = check([path]).violations;
    expect(violation).toMatch(/^broken\/package-lock\.json: unparseable lock .* regenerate/u);
  });

  it('an unparseable .json with lock markers is red (closed failure)', () => {
    const path = put('jsonc/data.json', '{ // note\n "lockfileVersion": 3 }');
    const { violations } = check([path]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(
      /^jsonc\/data\.json: \.json with lock markers does not parse .* make the file valid JSON or remove the lock$/u,
    );
  });

  it('a directory or symlink named like a carrier is ignored', () => {
    mkdirSync(join(root, 'dir.json'));
    const target = put('target.txt', packageLock(FOREIGN));
    symlinkSync(join(root, target), join(root, 'package-lock.json'));
    expect(check(['dir.json', 'package-lock.json']).violations).toEqual([]);
  });

  it('a path deleted in the working tree is skipped', () => {
    expect(check(['gone/package-lock.json'])).toEqual({
      violations: [],
      carriers: 0,
      exempted: 0,
    });
  });
});

describe('declared exemptions cover exact bytes only', () => {
  const CASES = 'tools/agent-bench/corpus/cases';

  it('an exempt frozen seed passes and is counted; a new 15th case is refused', () => {
    const frozen = put(`${CASES}/frozen/project.json`, corpusSeed(FOREIGN));
    const added = put(`${CASES}/added/project.json`, corpusSeed(FOREIGN));
    const result = check([frozen, added], [{ path: frozen, sha256: sha256(frozen) }]);
    expect(result.exempted).toBe(1);
    expect(result.violations).toEqual([onHost(`${added}#/package-lock.json`, 2)]);
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

    // Tracked only (staged counts): an untracked lock is ignored, the same answer as CI.
    execFileSync('git', ['init', '-q'], { cwd: root });
    put('docs/backlog/x/reference/probe/package-lock.json', packageLock(FOREIGN));
    expect(repoPaths(root)).toEqual([]);
    execFileSync('git', ['add', '.'], { cwd: root });
    const red = run(root);
    expect(red.status).toBe(1);
    expect(red.stderr).toContain(onHost('docs/backlog/x/reference/probe/package-lock.json', 2));
    expect(red.stderr).toMatch(/0\/19 declared exemption\(s\)/u);
  });
});
