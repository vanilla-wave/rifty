/**
 * Wire an `npm` builtin into the playground shell. Closes the M9 prompt-install
 * UX gap (follow-ups item #15, 2026-05-27): without it `npm install <pkg>` hits
 * the shell's "command not found" path and exits 127. Installs run through
 * `@riftydev/npm-client.install` like `realVite.ts` — same registry, VFS bridge,
 * proxy fetcher.
 *
 * Scope: `npm install`, `npm install <name>[@<range>] …`, `i`/`add` synonyms,
 * plus `npm run <script>` via an injected host script runner. Deferred:
 * `npm uninstall`, `npm ci`/lockfile-only (M11 nested install lands first).
 *
 * Auto-creates a minimal `package.json` at `ctx.cwd` when none exists (matches
 * `realVite.ts` seeding) so `npm install express` is a one-liner on a blank tree.
 *
 * Progress reporting goes through `ctx.stdout.write`, which the shell pipes
 * into the terminal via `Shell.run`'s `onChunk` callback. Per-package fetch
 * progress is not yet a hook on `install()` itself — added at start/end and
 * once per resolved package; a streaming hook lands when the installer grows one.
 */

import {
  type InstallOptions,
  type InstallResult,
  type RegistryClient,
  install as realInstall,
} from '@riftydev/npm-client';
import type { CommandContext, ShellCommand } from '@riftydev/shell';
import type { Vfs } from '@riftydev/vfs';

/**
 * Signature of `@riftydev/npm-client.install`. Inlined so tests stub it without
 * importing another package's internals (the "no internal imports" rule).
 */
export type InstallFn = (
  arg1: string | InstallOptions,
  rootVersion?: string,
  dependenciesOrOpts?: Record<string, string> | InstallOptions,
  opts?: InstallOptions,
) => Promise<InstallResult>;

export interface NpmShellCommandDeps {
  /** VFS used by the installer to write `node_modules/` and the lockfile. */
  readonly vfs: Vfs;
  /** Playground wires one through `proxiedRegistryFetch()` so traffic stays on
   *  the proxy origin. */
  readonly registry: RegistryClient;
  /** Test seam; defaults to `@riftydev/npm-client.install`. */
  readonly install?: InstallFn;
  /** Executes an `npm run <script>` command in the host shell/session. */
  readonly runScript?: (name: string, command: string, ctx: CommandContext) => Promise<number>;
}

interface ProjectPackageJson {
  readonly raw: Record<string, unknown>;
  readonly name: string;
  readonly version: string;
  readonly scripts: Record<string, string>;
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
  readonly optionalDependencies: Record<string, string>;
}

const DEFAULT_PROJECT_NAME = 'rifty-project';
const DEFAULT_PROJECT_VERSION = '0.0.0';

/**
 * Build the `npm` shell command. The composition root (`App.tsx`) registers it
 * on a `ShellSession`; this factory stays Solid-free so unit tests can exercise
 * it with a plain `Shell` instance.
 */
export function createNpmShellCommand(deps: NpmShellCommandDeps): ShellCommand {
  return async (args, ctx) => {
    const sub = args[0];
    if (!sub) {
      ctx.stderr.write('npm: missing subcommand (try `npm install`)\n');
      return 1;
    }
    if (sub === 'install' || sub === 'i' || sub === 'add') {
      return runInstall(args.slice(1), ctx, deps);
    }
    if (sub === 'run' || sub === 'run-script') {
      return runPackageScript(args.slice(1), ctx, deps);
    }
    ctx.stderr.write(`npm: unknown subcommand '${sub}' (supported: install, i, add, run)\n`);
    return 1;
  };
}

/**
 * Parse `name`, `name@range`, `@scope/name`, or `@scope/name@range`. A scope's
 * leading `@` isn't a version separator, so look for the *second* `@`.
 */
function parseSpec(spec: string): { name: string; range: string } {
  if (spec.startsWith('@')) {
    const at = spec.indexOf('@', 1);
    if (at < 0) return { name: spec, range: 'latest' };
    return { name: spec.slice(0, at), range: spec.slice(at + 1) || 'latest' };
  }
  const at = spec.indexOf('@');
  if (at < 0) return { name: spec, range: 'latest' };
  return { name: spec.slice(0, at), range: spec.slice(at + 1) || 'latest' };
}

async function readPackageJson(vfs: Vfs, cwd: string): Promise<ProjectPackageJson> {
  const path = `${cwd}/package.json`;
  if (!(await vfs.exists(path))) {
    return {
      raw: { name: DEFAULT_PROJECT_NAME, version: DEFAULT_PROJECT_VERSION, private: true },
      name: DEFAULT_PROJECT_NAME,
      version: DEFAULT_PROJECT_VERSION,
      scripts: {},
      dependencies: {},
      devDependencies: {},
      optionalDependencies: {},
    };
  }
  const text = await vfs.readFileText(path);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected an object');
    }
    const raw = parsed as Record<string, unknown>;
    const dependencies =
      raw.dependencies && typeof raw.dependencies === 'object' && !Array.isArray(raw.dependencies)
        ? Object.fromEntries(
            Object.entries(raw.dependencies).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : {};
    const scripts =
      raw.scripts && typeof raw.scripts === 'object' && !Array.isArray(raw.scripts)
        ? Object.fromEntries(
            Object.entries(raw.scripts).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : {};
    const devDependencies = readStringMap(raw.devDependencies);
    const optionalDependencies = readStringMap(raw.optionalDependencies);
    return {
      raw,
      name: typeof raw.name === 'string' ? raw.name : DEFAULT_PROJECT_NAME,
      version: typeof raw.version === 'string' ? raw.version : DEFAULT_PROJECT_VERSION,
      scripts,
      dependencies,
      devDependencies,
      optionalDependencies,
    };
  } catch (err) {
    throw new Error(`npm: package.json at ${path} is not valid JSON: ${(err as Error).message}`);
  }
}

function readStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

async function writePackageJson(vfs: Vfs, cwd: string, pkg: ProjectPackageJson): Promise<void> {
  const path = `${cwd}/package.json`;
  // Stable formatting: re-installs with an unchanged dep set produce
  // byte-identical output, so the shell's diff-before-write keeps mtimes stable.
  await vfs.writeFile(path, `${JSON.stringify(pkg.raw, null, 2)}\n`);
}

async function runPackageScript(
  args: string[],
  ctx: CommandContext,
  deps: NpmShellCommandDeps,
): Promise<number> {
  const scriptName = args[0];
  if (!scriptName) {
    ctx.stderr.write('npm: missing script name (try `npm run dev`)\n');
    return 1;
  }
  if (scriptName.startsWith('-')) {
    ctx.stderr.write(`npm: flag '${scriptName}' not supported for run\n`);
    return 1;
  }

  const pkg = await readPackageJson(deps.vfs, ctx.cwd);
  const command = pkg.scripts[scriptName];
  if (!command) {
    ctx.stderr.write(`npm: missing script '${scriptName}'\n`);
    return 1;
  }
  if (!deps.runScript) {
    ctx.stderr.write('npm: script execution is not available in this shell\n');
    return 1;
  }
  return deps.runScript(scriptName, command, ctx);
}

async function runInstall(
  specs: string[],
  ctx: CommandContext,
  deps: NpmShellCommandDeps,
): Promise<number> {
  const pkg = await readPackageJson(deps.vfs, ctx.cwd);
  const dependencies = { ...pkg.dependencies };

  for (const spec of specs) {
    if (spec.startsWith('-')) {
      ctx.stderr.write(`npm: flag '${spec}' not supported (M9 scope)\n`);
      return 1;
    }
    const { name, range } = parseSpec(spec);
    if (!name) {
      ctx.stderr.write(`npm: malformed package spec '${spec}'\n`);
      return 1;
    }
    dependencies[name] = range;
  }

  if (Object.keys(dependencies).length === 0) {
    const hasPackageJsonDeps =
      Object.keys(pkg.devDependencies).length > 0 ||
      Object.keys(pkg.optionalDependencies).length > 0;
    if (specs.length === 0 && !hasPackageJsonDeps) {
      ctx.stdout.write('npm: no dependencies to install\n');
      return 0;
    }
  }

  const packageJsonPath = `${ctx.cwd}/package.json`;
  const hadPackageJson = await deps.vfs.exists(packageJsonPath);
  const previousPackageJson = hadPackageJson ? await deps.vfs.readFile(packageJsonPath) : null;
  if (specs.length > 0) {
    const next: ProjectPackageJson = {
      raw: { ...pkg.raw, dependencies },
      name: pkg.name,
      version: pkg.version,
      scripts: pkg.scripts,
      dependencies,
      devDependencies: pkg.devDependencies,
      optionalDependencies: pkg.optionalDependencies,
    };
    await writePackageJson(deps.vfs, ctx.cwd, next);
  }

  const requested = specs.length > 0 ? specs.join(' ') : 'all from package.json';
  ctx.stdout.write(`npm: installing ${requested}…\n`);
  const start = performance.now();

  const installFn = deps.install ?? realInstall;
  try {
    const result = await installFn({
      vfs: deps.vfs,
      cwd: ctx.cwd,
      registry: deps.registry,
    });
    const elapsedMs = Math.round(performance.now() - start);

    ctx.stdout.write(`npm: installed ${result.packages.length} package(s) in ${elapsedMs}ms\n`);
    return 0;
  } catch (err) {
    if (specs.length > 0) {
      if (previousPackageJson) {
        await deps.vfs.writeFile(packageJsonPath, previousPackageJson);
      } else {
        await deps.vfs.rm(packageJsonPath, { force: true });
      }
    }
    return reportInstallError(err, ctx);
  }
}

/**
 * Map known installer error codes to single-line stderr output. Unknown errors
 * fall through with the raw message so the operator still sees what happened.
 */
function reportInstallError(err: unknown, ctx: CommandContext): number {
  const e = err as Error & {
    code?: string;
    packageName?: string;
    firstVersion?: string;
    secondVersion?: string;
    expected?: string;
    actual?: string;
  };
  if (e.code === 'EVERSIONCONFLICT') {
    ctx.stderr.write(
      `npm: version conflict on ${e.packageName ?? '?'}: ${
        e.firstVersion ?? '?'
      } vs ${e.secondVersion ?? '?'} (nested install lands in M11)\n`,
    );
    return 1;
  }
  if (e.code === 'EINTEGRITY') {
    ctx.stderr.write(
      `npm: integrity mismatch for ${e.packageName ?? '?'}: expected ${
        e.expected ?? '?'
      }, got ${e.actual ?? '?'}\n`,
    );
    return 1;
  }
  if (e.code === 'EBROKENLOCK') {
    ctx.stderr.write(
      `npm: lockfile is broken (${e.packageName ?? 'unknown package'}); delete package-lock.json and retry\n`,
    );
    return 1;
  }
  ctx.stderr.write(`npm: install failed: ${e.message}\n`);
  return 1;
}
