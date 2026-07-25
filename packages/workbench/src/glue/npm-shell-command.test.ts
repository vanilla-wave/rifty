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
import { planShadowSubstitutionsFromLockfile } from '@riftydev/npm-client/internal';
import { type CommandContext, type ProcessExit, Shell } from '@riftydev/shell';
import { MemoryVfs, type Vfs } from '@riftydev/vfs';
import { describe, expect, it, vi } from 'vitest';
import { createPackageAcquisitionAuthority } from '../workers/package-acquisition-authority.ts';
import { installArtifactIdentity } from './install-artifact-identity.ts';
import { createInstallStampAuthority } from './install-stamp-authority.ts';
import { createInstallStamp } from './install-stamp.ts';
import { createTestNpmPackageAcquisitionAuthority } from './npm-shell-command.test-fixture.ts';
import {
  type InstallFn,
  type NpmShellCommandDeps,
  createNpmShellCommand as createNpmShellCommandWithAuthority,
  formatInstallDuration,
} from './npm-shell-command.ts';

const EMPTY_SHADOW_PLAN = planShadowSubstitutionsFromLockfile({
  lockfileVersion: 3,
  packages: {},
});

type TestNpmShellCommandDeps = Omit<NpmShellCommandDeps, 'packageAcquisitionAuthority'> & {
  readonly packageAcquisitionAuthority?: NpmShellCommandDeps['packageAcquisitionAuthority'];
};

function createNpmShellCommand(deps: TestNpmShellCommandDeps) {
  const { packageAcquisitionAuthority, ...base } = deps;
  return createNpmShellCommandWithAuthority({
    ...base,
    packageAcquisitionAuthority:
      packageAcquisitionAuthority ?? createTestNpmPackageAcquisitionAuthority(base),
  });
}

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
    provenance: { resolution: 'metadata', packages: [] },
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
    provenance: {
      resolution: 'metadata',
      packages: [{ name, version, transport: 'registry' }],
    },
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
  it('forwards terminal lifecycle cancellation into the active npm-client install', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile('/proj/package.json', '{"name":"app","dependencies":{"kleur":"4.1.5"}}\n');
    let markInstallStarted!: () => void;
    const installStarted = new Promise<void>((resolve) => {
      markInstallStarted = resolve;
    });
    let seenSignal: AbortSignal | undefined;
    const install: InstallFn = async (arg1) => {
      if (typeof arg1 !== 'object') throw new Error('expected options install');
      seenSignal = arg1.signal;
      markInstallStarted();
      return await new Promise<InstallResult>((_resolve, reject) => {
        arg1.signal?.addEventListener('abort', () => reject(arg1.signal?.reason), {
          once: true,
        });
      });
    };
    const command = createNpmShellCommand({ vfs, registry: fakeRegistry, install });
    const controller = new AbortController();
    const output: string[] = [];
    const running = command(['install'], {
      cwd: '/proj',
      env: {},
      signal: controller.signal,
      stdout: { write: (chunk) => output.push(String(chunk)) },
      stderr: { write: (chunk) => output.push(String(chunk)) },
    });
    await installStarted;
    const reason = new Error('project closed');
    controller.abort(reason);

    await expect(running).resolves.toBe(1);
    expect(seenSignal).toBe(controller.signal);
    expect(output.join('')).toContain('project closed');
  });

  it('walks from a nested cwd to the nearest package.json install root', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/src/nested', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify({ name: 'root', dependencies: { kleur: '4.1.5' } })}\n`,
    );
    const { install, calls } = makeStubInstall(() => singletonResult('kleur', '4.1.5'));
    const shell = new Shell({ cwd: '/proj/src/nested' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const result = await runShell(shell, 'npm install');

    expect(result.exitCode).toBe(0);
    expect(calls).toEqual([{ root: 'root', deps: { kleur: '4.1.5' }, cwd: '/proj' }]);
  });

  it('keeps a nested cwd that owns package.json as its exact install root', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/packages/app/src', { recursive: true });
    await vfs.mkdir('/proj/node_modules');
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify({ name: 'outer', dependencies: { outer: '1.0.0' } })}\n`,
    );
    await vfs.writeFile(
      '/proj/packages/app/package.json',
      `${JSON.stringify({ name: 'app', dependencies: { kleur: '4.1.5' } })}\n`,
    );
    const { install, calls } = makeStubInstall(() => singletonResult('kleur', '4.1.5'));
    const shell = new Shell({ cwd: '/proj/packages/app' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const result = await runShell(shell, 'npm install');

    expect(result.exitCode).toBe(0);
    expect(calls).toEqual([{ root: 'app', deps: { kleur: '4.1.5' }, cwd: '/proj/packages/app' }]);
  });

  it('ignores wrong-kind prefix markers and keeps walking to a valid ancestor', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/near/src', { recursive: true });
    await vfs.mkdir('/proj/near/package.json');
    await vfs.writeFile('/proj/near/node_modules', 'not a directory');
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify({ name: 'root', dependencies: { kleur: '4.1.5' } })}\n`,
    );
    const { install, calls } = makeStubInstall(() => singletonResult('kleur', '4.1.5'));
    const shell = new Shell({ cwd: '/proj/near/src' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const result = await runShell(shell, 'npm install');

    expect(result.exitCode).toBe(0);
    expect(calls).toEqual([{ root: 'root', deps: { kleur: '4.1.5' }, cwd: '/proj' }]);
  });

  it('treats marker stat failures as misses while walking like npm 11.17', async () => {
    class MarkerStatFailureVfs extends MemoryVfs {
      override async stat(path: string) {
        if (path.startsWith('/proj/near/')) throw new Error('marker stat denied');
        return super.stat(path);
      }
    }
    const vfs = new MarkerStatFailureVfs();
    await vfs.mkdir('/proj/near/src', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify({ name: 'root', dependencies: { kleur: '4.1.5' } })}\n`,
    );
    const { install, calls } = makeStubInstall(() => singletonResult('kleur', '4.1.5'));
    const shell = new Shell({ cwd: '/proj/near/src' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const result = await runShell(shell, 'npm install');

    expect(result.exitCode).toBe(0);
    expect(calls).toEqual([{ root: 'root', deps: { kleur: '4.1.5' }, cwd: '/proj' }]);
  });

  it.each([
    ['literal array', ['./packages/app/']],
    ['literal object packages', { packages: ['/packages/app'] }],
    ['empty array', []],
    ['wildcard', ['packages/*']],
    ['brace', { packages: ['packages/{app,other}'] }],
    ['extglob', ['packages/@(app|other)']],
    ['negation', ['packages/app', '!packages/other']],
  ])('rejects ancestor npm workspaces (%s) before install mutation', async (_form, workspaces) => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/packages/app/src', { recursive: true });
    const rootPackageJson = `${JSON.stringify({ name: 'root', workspaces })}\n`;
    const memberPackageJson = '{"name":"app"}\n';
    await vfs.writeFile('/proj/package.json', rootPackageJson);
    await vfs.writeFile('/proj/packages/app/package.json', memberPackageJson);
    const { install, calls } = makeStubInstall(() => emptyResult());
    const shell = new Shell({ cwd: '/proj/packages/app/src' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const result = await runShell(shell, 'npm install kleur@4.1.5');

    expect(result.exitCode).toBe(1);
    expect(result.rec.stderr.join('')).toContain('Not implemented: npm.workspaces');
    expect(calls).toEqual([]);
    expect(await vfs.readFileText('/proj/package.json')).toBe(rootPackageJson);
    expect(await vfs.readFileText('/proj/packages/app/package.json')).toBe(memberPackageJson);
  });

  it.each([
    ['discovered', '/proj/src', 'npm install kleur@4.1.5'],
    ['explicit --prefix', '/outside', 'npm --prefix /proj install kleur@4.1.5'],
  ])('rejects npm workspaces at the %s package root', async (_form, cwd, line) => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/src', { recursive: true });
    await vfs.mkdir('/outside');
    const packageJson = '{"name":"root","workspaces":[]}\n';
    await vfs.writeFile('/proj/package.json', packageJson);
    const { install, calls } = makeStubInstall(() => emptyResult());
    const shell = new Shell({ cwd });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const result = await runShell(shell, line);

    expect(result.exitCode).toBe(1);
    expect(result.rec.stderr.join('')).toContain('Not implemented: npm.workspaces');
    expect(calls).toEqual([]);
    expect(await vfs.readFileText('/proj/package.json')).toBe(packageJson);
  });

  it('rejects ancestor npm workspaces before a package lifecycle script runs', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/packages/app/src', { recursive: true });
    await vfs.writeFile('/proj/package.json', '{"name":"root","workspaces":["packages/app"]}\n');
    await vfs.writeFile(
      '/proj/packages/app/package.json',
      '{"name":"app","scripts":{"dev":"node src/dev.mjs"}}\n',
    );
    const runScript = vi.fn(async () => 0);
    const shell = new Shell({ cwd: '/proj/packages/app/src' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, runScript }));

    const result = await runShell(shell, 'npm run dev');

    expect(result.exitCode).toBe(1);
    expect(result.rec.stderr.join('')).toContain('Not implemented: npm.workspaces');
    expect(runScript).not.toHaveBeenCalled();
  });

  it('rejects ancestor npm workspaces above a node_modules-only nearest prefix', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/packages/app/src', { recursive: true });
    await vfs.mkdir('/proj/packages/app/node_modules');
    await vfs.writeFile('/proj/package.json', '{"name":"root","workspaces":["packages/app"]}\n');
    const { install, calls } = makeStubInstall(() => emptyResult());
    const shell = new Shell({ cwd: '/proj/packages/app/src' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const result = await runShell(shell, 'npm install kleur@4.1.5');

    expect(result.exitCode).toBe(1);
    expect(result.rec.stderr.join('')).toContain('Not implemented: npm.workspaces');
    expect(calls).toEqual([]);
  });

  it.each([
    ['object packages', { packages: 'packages/app' }],
    ['string', 'packages/app'],
    ['non-string array entry', ['packages/app', 7]],
  ])('rejects malformed npm workspaces (%s) with EWORKSPACESCONFIG', async (_form, workspaces) => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/packages/app/src', { recursive: true });
    await vfs.writeFile('/proj/package.json', `${JSON.stringify({ name: 'root', workspaces })}\n`);
    await vfs.writeFile('/proj/packages/app/package.json', '{"name":"app"}\n');
    const { install, calls } = makeStubInstall(() => emptyResult());
    const shell = new Shell({ cwd: '/proj/packages/app/src' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const result = await runShell(shell, 'npm install');

    expect(result.exitCode).toBe(1);
    expect(result.rec.stderr.join('')).toContain(
      'EWORKSPACESCONFIG: workspaces config expects an Array',
    );
    expect(calls).toEqual([]);
  });

  it('uses an orphan cwd exactly when no ancestor package.json exists', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/orphan/nested', { recursive: true });
    const { install, calls } = makeStubInstall(() => singletonResult('kleur', '4.1.5'));
    const shell = new Shell({ cwd: '/orphan/nested' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const result = await runShell(shell, 'npm install kleur@4.1.5');

    expect(result.exitCode).toBe(0);
    expect(calls).toEqual([
      { root: 'rifty-project', deps: { kleur: '4.1.5' }, cwd: '/orphan/nested' },
    ]);
  });

  it('runs scripts at an explicit relative --prefix without changing shell cwd', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/src', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify({ scripts: { dev: 'node src/server.mjs' } })}\n`,
    );
    const calls: Array<{ readonly name: string; readonly command: string; readonly cwd: string }> =
      [];
    const shell = new Shell({ cwd: '/proj/src' });
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

    const result = await runShell(shell, 'npm --prefix .. run dev');

    expect(result).toMatchObject({ exitCode: 0 });
    expect(calls).toEqual([{ name: 'dev', command: 'node src/server.mjs', cwd: '/proj' }]);
    expect(shell.cwd).toBe('/proj/src');
  });

  it('installs at an explicit relative --prefix without changing shell cwd', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/src', { recursive: true });
    const { install, calls } = makeStubInstall(() => singletonResult('kleur', '4.1.5'));
    const shell = new Shell({ cwd: '/proj/src' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const result = await runShell(shell, 'npm --prefix .. install kleur@^4.1.0');

    expect(result).toMatchObject({ exitCode: 0 });
    expect(calls[0]?.cwd).toBe('/proj');
    expect(shell.cwd).toBe('/proj/src');
    await expect(vfs.readFileText('/proj/package.json')).resolves.toContain('"kleur": "^4.1.0"');
  });

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

  it('carries exact successful process exits through every pre/main/post hook', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify({
        scripts: { predev: 'pre', dev: 'node server.js', postdev: 'post' },
      })}\n`,
    );
    const calls: string[] = [];
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        runScript: async (name): Promise<ProcessExit> => {
          calls.push(name);
          return { code: 0, signal: null };
        },
      }),
    );

    const result = await shell.run('npm run dev');

    expect(calls).toEqual(['predev', 'dev', 'postdev']);
    expect(result.exit).toEqual({ code: 0, signal: null });
  });

  it.each([
    ['predev', ['predev']],
    ['dev', ['predev', 'dev']],
    ['postdev', ['predev', 'dev', 'postdev']],
  ] as const)('stops at a signal exit from %s and preserves it', async (terminatedAt, expected) => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify({
        scripts: { predev: 'pre', dev: 'node server.js', postdev: 'post' },
      })}\n`,
    );
    const calls: string[] = [];
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        runScript: async (name): Promise<ProcessExit> => {
          calls.push(name);
          return name === terminatedAt
            ? { code: null, signal: 'SIGTERM' }
            : { code: 0, signal: null };
        },
      }),
    );

    const result = await shell.run('npm run dev');

    expect(calls).toEqual(expected);
    expect(result).toMatchObject({
      exitCode: 143,
      exit: { code: null, signal: 'SIGTERM' },
    });
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

  it('runs an empty manifest through the installer and publishes its canonical empty lock/tree', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules/stale', { recursive: true });
    await vfs.writeFile('/proj/package.json', '{"name":"demo","private":true}\n');
    await vfs.writeFile('/proj/node_modules/stale/package.json', '{"name":"stale"}\n');
    await vfs.writeFile(
      '/proj/package-lock.json',
      '{"lockfileVersion":3,"packages":{"node_modules/stale":{"version":"1.0.0"}}}\n',
    );
    const lockfile = {
      name: 'demo',
      version: '0.0.0',
      lockfileVersion: 3 as const,
      requires: true as const,
      packages: { '': { version: '0.0.0', dependencies: {} } },
    };
    let installCalls = 0;
    const install: InstallFn = async (arg1) => {
      if (typeof arg1 !== 'object') throw new Error('expected options install');
      installCalls += 1;
      await arg1.vfs.mkdir(`${arg1.cwd}/node_modules`, { recursive: true });
      await arg1.vfs.writeFile(`${arg1.cwd}/package-lock.json`, `${JSON.stringify(lockfile)}\n`);
      return {
        packages: [],
        lockfile,
        conflicts: [],
        provenance: { resolution: 'metadata', packages: [] },
      };
    };
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        prepareEmptyInstall: async () => {
          await vfs.rm('/proj/node_modules', { recursive: true, force: true });
          await vfs.rm('/proj/package-lock.json', { force: true });
        },
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install');

    expect(exitCode).toBe(0);
    expect(installCalls).toBe(1);
    expect(await vfs.exists('/proj/node_modules/stale')).toBe(false);
    expect(
      Object.keys(JSON.parse(await vfs.readFileText('/proj/package-lock.json')).packages),
    ).toEqual(['']);
    expect(await vfs.exists('/proj/node_modules/.rifty-install-stamp.json')).toBe(true);
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

  it('keeps --workspaces=false loud until npm workspace flags are supported', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile('/proj/package.json', '{"name":"root"}\n');
    const { install, calls } = makeStubInstall(() => emptyResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand('npm', createNpmShellCommand({ vfs, registry: fakeRegistry, install }));

    const { exitCode, rec } = await runShell(shell, 'npm install --workspaces=false');

    expect(exitCode).toBe(1);
    expect(rec.stderr.join('')).toContain("flag '--workspaces=false' not supported");
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
      provenance: {
        resolution: 'metadata',
        packages: [
          { name: 'lodash', version: '4.17.21', transport: 'registry' },
          { name: 'ms', version: '2.1.3', transport: 'registry' },
        ],
      },
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

  it('materializes pending, then runs one full-ledger proof before the trusted commit — in background', async () => {
    // ADR-0261: pending is the durable-death-point candidate. One full-ledger
    // proof while that fence is active covers tree + claim; trusted is the
    // final commit marker, with no second drain.
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
          const pending = JSON.parse(
            await vfs.readFileText('/proj/node_modules/.rifty-install-stamp.json'),
          ) as { durability?: string };
          events.push(
            pending.durability === 'pending' ? 'proof-while-pending' : 'proof-without-fence',
          );
          return undefined;
        },
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install lodash@^4.17.0');

    expect(exitCode).toBe(0);
    await vi.waitFor(() => {
      expect(events).toEqual(['proof-while-pending']);
    });
    const stamp = JSON.parse(
      await vfs.readFileText('/proj/node_modules/.rifty-install-stamp.json'),
    ) as { version: number; deps: Record<string, string>; packages: number };
    expect(stamp.version).toBe(4);
    expect(stamp.deps).toEqual({ lodash: '^4.17.0' });
    expect(stamp.packages).toBe(2);
  });

  it('a DIRTY proof blocks trusted publication and warns loudly — never trust a torn tree', async () => {
    // OPFS quota/perm failure: the write-through swallowed it per-op, but the
    // flush report exposes it (ADR-0187 Corrected). The install stays usable
    // this session (exit 0), the claim stays PENDING (next boot re-installs
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
    expect(
      JSON.parse(await vfs.readFileText('/proj/node_modules/.rifty-install-stamp.json')),
    ).toMatchObject({ durability: 'pending' });
  });

  it('a claim-file failure in the proof blocks trusted publication and stays pending', async () => {
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
              path: '/proj/node_modules/.rifty-install-stamp.json',
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
    await vi.waitFor(() => {
      expect(rec.stderr.join('')).toContain('the install stamp failed to persist');
    });
    expect(
      JSON.parse(await vfs.readFileText('/proj/node_modules/.rifty-install-stamp.json')),
    ).toMatchObject({ durability: 'pending' });
  });

  it('a stamp write failure beyond the sampled failures still warns — the FULL ledger, not the sample', async () => {
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
          total: 21,
          anyFailure: (pred: (p: string) => boolean) =>
            pred('/.rifty/eddy-learned-pins.json') ||
            pred('/proj/node_modules/.rifty-install-stamp.json'),
        }),
      }),
    );

    const { exitCode, rec } = await runShell(shell, 'npm install lodash@^4.17.0');

    expect(exitCode).toBe(0);
    await vi.waitFor(() => {
      expect(rec.stderr.join('')).toContain('the install stamp failed to persist');
    });
    expect(
      JSON.parse(await vfs.readFileText('/proj/node_modules/.rifty-install-stamp.json')),
    ).toMatchObject({ durability: 'pending' });
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
    expect(
      JSON.parse(await vfs.readFileText('/proj/node_modules/.rifty-install-stamp.json')),
    ).toMatchObject({ durability: 'pending' });
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
    expect(
      JSON.parse(await vfs.readFileText('/proj/node_modules/.rifty-install-stamp.json')),
    ).toMatchObject({ durability: 'pending' });
  });

  it('drains the write-through even when the stamp write FAILS — durable-on-exit must not hinge on the stamp', async () => {
    // A stamp failure only costs the next boot's skip optimization; the TREE must
    // still be flushed or an immediate reload loses the user's install. So flush
    // runs regardless of the stamp's outcome.
    const base = new MemoryVfs();
    await base.mkdir('/proj/node_modules', { recursive: true });
    let stampWrites = 0;
    const vfs = new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === 'writeFile') {
          return async (path: string, data: unknown) => {
            if (String(path).endsWith('.rifty-install-stamp.json') && ++stampWrites === 2) {
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

    const { exitCode, rec } = await runShell(shell, 'npm install lodash@^4.17.0');

    expect(exitCode).toBe(0); // install still succeeds
    await vi.waitFor(() => {
      expect(flushed).toBe(true); // …and the tree was flushed despite the stamp failure
      expect(rec.stderr.join('')).toContain('install stamp write failed');
    });
    expect(
      JSON.parse(await base.readFileText('/proj/node_modules/.rifty-install-stamp.json')),
    ).toMatchObject({
      durability: 'pending',
    });
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

  it('a failed install leaves no trusted claim after the mutation window opens', async () => {
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
    // The authority removes its proven-pending marker before ancestor tree
    // mutation. A failure leaves ABSENT, never the old trusted claim; restart
    // therefore re-installs.
    expect(await vfs.exists('/proj/node_modules/.rifty-install-stamp.json')).toBe(false);
  });
});

describe('npm-shell-command — background durability with authority-held FIFO', () => {
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
      provenance: {
        resolution: 'metadata',
        packages: [
          { name: 'lodash', version: '4.17.21', transport: 'registry' },
          { name: 'ms', version: '2.1.3', transport: 'registry' },
        ],
      },
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

  async function expectPending(promise: Promise<unknown>): Promise<void> {
    let settled = false;
    void promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
  }

  it('returns the install and its && continuation before the clean drain publishes trust', async () => {
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

    const running = runShell(shell, 'npm install lodash@^4.17.0 && echo NEXT');
    await vi.waitFor(() => expect(flushCalls).toBe(1));
    const { exitCode, rec } = await running;
    expect(exitCode).toBe(0);
    expect(rec.stdout.join('')).toContain('npm: installed 2 package(s)');
    expect(rec.stdout.join('')).toContain('NEXT');
    expect(await trustedStamp(vfs)).toBeNull();

    releaseFlush();
    await vi.waitFor(async () => expect(await trustedStamp(vfs)).not.toBeNull());
  });

  it('returns before a DIRTY drain warns loudly and skips trust', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install } = makeStubInstall(() => twoPackageResult());
    let releaseFlush!: () => void;
    const flushGate = new Promise<void>((r) => {
      releaseFlush = r;
    });
    let flushStarted = false;
    const shell = new Shell({ cwd: '/proj' });
    const rec: Recorded = { stdout: [], stderr: [] };
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => {
          flushStarted = true;
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

    const running = shell.run('npm install lodash@^4.17.0', {
      onChunk: (chunk, stream) => {
        rec[stream].push(chunk);
      },
    });
    await vi.waitFor(() => expect(flushStarted).toBe(true));
    const r = await running;
    expect(r.exitCode).toBe(0);
    expect(rec.stderr.join('')).toBe('');
    releaseFlush();
    await vi.waitFor(() => expect(rec.stderr.join('')).toContain('NOT durable'));
    expect(rec.stderr.join('')).toContain('137 file(s) failed to persist');
    expect(await trustedStamp(vfs)).toBeNull();
  });

  it('a drain that never completes leaves the root internally reserved without blocking the prompt', async () => {
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

    const running = runShell(shell, 'npm install lodash@^4.17.0');
    await vi.waitFor(async () => expect(await vfs.exists(STAMP)).toBe(true));
    await expect(running).resolves.toMatchObject({ exitCode: 0 });
    expect(await trustedStamp(vfs)).toBeNull();
  });

  it('serializes a newer install behind the older install\u2019s durability and promotion', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    let releaseFlush!: () => void;
    const flushGate = new Promise<void>((r) => {
      releaseFlush = r;
    });
    let flushCalls = 0;
    const { install, calls } = makeStubInstall(() => twoPackageResult());
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

    const first = runShell(shell, 'npm install lodash@^4.17.0');
    await vi.waitFor(() => expect(flushCalls).toBe(1));
    const second = runShell(shell, 'npm install ms@^2.1.3');
    await expect(first).resolves.toMatchObject({ exitCode: 0 });
    await expectPending(second);
    expect(calls).toHaveLength(1);

    releaseFlush();
    await expect(second).resolves.toMatchObject({ exitCode: 0 });
    expect(calls).toHaveLength(2);
    await vi.waitFor(async () => {
      expect((await trustedStamp(vfs))?.deps).toEqual({ lodash: '^4.17.0', ms: '^2.1.3' });
    });
  });

  it('one injected owner authority serializes the same tree across terminal command instances', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    let releaseFlush!: () => void;
    const flushGate = new Promise<void>((r) => {
      releaseFlush = r;
    });
    let flushCalls = 0;
    const { install, calls } = makeStubInstall(() => twoPackageResult());
    const deps = {
      vfs,
      registry: fakeRegistry,
      install,
      flush: async () => {
        flushCalls += 1;
        if (flushCalls === 1) await flushGate;
        return { failures: [], total: 0 };
      },
    };
    const packageAcquisitionAuthority = createTestNpmPackageAcquisitionAuthority(deps);
    const shellA = new Shell({ cwd: '/proj' });
    shellA.registerCommand('npm', createNpmShellCommand({ ...deps, packageAcquisitionAuthority }));
    const shellB = new Shell({ cwd: '/proj' });
    shellB.registerCommand('npm', createNpmShellCommand({ ...deps, packageAcquisitionAuthority }));

    const a = runShell(shellA, 'npm install lodash@^4.17.0');
    await vi.waitFor(() => expect(flushCalls).toBe(1));
    const b = runShell(shellB, 'npm install ms@^2.1.3');
    await expect(a).resolves.toMatchObject({ exitCode: 0 });
    await expectPending(b);
    expect(calls).toHaveLength(1);
    releaseFlush();
    await expect(b).resolves.toMatchObject({ exitCode: 0 });
    expect(calls).toHaveLength(2);
    await vi.waitFor(async () => {
      expect((await trustedStamp(vfs))?.deps).toEqual({ lodash: '^4.17.0', ms: '^2.1.3' });
    });
  });

  it('an in-flight install removes the previous trusted claim before touching the tree', async () => {
    // Regression (review round 1): without this, a reload during install #2
    // (or its background drain) must never see install #1's trusted stamp over
    // a half-replaced tree. The demote is proven first; then the authority
    // removes its own pending marker so ancestor mutation is legal. ABSENT is
    // still untrusted on restart.
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

    let stampExistsDuringInstall = true;
    const secondInstall: InstallFn = async () => {
      stampExistsDuringInstall = await vfs.exists(STAMP);
      return twoPackageResult();
    };
    const shell2 = new Shell({ cwd: '/proj' });
    shell2.registerCommand(
      'npm',
      createNpmShellCommand({ vfs, registry: fakeRegistry, install: secondInstall }),
    );
    const { exitCode } = await runShell(shell2, 'npm install ms@^2.1.3');

    expect(exitCode).toBe(0);
    expect(stampExistsDuringInstall).toBe(false);
  });

  it('a package.json edit during the authority-held drain skips the trusted stamp loudly', async () => {
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
    let flushStarted = false;
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => {
          flushStarted = true;
          await flushGate;
          return { failures: [], total: 0 };
        },
      }),
    );

    const running = runShell(shell, 'npm install lodash@^4.17.0');
    await vi.waitFor(() => expect(flushStarted).toBe(true));
    const { exitCode, rec } = await running;

    await vfs.writeFile(
      '/proj/package.json',
      `${JSON.stringify({ name: 'demo', dependencies: { lodash: '^4.17.0', evil: '9.9.9' } }, null, 2)}\n`,
    );
    releaseFlush();
    expect(exitCode).toBe(0);
    await vi.waitFor(() =>
      expect(rec.stderr.join('')).toContain('package.json changed during the install'),
    );
    expect(await trustedStamp(vfs)).toBeNull();
  });

  it('the promoted stamp carries the install-time slug when selection changes during the background drain', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install } = makeStubInstall(() => twoPackageResult());
    let releaseFlush!: () => void;
    const flushGate = new Promise<void>((r) => {
      releaseFlush = r;
    });
    let flushStarted = false;
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
          flushStarted = true;
          await flushGate;
          return { failures: [], total: 0 };
        },
      }),
    );

    const running = runShell(shell, 'npm install lodash@^4.17.0');
    await vi.waitFor(() => expect(flushStarted).toBe(true));
    await expect(running).resolves.toMatchObject({ exitCode: 0 });
    slug = 'preset-b';
    releaseFlush();
    let stamp!: { durability?: string; slug: string };
    await vi.waitFor(async () => {
      stamp = JSON.parse(await vfs.readFileText(STAMP)) as {
        durability?: string;
        slug: string;
      };
      expect(stamp.durability).toBeUndefined();
    });
    expect(stamp.durability).toBeUndefined();
    expect(stamp.slug).toBe('preset-a');
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

  it('a section move during the authority-held drain still fails the byte-exact manifest guard', async () => {
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
    let flushStarted = false;
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => {
          flushStarted = true;
          await flushGate;
          return { failures: [], total: 0 };
        },
      }),
    );

    const running = runShell(shell, 'npm install lodash@^4.17.0');
    await vi.waitFor(() => expect(flushStarted).toBe(true));
    const { exitCode, rec } = await running;

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
    expect(exitCode).toBe(0);
    await vi.waitFor(() =>
      expect(rec.stderr.join('')).toContain('package.json changed during the install'),
    );
    expect(await trustedStamp(vfs)).toBeNull();
  });

  it('a tree deleted during the authority-held drain is never resurrected by promotion', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    const { install } = makeStubInstall(() => twoPackageResult());
    let releaseFlush!: () => void;
    const flushGate = new Promise<void>((r) => {
      releaseFlush = r;
    });
    let flushStarted = false;
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        flush: async () => {
          flushStarted = true;
          await flushGate;
          return { failures: [], total: 0 };
        },
      }),
    );

    const running = runShell(shell, 'npm install lodash@^4.17.0');
    await vi.waitFor(() => expect(flushStarted).toBe(true));
    await expect(running).resolves.toMatchObject({ exitCode: 0 });
    await vfs.rm('/proj/node_modules', { recursive: true, force: true });
    releaseFlush();
    expect(await vfs.exists(STAMP)).toBe(false);
    expect(await vfs.exists('/proj/node_modules')).toBe(false);
  });

  it('holds the root through the final manifest probe so no newer epoch can enter its write slot', async () => {
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
    let gateArmed = false;
    const vfs = new Proxy(inner, {
      get(target, property, receiver) {
        if (property === 'readFileText') {
          return async (path: string): Promise<string> => {
            const text = await target.readFileText(path);
            if (gateArmed && path === '/proj/package.json') {
              gateArmed = false;
              sequenceParked();
              await sequenceGate;
            }
            return text;
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      },
    }) as unknown as Vfs;
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
        flush: async () => {
          gateArmed = true;
          return { failures: [], total: 0 };
        },
      }),
    );

    const firstRun = runShell(shell, 'npm install lodash@^4.17.0');
    await parked;
    const secondRun = runShell(shell, 'npm install lodash@^4.17.0');
    await expect(firstRun).resolves.toMatchObject({ exitCode: 0 });
    await expectPending(secondRun);
    expect(installCalls).toBe(1);
    expect(await trustedStamp(inner)).toBeNull();

    releaseSequence();
    await expect(secondRun).resolves.toMatchObject({ exitCode: 0 });
    expect(installCalls).toBe(2);
    await vi.waitFor(async () => {
      expect((await trustedStamp(inner))?.deps).toEqual({ lodash: '^4.17.0' });
    });
  });

  it('a tree deleted at the trusted commit is not resurrected — the final write must not mkdir', async () => {
    // The pending claim is already proven. Delete the tree exactly when the
    // trusted commit marker is attempted: that write must fail, stay loud,
    // and never recreate node_modules.
    const inner = new MemoryVfs();
    await inner.mkdir('/proj/node_modules', { recursive: true });
    let stampWrites = 0;
    const vfs = new Proxy(inner, {
      get(target, property, receiver) {
        if (property === 'writeFile') {
          return async (path: string, data: Uint8Array | string): Promise<void> => {
            if (path === STAMP && ++stampWrites === 2) {
              await target.rm('/proj/node_modules', { recursive: true, force: true });
            }
            await target.writeFile(path, data);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      },
    }) as unknown as Vfs;
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
    // The write failed with the parent gone; the terminal says so.
    expect(rec.stderr.join('')).toContain('install stamp write failed');
  });

  const TRUSTED_PACKAGE_JSON = `${JSON.stringify(
    { name: 'demo', version: '0.0.0', dependencies: { lodash: '^4.17.0' } },
    null,
    2,
  )}\n`;
  const TRUSTED_SEED = `${JSON.stringify(
    createInstallStamp('/proj', TRUSTED_PACKAGE_JSON, { slug: '', packages: 2 }),
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

  it('a TRUSTED stamp is revoked from view even when package.json is ABSENT', async () => {
    // Review round 4: the old demote helper no-op'd without package.json, so a
    // named install onto a stamped tree whose package.json was deleted left
    // the old TRUSTED stamp durable while the tree mutated — and the
    // demote-proof flush passed vacuously (nothing was written to prove).
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    await vfs.writeFile(STAMP, TRUSTED_SEED); // trusted stamp, NO package.json
    let stampExistsDuringInstall = true;
    const install: InstallFn = async () => {
      stampExistsDuringInstall = await vfs.exists(STAMP);
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
    expect(stampExistsDuringInstall).toBe(false);
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

  it('prepareInstall runs INSIDE the authority queue — terminal B’s clear/reseed cannot raze terminal A’s in-flight install', async () => {
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
    let installCalls = 0;
    const npm = createNpmShellCommand({
      vfs,
      registry: fakeRegistry,
      prepareInstall: async (_ctx, info) => {
        if (info.fullInstall) events.push('prepareB'); // the would-be clear/reseed
      },
      install: async () => {
        installCalls += 1;
        if (installCalls === 1) {
          events.push('installA:start');
          await installAGate;
          events.push('installA:end');
        } else {
          events.push('installB');
        }
        return twoPackageResult();
      },
    });
    const shellA = new Shell({ cwd: '/proj' });
    shellA.registerCommand('npm', npm);
    const shellB = new Shell({ cwd: '/proj' });
    shellB.registerCommand('npm', npm);

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

  it('prepareInstall runs after the demote proof and authority-owned marker removal', async () => {
    // Review round 5: the clear ran before the generation claim and the
    // trusted-stamp demote/proof; a clear whose OPFS rm never persisted
    // erased the MIRROR stamp while OPFS kept the trusted one — the install
    // then saw no trusted prior stamp, skipped the proof, and mutated under
    // the durable stamp.
    const vfs = new MemoryVfs();
    await seedTrustedProject(vfs);
    let stampExistsAtPrepare = true;
    let flushCalls = 0;
    let flushCallsAtPrepare = 0;
    const { install } = makeStubInstall(() => twoPackageResult());
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        install,
        prepareInstall: async () => {
          flushCallsAtPrepare = flushCalls;
          stampExistsAtPrepare = await vfs.exists(STAMP);
        },
        flush: async () => {
          flushCalls += 1;
          return { failures: [], total: 0 };
        },
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install lodash@^4.17.0');

    expect(exitCode).toBe(0);
    expect(flushCallsAtPrepare).toBe(1); // pending demote proven before mutation opens
    expect(stampExistsAtPrepare).toBe(false); // reserved claim removed by its authority
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

  it('one injected owner authority serializes separate terminal command instances', async () => {
    // Review round 2: epoch fencing cancels stale PROMOTIONS, but the
    // foreground install phases must not interleave tree writes either.
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj/node_modules', { recursive: true });
    let releaseInstallA!: () => void;
    const installAGate = new Promise<void>((r) => {
      releaseInstallA = r;
    });
    const events: string[] = [];
    let installCalls = 0;
    const deps = {
      vfs,
      registry: fakeRegistry,
      install: async () => {
        installCalls += 1;
        if (installCalls === 1) {
          events.push('installA:start');
          await installAGate; // A's install phase hangs mid-write
          events.push('installA:end');
        } else {
          events.push('installB');
        }
        return twoPackageResult();
      },
    };
    const packageAcquisitionAuthority = createTestNpmPackageAcquisitionAuthority(deps);
    const shellA = new Shell({ cwd: '/proj' });
    shellA.registerCommand('npm', createNpmShellCommand({ ...deps, packageAcquisitionAuthority }));
    const shellB = new Shell({ cwd: '/proj' });
    shellB.registerCommand('npm', createNpmShellCommand({ ...deps, packageAcquisitionAuthority }));

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

describe('npm-shell-command — cwd package identity', () => {
  it('resolves a queued terminal install against the project active at the FIFO head', async () => {
    const root = '/workspace';
    const packageJsonA = '{"name":"project-a","dependencies":{"a":"1.0.0"}}\n';
    const packageJsonB = '{"name":"project-b","dependencies":{"b":"1.0.0"}}\n';
    const projectA = {
      projectId: 'project-a',
      root,
      slug: 'project-a',
      identity: installArtifactIdentity,
    };
    const projectB = {
      projectId: 'project-b',
      root,
      slug: 'project-b',
      identity: installArtifactIdentity,
    };
    const packageJsonBySlug = new Map([
      [projectA.slug, packageJsonA],
      [projectB.slug, packageJsonB],
    ]);
    const vfs = new MemoryVfs();
    await vfs.mkdir(`${root}/node_modules`, { recursive: true });
    await vfs.writeFile(`${root}/package.json`, packageJsonA);
    const stamps = createInstallStampAuthority({ vfs });
    let activeProject = projectA;
    let releaseHead!: () => void;
    const headGate = new Promise<void>((resolve) => {
      releaseHead = resolve;
    });
    let markHeadStarted!: () => void;
    const headStarted = new Promise<void>((resolve) => {
      markHeadStarted = resolve;
    });
    const installedSlugs: string[] = [];
    const installedConfigs: string[] = [];
    const packages = createPackageAcquisitionAuthority({
      stamps,
      adapter: {
        planSnapshotRestore: async () => ({ status: 'rejected', reason: 'unused' }),
        install: async (request) => {
          const packageJsonText = packageJsonBySlug.get(request.project.slug);
          if (!packageJsonText) throw new Error(`missing config for ${request.project.slug}`);
          installedSlugs.push(request.project.slug);
          installedConfigs.push(packageJsonText);
          if (installedSlugs.length === 1) {
            markHeadStarted();
            await headGate;
          }
          await vfs.rm(`${root}/node_modules`, { recursive: true, force: true });
          await vfs.mkdir(`${root}/node_modules/${request.project.slug}`, { recursive: true });
          await vfs.writeFile(`${root}/package.json`, packageJsonText);
          await vfs.writeFile(`${root}/node_modules/${request.project.slug}/package.json`, '{}\n');
          return {
            result: singletonResult(request.project.slug, '1.0.0'),
            shadowPlan: EMPTY_SHADOW_PLAN,
            packageJsonText,
          };
        },
        reset: async () => {},
        switchProject: async (command) => {
          const packageJsonText = packageJsonBySlug.get(command.to.slug);
          if (!packageJsonText) throw new Error(`missing config for ${command.to.slug}`);
          activeProject = command.to;
          await vfs.rm(`${root}/node_modules`, { recursive: true, force: true });
          await vfs.mkdir(`${root}/node_modules`, { recursive: true });
          await vfs.writeFile(`${root}/package.json`, packageJsonText);
        },
      },
    });

    const head = packages.dispatch({ type: 'terminal-install', project: projectA, argv: [] });
    await headStarted;
    const projectSwitch = packages.dispatch({
      type: 'project-switch',
      from: projectA,
      to: projectB,
      resetPackages: true,
      packageJsonText: packageJsonB,
    });
    const sink = { write: (_chunk: string | Uint8Array): void => {} };
    const context: CommandContext = { cwd: root, env: {}, stdout: sink, stderr: sink };
    const npm = createNpmShellCommand({
      vfs,
      registry: fakeRegistry,
      packageAcquisitionAuthority: packages,
      projectSlug: (candidateRoot) =>
        candidateRoot === activeProject.root ? activeProject.slug : `root:${candidateRoot}`,
    });
    const queuedInstall = npm(['install'], context);

    releaseHead();
    await expect(head).resolves.toMatchObject({ outcome: 'installed' });
    await expect(projectSwitch).resolves.toBeUndefined();
    await expect(queuedInstall).resolves.toBe(0);
    await packages.quiesce();

    expect(installedSlugs).toEqual([projectA.slug, projectB.slug]);
    expect(installedConfigs).toEqual([packageJsonA, packageJsonB]);
    await expect(vfs.readFileText(`${root}/package.json`)).resolves.toBe(packageJsonB);
    await expect(stamps.check({ root, slug: projectB.slug })).resolves.toMatchObject({
      status: 'trusted',
      stamp: { slug: projectB.slug, packageJsonText: packageJsonB },
    });
  });

  it('keys an arbitrary nested cwd locally and demotes its stamped node_modules ancestor', async () => {
    const outerRoot = '/workspace';
    const nestedRoot = `${outerRoot}/node_modules/tool/project`;
    const outerPackageJson = '{"name":"workspace","dependencies":{"tool":"1.0.0"}}\n';
    const nestedPackageJson = '{"name":"nested","dependencies":{"vite":"5.4.21"}}\n';
    const vfs = new MemoryVfs();
    await vfs.mkdir(`${nestedRoot}/node_modules`, { recursive: true });
    await vfs.writeFile(`${outerRoot}/package.json`, outerPackageJson);
    await vfs.writeFile(`${nestedRoot}/package.json`, nestedPackageJson);
    const stamps = createInstallStampAuthority({ vfs });
    const outerProject = {
      projectId: 'active',
      root: outerRoot,
      slug: 'active',
      identity: installArtifactIdentity,
    };
    const outerClaim = await stamps.demote(outerProject);
    await stamps.promote(
      { ...outerProject, packageJsonText: outerPackageJson },
      { epoch: outerClaim.epoch, packages: 1 },
    );
    let installedProject: { readonly root: string; readonly slug: string } | undefined;
    const packages = createPackageAcquisitionAuthority({
      stamps,
      resolveTreeGuards: (root) =>
        root === nestedRoot ? [{ mode: 'demote', project: outerProject }] : [],
      adapter: {
        planSnapshotRestore: async () => ({ status: 'rejected', reason: 'not requested' }),
        install: async (request) => {
          installedProject = request.project;
          await vfs.mkdir(`${nestedRoot}/node_modules/vite`, { recursive: true });
          await vfs.writeFile(`${nestedRoot}/node_modules/vite/package.json`, '{}\n');
          return {
            result: emptyResult(),
            shadowPlan: EMPTY_SHADOW_PLAN,
            packageJsonText: nestedPackageJson,
          };
        },
        reset: async () => {},
        switchProject: async () => {},
      },
    });
    const shell = new Shell({ cwd: nestedRoot });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: fakeRegistry,
        packageAcquisitionAuthority: packages,
        projectSlug: (root) => (root === outerRoot ? 'active' : `root:${root}`),
      }),
    );

    const { exitCode } = await runShell(shell, 'npm install');
    await packages.quiesce();

    expect(exitCode).toBe(0);
    expect(installedProject).toMatchObject({ root: nestedRoot, slug: `root:${nestedRoot}` });
    await expect(stamps.check({ root: outerRoot, slug: 'active' })).resolves.toMatchObject({
      status: 'pending',
    });
    await expect(
      stamps.check({ root: nestedRoot, slug: `root:${nestedRoot}` }),
    ).resolves.toMatchObject({ status: 'trusted' });
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
