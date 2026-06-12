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
 * violate CLAUDE.md "no internal imports across packages").
 */
import type { InstallOptions, InstallResult } from '@riftydev/npm-client';
import { RegistryClient } from '@riftydev/npm-client';
import { Shell } from '@riftydev/shell';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { type InstallFn, createNpmShellCommand } from './npm-shell-command.ts';

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

describe('npm-shell-command — argv', () => {
  it('rejects unknown subcommands without exit 127', async () => {
    const vfs = new MemoryVfs();
    const shell = new Shell({ cwd: '/' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry }));

    const { exitCode, rec } = await runShell(shell, 'npm publish');
    expect(exitCode).toBe(1);
    expect(rec.stderr.join('')).toContain("unknown subcommand 'publish'");
  });

  it('refuses flags (M9 scope) instead of silently dropping them', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const { install, calls } = makeStubInstall(() => emptyResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const { exitCode, rec } = await runShell(shell, 'npm install --save-dev lodash');
    expect(exitCode).toBe(1);
    expect(rec.stderr.join('')).toContain("flag '--save-dev' not supported");
    expect(calls).toEqual([]);
  });
});
