/**
 * `git checkout` — branch-switch + file-restore over the {@link makeGit} facade,
 * byte-exact to real git 2.50.1. Split out of `git.ts` (the package's `_`-prefixed
 * helper-module convention) since checkout is the largest sub-feature. ALL messages
 * go to stderr; stdout stays empty. Ceiling flags/globs throw loud (exit 128);
 * typed git user-errors map to git's exact stderr (caught here, never reaching the
 * shell's generic handler).
 */
import {
  BranchExistsError,
  CheckoutConflictError,
  type CheckoutResult,
  PathspecError,
  type makeGit,
  pathspecMatch,
} from '@riftydev/git';
import { NotImplementedError } from '@riftydev/io';
import type { CommandContext } from '../types.ts';
import { hasGlobMeta } from './_glob.ts';

/**
 * The facade returned by {@link makeGit}. Its named interface (`Git`) is not on
 * the package's public surface, so we derive it from the factory's return type
 * (public API only — no deep import of package internals).
 */
type Git = ReturnType<typeof makeGit>;
type PathspecMapper = (pathspec: string) => string;

const identityPathspec: PathspecMapper = (pathspec) => pathspec;

/**
 * Static middle of git's detached-HEAD advisory (verbatim from real git 2.50.1,
 * see packages/git/fixtures/checkout-detached.err). The two `git switch ...`
 * lines are git's own words — reproduced verbatim for fidelity to git's text
 * even though rifty's `switch` builtin is itself unimplemented.
 */
const DETACHED_ADVISORY_BODY = `You are in 'detached HEAD' state. You can look around, make experimental
changes and commit them, and you can discard any commits you make in this
state without impacting any branches by switching back to a branch.

If you want to create a new branch to retain commits you create, you may
do so (now or later) by using -c with the switch command. Example:

  git switch -c <new-branch-name>

Or undo this operation with:

  git switch -

Turn off this advice by setting config variable advice.detachedHead to false`;

/**
 * Detached-HEAD render style. `checkout` prints the full advisory block
 * (`Note: switching to '<arg>'.` + body + HEAD-line); `switch --detach` prints
 * ONLY the `HEAD is now at <oid> <subject>` line (no advisory) — verbatim real
 * git 2.50.1 (see packages/git/fixtures/{checkout,switch}-detached.err).
 */
export type DetachedStyle = 'checkout' | 'switch';

/** A cwd-relative/absolute pathspec normalized outside the governing repo root. */
export class OutsideRepoPathspecError extends Error {
  constructor(
    readonly pathspec: string,
    readonly root: string,
  ) {
    super(`${pathspec}: '${pathspec}' is outside repository at '${root}'`);
    this.name = 'OutsideRepoPathspecError';
  }
}

/** A rev-like token had a valid base ref but did not resolve as a revision. */
export class RevisionArgumentError extends Error {
  constructor(readonly rev: string) {
    super(`ambiguous argument '${rev}': unknown revision or path not in the working tree`);
    this.name = 'RevisionArgumentError';
  }
}

/**
 * Render a `switch`-result to stderr (stdout stays empty, matching real git —
 * every checkout/switch message is stderr). `arg` is the verbatim ref the user
 * typed, needed for the detached advisory's `Note: switching to '<ARG>'.` line.
 * `detachedStyle` picks the detached text: `checkout` = full advisory,
 * `switch` = HEAD-line only.
 */
export function renderSwitch(
  res: Extract<CheckoutResult, { op: 'switch' }>,
  arg: string,
  ctx: CommandContext,
  detachedStyle: DetachedStyle = 'checkout',
): void {
  if (res.detached) {
    const headLine = `HEAD is now at ${res.oid.slice(0, 7)} ${res.headSubject}\n`;
    if (detachedStyle === 'switch') {
      // `git switch --detach` prints ONLY the HEAD-line — NO advisory block.
      ctx.stderr.write(headLine);
      return;
    }
    ctx.stderr.write(`Note: switching to '${arg}'.\n\n${DETACHED_ADVISORY_BODY}\n\n${headLine}`);
    return;
  }
  // Facade contract: a non-detached switch always has a `target` (the detached
  // branch returned above). A missing one is a broken invariant — surface it
  // loudly rather than render `Switched to branch ''`.
  if (res.target === undefined) {
    throw new Error('git checkout: non-detached switch result missing target branch');
  }
  const target = res.target;
  if (res.created) {
    ctx.stderr.write(`Switched to a new branch '${target}'\n`);
  } else if (res.alreadyOn) {
    ctx.stderr.write(`Already on '${target}'\n`);
  } else {
    ctx.stderr.write(`Switched to branch '${target}'\n`);
  }
}

/**
 * Map a typed checkout error to git's exact stderr + exit code. Caught INSIDE
 * {@link doCheckout} so it never reaches the shell's generic handler. Returns
 * the exit code; rethrows anything unrecognized (a real bug, not a git error).
 */
export function renderCheckoutError(e: unknown, ctx: CommandContext): number {
  if (e instanceof CheckoutConflictError) {
    let msg =
      'error: Your local changes to the following files would be overwritten by checkout:\n';
    for (const f of e.files) msg += `\t${f}\n`;
    msg += 'Please commit your changes or stash them before you switch branches.\nAborting\n';
    ctx.stderr.write(msg);
    return 1;
  }
  if (e instanceof PathspecError) {
    ctx.stderr.write(`error: pathspec '${e.pathspec}' did not match any file(s) known to git\n`);
    return 1;
  }
  if (e instanceof OutsideRepoPathspecError) {
    ctx.stderr.write(
      `fatal: ${e.pathspec}: '${e.pathspec}' is outside repository at '${e.root}'\n`,
    );
    return 128;
  }
  if (e instanceof RevisionArgumentError) {
    ctx.stderr.write(
      `fatal: ambiguous argument '${e.rev}': unknown revision or path not in the working tree.\n`,
    );
    return 128;
  }
  if (e instanceof BranchExistsError) {
    ctx.stderr.write(`fatal: a branch named '${e.branch}' already exists\n`);
    return 128;
  }
  if (e instanceof NotImplementedError) {
    ctx.stderr.write(`${e.message}\n`);
    return 128;
  }
  throw e; // not a git user-error — a real bug, surface it.
}

export function renderCheckoutOrFatal(e: unknown, ctx: CommandContext): number {
  try {
    return renderCheckoutError(e, ctx);
  } catch (fatal) {
    ctx.stderr.write(`fatal: ${fatal instanceof Error ? fatal.message : String(fatal)}\n`);
    return 128;
  }
}

export function renderRevisionAndPathAmbiguity(arg: string, ctx: CommandContext): number {
  ctx.stderr.write(`fatal: ambiguous argument '${arg}': both revision and filename\n`);
  ctx.stderr.write("Use '--' to separate paths from revisions, like this:\n");
  ctx.stderr.write("'git <command> [<revision>...] -- [<file>...]'\n");
  return 128;
}

/**
 * Parsed `git checkout` invocation: a `-b` create, a `--`-delimited restore, or
 * raw positionals to disambiguate (ref vs path). Ceiling flags are rejected
 * during parse (loud {@link NotImplementedError}), never silently ignored.
 */
type CheckoutPlan =
  | { kind: 'create'; name: string; startPoint?: string; force: boolean }
  | { kind: 'restore-explicit'; pathspecs: string[]; source?: string }
  | { kind: 'positional'; positionals: string[]; force: boolean };

/** Read-only checkout resolution shared by mutation planning and execution. */
export type PreparedCheckoutPlan =
  | {
      readonly kind: 'switch';
      readonly ref: string;
      readonly force: boolean;
      readonly create: boolean;
      readonly startPoint?: string;
    }
  | { readonly kind: 'restore'; readonly pathspecs: readonly string[]; readonly source?: string }
  | { readonly kind: 'noop'; readonly source?: string }
  | { readonly kind: 'ambiguity'; readonly arg: string };

/** Reflog marker remains a hard ceiling (no reflog); `~`/`^` are parsed in @riftydev/git. */
export const REVSPEC_MARKER = /[~^]|@\{/;

function revisionSyntaxBase(rev: string): string | undefined {
  const idx = rev.search(/[~^]/);
  if (idx === -1) return undefined;
  const base = rev.slice(0, idx);
  return base.length === 0 ? undefined : base;
}

async function hasResolvableRevisionBase(g: Git, rev: string): Promise<boolean> {
  const base = revisionSyntaxBase(rev);
  if (base === undefined) return false;
  try {
    await g.resolveRevision(base);
    return true;
  } catch (e) {
    if (e instanceof NotImplementedError) return true;
    return false;
  }
}

export async function revisionExists(g: Git, rev: string): Promise<boolean> {
  try {
    await g.resolveRevision(rev);
    return true;
  } catch (e) {
    if (e instanceof NotImplementedError) throw e;
    if (await hasResolvableRevisionBase(g, rev)) throw new RevisionArgumentError(rev);
    return false;
  }
}

/**
 * Ceiling flags rejected during parse → `NotImplementedError('git.checkout.<slug>')`
 * (loud exit 128, never silently ignored). `-p`/`--patch` share one slug, as do
 * `-m`/`--merge` and `-t`/`--track`; the bare `-` (previous-branch) is its own.
 */
const CEILING_FLAGS = new Map<string, string>([
  ['-B', 'B'],
  ['--orphan', 'orphan'],
  ['-p', 'patch'],
  ['--patch', 'patch'],
  ['-m', 'merge'],
  ['--merge', 'merge'],
  ['--ours', 'ours'],
  ['--theirs', 'theirs'],
  ['-t', 'track'],
  ['--track', 'track'],
  ['-', 'previous'],
]);

/**
 * Parse `args` (args[0]==='checkout'). Throws {@link NotImplementedError} for any
 * ceiling flag/arg so the gap is loud (exit 128). `--` splits tree-ish source
 * (before, ≤1) from pathspecs (after). `-b <name> [<start>]` → create.
 */
export function parseCheckout(args: string[]): CheckoutPlan {
  const rest = args.slice(1);
  const dashDash = rest.indexOf('--');
  const flagTokens = dashDash === -1 ? rest : rest.slice(0, dashDash);
  const afterDashDash = dashDash === -1 ? [] : rest.slice(dashDash + 1);

  let force = false;
  let createName: string | undefined;
  let startPoint: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < flagTokens.length; i++) {
    const t = flagTokens[i] as string;
    if (t === '-b') {
      createName = flagTokens[++i];
      if (createName === undefined) throw new NotImplementedError('git.checkout.b-missing-name');
      continue;
    }
    if (t === '-f' || t === '--force') {
      force = true;
      continue;
    }
    // Ceiling flags + the bare `-` (previous-branch) arg → loud throw.
    const slug = CEILING_FLAGS.get(t);
    if (slug !== undefined) throw new NotImplementedError(`git.checkout.${slug}`);
    if (t.startsWith('-')) throw new NotImplementedError(`git.checkout.${t.replace(/^-+/, '')}`);
    positionals.push(t);
  }

  // Reflog expressions need a reflog rifty does not keep. Parent arithmetic is
  // implemented by @riftydev/git's resolveRevision, so only `@{...}` stays loud.
  const refTokens = createName !== undefined ? positionals.slice(0, 1) : positionals;
  for (const t of refTokens) {
    if (t.includes('@{')) {
      throw new NotImplementedError(
        'git.checkout.revspec',
        'reflog revspecs (@{-1}, HEAD@{1}) are not supported',
      );
    }
  }

  if (createName !== undefined) {
    if (positionals.length > 1) throw new NotImplementedError('git.checkout.args');
    startPoint = positionals[0];
    return { kind: 'create', name: createName, startPoint, force };
  }
  if (dashDash !== -1) {
    if (positionals.length > 1) throw new NotImplementedError('git.checkout.args');
    for (const p of afterDashDash) {
      if (hasGlobMeta(p)) throw new NotImplementedError('git.checkout.glob-pathspec');
    }
    return {
      kind: 'restore-explicit',
      pathspecs: afterDashDash,
      source: positionals[0],
    };
  }
  return { kind: 'positional', positionals, force };
}

/**
 * Resolve checkout's ref-vs-path meaning without mutating. The returned plan is
 * the single semantic input used after the mutation guard admits the command.
 */
export async function prepareCheckout(
  g: Git,
  args: string[],
  mapPathspec: PathspecMapper = identityPathspec,
): Promise<PreparedCheckoutPlan> {
  const plan = parseCheckout(args);
  if (plan.kind === 'create') {
    return {
      kind: 'switch',
      ref: plan.name,
      force: plan.force,
      create: true,
      ...(plan.startPoint !== undefined ? { startPoint: plan.startPoint } : {}),
    };
  }
  if (plan.kind === 'restore-explicit') {
    return plan.pathspecs.length === 0
      ? {
          kind: 'noop',
          ...(plan.source !== undefined ? { source: plan.source } : {}),
        }
      : {
          kind: 'restore',
          pathspecs: plan.pathspecs.map(mapPathspec),
          ...(plan.source !== undefined ? { source: plan.source } : {}),
        };
  }

  const { positionals, force } = plan;
  if (positionals.length === 0) return { kind: 'noop' };
  if (positionals.length === 1) {
    const arg = positionals[0] as string;
    if (await revisionExists(g, arg)) {
      return { kind: 'switch', ref: arg, force, create: false };
    }
    const pathspec = mapPathspec(arg);
    const tracked = await g.listFiles();
    if (tracked.some((path) => pathspecMatch(path, pathspec))) {
      return { kind: 'restore', pathspecs: [pathspec] };
    }
    if (hasGlobMeta(arg)) throw new NotImplementedError('git.checkout.glob-pathspec');
    throw new PathspecError(arg);
  }

  const first = positionals[0] as string;
  const restSpecs = positionals.slice(1).map(mapPathspec);
  for (const pathspec of restSpecs) {
    if (hasGlobMeta(pathspec)) throw new NotImplementedError('git.checkout.glob-pathspec');
  }
  if (await revisionExists(g, first)) {
    const firstPathspec = mapPathspec(first);
    if ((await g.status()).some((entry) => pathspecMatch(entry.filepath, firstPathspec))) {
      return { kind: 'ambiguity', arg: first };
    }
    return { kind: 'restore', pathspecs: restSpecs, source: first };
  }
  if (hasGlobMeta(first)) throw new NotImplementedError('git.checkout.glob-pathspec');
  return { kind: 'restore', pathspecs: positionals.map(mapPathspec) };
}

/**
 * `git checkout` — branch-switch + file-restore over the {@link makeGit} facade,
 * byte-exact to real git 2.50.1. ALL messages go to stderr; stdout stays empty.
 * Ceiling flags/globs throw loud (exit 128); typed git user-errors map to git's
 * exact stderr (caught here, never reaching the generic handler).
 */
export async function doCheckout(
  g: Git,
  args: string[],
  ctx: CommandContext,
  mapPathspec: PathspecMapper = identityPathspec,
  prepared?: PreparedCheckoutPlan,
): Promise<number> {
  let plan: PreparedCheckoutPlan;
  try {
    plan = prepared ?? (await prepareCheckout(g, args, mapPathspec));
  } catch (e) {
    return renderCheckoutOrFatal(e, ctx);
  }

  try {
    if (plan.kind === 'switch') {
      const res = await g.checkout({
        op: 'switch',
        ref: plan.ref,
        ...(plan.create ? { create: true as const } : {}),
        ...(plan.startPoint !== undefined ? { startPoint: plan.startPoint } : {}),
        force: plan.force,
      });
      if (res.op === 'switch') renderSwitch(res, plan.ref, ctx);
      return 0;
    }

    if (plan.kind === 'noop') {
      // Explicit source still validates even though no worktree path was named.
      if (plan.source !== undefined) {
        try {
          await g.resolveRevision(plan.source);
        } catch (e) {
          if (e instanceof NotImplementedError) return renderCheckoutError(e, ctx);
          ctx.stderr.write(`fatal: invalid reference: ${plan.source}\n`);
          return 128;
        }
      }
      return 0;
    }

    if (plan.kind === 'ambiguity') return renderRevisionAndPathAmbiguity(plan.arg, ctx);

    if (plan.kind === 'restore') {
      await g.checkout({
        op: 'restore',
        pathspecs: [...plan.pathspecs],
        ...(plan.source !== undefined ? { source: plan.source } : {}),
      });
      return 0; // restore is silent
    }
    throw new Error('git checkout: unhandled prepared plan');
  } catch (e) {
    return renderCheckoutOrFatal(e, ctx);
  }
}
