/**
 * Wire an `npm` builtin into the playground shell.
 *
 * Without this, typing `npm install <pkg>` at the terminal hits the shell's
 * "command not found" path and returns exit 127. Closes the M9 prompt-install
 * UX gap (follow-ups item #15, 2026-05-27). The install itself runs through
 * `@riftydev/npm-client.install` exactly the way `realVite.ts` does — same
 * registry, same VFS bridge, same proxy fetcher.
 *
 * What this supports today (M9-scope):
 *   - `npm install`                         — install every dep in package.json.
 *   - `npm install <name>[@<range>] ...`    — add the named deps and install.
 *   - `npm i …` / `npm add …`               — synonyms for `install`.
 *
 * Out of scope here (deferred to later milestones):
 *   - `npm run …` (needs script execution — pairs with `node` builtin / M11).
 *   - `npm uninstall` (no flow consumer yet).
 *   - Lockfile-only / `npm ci` (M11 nested install lands first).
 *
 * The command auto-creates a minimal `package.json` at `ctx.cwd` when the
 * project has none — matches what `realVite.ts` seeds for its workspace and
 * keeps `npm install express` working as a one-liner even on a blank tree.
 *
 * Progress reporting goes through `ctx.stdout.write`, which the shell pipes
 * into the terminal via `Shell.run`'s `onChunk` callback. The operator sees
 * lines as they happen rather than a single blob at the end (the readiness
 * doc's "real bar at the terminal" requirement). Per-package fetch progress
 * is not yet a hook on `install()` itself — added at start/end and once per
 * resolved package; a streaming hook lands when the installer grows one.
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
 * Signature of `@riftydev/npm-client.install`. Inlined here so tests can pass
 * a stub without reaching across into `_test-fixtures` of another package
 * (would violate the "no internal imports" rule from CLAUDE.md).
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
  /** Registry client; the playground typically passes one wired through
   *  `proxiedRegistryFetch()` so traffic stays on the proxy origin. */
  readonly registry: RegistryClient;
  /** Injection seam for unit tests; defaults to `@riftydev/npm-client.install`. */
  readonly install?: InstallFn;
}

/**
 * Minimal subset of the package.json shape we read and write. We do not
 * round-trip arbitrary keys — only `name`, `version`, `dependencies` and
 * `private` — because the file may be hand-edited and we want diff churn
 * scoped to what we actually touched.
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
 * Build the `npm` shell command. Registering the command on a `ShellSession`
 * is the responsibility of the composition root (`App.tsx`); this factory
 * stays free of Solid imports so the unit tests can exercise it with a
 * plain `Shell` instance.
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
 * Parse a package spec of the form `name`, `name@range`, `@scope/name`, or
 * `@scope/name@range`. The leading `@` of a scope is not a version
 * separator, so we look for the *second* `@` when the spec starts with one.
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
  // Stable formatting so re-installs that don't change the dep set produce
  // byte-identical output and the shell's diff-before-write keeps mtimes
  // stable. (Matches what the installer does for the lockfile.)
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

    // Only persist package.json when the operator explicitly named packages.
    // A bare `npm install` re-reads the existing file; rewriting it just
    // because we read it would churn mtimes for no behavioural change.
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
 * Map known installer error shapes to single-line operator-friendly stderr
 * output. EVERSIONCONFLICT and EINTEGRITY are the two we expect to surface
 * regularly today; everything else falls through with the raw message and a
 * generic exit code so the operator still sees what happened.
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
