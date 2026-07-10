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
 * After a successful install the OPFS write-through is drained and CHECKED
 * (ADR-0187 Corrected): only a clean drain (no persist failures) stamps the
 * tree (ADR-0135) — FIFO order alone cannot deliver "durable stamp implies
 * durable tree" when a quota/perm failure is swallowed per-op. On a dirty
 * drain the stamp is SKIPPED and the terminal warns loudly: the install
 * works this session, the next boot re-installs instead of trusting a torn
 * tree (npm parity stays honest — a reload cannot silently lose the install).
 * The sequence runs in BACKGROUND (backlog install-stamp-background-flush):
 * install exit does not await it — real `npm install` exit does not fsync
 * node_modules either, so the durability tier (a browser-only concept) must
 * not tax the prompt. Order is intact; a later install serializes behind the
 * in-flight sequence so stamp #N always lands before install #N+1's tree
 * writes.
 */

import { NotImplementedError } from '@riftydev/io';
import {
  type EddyPrefetchHandle,
  type EddyRequestBody,
  type InstallOptions,
  type InstallResult,
  type RegistryClient,
  canonicalEddyRequestKey,
  eddyRequestFromPackageJson,
  install as realInstall,
} from '@riftydev/npm-client';
import type { CommandContext, ShellCommand } from '@riftydev/shell';
import type { PersistFailureReport, Vfs } from '@riftydev/vfs';
import {
  depsEqual,
  installStampPath,
  installTreeDir,
  isStampedTreeDamage,
  readEffectiveDeps,
  readInstallStamp,
  reportHasFailure,
  stampTrusted,
  writeDeferredTrustedStamp,
  writeInstallStamp,
} from './install-stamp.ts';

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
  /** Pre-install tree preparation (e.g. the from-scratch clean-start
   *  clear/reseed) — runs INSIDE the per-tree install phase lock, before any
   *  read or mutation of this install: a preparation that deletes/reseeds the
   *  tree outside the lock could raze it under ANOTHER terminal's in-flight
   *  exclusive install. `fullInstall` = bare `npm install` (no specs);
   *  `sessionInstallActivity` = THIS realm already ran an install on this
   *  tree (its background durability may still be in flight — a PENDING
   *  stamp seen now is ours, not a foreign/torn leftover). */
  readonly prepareInstall?: (
    ctx: CommandContext,
    info: { fullInstall: boolean; sessionInstallActivity: boolean },
  ) => Promise<void>;
  /** Executes an `npm run <script>` command in the host shell/session. */
  readonly runScript?: (name: string, command: string, ctx: CommandContext) => Promise<number>;
  /** Drains the VFS write-through — in BACKGROUND, after the command returned
   *  (npm parity: real `npm install` exit does not fsync node_modules; a
   *  reload before the drain settles only costs a re-install, never a torn
   *  stamped tree). Returns the drain's persist-failure report (ADR-0187
   *  Corrected) — a dirty report gates the install stamp (never stamp a tree
   *  OPFS failed to hold); `undefined` means "no durability tier" (memory
   *  backend) and reads as clean. */
  readonly flush?: () => Promise<PersistFailureReport | undefined>;
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
   *  is a cacheable GET. A STALE lookup (SWR window, backlog
   *  eddy-stale-pin-revalidate) is still served but obligates the `as-of`
   *  honesty line + one background `revalidate` — and SKIPS the immediate
   *  write-back (refreshing `savedAt` without consulting the server would
   *  self-renew the pin past its hard 24h bound forever). Inert without
   *  `resolverUrl`. */
  readonly learnedPins?: {
    get(requestKey: string): Promise<LearnedPinLookup | undefined>;
    /** Persist a pin. `expectedCurrent` = the pin observed at install START
     *  (`null` = none) — the store writes compare-and-set against it, so a
     *  slower install adopting an OLDER resolution cannot roll back a newer
     *  pin written while it ran (the revalidate-CAS sibling). */
    set(requestKey: string, closureHash: string, expectedCurrent?: string | null): Promise<void>;
    /** Background revalidate of a STALE pin that was just served: POST the
     *  same canonical request, compare closure hashes, refresh/replace the
     *  pin. Rejection = one async terminal warning; the pin stays untouched
     *  and the next stale install retries. */
    revalidate(
      requestKey: string,
      request: EddyRequestBody,
      servedClosureHash: string,
    ): Promise<void>;
  };
}

/** One learned-pin lookup: `stale` = past the fresh TTL but inside the hard
 *  stale bound (see `eddy-learned-pins.ts`); structural on purpose — the seam
 *  stays stubbable without importing the pin store. */
export interface LearnedPinLookup {
  readonly closureHash: string;
  readonly stale: boolean;
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

/** Classify a leading-`-` install flag: which dep map it targets (or global),
 *  or the freshness escape hatch. */
function installFlagKind(flag: string): 'dev' | 'prod' | 'global' | 'prefer-online' | 'unknown' {
  if (flag === '-D' || flag === '--save-dev') return 'dev';
  if (flag === '-S' || flag === '--save' || flag === '-E' || flag === '--save-exact') return 'prod';
  if (flag === '-g' || flag === '--global') return 'global';
  // The stale-window escape hatch (ADR-0216): forces a fresh server-side
  // recompute AND bypasses pins/prefetch client-side (installer semantics).
  if (flag === '--prefer-online') return 'prefer-online';
  return 'unknown';
}

/**
 * Per-TREE install coordination state. A TREE is (vfs, cwd) — the same path
 * string on two different VFS instances is two unrelated trees (two projects,
 * two test harnesses) and must never share a mutex or a generation, or
 * genuinely concurrent installs silently serialize (false sharing). Within one
 * VFS the state is cross-terminal by design (two terminals, one tree).
 *
 * - `generation`: each install bumps it at mutation start; a background
 *   durability sequence may write its TRUSTED stamp only while its generation
 *   is still current — a newer install cancels the older sequence's stamp
 *   instead of racing it (same stale-promoter guard as the boot path's
 *   `promotionId`, ADR-0187). Deliberately NOT an await-chain: waiting on the
 *   previous drain would park the next install forever behind a wedged
 *   durability layer (unbounded-wait class).
 * - `phase`: foreground-phase mutex — pending-demote → installFn's tree writes
 *   → background scheduling — of two terminals must not interleave on one
 *   tree. Only the foreground phase is chained (visible, user-interruptible
 *   work); the background drain is NOT (see `generation`).
 * - `stampWrites`: ALL stamp writes for this tree (pending demote, deferred
 *   trusted) serialize here, so chain order — not wall-clock luck — decides
 *   the final stamp; the deferred trusted write re-checks the generation
 *   SYNCHRONOUSLY inside its slot, closing the check→write TOCTOU (an older
 *   sequence can never overwrite a newer install's pending stamp). Tasks are
 *   bounded VFS writes ONLY — never a drain (a wedged flush must not park
 *   later installs or stamp writes).
 */
interface TreeInstallState {
  generation: number;
  phase: Promise<void>;
  stampWrites: Promise<void>;
}

const installStates = new WeakMap<Vfs, Map<string, TreeInstallState>>();

function installStateFor(vfs: Vfs, cwd: string): TreeInstallState {
  let byCwd = installStates.get(vfs);
  if (!byCwd) {
    byCwd = new Map();
    installStates.set(vfs, byCwd);
  }
  let state = byCwd.get(cwd);
  if (!state) {
    state = { generation: 0, phase: Promise.resolve(), stampWrites: Promise.resolve() };
    byCwd.set(cwd, state);
  }
  return state;
}

/** Enqueue one bounded stamp write on the tree's chain (see
 * `TreeInstallState.stampWrites`). Rejections propagate to the caller; the
 * chain itself never wedges on them. */
function chainStampWrite<T>(state: TreeInstallState, task: () => Promise<T>): Promise<T> {
  const run = state.stampWrites.then(task);
  state.stampWrites = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function runInstall(
  specs: string[],
  ctx: CommandContext,
  deps: NpmShellCommandDeps,
): Promise<number> {
  const state = installStateFor(deps.vfs, ctx.cwd);
  const run = state.phase.then(() => runInstallExclusive(specs, ctx, deps));
  state.phase = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function runInstallExclusive(
  specs: string[],
  ctx: CommandContext,
  deps: NpmShellCommandDeps,
): Promise<number> {
  // Partition argv into save-flags vs package specs; the flags pick the target
  // dep map. `-g` is a directed loud throw (no global store in the sandbox).
  let target: 'dependencies' | 'devDependencies' = 'dependencies';
  let prefer: 'online' | undefined;
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
      else if (kind === 'prefer-online') prefer = 'online';
      else if (kind === 'unknown') {
        ctx.stderr.write(`npm: flag '${spec}' not supported (M9 scope)\n`);
        return 1;
      }
      // `prod` (-S/--save default, -E/--save-exact) is otherwise a no-op.
      continue;
    }
    pkgSpecs.push(spec);
  }

  // Tree preparation INSIDE the phase lock, before this install reads
  // anything: a clear/reseed running outside the lock could raze the tree
  // under another terminal's in-flight exclusive install (see the seam doc).
  if (deps.prepareInstall) {
    await deps.prepareInstall(ctx, {
      fullInstall: pkgSpecs.length === 0,
      sessionInstallActivity: installStateFor(deps.vfs, ctx.cwd).generation > 0,
    });
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

  // Claim the tree: any in-flight background sequence of an OLDER install
  // loses its right to write a trusted stamp the moment this generation is
  // bumped (see TreeInstallState).
  const state = installStateFor(deps.vfs, ctx.cwd);
  state.generation += 1;
  const generation = state.generation;

  // The INSTALL-TIME project identity: sampled at mutation start, never after
  // installFn — a preset switch during the install must not re-key this
  // install's stamp under the NEW slug (two presets can share a dep set; the
  // slug is exactly what keeps them from reusing each other's tree).
  const stampSlug = deps.projectSlug?.() ?? '';

  // Demote any TRUSTED stamp to PENDING before the first tree mutation —
  // the boot path's pending-first pattern (ADR-0187) applied to the command
  // site: a reload during this install (or its background drain) must find
  // an untrusted marker and re-arrive, never trust a half-replaced tree. A
  // failed install leaves it pending (self-heal: the tree may be part-
  // mutated, the old stamp must not resurrect). Demote deps fall back to the
  // prior stamp's own snapshot: a trusted stamp must never survive un-demoted
  // just because package.json is missing (the silent no-op would also make
  // the durability proof below pass vacuously). On the stamp chain: the
  // demote must land AFTER any in-flight older sequence's trusted write,
  // never under it.
  const priorStamp = await readInstallStamp(deps.vfs, ctx.cwd);
  const demoteDeps: Record<string, string> | undefined =
    (await readEffectiveDeps(deps.vfs, ctx.cwd)) ??
    (priorStamp ? { ...priorStamp.deps } : undefined);
  if (demoteDeps) {
    await chainStampWrite(state, () =>
      writeInstallStamp(deps.vfs, ctx.cwd, 0, stampSlug, 'pending', undefined, demoteDeps),
    );
  }
  // A demote that revokes a TRUSTED stamp must be PROVEN durable before the
  // first tree write (r17 class: a revocation that never reached disk is a
  // lie) — else OPFS keeps the old trusted stamp while the tree mutates, and
  // a reload after a torn mutation trusts it. The proof costs one drain, paid
  // ONLY here (fresh/pending trees have nothing to revoke; the queue is
  // normally idle after boot). Fallback ladder: demote persisted → proceed;
  // failed → durable RM of the stamp; even that failing → ABORT before any
  // mutation (tree intact, attestation still true — the only honest state
  // left). On abort the MIRROR stamp is restored to the trusted original:
  // OPFS still holds it, and a retry must see a trusted prior stamp so it
  // re-runs this proof instead of skipping it (mirror/durable split).
  if (priorStamp && stampTrusted(priorStamp) && deps.flush) {
    const stampPath = installStampPath(ctx.cwd);
    const failedToPersist = (report: PersistFailureReport | undefined): boolean =>
      report !== undefined && reportHasFailure(report, (p) => p === stampPath);
    const abortRestoringMirror = async (message: string): Promise<1> => {
      await chainStampWrite(state, () =>
        writeDeferredTrustedStamp(deps.vfs, ctx.cwd, priorStamp.packages, priorStamp.slug, {
          ...priorStamp.deps,
        }),
      ).catch(() => {
        // Even the in-memory restore failed — the retry then reads an
        // untrusted (pending/absent) stamp and self-heals at boot; the abort
        // itself is already loud.
      });
      ctx.stderr.write(message);
      return 1;
    };
    try {
      if (failedToPersist(await deps.flush())) {
        await chainStampWrite(state, () => deps.vfs.rm(stampPath, { force: true }));
        if (failedToPersist(await deps.flush())) {
          return abortRestoringMirror(
            'npm: install aborted: the previous install stamp could not be demoted or removed durably — installing now could let a reload trust a torn tree; check browser storage (quota) and retry\n',
          );
        }
      }
    } catch (err) {
      return abortRestoringMirror(
        `npm: install aborted: durability check failed (${(err as Error).message}) — cannot prove the previous install stamp was demoted\n`,
      );
    }
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
  const prefetchCandidate = deps.resolverUrl ? deps.resolverPrefetch?.() : undefined;
  // Pin selection (ADR-0194). requestKey is the EXACT post-merge dep set —
  // computed AFTER the package.json write above, so `npm i kleur` keys {…+kleur},
  // not the stale file. A learned pin, keyed on that exact request, is the CORRECT
  // closure for this set, so it WINS over the coarse template env pin
  // (`VITE_RIFTY_EDDY_PINS`) — the env pin only matches the pristine preset; after
  // `npm install <pkg>` it no longer describes the request (it would just cost a
  // coverage-cancelled GET before POST). Env pin stays the fallback that seeds the
  // FIRST install of a set (no learned pin yet). This keeps the ADR-0194 promise:
  // a repeat of the same dep set — modified or not — rides a cacheable learned GET.
  const eddyRequest = deps.resolverUrl ? await installEddyRequest(deps.vfs, packageJsonPath) : null;
  const learnedPin =
    eddyRequest && deps.learnedPins
      ? await deps.learnedPins.get(eddyRequest.key).catch(() => undefined)
      : undefined;
  const resolverClosureHash = learnedPin?.closureHash ?? envPin;
  // A PINNED boot prefetch (handle carries a closureHash) is forwarded only
  // while that hash IS the current pin decision: the handle was primed at
  // boot, and a pin expired past 24h or replaced since must not ride in via
  // the buffered GET — it would serve the dropped closure with no as-of line
  // and no revalidate, silently past the stale bound. An UNPINNED prefetch
  // (no hash — a boot POST resolve) is a fresh server answer and passes.
  const resolverPrefetch =
    prefetchCandidate?.closureHash !== undefined &&
    prefetchCandidate.closureHash !== resolverClosureHash
      ? undefined
      : prefetchCandidate;
  try {
    const result = await installFn({
      vfs: deps.vfs,
      cwd: ctx.cwd,
      registry: deps.registry,
      ...(deps.resolverUrl ? { resolverUrl: deps.resolverUrl } : {}),
      ...(prefer ? { prefer } : {}),
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

    // Background (ADR-0216): the drain → gate → stamp → stamp-drain sequence
    // runs unchanged but the command does NOT await it — the prompt returns
    // (a `&&`-chained dev server starts) while OPFS durability settles behind
    // it. Dirty-drain/stamp warnings arrive asynchronously (accepted: honesty
    // stays loud, latency does not pay for it). The deferred stamp attests
    // the request maps THIS install was fed (the same merge
    // `readEffectiveDeps` computes) — never a re-read: a package.json edit
    // DURING the install or the drain, or a preset switch, must not leak into
    // a trusted stamp.
    const stampDeps: Record<string, string> = {
      ...dependencies,
      ...devDependencies,
      ...pkg.optionalDependencies,
    };
    void stampInstalledTree(
      deps,
      ctx,
      ctx.cwd,
      result.packages.length,
      stampDeps,
      stampSlug,
      generation,
    ).catch((err) => {
      // stampInstalledTree reports every expected failure itself; this guard
      // only keeps an unexpected reject from surfacing unhandled — still
      // loud, never silent.
      console.warn(`npm: install durability sequence failed: ${(err as Error).message}`);
    });
    // A STALE pin actually served this install (SWR): the tree came from a
    // ≤24h-old cached resolution — say so loudly (`as-of` = the SERVED
    // manifest's resolvedAt, never the pin file's age) and refresh in
    // background via ONE manifest-only POST. The ordinary write-back is
    // SKIPPED here: rewriting savedAt on serve would self-renew the pin past
    // the 24h bound without ever consulting the server.
    const stalePinServed =
      learnedPin?.stale === true &&
      result.source === 'eddy' &&
      // 'prefetch'/'get' = a CACHE serve of the pinned closure; a POST that
      // recomputed the same hash is a FRESH resolution (no line, ordinary
      // re-learn) — hash equality alone cannot tell them apart.
      result.resolvedVia !== 'post' &&
      result.closureHash === learnedPin.closureHash;
    if (stalePinServed && eddyRequest && deps.learnedPins) {
      const { learnedPins } = deps;
      const servedHash = learnedPin.closureHash;
      ctx.stdout.write(
        `npm: eddy cached resolution (as-of ${result.resolvedAt ?? 'unknown'}), refreshing in background\n`,
      );
      void Promise.resolve()
        .then(() => learnedPins.revalidate(eddyRequest.key, eddyRequest.body, servedHash))
        .catch((err) => {
          // Async by design (the prompt already returned); the pin is
          // untouched — the next stale install retries the refresh.
          ctx.stderr.write(
            `npm: WARNING: eddy pin refresh failed (${(err as Error).message}) — retrying on the next install\n`,
          );
        });
    } else if (
      result.source === 'eddy' &&
      // Only a POST re-vouches the resolution's age: writing savedAt on a
      // GET/prefetch cache serve would let repeat installs self-renew a pin
      // forever with zero server contact, voiding the 24h stale bound.
      result.resolvedVia === 'post' &&
      result.closureHash &&
      eddyRequest &&
      deps.learnedPins
    ) {
      // Fire-and-forget write-back: the pin is an optimization, never worth
      // blocking or failing the install line over. CAS baseline = the pin
      // this install READ at its start (null = absent): if the entry moved
      // meanwhile, a newer install already re-learned it — skip, never roll
      // it back.
      const { learnedPins } = deps;
      const closureHash = result.closureHash;
      void Promise.resolve()
        .then(() => learnedPins.set(eddyRequest.key, closureHash, learnedPin?.closureHash ?? null))
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
 * The canonical eddy request (body + key) for the package.json ON DISK
 * (post-merge). `null` when the file is missing or a shape the installer would
 * reject — then no pin can be looked up, learned, or revalidated (the install
 * itself surfaces any loud error).
 */
async function installEddyRequest(
  vfs: Vfs,
  packageJsonPath: string,
): Promise<{ key: string; body: EddyRequestBody } | null> {
  if (!(await vfs.exists(packageJsonPath))) return null;
  let text: string;
  try {
    text = await vfs.readFileText(packageJsonPath);
  } catch {
    return null;
  }
  const body = eddyRequestFromPackageJson(text);
  return body ? { key: canonicalEddyRequestKey(body), body } : null;
}

/** One terminal-readable line for a dirty drain: first failure + count. */
function persistFailureLine(report: PersistFailureReport): string {
  const first = report.failures[0];
  const sample = first ? ` (first: ${first.op} ${first.path}: ${first.message})` : '';
  return `${report.total} file(s) failed to persist to OPFS${sample}`;
}

/**
 * Drain the write-through, GATE, stamp, drain the stamp (ADR-0187 Corrected).
 * FIFO order still lands the stamp after the tree, but order alone cannot
 * survive a swallowed per-op quota/perm failure — a stamped-but-torn tree
 * would be TRUSTED by the next boot's `installStampSatisfied`. So the tree
 * drain is checked FIRST and a dirty report skips the stamp (self-heal: no
 * stamp → the next boot re-installs) with a loud terminal warning. Runs in
 * BACKGROUND, un-awaited by the install command (install exit does not fsync,
 * npm parity); warnings surface on the terminal after the prompt returned. A
 * tab killed mid-sequence leaves no stamp — the next boot re-installs, never
 * trusts a torn tree.
 *
 * The stamp stays best-effort: its own write/drain failure only costs the
 * next boot's skip optimization — the TREE is already proven durable.
 */
async function stampInstalledTree(
  deps: NpmShellCommandDeps,
  ctx: CommandContext,
  cwd: string,
  packages: number,
  stampDeps: Record<string, string>,
  stampSlug: string,
  generation: number,
): Promise<void> {
  const notDurable = (cause: string): void => {
    ctx.stderr.write(
      `npm: WARNING: ${cause} — the install works in this session but is NOT durable; skipping the install stamp (the next boot re-installs)\n`,
    );
  };
  let treeReport: PersistFailureReport | undefined;
  try {
    treeReport = await deps.flush?.();
  } catch (err) {
    notDurable(`install flush failed: ${(err as Error).message}`);
    return;
  }
  if (treeReport && treeReport.total > 0) {
    // Only failures INSIDE the stamped tree (`<cwd>/node_modules`, minus the
    // stamp file — which is about to be rewritten, healing it) gate the stamp.
    // A global/foreign path (`/.rifty/eddy-learned-pins.json`, another project)
    // failing to persist is not THIS tree torn and must not skip a good stamp
    // (`isStampedTreeDamage`). Ask the FULL ledger (`reportHasFailure`), not the
    // 20-entry sample: foreign failures could fill the sample while tree damage
    // sits beyond it. Report the full OPFS count with a tree example (from the
    // sample when present) as the trigger.
    if (reportHasFailure(treeReport, (p) => isStampedTreeDamage(p, cwd))) {
      const example = treeReport.failures.find((f) => isStampedTreeDamage(f.path, cwd));
      notDurable(
        persistFailureLine({ failures: example ? [example] : [], total: treeReport.total }),
      );
      return;
    }
  }
  // A NEWER install claimed this tree while the drain ran: its pending stamp
  // is already down and only ITS sequence may promote — writing this stale
  // trusted stamp would attest a tree the newer install is replacing. Not a
  // failure (the newer install owns stamping now), so no warning. (Cheap
  // early-exit; the LOAD-BEARING check is the sync re-check inside the chain
  // slot below.)
  const state = installStateFor(deps.vfs, cwd);
  if (state.generation !== generation) return;
  // The stamp writes the INSTALL-TIME snapshot, but only when package.json
  // provably did not move since (the boot promoter's contract): the real
  // installer re-reads package.json AFTER the eddy pin window, so a
  // mid-install edit can put deps in the tree the snapshot never named — a
  // trusted stamp for either set would be a provenance lie. Moved → loud
  // skip, self-heal (the next boot re-installs). Checked AFTER the
  // generation guard: a newer install legitimately rewrote package.json and
  // owns stamping — that is not an edit, no warning.
  const currentDeps = await readEffectiveDeps(deps.vfs, cwd);
  if (!currentDeps || !depsEqual(currentDeps, stampDeps)) {
    ctx.stderr.write(
      'npm: WARNING: package.json changed during the install — install stamp skipped; the next boot re-installs\n',
    );
    return;
  }
  // The tree itself vanished while the drain ran (`npm install && rm -rf
  // node_modules`): the deferred writer must not resurrect a trusted stamp
  // into an empty dir. The user deleted it; no stamp is the honest state. A
  // deletion completing AFTER this read is caught by the write itself — the
  // no-mkdir writer fails ENOENT on the vanished parent (loud, below).
  if (!(await deps.vfs.exists(installTreeDir(cwd)))) return;
  try {
    const written = await chainStampWrite(state, async () => {
      // Re-checked SYNCHRONOUSLY in the chain slot — no await between this
      // read and the write dispatch. A newer install bumps the generation
      // BEFORE enqueueing its pending demote on this same chain, so passing
      // here proves that demote (if any) lands AFTER this write, never under
      // it.
      if (state.generation !== generation) return false;
      await writeDeferredTrustedStamp(deps.vfs, cwd, packages, stampSlug, stampDeps);
      return true;
    });
    if (!written) return;
  } catch (err) {
    // Terminal, not console: the user's reload behavior changes (next boot
    // re-installs) — that must be visible where the install ran.
    ctx.stderr.write(
      `npm: WARNING: install stamp write failed (${(err as Error).message}) — the next boot re-installs\n`,
    );
    return;
  }
  try {
    const stampReport = await deps.flush?.();
    // Scope to the STAMP FILE via the FULL ledger: foreign/global failures can
    // fill the sample while the stamp's own failure sits beyond it.
    if (stampReport && reportHasFailure(stampReport, (p) => p === installStampPath(cwd))) {
      ctx.stderr.write(
        'npm: WARNING: the install stamp failed to persist — the next boot re-installs\n',
      );
    }
  } catch (err) {
    ctx.stderr.write(
      `npm: WARNING: install stamp flush failed (${(err as Error).message}) — the next boot may re-install\n`,
    );
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
