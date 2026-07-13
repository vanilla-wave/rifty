/**
 * Unit tests for `createNpmShellCommand`. These cover the parts the glue
 * file actually owns:
 *
 *   - argv parsing (subcommand selection, spec `name@range` including the
 *     scoped-name corner case),
 *   - the package.json read / merge / write round-trip,
 *   - the bare-`npm install` no-rewrite contract,
 *   - error mapping for the EVERSIONCONFLICT / EINTEGRITY / EBROKENLOCK
 *     codes the operator is most likely to hit.
 *
 * The real `install` flow is exercised by `@riftydev/npm-client`'s own suite;
 * we inject a stub via the `install` DI seam so this file does not depend on
 * tarball fixtures from another package's private `_test-fixtures/` (would
 * violate CLAUDE.md "no internal imports across packages"). The seam is the
 * command's REAL contract (`deps.install ?? realInstall` — the compiler pins
 * `InstallFn` to the real signature), not a convenience mock; what a stub
 * can't vouch for — real result shape, learned-pin write-back with the
 * eddy-computed hash, stamp over a real tree — is covered without any stub by
 * `tests/integration/npm-shell-eddy-glue.test.ts` (real npm-client + real eddy
 * server over the fixture registry).
 */
import type { InstallOptions, InstallResult } from '@riftydev/npm-client';
import {
  RegistryClient,
  canonicalEddyRequestKey,
  eddyRequestFromPackageJson,
} from '@riftydev/npm-client';
import { Shell } from '@riftydev/shell';
import { MemoryVfs, type Vfs } from '@riftydev/vfs';
import { describe, expect, it, vi } from 'vitest';
import { createInstallStamp } from './install-stamp.ts';
import {
  type InstallFn,
  createNpmShellCommand,
  formatInstallDuration,
} from './npm-shell-command.ts';

/**
 * Build a successful install stub that records the call and returns the
 * provided package list. The stub never touches the VFS beyond writing the
 * lockfile (so callers that depend on `node_modules/<x>/package.json` would
 * not see the file). That is fine for these tests — they assert on the
 * shell command's own behaviour, not on the linker output.
 */
function makeStubInstall(responder: (deps: Record<string, string>) => InstallResult): {
  install: InstallFn;
  calls: Array<{ root: string; deps: Record<string, string>; cwd: string }>;
} {
  const calls: Array<{ root: string; deps: Record<string, string>; cwd: string }> = [];
  const install: InstallFn = async (arg1, _rootVersion, dependenciesOrOpts, opts) => {
    let rootName: string;
    let dependencies: Record<string, string>;
    let installOpts: InstallOptions;
    if (typeof arg1 === 'string') {
      rootName = arg1;
      dependencies = dependenciesOrOpts as Record<string, string>;
      installOpts = opts as InstallOptions;
    } else {
      installOpts = arg1;
      const raw = JSON.parse(
        await installOpts.vfs.readFileText(`${installOpts.cwd}/package.json`),
      ) as {
        name?: string;
        dependencies?: Record<string, string>;
      };
      rootName = raw.name ?? 'root';
      dependencies = raw.dependencies ?? {};
    }
    calls.push({ root: rootName, deps: { ...dependencies }, cwd: installOpts.cwd });
    return responder(dependencies);
  };
  return { install, calls };
}

function emptyResult(): InstallResult {
  return {
    packages: [],
    lockfile: {
      name: 'root',
      version: '0.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {},
    },
    conflicts: [],
  };
}

function singletonResult(name: string, version: string): InstallResult {
  return {
    packages: [{ name, version, dependencies: {}, files: {} }],
    lockfile: {
      name: 'root',
      version: '0.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {},
    },
    conflicts: [],
  };
}

const fakeRegistry = new RegistryClient({
  baseUrl: '/unused',
  fetch: async () => new Response('', { status: 599 }),
});

interface Recorded {
  stdout: string[];
  stderr: string[];
}

async function runShell(shell: Shell, line: string): Promise<{ exitCode: number; rec: Recorded }> {
  const rec: Recorded = { stdout: [], stderr: [] };
  const r = await shell.run(line, {
    onChunk: (chunk, stream) => {
      rec[stream].push(chunk);
    },
  });
  return { exitCode: r.exitCode, rec };
}

describe('npm-shell-command — happy path', () => {
  it('runs package scripts through the injected script runner', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify(
        {
          name: 'demo',
          version: '0.0.0',
          scripts: { vite: 'vite' },
        },
        null,
        2,
      )}\n`,
    );
    const calls: Array<{ name: string; command: string; cwd: string }> = [];
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        runScript: async (name, command, ctx) => {
          calls.push({ name, command, cwd: ctx.cwd });
          ctx.stdout.write(`script:${command}\n`);
          return 0;
        },
      }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm run vite');

    expect(exitCode).toBe(0);
    expect(calls).toEqual([{ name: 'vite', command: 'vite', cwd: '/proj' }]);
    expect(rec.stdout.join('')).toContain('script:vite');
  });

  it('forwards npm run arguments after the script name', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify(
        {
          name: 'demo',
          version: '0.0.0',
          scripts: { lint: 'eslint src/lint.js' },
        },
        null,
        2,
      )}\n`,
    );
    const calls: Array<{ name: string; command: string; cwd: string }> = [];
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        runScript: async (name, command, ctx) => {
          calls.push({ name, command, cwd: ctx.cwd });
          return 0;
        },
      }),
    );

    const { exitCode } = await runShell(shell, 'npm run lint -- --fix src/lint.js');

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      { name: 'lint', command: 'eslint src/lint.js --fix src/lint.js', cwd: '/proj' },
    ]);
  });

  it('does not forward npm run flags without the npm -- separator', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify(
        {
          name: 'demo',
          version: '0.0.0',
          scripts: { lint: 'eslint src/lint.js' },
        },
        null,
        2,
      )}\n`,
    );
    const calls: Array<{ name: string; command: string; cwd: string }> = [];
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        runScript: async (name, command, ctx) => {
          calls.push({ name, command, cwd: ctx.cwd });
          return 0;
        },
      }),
    );

    const { exitCode } = await runShell(shell, 'npm run lint --fix');

    expect(exitCode).toBe(0);
    expect(calls).toEqual([{ name: 'lint', command: 'eslint src/lint.js', cwd: '/proj' }]);
  });

  it('quotes forwarded npm run args that would expand in the child shell', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify(
        {
          name: 'demo',
          version: '0.0.0',
          scripts: { show: 'echo' },
        },
        null,
        2,
      )}\n`,
    );
    const calls: Array<{ name: string; command: string; cwd: string }> = [];
    const shell = new Shell({ cwd: '/proj', env: { HOME: '/tmp/home' } });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        runScript: async (name, command, ctx) => {
          calls.push({ name, command, cwd: ctx.cwd });
          return 0;
        },
      }),
    );

    const { exitCode } = await runShell(shell, "npm run show -- '$HOME' '*.js'");

    expect(exitCode).toBe(0);
    expect(calls).toEqual([{ name: 'show', command: "echo '$HOME' '*.js'", cwd: '/proj' }]);
  });

  it('runs package scripts without validating install-only dependency maps', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify(
        {
          name: 'demo',
          version: '0.0.0',
          scripts: { ok: 'echo OK' },
          dependencies: { bad: { version: '1.0.0' } },
        },
        null,
        2,
      )}\n`,
    );
    const calls: Array<{ name: string; command: string; cwd: string }> = [];
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        runScript: async (name, command, ctx) => {
          calls.push({ name, command, cwd: ctx.cwd });
          return 0;
        },
      }),
    );

    const { exitCode } = await runShell(shell, 'npm run ok');

    expect(exitCode).toBe(0);
    expect(calls).toEqual([{ name: 'ok', command: 'echo OK', cwd: '/proj' }]);
  });

  it('runs pre/post npm script hooks without forwarding main script arguments', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify(
        {
          name: 'demo',
          version: '0.0.0',
          scripts: {
            prelint: 'echo PRE',
            lint: 'eslint src/lint.js',
            postlint: 'echo POST',
          },
        },
        null,
        2,
      )}\n`,
    );
    const calls: Array<{ name: string; command: string; cwd: string }> = [];
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        runScript: async (name, command, ctx) => {
          calls.push({ name, command, cwd: ctx.cwd });
          return 0;
        },
      }),
    );

    const { exitCode } = await runShell(shell, 'npm run lint -- --fix src/lint.js');

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      { name: 'prelint', command: 'echo PRE', cwd: '/proj' },
      { name: 'lint', command: 'eslint src/lint.js --fix src/lint.js', cwd: '/proj' },
      { name: 'postlint', command: 'echo POST', cwd: '/proj' },
    ]);
  });

  it('stops npm run hooks after the first failing hook or script', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify(
        {
          name: 'demo',
          version: '0.0.0',
          scripts: {
            prelint: 'echo PRE',
            lint: 'eslint src/lint.js',
            postlint: 'echo POST',
            preformat: 'echo PRE_FORMAT',
            format: 'prettier --write src/bad.ts',
            postformat: 'echo POST_FORMAT',
          },
        },
        null,
        2,
      )}\n`,
    );
    const calls: Array<{ name: string; command: string }> = [];
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        runScript: async (name, command) => {
          calls.push({ name, command });
          return name === 'prelint' || name === 'format' ? 7 : 0;
        },
      }),
    );

    const lint = await runShell(shell, 'npm run lint');
    const format = await runShell(shell, 'npm run format');

    expect(lint.exitCode).toBe(7);
    expect(format.exitCode).toBe(7);
    expect(calls).toEqual([
      { name: 'prelint', command: 'echo PRE' },
      { name: 'preformat', command: 'echo PRE_FORMAT' },
      { name: 'format', command: 'prettier --write src/bad.ts' },
    ]);
  });

  it('installs a single package and writes it into package.json', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const { install } = makeStubInstall(() => singletonResult('lodash', '4.17.21'));

    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const { exitCode, rec } = await runShell(shell, 'npm install lodash@^4.17.0');
    expect(exitCode).toBe(0);
    const stdout = rec.stdout.join('');
    expect(stdout).toContain('installing lodash@^4.17.0');
    expect(stdout).toContain('installed 1 package');

    const pkg = JSON.parse(await vfs.readFileText('/proj/package.json')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies).toEqual({ lodash: '^4.17.0' });
  });

  it('merges new deps into existing package.json without clobbering existing deps', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify(
        { name: 'demo', version: '0.0.0', dependencies: { a: '1.0.0' } },
        null,
        2,
      )}\n`,
    );
    const { install, calls } = makeStubInstall(() => emptyResult());

    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const { exitCode } = await runShell(shell, 'npm i b@2.0.0');
    expect(exitCode).toBe(0);
    expect(calls[0]?.deps).toEqual({ a: '1.0.0', b: '2.0.0' });

    const pkg = JSON.parse(await vfs.readFileText('/proj/package.json')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies).toEqual({ a: '1.0.0', b: '2.0.0' });
  });

  it('preserves unrelated package.json fields when adding dependencies', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify(
        {
          name: 'demo',
          version: '0.0.0',
          type: 'module',
          private: true,
          scripts: { dev: 'vite' },
          devDependencies: { vite: '^5.4.0' },
          dependencies: { a: '1.0.0' },
        },
        null,
        2,
      )}\n`,
    );
    const { install } = makeStubInstall(() => emptyResult());

    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const { exitCode } = await runShell(shell, 'npm install b@2.0.0');
    expect(exitCode).toBe(0);

    const pkg = JSON.parse(await vfs.readFileText('/proj/package.json')) as {
      type?: string;
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    expect(pkg.type).toBe('module');
    expect(pkg.scripts).toEqual({ dev: 'vite' });
    expect(pkg.devDependencies).toEqual({ vite: '^5.4.0' });
    expect(pkg.dependencies).toEqual({ a: '1.0.0', b: '2.0.0' });
  });

  it('parses scoped specs (`@scope/name@range`) without splitting at the leading @', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const { install, calls } = makeStubInstall(() => emptyResult());

    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const { exitCode } = await runShell(shell, 'npm add @scope/pkg@^1.2.0');
    expect(exitCode).toBe(0);
    expect(calls[0]?.deps).toEqual({ '@scope/pkg': '^1.2.0' });
  });

  it('defaults a spec without `@range` to "latest"', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const { install, calls } = makeStubInstall(() => emptyResult());

    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    await runShell(shell, 'npm install express');
    expect(calls[0]?.deps).toEqual({ express: 'latest' });
  });

  it('rejects non-registry CLI specs before they reach the registry installer', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const { install, calls } = makeStubInstall(() => emptyResult());

    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const { exitCode, rec } = await runShell(shell, 'npm install file:../local');

    expect(exitCode).toBe(1);
    expect(rec.stderr.join('')).toContain('npm-client.dependency-spec.file');
    expect(calls).toEqual([]);
    expect(await vfs.exists('/proj/package.json')).toBe(false);
  });

  it('rejects bare local-directory CLI specs before they reach the registry installer', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const { install, calls } = makeStubInstall(() => emptyResult());

    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const { exitCode, rec } = await runShell(shell, 'npm install .');

    expect(exitCode).toBe(1);
    expect(rec.stderr.join('')).toContain('npm-client.dependency-spec.file');
    expect(calls).toEqual([]);
    expect(await vfs.exists('/proj/package.json')).toBe(false);
  });

  it('rejects GitHub shorthand CLI specs before writing package.json', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const { install, calls } = makeStubInstall(() => emptyResult());

    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const { exitCode, rec } = await runShell(shell, 'npm install expressjs/express');

    expect(exitCode).toBe(1);
    expect(rec.stderr.join('')).toContain('npm-client.dependency-spec.git');
    expect(calls).toEqual([]);
    expect(await vfs.exists('/proj/package.json')).toBe(false);
  });

  it('bare `npm install` reads existing deps and does NOT rewrite package.json', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify(
        { name: 'demo', version: '0.0.0', dependencies: { a: '1.0.0' } },
        null,
        2,
      )}\n`,
    );
    const before = await vfs.readFile('/proj/package.json');
    const { install, calls } = makeStubInstall(() => emptyResult());

    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const { exitCode } = await runShell(shell, 'npm install');
    expect(exitCode).toBe(0);
    expect(calls[0]?.deps).toEqual({ a: '1.0.0' });
    const after = await vfs.readFile('/proj/package.json');
    expect(after).toEqual(before);
  });

  it('rejects malformed package.json dependency entries instead of dropping them', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const before = `${JSON.stringify(
      {
        name: 'demo',
        version: '0.0.0',
        dependencies: { bad: { version: '1.0.0' } },
      },
      null,
      2,
    )}\n`;
    await vfs.writeFile('/proj/package.json', before);
    const { install, calls } = makeStubInstall(() => emptyResult());

    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const { exitCode, rec } = await runShell(shell, 'npm install');

    expect(exitCode).toBe(1);
    expect(rec.stderr.join('')).toContain('npm-client.package-json.dependencies');
    expect(rec.stdout.join('')).not.toContain('no dependencies');
    expect(calls).toEqual([]);
    expect(await vfs.readFileText('/proj/package.json')).toBe(before);
  });

  it('refuses an empty install (no args, no package.json deps)', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const { install, calls } = makeStubInstall(() => emptyResult());

    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const { exitCode, rec } = await runShell(shell, 'npm install');
    expect(exitCode).toBe(0);
    expect(calls).toEqual([]);
    expect(rec.stdout.join('')).toContain('no dependencies');
  });

  it('keeps root lifecycle ceilings on bare npm install even when no deps exist', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify(
        {
          name: 'demo',
          version: '0.0.0',
          scripts: { prepare: 'node build.js' },
        },
        null,
        2,
      )}\n`,
    );

    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry }));

    const { exitCode, rec } = await runShell(shell, 'npm install');

    expect(exitCode).toBe(1);
    expect(rec.stderr.join('')).toContain('npm-client.lifecycle.prepare');
    expect(rec.stdout.join('')).not.toContain('no dependencies');
  });
});

describe('npm-shell-command — error mapping', () => {
  async function makeShellWithThrow(
    code: string,
    extra: Record<string, unknown>,
  ): Promise<{ shell: Shell }> {
    const vfs = new MemoryVfs();
    // Seed a package.json with a dep so the bare-`npm install` path still
    // calls the (throwing) install stub; without this, `no dependencies to
    // install` short-circuits before the throw can fire.
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify({ name: 'demo', version: '0.0.0', dependencies: { a: '1.0.0' } }, null, 2)}\n`,
    );
    const install: InstallFn = async () => {
      throw Object.assign(new Error('boom'), { code, ...extra });
    };
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));
    return { shell };
  }

  it('reports EVERSIONCONFLICT with the offending pair', async () => {
    const { shell } = await makeShellWithThrow('EVERSIONCONFLICT', {
      packageName: 'ms',
      firstVersion: '2.1.3',
      secondVersion: '2.0.0',
    });
    const { exitCode, rec } = await runShell(shell, 'npm install a');
    expect(exitCode).toBe(1);
    const stderr = rec.stderr.join('');
    expect(stderr).toContain('version conflict on ms');
    expect(stderr).toContain('2.1.3 vs 2.0.0');
  });

  it('reports EINTEGRITY with expected vs actual', async () => {
    const { shell } = await makeShellWithThrow('EINTEGRITY', {
      packageName: 'evil',
      expected: 'sha512-A',
      actual: 'sha512-B',
    });
    const { exitCode, rec } = await runShell(shell, 'npm install evil');
    expect(exitCode).toBe(1);
    const stderr = rec.stderr.join('');
    expect(stderr).toContain('integrity mismatch for evil');
    expect(stderr).toContain('sha512-A');
    expect(stderr).toContain('sha512-B');
  });

  it('reports EBROKENLOCK with a recovery hint', async () => {
    const { shell } = await makeShellWithThrow('EBROKENLOCK', { packageName: 'ms' });
    const { exitCode, rec } = await runShell(shell, 'npm install');
    expect(exitCode).toBe(1);
    expect(rec.stderr.join('')).toContain('lockfile is broken');
  });

  it('falls through to the raw message for unmapped error codes', async () => {
    const { shell } = await makeShellWithThrow('ENETUNREACH', {});
    const { exitCode, rec } = await runShell(shell, 'npm install x');
    expect(exitCode).toBe(1);
    expect(rec.stderr.join('')).toContain('install failed: boom');
  });
});

describe('npm-shell-command — package.json rollback on failed named install', () => {
  const throwingInstall: InstallFn = async () => {
    throw Object.assign(new Error('boom'), { code: 'ENETUNREACH' });
  };

  it('restores the prior package.json bytes exactly', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const before = `${JSON.stringify(
      { name: 'demo', version: '1.2.3', dependencies: { ms: '^2.0.0' }, license: 'MIT' },
      null,
      2,
    )}\n`;
    await vfs.writeFile('/proj/package.json', before);
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({ vfs, registry: fakeRegistry, install: throwingInstall }),
    );

    const { exitCode } = await runShell(shell, 'npm install lodash');

    expect(exitCode).toBe(1);
    expect(await vfs.readFileText('/proj/package.json')).toBe(before);
  });

  it('removes the package.json the install itself created', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({ vfs, registry: fakeRegistry, install: throwingInstall }),
    );

    const { exitCode } = await runShell(shell, 'npm install lodash');

    expect(exitCode).toBe(1);
    expect(await vfs.exists('/proj/package.json')).toBe(false);
  });

  it('bare `npm install` failure leaves package.json untouched (no rollback writes)', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const before = `${JSON.stringify(
      { name: 'demo', version: '0.0.0', dependencies: { a: '1.0.0' } },
      null,
      2,
    )}\n`;
    await vfs.writeFile('/proj/package.json', before);
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({ vfs, registry: fakeRegistry, install: throwingInstall }),
    );

    const { exitCode } = await runShell(shell, 'npm install');

    expect(exitCode).toBe(1);
    expect(await vfs.readFileText('/proj/package.json')).toBe(before);
  });
});

describe('npm-shell-command — argv', () => {
  it('rejects unknown subcommands without exit 127', async () => {
    const vfs = new MemoryVfs();
    const shell = new Shell({ cwd: '/' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry }));

    const { exitCode, rec } = await runShell(shell, 'npm publish');
    expect(exitCode).toBe(1);
    expect(rec.stderr.join('')).toContain("unknown subcommand 'publish'");
  });

  it('refuses an UNKNOWN install flag instead of silently dropping it', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const { install, calls } = makeStubInstall(() => emptyResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const { exitCode, rec } = await runShell(shell, 'npm install --frozen-lockfile lodash');
    expect(exitCode).toBe(1);
    expect(rec.stderr.join('')).toContain("flag '--frozen-lockfile' not supported");
    expect(calls).toEqual([]);
  });

  it('points an unknown subcommand at `npm help`', async () => {
    const vfs = new MemoryVfs();
    const shell = new Shell({ cwd: '/' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry }));

    const { rec } = await runShell(shell, 'npm publish');
    expect(rec.stderr.join('')).toContain('npm help');
  });
});

describe('npm-shell-command — help', () => {
  async function help(line: string): Promise<{ exitCode: number; out: string; err: string }> {
    const vfs = new MemoryVfs();
    const shell = new Shell({ cwd: '/' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry }));
    const { exitCode, rec } = await runShell(shell, line);
    return { exitCode, out: rec.stdout.join(''), err: rec.stderr.join('') };
  }

  it('`npm help` prints help to stdout with exit 0', async () => {
    const { exitCode, out } = await help('npm help');
    expect(exitCode).toBe(0);
    expect(out).toContain('Commands:');
  });

  for (const line of ['npm -h', 'npm --help', 'npm']) {
    it(`'${line}' prints help to stdout with npm's usage exit 1`, async () => {
      const { exitCode, out } = await help(line);
      expect(exitCode).toBe(1);
      expect(out).toContain('Commands:');
    });
  }

  it('rejects unsupported help topics instead of silently showing generic help', async () => {
    const { exitCode, err } = await help('npm help publish');
    expect(exitCode).toBe(1);
    expect(err).toContain('Not implemented: npm.help.topic');
  });

  it('lists each supported command on its own line', async () => {
    const { out } = await help('npm help');
    // One command per line — no comma-joined single line.
    const lines = out.split('\n');
    for (const name of ['install', 'run', 'test', 'start', 'stop', 'restart']) {
      const hit = lines.filter((l) => new RegExp(`\\bnpm ${name}\\b`).test(l));
      expect(hit).toHaveLength(1);
    }
    expect(out).not.toContain('install, i, add, run');
  });

  it('advertises the install aliases without a separate line per alias', async () => {
    const { out } = await help('npm help');
    expect(out).toContain('i, add');
  });
});

describe('npm-shell-command — formatInstallDuration', () => {
  it('renders sub-second durations in milliseconds', () => {
    expect(formatInstallDuration(0)).toBe('0ms');
    expect(formatInstallDuration(1)).toBe('1ms');
    expect(formatInstallDuration(850)).toBe('850ms');
    expect(formatInstallDuration(999)).toBe('999ms');
  });

  it('renders one-second-and-over durations in seconds (one decimal)', () => {
    expect(formatInstallDuration(1000)).toBe('1.0s');
    expect(formatInstallDuration(1500)).toBe('1.5s');
    expect(formatInstallDuration(2523)).toBe('2.5s');
    expect(formatInstallDuration(60000)).toBe('60.0s');
  });
});

describe('npm-shell-command — save flags + lifecycle aliases', () => {
  it('npm install --prefer-online forwards prefer to install() — the freshness escape hatch works from the terminal', async () => {
    // ADR-0216 names prefer:'online' as the stale-window escape hatch; it must
    // exist where the deviation lives (the playground terminal), not only in
    // the SDK. The installer itself bypasses pins/prefetch under online.
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify({ name: 'demo', dependencies: { debug: '^4.4.1' } }, null, 2)}\n`,
    );
    let seenPrefer: string | undefined;
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install: async (arg1) => {
          seenPrefer = (arg1 as InstallOptions).prefer;
          return emptyResult();
        },
      }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm install --prefer-online');

    expect(exitCode).toBe(0);
    expect(rec.stderr.join('')).toBe('');
    expect(seenPrefer).toBe('online');
  });

  async function readPkg(
    vfs: MemoryVfs,
  ): Promise<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }> {
    return JSON.parse(await vfs.readFileText('/proj/package.json'));
  }

  it('npm i -D <pkg> records it under devDependencies, NOT dependencies', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const { install } = makeStubInstall(() => emptyResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    expect((await runShell(shell, 'npm i -D vitest@^2.0.0')).exitCode).toBe(0);
    const pkg = await readPkg(vfs);
    expect(pkg.devDependencies).toEqual({ vitest: '^2.0.0' });
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it('--save-dev is the long alias of -D', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const { install } = makeStubInstall(() => emptyResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    expect((await runShell(shell, 'npm install --save-dev lodash')).exitCode).toBe(0);
    expect((await readPkg(vfs)).devDependencies).toEqual({ lodash: 'latest' });
  });

  it('--save / -E / bare all record under dependencies (save is the default)', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const { install } = makeStubInstall(() => emptyResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    expect((await runShell(shell, 'npm i --save a@1.0.0')).exitCode).toBe(0);
    expect((await runShell(shell, 'npm i -E b@2.0.0')).exitCode).toBe(0);
    const pkg = await readPkg(vfs);
    expect(pkg.dependencies).toEqual({ a: '1.0.0', b: '2.0.0' });
    expect(pkg.devDependencies ?? {}).toEqual({});
  });

  it('npm i -g <pkg> → directed browser-sandbox message, exit 1, no install', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const { install, calls } = makeStubInstall(() => emptyResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const { exitCode, rec } = await runShell(shell, 'npm i -g typescript');
    expect(exitCode).toBe(1);
    expect(rec.stderr.join('')).toContain(
      "global installs aren't supported in the browser sandbox",
    );
    expect(calls).toEqual([]);
  });

  it('npm test / start / stop / restart alias to npm run <name>', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify(
        {
          name: 'demo',
          version: '0.0.0',
          scripts: { test: 'vitest run', start: 'node s.js', stop: 'true', restart: 'true' },
        },
        null,
        2,
      )}\n`,
    );
    const ran: Array<{ name: string; command: string }> = [];
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        runScript: async (name, command) => {
          ran.push({ name, command });
          return 0;
        },
      }),
    );

    for (const name of ['test', 'start', 'stop', 'restart']) {
      expect((await runShell(shell, `npm ${name}`)).exitCode).toBe(0);
    }
    expect(ran).toEqual([
      { name: 'test', command: 'vitest run' },
      { name: 'start', command: 'node s.js' },
      { name: 'stop', command: 'true' },
      { name: 'restart', command: 'true' },
    ]);
  });

  it('npm test with no test script → missing-script message, non-zero', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify({ name: 'demo', version: '0.0.0', scripts: {} }, null, 2)}\n`,
    );
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({ vfs, registry: fakeRegistry, runScript: async () => 0 }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm test');
    expect(exitCode).not.toBe(0);
    expect(rec.stderr.join('')).toContain("missing script 'test'");
  });

  it('advertises the lifecycle commands via `npm help`, one per line', async () => {
    const vfs = new MemoryVfs();
    const shell = new Shell({ cwd: '/' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry }));
    const { rec } = await runShell(shell, 'npm help');
    const lines = rec.stdout.join('').split('\n');
    for (const name of ['test', 'start', 'stop', 'restart']) {
      expect(lines.filter((l) => new RegExp(`\\bnpm ${name}\\b`).test(l))).toHaveLength(1);
    }
  });
});

describe('npm-shell-command — per-package progress + install stamp (ADR-0134/0135)', () => {
  function twoPackageResult(): InstallResult {
    return {
      packages: [
        { name: 'lodash', version: '4.17.21', dependencies: {}, files: {} },
        { name: 'ms', version: '2.1.3', dependencies: {}, files: {} },
      ],
      lockfile: {
        name: 'root',
        version: '0.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {},
      },
      conflicts: [],
    };
  }

  it('streams a `npm: + name@version` line per package as the installer reports progress', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const install: InstallFn = async (arg1) => {
      const opts = arg1 as InstallOptions;
      opts.onPackage?.({ name: 'lodash', version: '4.17.21', cacheHit: false });
      opts.onPackage?.({ name: 'ms', version: '2.1.3', cacheHit: true });
      return twoPackageResult();
    };
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const { exitCode, rec } = await runShell(shell, 'npm install lodash');

    expect(exitCode).toBe(0);
    const stdout = rec.stdout.join('');
    expect(stdout).toContain('npm: + lodash@4.17.21\n');
    expect(stdout).toContain('npm: + ms@2.1.3 (cached)\n');
    expect(stdout.indexOf('npm: + lodash@4.17.21')).toBeLessThan(
      stdout.indexOf('installed 2 package'),
    );
  });

  it('drains + CHECKS before the stamp, then drains the stamp (ADR-0187 Corrected) — in background', async () => {
    // The tree drain is checked FIRST — a stamp must never claim a tree whose
    // write-through failed — then the stamp rides its own (tiny) drain. The
    // sequence runs in background (install exit does not await it), so the
    // asserts wait for it to settle.
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install } = makeStubInstall(() => twoPackageResult());
    const shell = new Shell({ cwd: '/proj' });
    const events: string[] = [];
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => {
          events.push(
            (await vfs.exists('/proj/node_modules/.rifty-install-stamp.json'))
              ? 'flush-after-stamp'
              : 'flush-before-stamp',
          );
          return undefined;
        },
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install lodash@^4.17.0');

    expect(exitCode).toBe(0);
    await vi.waitFor(() => {
      expect(events).toEqual(['flush-before-stamp', 'flush-after-stamp']);
    });
    const stamp = JSON.parse(
      await vfs.readFileText('/proj/node_modules/.rifty-install-stamp.json'),
    ) as { version: number; deps: Record<string, string>; packages: number };
    expect(stamp.version).toBe(2);
    expect(stamp.deps).toEqual({ lodash: '^4.17.0' });
    expect(stamp.packages).toBe(2);
  });

  it('a DIRTY drain (persist failures) skips the stamp and warns loudly — never stamp a torn tree', async () => {
    // OPFS quota/perm failure: the write-through swallowed it per-op, but the
    // flush report exposes it (ADR-0187 Corrected). The install stays usable
    // this session (exit 0), the stamp is SKIPPED (next boot re-installs
    // instead of trusting a tree OPFS failed to hold), stderr says so.
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install } = makeStubInstall(() => twoPackageResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => ({
          failures: [
            {
              path: '/proj/node_modules/lodash/package.json',
              op: 'write' as const,
              message: 'QuotaExceededError',
            },
          ],
          total: 137,
        }),
      }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm install lodash@^4.17.0');

    expect(exitCode).toBe(0); // the live tree works — durability, not the install, failed
    await vi.waitFor(() => {
      expect(rec.stderr.join('')).toContain('NOT durable');
    });
    const stderr = rec.stderr.join('');
    expect(stderr).toContain('137 file(s) failed to persist');
    expect(stderr).toContain('QuotaExceededError');
    expect(await vfs.exists('/proj/node_modules/.rifty-install-stamp.json')).toBe(false);
  });

  it('a leftover failure on the stamp file ITSELF does not gate — the stamp rewrite heals that path', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install } = makeStubInstall(() => twoPackageResult());
    const shell = new Shell({ cwd: '/proj' });
    let call = 0;
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () =>
          ++call === 1
            ? {
                // A previous install's stamp never persisted — not a torn TREE.
                failures: [
                  {
                    path: '/proj/node_modules/.rifty-install-stamp.json',
                    op: 'write' as const,
                    message: 'QuotaExceededError',
                  },
                ],
                total: 1,
              }
            : { failures: [], total: 0 },
      }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm install lodash@^4.17.0');

    expect(exitCode).toBe(0);
    await vi.waitFor(async () => {
      expect(await vfs.exists('/proj/node_modules/.rifty-install-stamp.json')).toBe(true);
    });
    expect(rec.stderr.join('')).toBe('');
  });

  it('a stamp write failure beyond the sampled failures still warns — the FULL ledger, not the sample', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install } = makeStubInstall(() => twoPackageResult());
    const shell = new Shell({ cwd: '/proj' });
    let call = 0;
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () =>
          ++call === 1
            ? { failures: [], total: 0 }
            : {
                failures: [
                  {
                    path: '/.rifty/eddy-learned-pins.json',
                    op: 'write' as const,
                    message: 'QuotaExceededError',
                  },
                ],
                total: 21,
                anyFailure: (pred: (p: string) => boolean) =>
                  pred('/.rifty/eddy-learned-pins.json') ||
                  pred('/proj/node_modules/.rifty-install-stamp.json'),
              },
      }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm install lodash@^4.17.0');

    expect(exitCode).toBe(0);
    await vi.waitFor(() => {
      expect(rec.stderr.join('')).toContain('the install stamp failed to persist');
    });
    expect(await vfs.exists('/proj/node_modules/.rifty-install-stamp.json')).toBe(true);
  });

  it('a FOREIGN persist failure (outside node_modules) does not gate — the stamp attests THIS tree, not the whole VFS', async () => {
    // A learned-pins / other-project write failing to persist is not this
    // node_modules torn — it must NOT skip a good stamp (over-broad revoke bug).
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install } = makeStubInstall(() => twoPackageResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => ({
          failures: [
            {
              path: '/.rifty/eddy-learned-pins.json',
              op: 'write' as const,
              message: 'QuotaExceededError',
            },
          ],
          total: 1,
        }),
      }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm install lodash@^4.17.0');

    expect(exitCode).toBe(0);
    await vi.waitFor(async () => {
      expect(await vfs.exists('/proj/node_modules/.rifty-install-stamp.json')).toBe(true); // stamped
    });
    expect(rec.stderr.join('')).toBe(''); // no NOT-durable warning
  });

  it('a tree failure BEYOND the sampled failures still gates the stamp — the FULL ledger, not the sample', async () => {
    // Foreign failures fill the report sample; the node_modules failure sits
    // beyond it and is only visible via `anyFailure` (the full ledger). Scanning
    // `failures` alone would stamp a torn tree.
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install } = makeStubInstall(() => twoPackageResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => ({
          failures: [
            { path: '/.rifty/eddy-learned-pins.json', op: 'write' as const, message: 'Quota' },
          ],
          total: 21,
          anyFailure: (pred: (p: string) => boolean) =>
            pred('/.rifty/eddy-learned-pins.json') ||
            pred('/proj/node_modules/lodash/package.json'),
        }),
      }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm install lodash@^4.17.0');

    expect(exitCode).toBe(0); // live tree works
    await vi.waitFor(() => {
      expect(rec.stderr.join('')).toContain('NOT durable'); // …but stamp SKIPPED
    });
    expect(await vfs.exists('/proj/node_modules/.rifty-install-stamp.json')).toBe(false);
  });

  it('a THROWING flush skips the stamp and warns — a drain that cannot even report is not durable', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install } = makeStubInstall(() => twoPackageResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => {
          throw new Error('rpc torn');
        },
      }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm install lodash@^4.17.0');

    expect(exitCode).toBe(0);
    await vi.waitFor(() => {
      expect(rec.stderr.join('')).toContain('install flush failed: rpc torn');
    });
    expect(await vfs.exists('/proj/node_modules/.rifty-install-stamp.json')).toBe(false);
  });

  it('drains the write-through even when the stamp write FAILS — durable-on-exit must not hinge on the stamp', async () => {
    // A stamp failure only costs the next boot's skip optimization; the TREE must
    // still be flushed or an immediate reload loses the user's install. So flush
    // runs regardless of the stamp's outcome.
    const base = new MemoryVfs();
    await base.mkdir('/proj/node_modules', { recursive: true });
    const vfs = new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === 'writeFile') {
          return async (path: string, data: unknown) => {
            if (String(path).endsWith('.rifty-install-stamp.json')) {
              throw new Error('stamp write boom');
            }
            return (target.writeFile as (p: string, d: unknown) => Promise<void>)(path, data);
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    }) as unknown as MemoryVfs;
    let flushed = false;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { install } = makeStubInstall(() => twoPackageResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => {
          flushed = true;
          return undefined;
        },
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install lodash@^4.17.0');

    expect(exitCode).toBe(0); // install still succeeds
    await vi.waitFor(() => {
      expect(flushed).toBe(true); // …and the tree was flushed despite the stamp failure
    });
    warnSpy.mockRestore();
    expect(await base.exists('/proj/node_modules/.rifty-install-stamp.json')).toBe(false);
  });

  it('keys the install stamp on the owner project slug so a reload reuses the tree', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install } = makeStubInstall(() => twoPackageResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        projectSlug: () => 'real-vite',
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install lodash@^4.17.0');

    expect(exitCode).toBe(0);
    await vi.waitFor(async () => {
      expect(await vfs.exists('/proj/node_modules/.rifty-install-stamp.json')).toBe(true);
    });
    const stamp = JSON.parse(
      await vfs.readFileText('/proj/node_modules/.rifty-install-stamp.json'),
    ) as { slug: string };
    // The old default '' broke post-reload reuse: the boot's
    // installStampSatisfied(projectSlug) missed on the slug, so the dependency
    // arrival re-ran and CLOBBERED the user-installed tree. The stamp must carry
    // the owner's project slug so the reused-tree fast path is taken on reload.
    expect(stamp.slug).toBe('real-vite');
  });

  it('does not write a stamp when the install fails', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const install: InstallFn = async () => {
      throw new Error('network down');
    };
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const { exitCode } = await runShell(shell, 'npm install lodash');

    expect(exitCode).toBe(1);
    expect(await vfs.exists('/proj/node_modules/.rifty-install-stamp.json')).toBe(false);
  });

  it('a failed install leaves a previously TRUSTED stamp demoted to pending — the tree may be part-mutated', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install } = makeStubInstall(() => twoPackageResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));
    await runShell(shell, 'npm install lodash@^4.17.0');
    await vi.waitFor(async () => {
      const stamp = JSON.parse(
        await vfs.readFileText('/proj/node_modules/.rifty-install-stamp.json'),
      ) as { durability?: string };
      expect(stamp.durability).toBeUndefined(); // trusted stamp #1 down
    });

    const failing: InstallFn = async () => {
      throw new Error('network down');
    };
    const shell2 = new Shell({ cwd: '/proj' });
    shell2.registerCommand(
      'npm',
      createNpmShellCommand({ vfs, registry: fakeRegistry, install: failing }),
    );
    const { exitCode } = await runShell(shell2, 'npm install ms');

    expect(exitCode).toBe(1);
    // The failing install may have part-mutated the tree before throwing —
    // the old trusted stamp must NOT resurrect (pending = next boot re-installs).
    const stamp = JSON.parse(
      await vfs.readFileText('/proj/node_modules/.rifty-install-stamp.json'),
    ) as { durability?: string };
    expect(stamp.durability).toBe('pending');
  });
});

describe('npm-shell-command — background durability (install exit stops awaiting the drain)', () => {
  function twoPackageResult(): InstallResult {
    return {
      packages: [
        { name: 'lodash', version: '4.17.21', dependencies: {}, files: {} },
        { name: 'ms', version: '2.1.3', dependencies: {}, files: {} },
      ],
      lockfile: {
        name: 'root',
        version: '0.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {},
      },
      conflicts: [],
    };
  }
  const STAMP = '/proj/node_modules/.rifty-install-stamp.json';
  /** The stamp iff present AND trusted (not pending); null otherwise. */
  async function trustedStamp(
    vfs: MemoryVfs,
  ): Promise<{ deps: Record<string, string>; slug: string } | null> {
    if (!(await vfs.exists(STAMP))) return null;
    const stamp = JSON.parse(await vfs.readFileText(STAMP)) as {
      durability?: string;
      deps: Record<string, string>;
      slug: string;
    };
    return stamp.durability === undefined ? stamp : null;
  }

  it('resolves the install (and starts a &&-chained command) WITHOUT awaiting the durability sequence; the stamp still lands only after the clean drain', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install } = makeStubInstall(() => twoPackageResult());
    let releaseFlush!: () => void;
    const flushGate = new Promise<void>((r) => {
      releaseFlush = r;
    });
    let flushCalls = 0;
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => {
          flushCalls++;
          await flushGate;
          return { failures: [], total: 0 };
        },
      }),
    );

    // Resolves while the FIRST drain is still pending — re-awaiting the
    // sequence in the foreground deadlocks this call (the gate opens only
    // after runShell returns), so this line IS the timing assertion.
    const { exitCode, rec } = await runShell(shell, 'npm install lodash@^4.17.0 && echo NEXT');

    expect(exitCode).toBe(0);
    expect(rec.stdout.join('')).toContain('npm: installed 2 package(s)');
    expect(rec.stdout.join('')).toContain('NEXT'); // the chained command ran
    expect(flushCalls).toBe(1); // tree drain issued in background…
    expect(await trustedStamp(vfs)).toBeNull(); // …and the TRUSTED stamp is GATED on it
    releaseFlush();
    await vi.waitFor(async () => {
      expect(await trustedStamp(vfs)).not.toBeNull(); // order preserved: drain → gate → stamp
    });
  });

  it('a DIRTY background drain still warns loudly + skips the stamp — after the prompt returned, never blocking it', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install } = makeStubInstall(() => twoPackageResult());
    let releaseFlush!: () => void;
    const flushGate = new Promise<void>((r) => {
      releaseFlush = r;
    });
    const shell = new Shell({ cwd: '/proj' });
    const rec: Recorded = { stdout: [], stderr: [] };
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => {
          await flushGate;
          return {
            failures: [
              {
                path: '/proj/node_modules/lodash/package.json',
                op: 'write' as const,
                message: 'QuotaExceededError',
              },
            ],
            total: 137,
          };
        },
      }),
    );

    const r = await shell.run('npm install lodash@^4.17.0', {
      onChunk: (chunk, stream) => {
        rec[stream].push(chunk);
      },
    });

    expect(r.exitCode).toBe(0);
    expect(rec.stderr.join('')).toBe(''); // nothing failed YET — exit did not wait for the verdict
    releaseFlush();
    await vi.waitFor(() => {
      expect(rec.stderr.join('')).toContain('NOT durable'); // honesty stays loud, just async
    });
    expect(rec.stderr.join('')).toContain('137 file(s) failed to persist');
    expect(await trustedStamp(vfs)).toBeNull(); // never a trusted stamp over a dirty drain
  });

  it('a drain that never completes (tab/worker killed) leaves NO stamp — self-heal: the next boot re-installs', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install } = makeStubInstall(() => twoPackageResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: () => new Promise(() => {}), // the drain never settles
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install lodash@^4.17.0');

    expect(exitCode).toBe(0); // install exit never hinged on the drain
    await new Promise((r) => setTimeout(r, 20));
    // Never a TRUSTED stamp for an unproven tree — the next boot re-installs.
    expect(await trustedStamp(vfs)).toBeNull();
  });

  it('a NEWER install cancels the in-flight sequence\u2019s trusted stamp \u2014 stamp #1 can never attest install #2\u2019s tree', async () => {
    // Generation guard (review round 1): install #2 does NOT wait on install
    // #1\u2019s wedged drain (an await-chain would park every later install behind
    // a dead durability layer); instead #1\u2019s sequence loses the right to
    // write a trusted stamp the moment #2 claims the tree.
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    let releaseFlush!: () => void;
    const flushGate = new Promise<void>((r) => {
      releaseFlush = r;
    });
    let flushCalls = 0;
    const { install } = makeStubInstall(() => twoPackageResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => {
          flushCalls++;
          if (flushCalls === 1) await flushGate; // install #1's tree drain hangs
          return { failures: [], total: 0 };
        },
      }),
    );

    const first = await runShell(shell, 'npm install lodash@^4.17.0');
    expect(first.exitCode).toBe(0); // resolved with its sequence still in flight

    // Install #2 proceeds immediately (never parked behind #1's drain) and
    // its own sequence stamps the tree.
    const second = await runShell(shell, 'npm install ms@^2.1.3');
    expect(second.exitCode).toBe(0);
    await vi.waitFor(async () => {
      expect((await trustedStamp(vfs))?.deps).toEqual({ lodash: '^4.17.0', ms: '^2.1.3' });
    });

    // Now #1's drain finally settles — its sequence must NOT overwrite the
    // newer stamp with the stale lodash-only attestation.
    releaseFlush();
    await new Promise((r) => setTimeout(r, 20));
    expect((await trustedStamp(vfs))?.deps).toEqual({ lodash: '^4.17.0', ms: '^2.1.3' });
  });

  it('the generation guard is per TREE, not per command instance \u2014 another terminal\u2019s install cancels it too', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    let releaseFlush!: () => void;
    const flushGate = new Promise<void>((r) => {
      releaseFlush = r;
    });
    let hangNext = true;
    const makeDeps = () => ({
      vfs,
      registry: fakeRegistry,
      install: makeStubInstall(() => twoPackageResult()).install,
      flush: async () => {
        const hang = hangNext;
        hangNext = false;
        if (hang) await flushGate; // only terminal A's tree drain hangs
        return { failures: [], total: 0 };
      },
    });
    const shellA = new Shell({ cwd: '/proj' });
    shellA.registerCommand('npm', createNpmShellCommand(makeDeps()));
    const shellB = new Shell({ cwd: '/proj' });
    shellB.registerCommand('npm', createNpmShellCommand(makeDeps()));

    const a = await runShell(shellA, 'npm install lodash@^4.17.0');
    expect(a.exitCode).toBe(0); // A's sequence still in flight

    const b = await runShell(shellB, 'npm install ms@^2.1.3');
    expect(b.exitCode).toBe(0);
    await vi.waitFor(async () => {
      expect((await trustedStamp(vfs))?.deps).toEqual({ lodash: '^4.17.0', ms: '^2.1.3' });
    });

    releaseFlush();
    await new Promise((r) => setTimeout(r, 20));
    // A's late sequence (a DIFFERENT command instance) still must not clobber
    // B's stamp \u2014 the generation map is module-level, keyed by tree root.
    expect((await trustedStamp(vfs))?.deps).toEqual({ lodash: '^4.17.0', ms: '^2.1.3' });
  });

  it('an in-flight install REPLACES the previous trusted stamp with a PENDING one BEFORE touching the tree', async () => {
    // Regression (review round 1): without this, a reload during install #2
    // (or its background drain) sees install #1's still-trusted stamp over a
    // half-replaced tree and trusts it. Same pending-first pattern as the
    // boot path (ADR-0187).
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install: firstInstall } = makeStubInstall(() => twoPackageResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({ vfs, registry: fakeRegistry, install: firstInstall }),
    );
    await runShell(shell, 'npm install lodash@^4.17.0');
    await vi.waitFor(async () => {
      const stamp = JSON.parse(await vfs.readFileText(STAMP)) as { durability?: string };
      expect(stamp.durability).toBeUndefined(); // trusted stamp #1 down
    });

    let stampDuringInstall: string | undefined = 'UNREAD';
    const secondInstall: InstallFn = async () => {
      stampDuringInstall = (JSON.parse(await vfs.readFileText(STAMP)) as { durability?: string })
        .durability;
      return twoPackageResult();
    };
    const shell2 = new Shell({ cwd: '/proj' });
    shell2.registerCommand(
      'npm',
      createNpmShellCommand({ vfs, registry: fakeRegistry, install: secondInstall }),
    );
    const { exitCode } = await runShell(shell2, 'npm install ms@^2.1.3');

    expect(exitCode).toBe(0);
    expect(stampDuringInstall).toBe('pending'); // trusted #1 was demoted before tree writes
  });

  it('a package.json edit during the DRAIN skips the trusted stamp loudly — never a stamp for deps the tree may not hold', async () => {
    // Round 1 wrote the INSTALL-TIME snapshot here; round 4 showed the
    // snapshot cannot be PROVEN to be what the installer read (the installer
    // re-reads package.json after the eddy pin window), so the honest
    // contract is the boot promoter's: package.json moved since the snapshot
    // → no trusted stamp, loud skip, the next boot re-installs.
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install } = makeStubInstall(() => twoPackageResult());
    let releaseFlush!: () => void;
    const flushGate = new Promise<void>((r) => {
      releaseFlush = r;
    });
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => {
          await flushGate;
          return { failures: [], total: 0 };
        },
      }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm install lodash@^4.17.0');
    expect(exitCode).toBe(0);

    // Edit package.json while the drain is still in flight.
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify({ name: 'demo', dependencies: { lodash: '^4.17.0', evil: '9.9.9' } }, null, 2)}\n`,
    );
    releaseFlush();

    await vi.waitFor(() => {
      expect(rec.stderr.join('')).toContain('package.json changed during the install');
    });
    // Fresh tree (no prior stamp to demote): the honest state after the skip
    // is NO stamp at all — untrusted either way, the next boot re-installs.
    expect(await trustedStamp(vfs)).toBeNull();
  });

  it('the background stamp carries the INSTALL-TIME project slug — a preset switch during the drain cannot re-key it', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install } = makeStubInstall(() => twoPackageResult());
    let releaseFlush!: () => void;
    const flushGate = new Promise<void>((r) => {
      releaseFlush = r;
    });
    let slug = 'preset-a';
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        projectSlug: () => slug,
        flush: async () => {
          await flushGate;
          return { failures: [], total: 0 };
        },
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install lodash@^4.17.0');
    expect(exitCode).toBe(0);

    slug = 'preset-b'; // the active preset changes during the drain window
    releaseFlush();

    await vi.waitFor(async () => {
      const stamp = JSON.parse(await vfs.readFileText(STAMP)) as {
        durability?: string;
        slug: string;
      };
      expect(stamp.durability).toBeUndefined();
      expect(stamp.slug).toBe('preset-a'); // the slug the install actually ran under
    });
  });

  it('a preset switch DURING installFn cannot re-key the stamp either — the slug is sampled at mutation START', async () => {
    // Review round 3: the slug was sampled after installFn returned, so a
    // switch mid-install stamped the OLD install under the NEW slug — with two
    // presets sharing a dep set, the next boot would trust the wrong tree
    // (exactly what the stamp's slug key exists to prevent).
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    let slug = 'preset-a';
    const install: InstallFn = async () => {
      slug = 'preset-b'; // the active preset changes while the install runs
      return twoPackageResult();
    };
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        projectSlug: () => slug,
        flush: async () => ({ failures: [], total: 0 }),
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install lodash@^4.17.0');
    expect(exitCode).toBe(0);

    await vi.waitFor(async () => {
      const stamp = JSON.parse(await vfs.readFileText(STAMP)) as {
        durability?: string;
        slug: string;
      };
      expect(stamp.durability).toBeUndefined();
      expect(stamp.slug).toBe('preset-a'); // the slug the install STARTED under
    });
  });

  it('a package.json edit DURING installFn skips the trusted stamp loudly — the snapshot cannot be proven fed to the installer', async () => {
    // Round 2 stamped the install-time snapshot; round 4 showed the real
    // installer re-reads package.json AFTER the eddy pin window, so an edit
    // inside installFn can make the tree hold deps the snapshot never named —
    // a trusted stamp for either set would be a provenance lie. Honest
    // outcome: no trusted stamp, loud skip, next boot re-installs.
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const install: InstallFn = async () => {
      // The user edits package.json while the install is running.
      await vfs.writeFile(
        '/proj/package.json',
        `${JSON.stringify({ name: 'demo', dependencies: { lodash: '^4.17.0', evil: '9.9.9' } }, null, 2)}\n`,
      );
      return twoPackageResult();
    };
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const { exitCode, rec } = await runShell(shell, 'npm install lodash@^4.17.0');
    expect(exitCode).toBe(0);

    await vi.waitFor(() => {
      expect(rec.stderr.join('')).toContain('package.json changed during the install');
    });
    expect(await trustedStamp(vfs)).toBeNull(); // never a stamp for { …, evil } OR the stale snapshot
  });

  it('a SECTION move in package.json (same flat dep map) during the drain also skips the stamp — the unmoved-guard is byte-exact, not a lossy aggregate', async () => {
    // Review round 5: the guard compared the flattened dependencies ∪
    // devDependencies ∪ optionalDependencies map — moving a dep between
    // sections (or editing `overrides`) changes the real installer request
    // while the flat map stays identical, so a trusted stamp attested a tree
    // resolved under different inputs.
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install } = makeStubInstall(() => twoPackageResult());
    let releaseFlush!: () => void;
    const flushGate = new Promise<void>((r) => {
      releaseFlush = r;
    });
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => {
          await flushGate;
          return { failures: [], total: 0 };
        },
      }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm install lodash@^4.17.0');
    expect(exitCode).toBe(0);

    // Same flat map — lodash just moves to devDependencies.
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify(
        {
          name: 'rifty-project',
          version: '0.0.0',
          private: true,
          devDependencies: { lodash: '^4.17.0' },
        },
        null,
        2,
      )}\n`,
    );
    releaseFlush();

    await vi.waitFor(() => {
      expect(rec.stderr.join('')).toContain('package.json changed during the install');
    });
    expect(await trustedStamp(vfs)).toBeNull();
  });

  it('a tree DELETED during the drain window is never re-stamped — `npm install && rm -rf node_modules` must not resurrect trust', async () => {
    // Review round 2 regression: pre-background, the stamp landed before the
    // prompt, so a chained deletion removed it WITH the tree; the deferred
    // writer must not recreate a trusted stamp inside an empty tree.
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install } = makeStubInstall(() => twoPackageResult());
    let releaseFlush!: () => void;
    const flushGate = new Promise<void>((r) => {
      releaseFlush = r;
    });
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => {
          await flushGate;
          return { failures: [], total: 0 };
        },
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install lodash@^4.17.0');
    expect(exitCode).toBe(0);

    await vfs.rm('/proj/node_modules', { recursive: true, force: true }); // the chained rm -rf
    releaseFlush();
    await new Promise((r) => setTimeout(r, 20));

    expect(await vfs.exists(STAMP)).toBe(false); // no stamp resurrected into an empty tree
    expect(await vfs.exists('/proj/node_modules')).toBe(false); // …and no phantom dir either
  });

  /** Delegate to a MemoryVfs but intercept `exists(interceptPath)` — the
   * deterministic lever for the vanish-check→write window. The hook OWNS the
   * answer (it gets the real read and may park, or mutate the tree and return
   * a stale answer). Methods are bound to the target so MemoryVfs #private
   * fields survive the Proxy. */
  function vfsWithExistsHook(
    inner: MemoryVfs,
    interceptPath: string,
    hook: (read: () => Promise<boolean>) => Promise<boolean>,
  ): Vfs {
    return new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === 'exists') {
          return async (p: string): Promise<boolean> => {
            if (p === interceptPath) return hook(() => target.exists(p));
            return target.exists(p);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      },
    }) as unknown as Vfs;
  }

  it('an OLDER sequence never overwrites a NEWER install’s PENDING stamp — the generation is re-checked AT the write, not before the awaits', async () => {
    // Review round 3: the generation check, the vanish check, and the stamp
    // write were separated by awaits; install #2's pending demote could land
    // in that window and be overwritten by #1's stale TRUSTED stamp — a reload
    // during #2 (same dep set) would then trust a half-replaced tree.
    const inner = new MemoryVfs();
    await inner.mkdir('/proj/node_modules', { recursive: true });
    let sequenceParked!: () => void;
    const parked = new Promise<void>((r) => {
      sequenceParked = r;
    });
    let releaseSequence!: () => void;
    const sequenceGate = new Promise<void>((r) => {
      releaseSequence = r;
    });
    let gateArmed = true; // only #1's vanish check parks; later calls pass through
    const vfs = vfsWithExistsHook(inner, '/proj/node_modules', async (read) => {
      if (gateArmed) {
        gateArmed = false;
        sequenceParked();
        await sequenceGate;
      }
      return read();
    });
    let releaseSecondInstall!: () => void;
    const secondInstallGate = new Promise<void>((r) => {
      releaseSecondInstall = r;
    });
    let installCalls = 0;
    const install: InstallFn = async () => {
      installCalls += 1;
      if (installCalls === 2) await secondInstallGate; // #2 parked mid-tree-write
      return twoPackageResult();
    };
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => ({ failures: [], total: 0 }),
      }),
    );

    const first = await runShell(shell, 'npm install lodash@^4.17.0');
    expect(first.exitCode).toBe(0);
    await parked; // #1's sequence passed its generation check, parked pre-write

    // Install #2, SAME dep set (the dangerous case: deps match, so a stale
    // trusted stamp would satisfy the next boot over #2's half-written tree).
    const secondRun = runShell(shell, 'npm install lodash@^4.17.0');
    await vi.waitFor(async () => {
      const stamp = JSON.parse(await inner.readFileText(STAMP)) as { durability?: string };
      expect(stamp.durability).toBe('pending'); // #2 demoted before its tree writes
    });

    // #1's parked sequence resumes — it must SKIP, never promote over #2's pending.
    releaseSequence();
    await new Promise((r) => setTimeout(r, 20));
    const after = JSON.parse(await inner.readFileText(STAMP)) as { durability?: string };
    expect(after.durability).toBe('pending');

    releaseSecondInstall();
    const second = await secondRun;
    expect(second.exitCode).toBe(0);
    await vi.waitFor(async () => {
      expect((await trustedStamp(inner))?.deps).toEqual({ lodash: '^4.17.0' });
    });
  });

  it('a tree deleted AFTER the vanish check is not resurrected — the deferred write must not mkdir, it fails loudly instead', async () => {
    // Review round 3: writeInstallStamp mkdirs node_modules, so an rm -rf
    // completing inside the exists→write window was silently UNDONE — a
    // trusted stamp re-created over an otherwise-empty tree.
    const inner = new MemoryVfs();
    await inner.mkdir('/proj/node_modules', { recursive: true });
    let rmOnce = true; // the tree vanishes right after #1's vanish check reads it
    const vfs = vfsWithExistsHook(inner, '/proj/node_modules', async (read) => {
      const present = await read();
      if (present && rmOnce) {
        rmOnce = false;
        await inner.rm('/proj/node_modules', { recursive: true, force: true });
      }
      return present; // the STALE answer — rm completed inside the window
    });
    const { install } = makeStubInstall(() => twoPackageResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => ({ failures: [], total: 0 }),
      }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm install lodash@^4.17.0');
    expect(exitCode).toBe(0);
    await new Promise((r) => setTimeout(r, 20));

    expect(await inner.exists('/proj/node_modules')).toBe(false); // never resurrected
    expect(await inner.exists(STAMP)).toBe(false);
    // …and the skipped stamp is LOUD, not silent (the write failed with the
    // parent gone — the user's reload behavior changes, the terminal says so).
    expect(rec.stderr.join('')).toContain('install stamp write failed');
  });

  const TRUSTED_PACKAGE_JSON = `${JSON.stringify(
    { name: 'demo', version: '0.0.0', dependencies: { lodash: '^4.17.0' } },
    null,
    2,
  )}\n`;
  const TRUSTED_SEED = `${JSON.stringify(
    createInstallStamp(TRUSTED_PACKAGE_JSON, { slug: '', packages: 2 }),
    null,
    2,
  )}\n`;

  async function seedTrustedProject(vfs: MemoryVfs): Promise<void> {
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    await vfs.writeFile('/proj/package.json', TRUSTED_PACKAGE_JSON);
    await vfs.writeFile(STAMP, TRUSTED_SEED);
  }

  it('demoting a TRUSTED stamp is PROVEN durable before any tree mutation — an unpersistable demote ABORTS the install loudly', async () => {
    // Review round 3 (r17 class: a revocation that never reached disk is a
    // lie): if the pending demote fails to persist AND tree writes then fail
    // too, OPFS keeps the OLD trusted stamp over a torn tree — the next boot
    // trusts it. When even the rm fallback won't persist, the only honest
    // move is to abort BEFORE the first mutation: tree intact, stamp true.
    const vfs = new MemoryVfs();
    await seedTrustedProject(vfs);
    let installCalled = false;
    const install: InstallFn = async () => {
      installCalled = true;
      return twoPackageResult();
    };
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => ({
          failures: [{ path: STAMP, op: 'write' as const, message: 'QuotaExceededError' }],
          total: 1,
        }),
      }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm install lodash@^4.17.0');

    expect(exitCode).toBe(1);
    expect(installCalled).toBe(false); // aborted BEFORE any tree mutation
    expect(rec.stderr.join('')).toContain('install aborted');
    // package.json untouched — nothing was mutated.
    const pkg = JSON.parse(await vfs.readFileText('/proj/package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies).toEqual({ lodash: '^4.17.0' });
  });

  it('an ABORTED install restores the trusted stamp in the mirror — a retry must re-run the durability proof', async () => {
    // Review round 4: the failed ladder left the mirror stamp pending/removed
    // while OPFS kept the TRUSTED one; a retry read the mirror, saw no trusted
    // prior stamp, skipped the proof, and mutated under the durable stamp.
    const vfs = new MemoryVfs();
    await seedTrustedProject(vfs);
    let installCalls = 0;
    const install: InstallFn = async () => {
      installCalls += 1;
      return twoPackageResult();
    };
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => ({
          failures: [{ path: STAMP, op: 'write' as const, message: 'QuotaExceededError' }],
          total: 1,
        }),
      }),
    );

    const first = await runShell(shell, 'npm install lodash@^4.17.0');
    expect(first.exitCode).toBe(1);
    // The mirror mirrors OPFS again: the trusted stamp is back in memory.
    const restored = JSON.parse(await vfs.readFileText(STAMP)) as { durability?: string };
    expect(restored.durability).toBeUndefined();

    // The retry re-reads a TRUSTED prior stamp → re-runs the proof → aborts
    // again (persist still failing) BEFORE any mutation.
    const second = await runShell(shell, 'npm install lodash@^4.17.0');
    expect(second.exitCode).toBe(1);
    expect(installCalls).toBe(0);
  });

  it('an unpersistable demote falls back to a durable RM of the stamp — the install proceeds once the revocation is proven', async () => {
    const vfs = new MemoryVfs();
    await seedTrustedProject(vfs);
    let flushCalls = 0;
    const { install } = makeStubInstall(() => twoPackageResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => {
          flushCalls += 1;
          // #1: the pending demote write failed to persist; #2 (after the rm
          // fallback): the ledger healed — the stamp path is gone from disk.
          if (flushCalls === 1) {
            return {
              failures: [{ path: STAMP, op: 'write' as const, message: 'QuotaExceededError' }],
              total: 1,
            };
          }
          return { failures: [], total: 0 };
        },
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install lodash@^4.17.0');

    expect(exitCode).toBe(0);
    // The background sequence still lands the trusted stamp for THIS install.
    await vi.waitFor(async () => {
      expect((await trustedStamp(vfs))?.deps).toEqual({ lodash: '^4.17.0' });
    });
  });

  it('a TRUSTED stamp is demoted even when package.json is ABSENT — the demote must never silently no-op', async () => {
    // Review round 4: writeInstallStamp no-ops without package.json, so a
    // named install onto a stamped tree whose package.json was deleted left
    // the old TRUSTED stamp durable while the tree mutated — and the
    // demote-proof flush passed vacuously (nothing was written to prove).
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    await vfs.writeFile(STAMP, TRUSTED_SEED); // trusted stamp, NO package.json
    let stampDuringInstall: string | undefined = 'UNREAD';
    const install: InstallFn = async () => {
      stampDuringInstall = (JSON.parse(await vfs.readFileText(STAMP)) as { durability?: string })
        .durability;
      return twoPackageResult();
    };
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => ({ failures: [], total: 0 }),
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install lodash@^4.17.0');

    expect(exitCode).toBe(0);
    expect(stampDuringInstall).toBe('pending'); // demoted BEFORE tree writes
  });

  it('no TRUSTED stamp on the tree → no foreground durability proof — the fast path stays await-free', async () => {
    // The demote-proof flush exists to revoke a trusted attestation; a tree
    // that never had one (fresh project, pending-only) has nothing to revoke —
    // adding a foreground drain there would tax every cold install for
    // nothing.
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    let flushCallsBeforeInstall = 0;
    let flushCalls = 0;
    const install: InstallFn = async () => {
      flushCallsBeforeInstall = flushCalls;
      return twoPackageResult();
    };
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => {
          flushCalls += 1;
          return { failures: [], total: 0 };
        },
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install lodash@^4.17.0');

    expect(exitCode).toBe(0);
    expect(flushCallsBeforeInstall).toBe(0); // no foreground drain on the fast path
  });

  it('prepareInstall runs INSIDE the phase lock — terminal B’s clear/reseed cannot raze terminal A’s in-flight install', async () => {
    // Review round 4: the production from-scratch wrapper cleared
    // node_modules BEFORE entering npmCommand (outside the lock), so two
    // terminals could interleave clear-vs-write on one tree.
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const events: string[] = [];
    let releaseInstallA!: () => void;
    const installAGate = new Promise<void>((r) => {
      releaseInstallA = r;
    });
    const shellA = new Shell({ cwd: '/proj' });
    shellA.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install: async () => {
          events.push('installA:start');
          await installAGate;
          events.push('installA:end');
          return twoPackageResult();
        },
      }),
    );
    const shellB = new Shell({ cwd: '/proj' });
    shellB.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        prepareInstall: async () => {
          events.push('prepareB'); // the would-be clear/reseed
        },
        install: async () => {
          events.push('installB');
          return twoPackageResult();
        },
      }),
    );

    const a = runShell(shellA, 'npm install lodash@^4.17.0');
    const b = runShell(shellB, 'npm install');
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toEqual(['installA:start']); // B's PREPARE waits for A's phase too

    releaseInstallA();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.exitCode).toBe(0);
    expect(rb.exitCode).toBe(0);
    expect(events).toEqual(['installA:start', 'installA:end', 'prepareB', 'installB']);
  });

  it('prepareInstall runs AFTER the demote+proof — a preparation that clears the tree cannot erase the revocation evidence first', async () => {
    // Review round 5: the clear ran before the generation claim and the
    // trusted-stamp demote/proof; a clear whose OPFS rm never persisted
    // erased the MIRROR stamp while OPFS kept the trusted one — the install
    // then saw no trusted prior stamp, skipped the proof, and mutated under
    // the durable stamp.
    const vfs = new MemoryVfs();
    await seedTrustedProject(vfs);
    let stampAtPrepare: string | null | undefined = 'UNREAD';
    const { install } = makeStubInstall(() => twoPackageResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        prepareInstall: async () => {
          const stamp = JSON.parse(await vfs.readFileText(STAMP)) as { durability?: string };
          stampAtPrepare = stamp.durability ?? null; // null = trusted
        },
        flush: async () => ({ failures: [], total: 0 }),
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install lodash@^4.17.0');

    expect(exitCode).toBe(0);
    expect(stampAtPrepare).toBe('pending'); // demoted (and proven) BEFORE the preparer could touch the tree
  });

  it('prepareInstall sees sessionInstallActivity=false on the first install, true after one ran — a PENDING stamp mid-window is provably OURS', async () => {
    // Review round 4: `npm install` now exits with a pending stamp until the
    // background drain promotes it; a from-scratch boot-line re-run (project
    // switch) inside that window read "pending → not satisfied" and razed the
    // user's tree + package.json. The activity flag lets the preparer tell a
    // session-local pending stamp from a foreign/crashed one.
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const flags: boolean[] = [];
    const { install } = makeStubInstall(() => twoPackageResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        prepareInstall: async (_ctx, info) => {
          flags.push(info.sessionInstallActivity);
        },
        flush: async () => ({ failures: [], total: 0 }),
      }),
    );

    await runShell(shell, 'npm install lodash@^4.17.0');
    await runShell(shell, 'npm install ms@^2.1.3');

    expect(flags).toEqual([false, true]);
  });

  it('the INSTALL PHASE of two terminals serializes per tree — an older install cannot keep writing under a newer trusted stamp', async () => {
    // Review round 2: the generation guard cancels stale STAMPS, but the
    // foreground install phases must not interleave tree writes either.
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    let releaseInstallA!: () => void;
    const installAGate = new Promise<void>((r) => {
      releaseInstallA = r;
    });
    const events: string[] = [];
    const shellA = new Shell({ cwd: '/proj' });
    shellA.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install: async () => {
          events.push('installA:start');
          await installAGate; // A's install phase hangs mid-write
          events.push('installA:end');
          return twoPackageResult();
        },
      }),
    );
    const shellB = new Shell({ cwd: '/proj' });
    shellB.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install: async () => {
          events.push('installB');
          return twoPackageResult();
        },
      }),
    );

    const a = runShell(shellA, 'npm install lodash@^4.17.0');
    const b = runShell(shellB, 'npm install ms@^2.1.3');
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toEqual(['installA:start']); // B's install phase WAITS for A's

    releaseInstallA();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.exitCode).toBe(0);
    expect(rb.exitCode).toBe(0);
    expect(events).toEqual(['installA:start', 'installA:end', 'installB']);
  });
});

describe('npm-shell-command — eddy fast-install seam (ADR-0182)', () => {
  async function projVfs(): Promise<MemoryVfs> {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify(
        { name: 'demo', version: '0.0.0', dependencies: { debug: '^4.4.1' } },
        null,
        2,
      )}\n`,
    );
    return vfs;
  }

  it('passes resolverUrl through to install() and tags the line when the eddy path ran', async () => {
    const vfs = await projVfs();
    let seenResolverUrl: string | undefined = 'UNSET';
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        resolverUrl: 'http://eddy.test',
        install: async (arg1) => {
          seenResolverUrl = (arg1 as InstallOptions).resolverUrl;
          return { ...singletonResult('debug', '4.4.1'), source: 'eddy' };
        },
      }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm install');

    expect(exitCode).toBe(0);
    expect(seenResolverUrl).toBe('http://eddy.test');
    expect(rec.stdout.join('')).toContain('via eddy (fast)');
  });

  it('forwards the ACTIVE preset pin + prefetch handle into install() (ADR-0195)', async () => {
    const vfs = await projVfs();
    const prefetchHandle = { take: () => null };
    let seen: Pick<InstallOptions, 'resolverClosureHash' | 'resolverPrefetch'> | null = null;
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        resolverUrl: 'http://eddy.test',
        resolverClosureHash: () => 'sha256-pin',
        resolverPrefetch: () => prefetchHandle,
        install: async (arg1) => {
          const opts = arg1 as InstallOptions;
          seen = {
            resolverClosureHash: opts.resolverClosureHash,
            resolverPrefetch: opts.resolverPrefetch,
          };
          return { ...singletonResult('debug', '4.4.1'), source: 'eddy' };
        },
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install');

    expect(exitCode).toBe(0);
    expect(seen).toEqual({ resolverClosureHash: 'sha256-pin', resolverPrefetch: prefetchHandle });
  });

  it('a PINNED prefetch is dropped when its hash is no longer the current pin decision — a buffered GET must not outlive the 24h bound', async () => {
    // Review round 4: the boot prefetch was primed against the pin AT BOOT;
    // if that pin expired (>24h) or was replaced by install time, forwarding
    // the handle served the old closure via the buffered GET with no as-of
    // line and no revalidate — silently past the stale bound.
    const vfs = await projVfs();
    const staleHandle = { closureHash: 'sha256-boot-old', take: () => null };
    let seenPrefetch: unknown = 'UNREAD';
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        resolverUrl: 'http://eddy.test',
        // No env pin, no learned pin: the pin the handle was primed against
        // is GONE — the prefetch must not ride in anyway.
        resolverPrefetch: () => staleHandle,
        install: async (arg1) => {
          seenPrefetch = (arg1 as InstallOptions).resolverPrefetch;
          return { ...singletonResult('debug', '4.4.1'), source: 'eddy' };
        },
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install');

    expect(exitCode).toBe(0);
    expect(seenPrefetch).toBeUndefined();
  });

  it('a PINNED prefetch matching the current pin decision is forwarded', async () => {
    const vfs = await projVfs();
    const handle = { closureHash: 'sha256-pin', take: () => null };
    let seenPrefetch: unknown = 'UNREAD';
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        resolverUrl: 'http://eddy.test',
        resolverClosureHash: () => 'sha256-pin',
        resolverPrefetch: () => handle,
        install: async (arg1) => {
          seenPrefetch = (arg1 as InstallOptions).resolverPrefetch;
          return { ...singletonResult('debug', '4.4.1'), source: 'eddy' };
        },
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install');

    expect(exitCode).toBe(0);
    expect(seenPrefetch).toBe(handle);
  });

  it('does not even INVOKE the pin/prefetch getters when resolverUrl is unset (documented inert)', async () => {
    // Regression (round 9): the getters ran unconditionally — a throwing pin
    // store or prefetch handle broke eddy-DISABLED installs.
    const vfs = await projVfs();
    let seen: Pick<InstallOptions, 'resolverClosureHash' | 'resolverPrefetch'> | null = null;
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        resolverClosureHash: () => {
          throw new Error('must not run without resolverUrl');
        },
        resolverPrefetch: () => {
          throw new Error('must not run without resolverUrl');
        },
        install: async (arg1) => {
          const opts = arg1 as InstallOptions;
          seen = {
            resolverClosureHash: opts.resolverClosureHash,
            resolverPrefetch: opts.resolverPrefetch,
          };
          return { ...singletonResult('debug', '4.4.1'), source: 'standard' };
        },
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install');

    expect(exitCode).toBe(0);
    expect(seen).toEqual({ resolverClosureHash: undefined, resolverPrefetch: undefined });
  });

  it('is inert when resolverUrl is unset — no resolverUrl forwarded, no provenance tag', async () => {
    const vfs = await projVfs();
    let seenResolverUrl: string | undefined = 'UNSET';
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install: async (arg1) => {
          seenResolverUrl = (arg1 as InstallOptions).resolverUrl;
          return { ...singletonResult('debug', '4.4.1'), source: 'standard' };
        },
      }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm install');

    expect(exitCode).toBe(0);
    expect(seenResolverUrl).toBeUndefined();
    expect(rec.stdout.join('')).not.toContain('via eddy');
  });
});

describe('npm-shell-command — stale learned pin (SWR: as-of line + background revalidate)', () => {
  async function projVfs(): Promise<MemoryVfs> {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify({ name: 'demo', version: '0.0.0', dependencies: { debug: '^4.4.1' } }, null, 2)}\n`,
    );
    return vfs;
  }
  const KEY = (() => {
    const body = eddyRequestFromPackageJson(JSON.stringify({ dependencies: { debug: '^4.4.1' } }));
    if (!body) throw new Error('test setup');
    return canonicalEddyRequestKey(body);
  })();
  const STALE_HASH = 'sha256-stale/pin=';
  const RESOLVED_AT = '2026-07-09T08:00:00.000Z';

  function eddyResult(closureHash: string, resolvedVia: 'get' | 'post' = 'get'): InstallResult {
    return {
      ...singletonResult('debug', '4.4.1'),
      source: 'eddy',
      closureHash,
      resolvedAt: RESOLVED_AT,
      resolvedVia,
    };
  }

  function makeSeams(pin: { closureHash: string; stale: boolean } | undefined) {
    const sets: Array<{ key: string; hash: string }> = [];
    const revalidations: Array<{ key: string; body: unknown; hash: string }> = [];
    let revalidateImpl: () => Promise<void> = async () => {};
    return {
      sets,
      revalidations,
      failRevalidate(message: string): void {
        revalidateImpl = async () => {
          throw new Error(message);
        };
      },
      learnedPins: {
        get: async () => pin,
        set: async (key: string, hash: string) => {
          sets.push({ key, hash });
        },
        revalidate: (key: string, body: unknown, hash: string) => {
          revalidations.push({ key, body, hash });
          return revalidateImpl();
        },
      },
    };
  }

  it('a STALE pin served by eddy prints the as-of honesty line and fires ONE background revalidate — no immediate savedAt refresh', async () => {
    const vfs = await projVfs();
    const seams = makeSeams({ closureHash: STALE_HASH, stale: true });
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        resolverUrl: 'http://eddy.test',
        learnedPins: seams.learnedPins,
        install: async () => eddyResult(STALE_HASH),
      }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm install');

    expect(exitCode).toBe(0);
    expect(rec.stdout.join('')).toContain(
      `npm: eddy cached resolution (as-of ${RESOLVED_AT}), refreshing in background`,
    );
    await vi.waitFor(() => {
      expect(seams.revalidations).toHaveLength(1);
    });
    expect(seams.revalidations[0]?.key).toBe(KEY);
    expect(seams.revalidations[0]?.hash).toBe(STALE_HASH);
    // The request body rides along so the revalidate POSTs the same canonical set.
    expect(canonicalEddyRequestKey(seams.revalidations[0]?.body as never)).toBe(KEY);
    // The immediate write-back is SKIPPED for a stale serve: refreshing savedAt
    // without consulting the server would self-renew the pin past the 24h bound
    // forever. Only the revalidate outcome may extend its life.
    expect(seams.sets).toEqual([]);
  });

  it('a FRESH pin served via GET stays silent AND writes NOTHING back — a cache serve must never refresh savedAt (no self-renew past 24h)', async () => {
    // Regression (review round 1): the unconditional write-back let installs
    // repeated within 30 min keep an arbitrarily old closure perpetually
    // fresh with zero server contact — the "hard 24h bound" was a lie for
    // actively-used dep sets. savedAt may move only on server-vouched
    // resolutions (POST write-back, revalidate).
    const vfs = await projVfs();
    const seams = makeSeams({ closureHash: STALE_HASH, stale: false });
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        resolverUrl: 'http://eddy.test',
        learnedPins: seams.learnedPins,
        install: async () => eddyResult(STALE_HASH, 'get'),
      }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm install');

    expect(exitCode).toBe(0);
    expect(rec.stdout.join('')).not.toContain('eddy cached resolution');
    await new Promise((r) => setTimeout(r, 10));
    expect(seams.sets).toEqual([]);
    expect(seams.revalidations).toEqual([]);
  });

  it('a stale pin whose POST fallback re-resolved the SAME closure is NOT a cache serve — no as-of line, ordinary re-learn', async () => {
    // GET missed (revoked/evicted), the POST recomputed the identical closure:
    // the resolution is FRESH (server-vouched now), so no honesty line, no
    // revalidate — just the ordinary write-back with a fresh savedAt.
    const vfs = await projVfs();
    const seams = makeSeams({ closureHash: STALE_HASH, stale: true });
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        resolverUrl: 'http://eddy.test',
        learnedPins: seams.learnedPins,
        install: async () => eddyResult(STALE_HASH, 'post'),
      }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm install');

    expect(exitCode).toBe(0);
    expect(rec.stdout.join('')).not.toContain('eddy cached resolution');
    await vi.waitFor(() => {
      expect(seams.sets).toEqual([{ key: KEY, hash: STALE_HASH }]);
    });
    expect(seams.revalidations).toEqual([]);
  });

  it('a stale pin whose GET fell back to POST (different served hash) re-learns via set — no as-of line, no revalidate', async () => {
    // Fault row: revoked/evicted bundle → the pinned GET 404s, the attempt
    // pipeline POSTs, the fresh closure is adopted. The install is NOT a
    // cached resolution, so no honesty line; the ordinary write-back replaces
    // the pin (`pin replaced on learn`).
    const vfs = await projVfs();
    const seams = makeSeams({ closureHash: STALE_HASH, stale: true });
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        resolverUrl: 'http://eddy.test',
        learnedPins: seams.learnedPins,
        install: async () => eddyResult('sha256-fresh/post=', 'post'),
      }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm install');

    expect(exitCode).toBe(0);
    expect(rec.stdout.join('')).not.toContain('eddy cached resolution');
    await vi.waitFor(() => {
      expect(seams.sets).toEqual([{ key: KEY, hash: 'sha256-fresh/post=' }]);
    });
    expect(seams.revalidations).toEqual([]);
  });

  it('a stale pin with a STANDARD fallback install stays silent — no line, no revalidate, no write-back', async () => {
    const vfs = await projVfs();
    const seams = makeSeams({ closureHash: STALE_HASH, stale: true });
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        resolverUrl: 'http://eddy.test',
        learnedPins: seams.learnedPins,
        install: async () => ({ ...singletonResult('debug', '4.4.1'), source: 'standard' }),
      }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm install');

    expect(exitCode).toBe(0);
    expect(rec.stdout.join('')).not.toContain('eddy cached resolution');
    await new Promise((r) => setTimeout(r, 10));
    expect(seams.sets).toEqual([]);
    expect(seams.revalidations).toEqual([]);
  });

  it('a failing revalidate warns asynchronously and never affects the install exit', async () => {
    const vfs = await projVfs();
    const seams = makeSeams({ closureHash: STALE_HASH, stale: true });
    seams.failRevalidate('resolver declined (workspace)');
    const shell = new Shell({ cwd: '/proj' });
    const rec: Recorded = { stdout: [], stderr: [] };
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        resolverUrl: 'http://eddy.test',
        learnedPins: seams.learnedPins,
        install: async () => eddyResult(STALE_HASH),
      }),
    );

    const r = await shell.run('npm install', {
      onChunk: (chunk, stream) => {
        rec[stream].push(chunk);
      },
    });

    expect(r.exitCode).toBe(0);
    await vi.waitFor(() => {
      expect(rec.stderr.join('')).toContain('eddy pin refresh failed');
    });
    expect(rec.stderr.join('')).toContain('resolver declined (workspace)');
    expect(seams.sets).toEqual([]); // pin untouched — retried on the next install
  });
});

describe('npm-shell-command — learned pins seam (ADR-0194)', () => {
  async function projVfs(deps: Record<string, string> = { debug: '^4.4.1' }): Promise<MemoryVfs> {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify({ name: 'demo', version: '0.0.0', dependencies: deps }, null, 2)}\n`,
    );
    return vfs;
  }

  function keyFor(deps: Record<string, string>): string {
    const body = eddyRequestFromPackageJson(JSON.stringify({ dependencies: deps }));
    if (!body) throw new Error('test setup: bad package.json');
    return canonicalEddyRequestKey(body);
  }

  /** Let a fire-and-forget write-back settle. */
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('a learned pin rides into install() as resolverClosureHash when no env pin exists', async () => {
    const vfs = await projVfs();
    const getKeys: string[] = [];
    let seenPin: string | undefined;
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        resolverUrl: 'http://eddy.test',
        learnedPins: {
          get: async (key) => {
            getKeys.push(key);
            return { closureHash: 'sha256-learned', stale: false };
          },
          set: async () => {},
          revalidate: async () => {},
        },
        install: async (arg1) => {
          seenPin = (arg1 as InstallOptions).resolverClosureHash;
          return { ...singletonResult('debug', '4.4.1'), source: 'eddy' };
        },
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install');

    expect(exitCode).toBe(0);
    expect(seenPin).toBe('sha256-learned');
    expect(getKeys).toEqual([keyFor({ debug: '^4.4.1' })]);
  });

  it('a learned pin WINS over the env pin — the exact post-merge request beats the coarse template pin', async () => {
    const vfs = await projVfs();
    const getKeys: string[] = [];
    let seenPin: string | undefined;
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        resolverUrl: 'http://eddy.test',
        resolverClosureHash: () => 'sha256-env',
        learnedPins: {
          get: async (key) => {
            getKeys.push(key);
            return { closureHash: 'sha256-learned', stale: false };
          },
          set: async () => {},
          revalidate: async () => {},
        },
        install: async (arg1) => {
          seenPin = (arg1 as InstallOptions).resolverClosureHash;
          return { ...singletonResult('debug', '4.4.1'), source: 'eddy' };
        },
      }),
    );

    await runShell(shell, 'npm install');

    // A learned pin matches the EXACT dep set, so it beats the template env pin —
    // otherwise a modified set (`npm i <pkg>`) never rides its learned GET.
    expect(seenPin).toBe('sha256-learned');
    expect(getKeys).toEqual([keyFor({ debug: '^4.4.1' })]);
  });

  it('the env pin is the FALLBACK when no learned pin covers the set yet', async () => {
    const vfs = await projVfs();
    let seenPin: string | undefined;
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        resolverUrl: 'http://eddy.test',
        resolverClosureHash: () => 'sha256-env',
        learnedPins: {
          get: async () => undefined, // first install of this set — nothing learned
          set: async () => {},
          revalidate: async () => {},
        },
        install: async (arg1) => {
          seenPin = (arg1 as InstallOptions).resolverClosureHash;
          return { ...singletonResult('debug', '4.4.1'), source: 'eddy' };
        },
      }),
    );

    await runShell(shell, 'npm install');

    expect(seenPin).toBe('sha256-env');
  });

  it('an eddy install writes the pin back under the MERGED package.json request key', async () => {
    const vfs = await projVfs({ debug: '^4.4.1' });
    const sets: Array<{ key: string; hash: string }> = [];
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        resolverUrl: 'http://eddy.test',
        learnedPins: {
          get: async () => undefined,
          set: async (key, hash) => {
            sets.push({ key, hash });
          },
          revalidate: async () => {},
        },
        install: async () => ({
          ...singletonResult('kleur', '4.1.5'),
          source: 'eddy',
          closureHash: 'sha256-new',
          resolvedVia: 'post',
        }),
      }),
    );

    // A named install MERGES into package.json first — the learned key must be
    // the post-merge request (debug + kleur), not the pre-install file.
    const { exitCode } = await runShell(shell, 'npm install kleur@4.1.5');
    await flush();

    expect(exitCode).toBe(0);
    expect(sets).toEqual([
      { key: keyFor({ debug: '^4.4.1', kleur: '4.1.5' }), hash: 'sha256-new' },
    ]);
  });

  it('the pin write-back carries the install-START baseline for compare-and-set — a late older POST cannot roll back a newer pin', async () => {
    // Review round 4 (the revalidate-CAS sibling the round-3 sweep missed):
    // two overlapping installs of one dep set — the slower one adopted an
    // OLDER cached resolution; its unconditional write-back rolled the pin
    // back and reset the stale window to the old closure.
    const vfs = await projVfs({ debug: '^4.4.1' });
    const sets: Array<{ key: string; hash: string; expectedCurrent: string | null | undefined }> =
      [];
    const learnedPins = {
      get: async () => ({ closureHash: 'sha256-old', stale: true }),
      set: async (key: string, hash: string, expectedCurrent?: string | null) => {
        sets.push({ key, hash, expectedCurrent });
      },
      revalidate: async () => {},
    };
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        resolverUrl: 'http://eddy.test',
        learnedPins,
        install: async () => ({
          ...singletonResult('kleur', '4.1.5'),
          source: 'eddy',
          closureHash: 'sha256-new',
          resolvedVia: 'post',
        }),
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install kleur@4.1.5');
    await flush();

    expect(exitCode).toBe(0);
    // The baseline = the pin READ at install start; the store skips the write
    // when the entry moved meanwhile (a newer install already re-learned).
    expect(sets).toEqual([
      { key: expect.any(String), hash: 'sha256-new', expectedCurrent: 'sha256-old' },
    ]);
  });

  it('a first-install write-back expects an ABSENT entry — two racers cannot both land', async () => {
    const vfs = await projVfs({ debug: '^4.4.1' });
    const sets: Array<{ expectedCurrent: string | null | undefined }> = [];
    const learnedPins = {
      get: async () => undefined, // no pin at install start
      set: async (_key: string, _hash: string, expectedCurrent?: string | null) => {
        sets.push({ expectedCurrent });
      },
      revalidate: async () => {},
    };
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        resolverUrl: 'http://eddy.test',
        learnedPins,
        install: async () => ({
          ...singletonResult('kleur', '4.1.5'),
          source: 'eddy',
          closureHash: 'sha256-new',
          resolvedVia: 'post',
        }),
      }),
    );

    await runShell(shell, 'npm install kleur@4.1.5');
    await flush();

    expect(sets).toEqual([{ expectedCurrent: null }]); // null = require-absent
  });

  it('a standard-source install never writes a pin', async () => {
    const vfs = await projVfs();
    let sets = 0;
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        resolverUrl: 'http://eddy.test',
        learnedPins: {
          get: async () => undefined,
          set: async () => {
            sets++;
          },
          revalidate: async () => {},
        },
        install: async () => ({ ...singletonResult('debug', '4.4.1'), source: 'standard' }),
      }),
    );

    await runShell(shell, 'npm install');
    await flush();

    expect(sets).toBe(0);
  });

  it('a failing pin write-back is swallowed (warn) — the install still succeeds', async () => {
    const vfs = await projVfs();
    const shell = new Shell({ cwd: '/proj' });
    const warnings: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      warnings.push(args.map((a) => String(a)).join(' '));
    });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        resolverUrl: 'http://eddy.test',
        learnedPins: {
          get: async () => undefined,
          set: async () => {
            throw new Error('opfs exploded');
          },
          revalidate: async () => {},
        },
        install: async () => ({
          ...singletonResult('debug', '4.4.1'),
          source: 'eddy',
          closureHash: 'sha256-new',
          resolvedVia: 'post',
        }),
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install');
    await flush();
    warnSpy.mockRestore();

    expect(exitCode).toBe(0);
    expect(warnings.some((w) => /learned pin/.test(w))).toBe(true);
  });

  it('is inert without resolverUrl — the learned store is never consulted', async () => {
    const vfs = await projVfs();
    let gets = 0;
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        learnedPins: {
          get: async () => {
            gets++;
            return { closureHash: 'sha256-learned', stale: false };
          },
          set: async () => {},
          revalidate: async () => {},
        },
        install: async () => ({ ...singletonResult('debug', '4.4.1'), source: 'standard' }),
      }),
    );

    await runShell(shell, 'npm install');

    expect(gets).toBe(0);
  });
});
