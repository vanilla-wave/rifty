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
 * The durability sequence stays background to the terminal result: real
 * `npm install` exit does not fsync node_modules. The package authority keeps
 * the affected-root admission until promotion/readiness settles, so another
 * overlapping mutation or child cannot observe the pending tree.
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
import {
  type ShadowAssetPlan,
  planAppliedShadowSubstitutions,
} from '@riftydev/npm-client/internal';
import {
  type CommandContext,
  type ShellCommand,
  type ShellCommandResult,
  shellCommandExitCode,
} from '@riftydev/shell';
import { type PersistFailureReport, type Vfs, normalizePath } from '@riftydev/vfs';
import {
  type PackageAcquisitionAuthority,
  PackageAcquisitionError,
  type PackageInstallExecution,
} from '../workers/package-acquisition-authority.ts';
import { installArtifactIdentity } from './install-artifact-identity.ts';
import {
  InstallStampAuthorityError,
  type InstallStampPromotionResult,
} from './install-stamp-authority.ts';
import { isStampedTreeDamage } from './install-stamp.ts';

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
  /** Host-owned all-target namespace preflight, before the installer links bytes. */
  readonly assertPortablePaths?: InstallOptions['assertPortablePaths'];
  /** Translate a fully parsed terminal invocation into the owner's storage namespace. */
  readonly mapInvocationContext?: (context: CommandContext) => CommandContext;
  /** Reflect one exact invocation's generated Starter Git baseline outcome. */
  readonly observeGeneratedBaseline?: (clean: boolean) => void;
  /** Pre-install tree preparation (e.g. the from-scratch clean-start
   *  clear/reseed) — runs INSIDE the owner acquisition FIFO, before any
   *  read or mutation of this install: a preparation that deletes/reseeds the
   *  tree outside the FIFO could raze it under ANOTHER terminal's in-flight
   *  exclusive install. `fullInstall` = bare `npm install` (no specs);
   *  `sessionInstallActivity` = THIS realm already ran an install on this
   *  tree (its owner-held background durability may still be in flight — a PENDING
   *  stamp seen now is ours, not a foreign/torn leftover). */
  readonly prepareInstall?: (
    ctx: CommandContext,
    info: {
      readonly fullInstall: boolean;
      readonly sessionInstallActivity: boolean;
      readonly priorSessionSlug?: string;
      readonly priorTrustedTree: boolean;
      readonly priorSlug?: string;
    },
  ) => Promise<void>;
  /** Prune a prior tree for an exact empty manifest, inside the acquisition FIFO.
   * The real installer then materializes the canonical empty lock/tree shape. */
  readonly prepareEmptyInstall?: (ctx: CommandContext) => Promise<void>;
  /** Executes an `npm run <script>` command in the host shell/session. */
  readonly runScript?: (
    name: string,
    command: string,
    ctx: CommandContext,
  ) => Promise<ShellCommandResult>;
  /** Drains the VFS write-through during authority-owned background settlement
   *  (npm parity: real `npm install` exit does not fsync node_modules; a
   *  reload before the drain settles only costs a re-install, never a torn
   *  stamped tree). Returns the drain's persist-failure report (ADR-0187
   *  Corrected) — a dirty report gates the install stamp (never stamp a tree
   *  OPFS failed to hold); `undefined` means "no durability tier" (memory
   *  backend) and reads as clean. */
  readonly flush?: () => Promise<PersistFailureReport | undefined>;
  /** Single owner-realm package mutation authority shared with boot/restore. */
  readonly packageAcquisitionAuthority: PackageAcquisitionAuthority;
  /** Root-aware project slug the install stamp is keyed on so the
   *  next boot's `installStampSatisfied(slug)` REUSES this tree instead of
   *  re-running its dependency arrival (which replaces node_modules, dropping the
   *  user install). The active preset can change; arbitrary cwd roots require a
   *  deterministic root-local identity. Defaults to the canonical cwd. */
  readonly projectSlug?: (root: string) => string;
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

type NpmInstallOperationDeps = Omit<NpmShellCommandDeps, 'packageAcquisitionAuthority'>;

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

function npmPrefixInvocation(
  args: readonly string[],
  context: CommandContext,
): {
  readonly args: readonly string[];
  readonly context: CommandContext;
  readonly explicitPrefix: boolean;
} | null {
  const first = args[0];
  if (first !== '--prefix' && !first?.startsWith('--prefix=')) {
    return { args, context, explicitPrefix: false };
  }
  const inline = first.startsWith('--prefix=');
  const prefix = inline ? first.slice('--prefix='.length) : args[1];
  if (prefix === undefined || prefix.length === 0 || prefix.includes('\0')) {
    context.stderr.write('npm: --prefix requires a non-empty path\n');
    return null;
  }
  const cwd = normalizePath(prefix.startsWith('/') ? prefix : `${context.cwd}/${prefix}`);
  return {
    args: args.slice(inline ? 1 : 2),
    context: { ...context, cwd },
    explicitPrefix: true,
  };
}

async function nearestNpmPrefix(vfs: Vfs, cwd: string): Promise<string> {
  const original = normalizePath(cwd);
  let nearest: string | null = null;
  let candidate = original;
  for (;;) {
    const base = candidate === '/' ? '' : candidate;
    const hasPackageJson = await npmPrefixMarker(vfs, `${base}/package.json`, 'file');
    if (hasPackageJson) await rejectNpmWorkspacesAt(vfs, candidate);
    if (
      nearest === null &&
      (hasPackageJson || (await npmPrefixMarker(vfs, `${base}/node_modules`, 'directory')))
    ) {
      nearest = candidate;
    }
    if (candidate === '/') return nearest ?? original;
    const separator = candidate.lastIndexOf('/');
    candidate = separator <= 0 ? '/' : candidate.slice(0, separator);
  }
}

async function rejectNpmWorkspacesAt(vfs: Vfs, root: string): Promise<void> {
  const base = root === '/' ? '' : root;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await vfs.readFileText(`${base}/package.json`)) as unknown;
  } catch {
    // npm ignores an unreadable/non-normalizable package.json during prefix discovery.
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
  const workspaces = (parsed as Record<string, unknown>).workspaces;
  if (!workspaces) return;

  assertNpmWorkspaceDeclaration(workspaces);
  throw new NotImplementedError(
    'npm.workspaces',
    'workspace-aware manifest, lockfile, and lifecycle routing is not implemented',
  );
}

function assertNpmWorkspaceDeclaration(workspaces: unknown): void {
  const declaration =
    workspaces !== null &&
    typeof workspaces === 'object' &&
    !Array.isArray(workspaces) &&
    Array.isArray((workspaces as Record<string, unknown>).packages)
      ? (workspaces as { readonly packages: readonly unknown[] }).packages
      : workspaces;
  if (!Array.isArray(declaration) || declaration.some((pattern) => typeof pattern !== 'string')) {
    throw Object.assign(new TypeError('EWORKSPACESCONFIG: workspaces config expects an Array'), {
      code: 'EWORKSPACESCONFIG' as const,
    });
  }
}

async function npmPrefixMarker(
  vfs: Vfs,
  path: string,
  kind: 'file' | 'directory',
): Promise<boolean> {
  try {
    const stat = await vfs.stat(path);
    return kind === 'file' ? stat.isFile : stat.isDirectory;
  } catch {
    // npm 11.17 treats every marker stat failure as a miss and keeps walking.
    return false;
  }
}

/**
 * Build the `npm` shell command. The composition root (`App.tsx`) registers it
 * on a `ShellSession`; this factory stays Solid-free so unit tests can exercise
 * it with a plain `Shell` instance.
 */
export function createNpmShellCommand(deps: NpmShellCommandDeps): ShellCommand {
  const packages = deps.packageAcquisitionAuthority;
  return async (rawArgs, rawContext) => {
    const invocation = npmPrefixInvocation(rawArgs, rawContext);
    if (invocation === null) return 1;
    const { args } = invocation;
    const mapped = deps.mapInvocationContext?.(invocation.context) ?? invocation.context;
    if (invocation.explicitPrefix) await rejectNpmWorkspacesAt(deps.vfs, mapped.cwd);
    const ctx = invocation.explicitPrefix
      ? mapped
      : { ...mapped, cwd: await nearestNpmPrefix(deps.vfs, mapped.cwd) };
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
      return runInstall(args.slice(1), ctx, deps, packages, deps.observeGeneratedBaseline);
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
): Promise<ShellCommandResult> {
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
  let result: ShellCommandResult = 0;
  for (const [name, scriptCommand] of scriptSteps) {
    ctx.stdout.write(`> ${scriptCommand}\n`);
    result = await deps.runScript(name, scriptCommand, ctx);
    if (shellCommandExitCode(result) !== 0) return result;
  }
  return result;
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

export interface ParsedNpmInstallRequest {
  readonly target: 'dependencies' | 'devDependencies';
  readonly prefer?: 'online';
  readonly packageSpecs: readonly string[];
}

export type ParsedNpmInstallResult =
  | { readonly status: 'ready'; readonly request: ParsedNpmInstallRequest }
  | { readonly status: 'rejected'; readonly message: string };

export function parseNpmInstallRequest(specs: readonly string[]): ParsedNpmInstallResult {
  let target: 'dependencies' | 'devDependencies' = 'dependencies';
  let prefer: 'online' | undefined;
  const pkgSpecs: string[] = [];
  for (const spec of specs) {
    if (spec.startsWith('-')) {
      const kind = installFlagKind(spec);
      if (kind === 'global') {
        return {
          status: 'rejected',
          message:
            "npm: global installs aren't supported in the browser sandbox — install into the project instead\n",
        };
      }
      if (kind === 'dev') target = 'devDependencies';
      else if (kind === 'prefer-online') prefer = 'online';
      else if (kind === 'unknown') {
        return {
          status: 'rejected',
          message: `npm: flag '${spec}' not supported (M9 scope)\n`,
        };
      }
      // `prod` (-S/--save default, -E/--save-exact) is otherwise a no-op.
      continue;
    }
    pkgSpecs.push(spec);
  }
  return {
    status: 'ready',
    request: {
      target,
      ...(prefer ? { prefer } : {}),
      packageSpecs: pkgSpecs,
    },
  };
}

async function runInstall(
  specs: string[],
  ctx: CommandContext,
  deps: NpmShellCommandDeps,
  packages: PackageAcquisitionAuthority,
  onGeneratedBaseline?: (clean: boolean) => void,
): Promise<number> {
  const parsed = parseNpmInstallRequest(specs);
  if (parsed.status === 'rejected') {
    ctx.stderr.write(parsed.message);
    return 1;
  }

  const root = normalizePath(ctx.cwd);
  try {
    await packages.dispatch({
      type: 'terminal-install',
      project: () => {
        const slug = deps.projectSlug?.(root) ?? root;
        return {
          projectId: slug,
          root,
          slug,
          identity: installArtifactIdentity,
        };
      },
      argv: specs,
      context: ctx,
      ...(onGeneratedBaseline === undefined ? {} : { onGeneratedBaseline }),
      onPromotion: (result) => reportInstallStampPromotion(ctx, result),
    });
    return 0;
  } catch (error) {
    if (error instanceof PackageAcquisitionError && error.failure === 'claim') {
      const cause = error.cause;
      const detail =
        cause instanceof InstallStampAuthorityError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : String(cause);
      ctx.stderr.write(
        `npm: install aborted: ${detail} — cannot prove the previous install stamp was demoted; check browser storage (quota) and retry\n`,
      );
      return 1;
    }
    return reportInstallError(error instanceof PackageAcquisitionError ? error.cause : error, ctx);
  }
}

/** The only npm tree-mutation path. The package authority owns FIFO order,
 * demotion, session activity, and promotion; this operation owns npm behavior. */
export async function executeNpmInstallOperation(
  request: ParsedNpmInstallRequest,
  ctx: CommandContext,
  deps: NpmInstallOperationDeps,
  execution: PackageInstallExecution,
): Promise<
  | {
      readonly status: 'noop';
      readonly packageJsonText: string | null;
      readonly shadowPlan: ShadowAssetPlan;
    }
  | {
      readonly result: InstallResult;
      readonly packageJsonText: string | null;
    }
> {
  const { target, prefer, packageSpecs: pkgSpecs } = request;
  if (ctx.signal?.aborted) throw ctx.signal.reason;

  // Tree preparation INSIDE the authority queue and AFTER the demote+proof: a
  // preparation that clears the tree (from-scratch clean-start) must not run
  // while OPFS could still hold a TRUSTED stamp — a clear whose rm never
  // persisted would erase the MIRROR copy while the durable one survived,
  // and the following install would skip the revocation proof. Before the
  // lock it could also raze the tree under another terminal's in-flight
  // exclusive install (see the seam doc).
  if (deps.prepareInstall) {
    await deps.prepareInstall(ctx, {
      fullInstall: pkgSpecs.length === 0,
      sessionInstallActivity: execution.sessionInstallActivity,
      ...(execution.priorSessionSlug !== undefined
        ? { priorSessionSlug: execution.priorSessionSlug }
        : {}),
      priorTrustedTree: execution.priorTrustedTree,
      ...(execution.priorSlug ? { priorSlug: execution.priorSlug } : {}),
    });
  }

  const pkg = await readPackageJson(deps.vfs, ctx.cwd);
  const packageJsonPath = `${ctx.cwd}/package.json`;
  const hadPackageJson = await deps.vfs.exists(packageJsonPath);
  const previousPackageJson = hadPackageJson ? await deps.vfs.readFile(packageJsonPath) : null;
  const dependencies = { ...pkg.dependencies };
  const devDependencies = { ...pkg.devDependencies };
  const targetMap = target === 'devDependencies' ? devDependencies : dependencies;

  for (const spec of pkgSpecs) {
    const { name, range } = parseSpec(spec);
    if (!name) {
      throw new Error(`malformed package spec '${spec}'`);
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
    const packageJsonText = hadPackageJson ? await deps.vfs.readFileText(packageJsonPath) : null;
    if (packageJsonText === null) {
      ctx.stdout.write('npm: no dependencies to install\n');
      return {
        status: 'noop',
        packageJsonText,
        shadowPlan: planAppliedShadowSubstitutions([]),
      };
    }
    await deps.prepareEmptyInstall?.(ctx);
  }

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

  // The BYTE-EXACT identity of the request this install is fed — the stamp
  // guard compares text, never the flattened dep map: a section move
  // (dependencies↔devDependencies) or an `overrides` edit changes the real
  // installer request while the flat map stays identical.
  const packageJsonTextAtInstall = (await deps.vfs.exists(packageJsonPath))
    ? await deps.vfs.readFileText(packageJsonPath)
    : null;

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
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
      ...(deps.assertPortablePaths ? { assertPortablePaths: deps.assertPortablePaths } : {}),
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

    if (ctx.signal?.aborted) throw ctx.signal.reason;
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
    return { result, packageJsonText: packageJsonTextAtInstall };
  } catch (err) {
    if (pkgSpecs.length > 0) {
      if (previousPackageJson) {
        await deps.vfs.writeFile(packageJsonPath, previousPackageJson);
      } else {
        await deps.vfs.rm(packageJsonPath, { force: true });
      }
    }
    throw err;
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

/** Translate the authority's structured durability verdict onto the terminal.
 * The authority owns drain gates, epochs, identity, and every stamp write. */
function reportInstallStampPromotion(
  ctx: CommandContext,
  result: InstallStampPromotionResult,
): void {
  const notDurable = (cause: string): void => {
    ctx.stderr.write(
      `npm: WARNING: ${cause} — the install works in this session but is NOT durable; skipping the install stamp (the next boot re-installs)\n`,
    );
  };
  if (result.status === 'trusted' || result.status === 'stale') return;
  switch (result.reason) {
    case 'guarded-scope-not-durable': {
      const report = result.report;
      if (!report) {
        notDurable('node_modules failed to persist');
        return;
      }
      const example = report.failures.find((failure) => isStampedTreeDamage(failure.path, ctx.cwd));
      notDurable(persistFailureLine({ failures: example ? [example] : [], total: report.total }));
      return;
    }
    case 'claim-not-durable':
      ctx.stderr.write(
        'npm: WARNING: the install stamp failed to persist — the next boot re-installs\n',
      );
      return;
    case 'identity-drift':
      ctx.stderr.write(
        'npm: WARNING: package.json changed during the install — install stamp skipped; the next boot re-installs\n',
      );
      return;
    case 'tree-missing':
      return;
    case 'claim-replaced':
    case 'write-failed':
      ctx.stderr.write(
        `npm: WARNING: install stamp write failed (${result.error ?? result.reason}) — the next boot re-installs\n`,
      );
      return;
    case 'flush-failed':
      notDurable(`install flush failed: ${result.error ?? 'unknown durability error'}`);
      return;
    case 'revocation-not-durable':
      ctx.stderr.write(
        'npm: WARNING: trusted install stamp revocation failed after durability damage — browser storage must recover before reload\n',
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
