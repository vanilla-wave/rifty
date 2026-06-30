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
    expect(rec.stderr.join('')).toContain("global installs aren't supported in the browser sandbox");
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

  it('the unknown-subcommand list now advertises the aliases', async () => {
    const vfs = new MemoryVfs();
    const shell = new Shell({ cwd: '/' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry }));
    const { rec } = await runShell(shell, 'npm publish');
    expect(rec.stderr.join('')).toContain('test, start, stop, restart');
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

  it('flushes, then writes the install stamp, then flushes again after a successful install', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install } = makeStubInstall(() => twoPackageResult());
    const flushSawStamp: boolean[] = [];
    const flush = async (): Promise<void> => {
      flushSawStamp.push(await vfs.exists('/proj/node_modules/.rifty-install-stamp.json'));
    };
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({ vfs, registry: fakeRegistry, install, flush }),
    );

    const { exitCode } = await runShell(shell, 'npm install lodash@^4.17.0');

    expect(exitCode).toBe(0);
    // First flush drains the tree BEFORE the stamp exists; second flush makes
    // the stamp itself durable (ADR-0135 ordering: stamp implies tree).
    expect(flushSawStamp).toEqual([false, true]);
    const stamp = JSON.parse(
      await vfs.readFileText('/proj/node_modules/.rifty-install-stamp.json'),
    ) as { version: number; deps: Record<string, string>; packages: number };
    expect(stamp.version).toBe(1);
    expect(stamp.deps).toEqual({ lodash: '^4.17.0' });
    expect(stamp.packages).toBe(2);
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
