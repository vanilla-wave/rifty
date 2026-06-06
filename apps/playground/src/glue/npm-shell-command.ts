/**
 * Wire an `npm` builtin into the playground shell. Closes the M9 prompt-install
 * UX gap (follow-ups item #15, 2026-05-27): without it `npm install <pkg>` hits
 * the shell's "command not found" path and exits 127. Installs run through
 * `@riftydev/npm-client.install` like `realVite.ts` — same registry, VFS bridge,
 * proxy fetcher.
 *
 * M9 scope: `npm install`, `npm install <name>[@<range>] …`, `i`/`add` synonyms.
 * Deferred: `npm run …` (M11, needs script execution), `npm uninstall`,
 * `npm ci`/lockfile-only (M11 nested install lands first).
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
  rootName: string,
  rootVersion: string,
  dependencies: Record<string, string>,
  opts: InstallOptions,
) => Promise<InstallResult>;

export interface NpmShellCommandDeps {
  /** VFS used by the installer to write `node_modules/` and the lockfile. */
  readonly vfs: Vfs;
  /** Playground wires one through `proxiedRegistryFetch()` so traffic stays on
   *  the proxy origin. */
  readonly registry: RegistryClient;
  /** Test seam; defaults to `@riftydev/npm-client.install`. */
  readonly install?: InstallFn;
}

/**
 * Subset of package.json we read/write. We don't round-trip arbitrary keys
 * (only name/version/dependencies/private) to keep diff churn scoped to what we
 * touched, since the file may be hand-edited.
 */
interface ProjectPackageJson {
  name: string;
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
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
    ctx.stderr.write(`npm: unknown subcommand '${sub}' (supported: install, i, add)\n`);
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
    return { name: DEFAULT_PROJECT_NAME, version: DEFAULT_PROJECT_VERSION, private: true };
  }
  const text = await vfs.readFileText(path);
  try {
    const parsed = JSON.parse(text) as Partial<ProjectPackageJson>;
    return {
      name: parsed.name ?? DEFAULT_PROJECT_NAME,
      version: parsed.version ?? DEFAULT_PROJECT_VERSION,
      private: parsed.private,
      dependencies: parsed.dependencies,
    };
  } catch (err) {
    throw new Error(`npm: package.json at ${path} is not valid JSON: ${(err as Error).message}`);
  }
}

async function writePackageJson(vfs: Vfs, cwd: string, pkg: ProjectPackageJson): Promise<void> {
  const path = `${cwd}/package.json`;
  // Stable formatting: re-installs with an unchanged dep set produce
  // byte-identical output, so the shell's diff-before-write keeps mtimes stable.
  await vfs.writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function runInstall(
  specs: string[],
  ctx: CommandContext,
  deps: NpmShellCommandDeps,
): Promise<number> {
  const pkg = await readPackageJson(deps.vfs, ctx.cwd);
  const dependencies = { ...(pkg.dependencies ?? {}) };

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
    ctx.stdout.write('npm: no dependencies to install\n');
    return 0;
  }

  const requested = specs.length > 0 ? specs.join(' ') : 'all from package.json';
  ctx.stdout.write(`npm: installing ${requested}…\n`);
  const start = performance.now();

  const installFn = deps.install ?? realInstall;
  try {
    const result = await installFn(pkg.name, pkg.version, dependencies, {
      vfs: deps.vfs,
      cwd: ctx.cwd,
      registry: deps.registry,
    });
    const elapsedMs = Math.round(performance.now() - start);

    // Persist only when packages were explicitly named. A bare `npm install`
    // just re-reads the file; rewriting it would churn mtimes for no change.
    if (specs.length > 0) {
      const next: ProjectPackageJson = {
        name: pkg.name,
        version: pkg.version,
        ...(pkg.private !== undefined ? { private: pkg.private } : {}),
        dependencies,
      };
      await writePackageJson(deps.vfs, ctx.cwd, next);
    }

    ctx.stdout.write(`npm: installed ${result.packages.length} package(s) in ${elapsedMs}ms\n`);
    return 0;
  } catch (err) {
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
