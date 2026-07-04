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
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it, vi } from 'vitest';
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

  it('drains + CHECKS before the stamp, then drains the stamp — durable-on-exit npm parity (ADR-0187 Corrected)', async () => {
    // A reload right after `npm install` must not lose the tree
    // (owner-snapshot-restore-exec e2e). The tree drain is checked FIRST — a
    // stamp must never claim a tree whose write-through failed — then the
    // stamp rides its own (tiny) drain.
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
    expect(events).toEqual(['flush-before-stamp', 'flush-after-stamp']);
    const stamp = JSON.parse(
      await vfs.readFileText('/proj/node_modules/.rifty-install-stamp.json'),
    ) as { version: number; deps: Record<string, string>; packages: number };
    expect(stamp.version).toBe(1);
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
    const stderr = rec.stderr.join('');
    expect(stderr).toContain('137 file(s) failed to persist');
    expect(stderr).toContain('QuotaExceededError');
    expect(stderr).toContain('NOT durable');
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
    expect(rec.stderr.join('')).toBe('');
    expect(await vfs.exists('/proj/node_modules/.rifty-install-stamp.json')).toBe(true);
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
    expect(rec.stderr.join('')).toContain('install flush failed: rpc torn');
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
    warnSpy.mockRestore();

    expect(exitCode).toBe(0); // install still succeeds
    expect(flushed).toBe(true); // …and the tree was flushed despite the stamp failure
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
            return 'sha256-learned';
          },
          set: async () => {},
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
            return 'sha256-learned';
          },
          set: async () => {},
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
        },
        install: async () => ({
          ...singletonResult('kleur', '4.1.5'),
          source: 'eddy',
          closureHash: 'sha256-new',
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
        },
        install: async () => ({
          ...singletonResult('debug', '4.4.1'),
          source: 'eddy',
          closureHash: 'sha256-new',
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
            return 'sha256-learned';
          },
          set: async () => {},
        },
        install: async () => ({ ...singletonResult('debug', '4.4.1'), source: 'standard' }),
      }),
    );

    await runShell(shell, 'npm install');

    expect(gets).toBe(0);
  });
});
