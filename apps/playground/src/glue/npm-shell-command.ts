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
 * After a successful install the tree is stamped (ADR-0135) and the OPFS
 * write-through is drained ONCE, after the stamp (ADR-0187): the queue is
 * FIFO, so the stamp — enqueued after every tree write — lands after the tree
 * by construction, and the single post-stamp drain makes both durable before
 * the command returns (npm parity: an immediate reload cannot lose the
 * install).
 */

import { NotImplementedError } from '@riftydev/io';
import {
  type EddyPrefetchHandle,
  type InstallOptions,
  type InstallResult,
  type RegistryClient,
  canonicalEddyRequestKey,
  eddyRequestFromPackageJson,
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
  /** Drains the VFS write-through before the command returns (npm parity: when
   *  `npm install` exits the tree IS on disk — an immediate reload must not
   *  lose it; e2e-pinned by owner-snapshot-restore-exec). ONE drain, after the
   *  stamp: the FIFO write-through (ADR-0187) lands the tree before the stamp,
   *  so a single post-stamp drain makes both durable. */
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
  /** Pinned closure hash for the ACTIVE preset (ADR-0195, `VITE_RIFTY_EDDY_PINS`).
   *  A getter — the active preset can change. Inert without `resolverUrl`. */
  readonly resolverClosureHash?: () => string | undefined;
  /** CDN base for pinned bundle GETs (`VITE_RIFTY_EDDY_BUNDLE_URL`, ADR-0195);
   *  the edge won't proxy POST, so GETs may ride a separate hostname. */
  readonly resolverBundleBaseUrl?: string;
  /** Owner-boot bundle prefetch for the ACTIVE preset (ADR-0195). A getter;
   *  install() consumes the handle at most once and only on a canonical
   *  request match. Inert without `resolverUrl`. */
  readonly resolverPrefetch?: () => EddyPrefetchHandle | undefined;
  /** Learned pins (ADR-0194): `canonicalEddyRequestKey → closureHash`. Read on
   *  the post-merge key and PREFERRED over the coarse template env pin (a learned
   *  pin matches the EXACT dep set, the env pin only the pristine preset); written
   *  fire-and-forget after a successful eddy install so the NEXT identical dep set
   *  is a cacheable GET. Inert without `resolverUrl`. */
  readonly learnedPins?: {
    get(requestKey: string): Promise<string | undefined>;
    set(requestKey: string, closureHash: string): Promise<void>;
  };
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
    // Bare `npm` and the help flags print the command list (one per line), but
    // keep npm's observable usage-exit contract: these forms return 1.
    if (!sub || sub === '-h' || sub === '--help') {
      printNpmHelp(ctx);
      return 1;
    }
    if (sub === 'help') {
      if (args.length === 1) {
        printNpmHelp(ctx);
        return 0;
      }
      throw new NotImplementedError(
        'npm.help.topic',
        `${args.slice(1).join(' ')} help is outside the browser npm subset`,
      );
    }
    if (sub === 'install' || sub === 'i' || sub === 'add') {
      return runInstall(args.slice(1), ctx, deps);
    }
    if (sub === 'run' || sub === 'run-script') {
      return runPackageScript(args.slice(1), ctx, deps);
    }
    // Lifecycle aliases: real npm runs `npm test/start/stop/restart` as the
    // matching script (the `node server.js` default for `start` is out of scope).
    if (sub === 'test' || sub === 'start' || sub === 'stop' || sub === 'restart') {
      return runPackageScript([sub, ...args.slice(1)], ctx, deps);
    }
    ctx.stderr.write(
      `npm: unknown subcommand '${sub}' — run \`npm help\` for a list of commands\n`,
    );
    return 1;
  };
}

/** Supported subcommands, one row per help line. Aliases fold into the summary
 *  (no fake separate `i`/`add` commands) so the list stays honest. */
const NPM_COMMANDS: ReadonlyArray<{ usage: string; summary: string }> = [
  { usage: 'npm install [<pkg>…]', summary: 'install dependencies (aliases: i, add)' },
  { usage: 'npm run <script>', summary: 'run a package.json script' },
  { usage: 'npm test', summary: 'run the "test" script' },
  { usage: 'npm start', summary: 'run the "start" script' },
  { usage: 'npm stop', summary: 'run the "stop" script' },
  { usage: 'npm restart', summary: 'run the "restart" script' },
  { usage: 'npm help', summary: 'show this help' },
];

/** Print the supported command list, one command per line (stdout). */
function printNpmHelp(ctx: CommandContext): void {
  const width = Math.max(...NPM_COMMANDS.map((c) => c.usage.length));
  const lines = [
    'npm <command> — a browser-native subset of npm',
    '',
    'Commands:',
    ...NPM_COMMANDS.map((c) => `  ${c.usage.padEnd(width)}  ${c.summary}`),
  ];
  ctx.stdout.write(`${lines.join('\n')}\n`);
}

/** Human-readable install duration: sub-second in ms, else seconds (1 decimal),
 *  matching real npm's `added N packages in 3s`. */
export function formatInstallDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
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

/** Classify a leading-`-` install flag: which dep map it targets (or global). */
function installFlagKind(flag: string): 'dev' | 'prod' | 'global' | 'unknown' {
  if (flag === '-D' || flag === '--save-dev') return 'dev';
  if (flag === '-S' || flag === '--save' || flag === '-E' || flag === '--save-exact') return 'prod';
  if (flag === '-g' || flag === '--global') return 'global';
  return 'unknown';
}

async function runInstall(
  specs: string[],
  ctx: CommandContext,
  deps: NpmShellCommandDeps,
): Promise<number> {
  // Partition argv into save-flags vs package specs; the flags pick the target
  // dep map. `-g` is a directed loud throw (no global store in the sandbox).
  let target: 'dependencies' | 'devDependencies' = 'dependencies';
  const pkgSpecs: string[] = [];
  for (const spec of specs) {
    if (spec.startsWith('-')) {
      const kind = installFlagKind(spec);
      if (kind === 'global') {
        ctx.stderr.write(
          "npm: global installs aren't supported in the browser sandbox — install into the project instead\n",
        );
        return 1;
      }
      if (kind === 'dev') target = 'devDependencies';
      else if (kind === 'unknown') {
        ctx.stderr.write(`npm: flag '${spec}' not supported (M9 scope)\n`);
        return 1;
      }
      // `prod` (-S/--save default, -E/--save-exact) is otherwise a no-op.
      continue;
    }
    pkgSpecs.push(spec);
  }

  const pkg = await readPackageJson(deps.vfs, ctx.cwd);
  const dependencies = { ...pkg.dependencies };
  const devDependencies = { ...pkg.devDependencies };
  const targetMap = target === 'devDependencies' ? devDependencies : dependencies;

  for (const spec of pkgSpecs) {
    const { name, range } = parseSpec(spec);
    if (!name) {
      ctx.stderr.write(`npm: malformed package spec '${spec}'\n`);
      return 1;
    }
    targetMap[name] = range;
  }

  const nothingToInstall =
    pkgSpecs.length === 0 &&
    Object.keys(dependencies).length === 0 &&
    Object.keys(devDependencies).length === 0 &&
    Object.keys(pkg.optionalDependencies).length === 0 &&
    !hasRootLifecycleScript(pkg.scripts);
  if (nothingToInstall) {
    ctx.stdout.write('npm: no dependencies to install\n');
    return 0;
  }

  const packageJsonPath = `${ctx.cwd}/package.json`;
  const hadPackageJson = await deps.vfs.exists(packageJsonPath);
  const previousPackageJson = hadPackageJson ? await deps.vfs.readFile(packageJsonPath) : null;
  if (pkgSpecs.length > 0) {
    // Emit a dep map only when it has entries OR was already present (no spurious `{}`).
    const nextRaw: Record<string, unknown> = { ...pkg.raw };
    if (Object.keys(dependencies).length > 0 || 'dependencies' in pkg.raw) {
      nextRaw.dependencies = dependencies;
    }
    if (Object.keys(devDependencies).length > 0 || 'devDependencies' in pkg.raw) {
      nextRaw.devDependencies = devDependencies;
    }
    const next: ProjectPackageJson = {
      raw: nextRaw,
      name: pkg.name,
      version: pkg.version,
      scripts: pkg.scripts,
      dependencies,
      devDependencies,
      optionalDependencies: pkg.optionalDependencies,
    };
    await writePackageJson(deps.vfs, ctx.cwd, next);
  }

  const requested = pkgSpecs.length > 0 ? pkgSpecs.join(' ') : 'all from package.json';
  ctx.stdout.write(`npm: installing ${requested}…\n`);
  const start = performance.now();

  const installFn = deps.install ?? realInstall;
  // Documented inert without `resolverUrl` — so the getters must not even RUN
  // (a throwing/warning pin store or prefetch handle must not touch an
  // eddy-disabled install).
  const envPin = deps.resolverUrl ? deps.resolverClosureHash?.() : undefined;
  const resolverPrefetch = deps.resolverUrl ? deps.resolverPrefetch?.() : undefined;
  // Pin selection (ADR-0194). requestKey is the EXACT post-merge dep set —
  // computed AFTER the package.json write above, so `npm i kleur` keys {…+kleur},
  // not the stale file. A learned pin, keyed on that exact request, is the CORRECT
  // closure for this set, so it WINS over the coarse template env pin
  // (`VITE_RIFTY_EDDY_PINS`) — the env pin only matches the pristine preset; after
  // `npm install <pkg>` it no longer describes the request (it would just cost a
  // coverage-cancelled GET before POST). Env pin stays the fallback that seeds the
  // FIRST install of a set (no learned pin yet). This keeps the ADR-0194 promise:
  // a repeat of the same dep set — modified or not — rides a cacheable learned GET.
  const requestKey = deps.resolverUrl ? await installRequestKey(deps.vfs, packageJsonPath) : null;
  const learnedPin =
    requestKey && deps.learnedPins
      ? await deps.learnedPins.get(requestKey).catch(() => undefined)
      : undefined;
  const resolverClosureHash = learnedPin ?? envPin;
  try {
    const result = await installFn({
      vfs: deps.vfs,
      cwd: ctx.cwd,
      registry: deps.registry,
      ...(deps.resolverUrl ? { resolverUrl: deps.resolverUrl } : {}),
      ...(resolverClosureHash ? { resolverClosureHash } : {}),
      ...(deps.resolverBundleBaseUrl ? { resolverBundleBaseUrl: deps.resolverBundleBaseUrl } : {}),
      ...(resolverPrefetch ? { resolverPrefetch } : {}),
      onPackage: (event) => {
        ctx.stdout.write(
          `npm: + ${event.name}@${event.version}${event.cacheHit ? ' (cached)' : ''}\n`,
        );
      },
      // Shadow-registry provenance lines (ADR-0188) belong in the npm output,
      // not the worker devtools console.
      onSubstitution: (line) => {
        ctx.stdout.write(`${line}\n`);
      },
    });
    const elapsedMs = Math.round(performance.now() - start);

    await stampInstalledTree(deps, ctx.cwd, result.packages.length);
    // Fire-and-forget write-back: the pin is an optimization, never worth
    // blocking or failing the install line over.
    if (result.source === 'eddy' && result.closureHash && requestKey && deps.learnedPins) {
      const { learnedPins } = deps;
      const closureHash = result.closureHash;
      void Promise.resolve()
        .then(() => learnedPins.set(requestKey, closureHash))
        .catch((err) => {
          console.warn(`npm: learned pin write failed: ${(err as Error).message}`);
        });
    }
    const via = result.source === 'eddy' ? ' via eddy (fast)' : '';
    ctx.stdout.write(
      `npm: installed ${result.packages.length} package(s) in ${formatInstallDuration(elapsedMs)}${via}\n`,
    );
    return 0;
  } catch (err) {
    if (pkgSpecs.length > 0) {
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
 * The canonical eddy request key for the package.json ON DISK (post-merge).
 * `null` when the file is missing or a shape the installer would reject — then
 * no pin can be looked up or learned (the install itself surfaces any loud
 * error).
 */
async function installRequestKey(vfs: Vfs, packageJsonPath: string): Promise<string | null> {
  if (!(await vfs.exists(packageJsonPath))) return null;
  let text: string;
  try {
    text = await vfs.readFileText(packageJsonPath);
  } catch {
    return null;
  }
  const body = eddyRequestFromPackageJson(text);
  return body ? canonicalEddyRequestKey(body) : null;
}

/**
 * Stamp the freshly installed tree (ADR-0135), then drain the write-through
 * ONCE. The single post-stamp drain (vs the historical flush→stamp→flush pair)
 * rides the FIFO ordering pin (ADR-0187): the stamp is enqueued after every
 * tree write, so one drain lands stamp AND tree together — npm parity, a
 * reload right after the command cannot lose the install. Best-effort.
 *
 * The stamp and the drain are INDEPENDENTLY guarded: a stamp write failure only
 * costs the next boot's skip optimization, but the TREE must still be flushed or
 * an immediate reload loses the user's install — so the drain runs regardless of
 * the stamp's outcome (durable-on-exit does not hinge on the stamp).
 */
async function stampInstalledTree(
  deps: NpmShellCommandDeps,
  cwd: string,
  packages: number,
): Promise<void> {
  try {
    await writeInstallStamp(deps.vfs, cwd, packages, deps.projectSlug?.() ?? '');
  } catch (err) {
    console.warn(`npm: install stamp write failed: ${(err as Error).message}`);
  }
  try {
    await deps.flush?.();
  } catch (err) {
    console.warn(`npm: install flush failed: ${(err as Error).message}`);
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
