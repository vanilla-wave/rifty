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
 * into the terminal via `Shell.run`'s `onChunk` callback. Per-package lines
 * stream live through `InstallOptions.onPackage` (ADR-0134).
 *
 * After a successful install the tree is stamped (ADR-0135) so the real-vite
 * worker bootstrap can skip its redundant install; `deps.flush` drains the
 * OPFS write-through before/after the stamp so a durable stamp implies a
 * durable tree.
 */

import { NotImplementedError } from '@riftydev/io';
import {
  type InstallOptions,
  type InstallResult,
  type RegistryClient,
  install as realInstall,
} from '@riftydev/npm-client';
import type { CommandContext, ShellCommand } from '@riftydev/shell';
import type { Vfs } from '@riftydev/vfs';
import { writeInstallStamp } from './install-stamp.ts';

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
  /** Drains the VFS write-through (page wires the OPFS sync-mirror flush) so
   *  the install stamp lands durably AFTER the tree (ADR-0135). */
  readonly flush?: () => Promise<void>;
  /** The owner's project slug (preset id) the install stamp is keyed on so the
   *  next boot's `installStampSatisfied(slug)` REUSES this tree instead of
   *  re-running its dependency arrival (which replaces node_modules, dropping the
   *  user install). A getter — the active preset can change. Defaults to `''`
   *  (page-side ad-hoc installs no boot reuses). */
  readonly projectSlug?: () => string;
  /** Opt-in eddy fast-install resolver URL (ADR-0182), env-config only (D-004),
   *  default OFF. When set, `install()` runs the fast path (with auto-fallback
   *  to the standard verifying install); the install line reports
   *  `via eddy (fast)` when the eddy path produced the tree. */
  readonly resolverUrl?: string;
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
  const directUnsupported = unsupportedDependencySpec(spec);
  if (directUnsupported) throwUnsupportedDependencySpec(spec, directUnsupported);
  if (spec.startsWith('@')) {
    const at = spec.indexOf('@', 1);
    if (at < 0) return { name: spec, range: 'latest' };
    const range = spec.slice(at + 1) || 'latest';
    const unsupported = unsupportedDependencySpec(range);
    if (unsupported) throwUnsupportedDependencySpec(spec, unsupported);
    return { name: spec.slice(0, at), range };
  }
  const at = spec.indexOf('@');
  if (at < 0) return { name: spec, range: 'latest' };
  const range = spec.slice(at + 1) || 'latest';
  const unsupported = unsupportedDependencySpec(range);
  if (unsupported) throwUnsupportedDependencySpec(spec, unsupported);
  return { name: spec.slice(0, at), range };
}

function unsupportedDependencySpec(range: string): string | null {
  const trimmed = range.trim();
  if (trimmed === '.' || trimmed === '..') return 'file';
  if (/^(?:\.{0,2}\/|\/)/.test(trimmed)) return 'file';
  if (/^(file|link):/.test(trimmed)) return 'file';
  if (trimmed.startsWith('workspace:')) return 'workspace';
  if (/^(git\+|git:|github:|gitlab:|bitbucket:)/.test(trimmed) || /\.git(?:#|$)/.test(trimmed)) {
    return 'git';
  }
  if (/^https?:/.test(trimmed)) return 'http-tarball';
  if (trimmed.startsWith('npm:')) return 'npm-alias';
  if (isGithubShorthand(trimmed)) return 'git';
  return null;
}

function isGithubShorthand(spec: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[#@].+)?$/.test(spec);
}

function throwUnsupportedDependencySpec(spec: string, feature: string): never {
  throw new NotImplementedError(
    `npm-client.dependency-spec.${feature}`,
    `${spec} is outside registry semver/tag installs`,
  );
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    throw new Error(`npm: package.json at ${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`npm: package.json at ${path} must be an object`);
  }
  const raw = parsed as Record<string, unknown>;
  const dependencies = readPackageJsonStringMap(raw, 'dependencies');
  const scripts = readPackageJsonScripts(raw);
  const devDependencies = readPackageJsonStringMap(raw, 'devDependencies');
  const optionalDependencies = readPackageJsonStringMap(raw, 'optionalDependencies');
  return {
    raw,
    name: typeof raw.name === 'string' ? raw.name : DEFAULT_PROJECT_NAME,
    version: typeof raw.version === 'string' ? raw.version : DEFAULT_PROJECT_VERSION,
    scripts,
    dependencies,
    devDependencies,
    optionalDependencies,
  };
}

async function readPackageScripts(vfs: Vfs, cwd: string): Promise<Record<string, string>> {
  const path = `${cwd}/package.json`;
  if (!(await vfs.exists(path))) return {};
  const text = await vfs.readFileText(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    throw new Error(`npm: package.json at ${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`npm: package.json at ${path} must be an object`);
  }
  return readPackageJsonScripts(parsed as Record<string, unknown>);
}

function readPackageJsonStringMap(
  raw: Record<string, unknown>,
  field: string,
): Record<string, string> {
  const value = raw[field];
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    // TODO(backlog: npm-client/tar-symlink-and-nonregistry-dep-tracking)
    throw new NotImplementedError(`npm-client.package-json.${field}`);
  }
  const out: Record<string, string> = {};
  for (const [name, range] of Object.entries(value)) {
    if (typeof range !== 'string') {
      // TODO(backlog: npm-client/tar-symlink-and-nonregistry-dep-tracking)
      throw new NotImplementedError(`npm-client.package-json.${field}`);
    }
    out[name] = range;
  }
  return out;
}

function readPackageJsonScripts(raw: Record<string, unknown>): Record<string, string> {
  return raw.scripts && typeof raw.scripts === 'object' && !Array.isArray(raw.scripts)
    ? Object.fromEntries(
        Object.entries(raw.scripts).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};
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

  const packageScripts = await readPackageScripts(deps.vfs, ctx.cwd);
  const command = packageScripts[scriptName];
  if (!command) {
    ctx.stderr.write(`npm: missing script '${scriptName}'\n`);
    return 1;
  }
  if (!deps.runScript) {
    ctx.stderr.write('npm: script execution is not available in this shell\n');
    return 1;
  }
  const scriptSteps = [
    [`pre${scriptName}`, packageScripts[`pre${scriptName}`]],
    [scriptName, appendScriptArguments(command, scriptForwardArgs(args))],
    [`post${scriptName}`, packageScripts[`post${scriptName}`]],
  ].filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  for (const [name, scriptCommand] of scriptSteps) {
    const code = await deps.runScript(name, scriptCommand, ctx);
    if (code !== 0) return code;
  }
  return 0;
}

function scriptForwardArgs(args: readonly string[]): readonly string[] {
  const rest = args.slice(1);
  return rest[0] === '--' ? rest.slice(1) : [];
}

function appendScriptArguments(command: string, args: readonly string[]): string {
  if (args.length === 0) return command;
  return `${command} ${args.map(quoteShellWord).join(' ')}`;
}

function quoteShellWord(value: string): string {
  if (value.length > 0 && !/[\s'"\\;&|<>$*?\[]/u.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
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
    if (specs.length === 0 && !hasPackageJsonDeps && !hasRootLifecycleScript(pkg.scripts)) {
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
      ...(deps.resolverUrl ? { resolverUrl: deps.resolverUrl } : {}),
      onPackage: (event) => {
        ctx.stdout.write(
          `npm: + ${event.name}@${event.version}${event.cacheHit ? ' (cached)' : ''}\n`,
        );
      },
    });
    const elapsedMs = Math.round(performance.now() - start);

    await stampInstalledTree(deps, ctx.cwd, result.packages.length);
    const via = result.source === 'eddy' ? ' via eddy (fast)' : '';
    ctx.stdout.write(
      `npm: installed ${result.packages.length} package(s) in ${elapsedMs}ms${via}\n`,
    );
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

function hasRootLifecycleScript(scripts: Record<string, string>): boolean {
  return (
    scripts.preinstall !== undefined ||
    scripts.install !== undefined ||
    scripts.postinstall !== undefined ||
    scripts.prepare !== undefined
  );
}

/**
 * Stamp the freshly installed tree (ADR-0135): flush write-through → write
 * stamp → flush stamp. Best-effort — a stamp failure costs the worker's skip
 * optimization, never the install's success.
 */
async function stampInstalledTree(
  deps: NpmShellCommandDeps,
  cwd: string,
  packages: number,
): Promise<void> {
  try {
    await deps.flush?.();
    await writeInstallStamp(deps.vfs, cwd, packages, deps.projectSlug?.() ?? '');
    await deps.flush?.();
  } catch (err) {
    console.warn(`npm: install stamp write failed: ${(err as Error).message}`);
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
