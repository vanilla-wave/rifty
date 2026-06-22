/**
 * `git` builtin — a thin CLI over the {@link makeGit} facade (`@riftydev/git`),
 * bound to the ambient async VFS (`asyncVfs()`), so it operates on the SAME tree
 * the shell + runtime see. LOCAL porcelain + network verbs (clone/fetch/pull/
 * push) over smart-HTTP; unsupported transports, the browser cross-origin wall,
 * and real network errors all surface as a loud exit-128, never a fake success.
 *
 * `status --porcelain` maps isomorphic-git's 3-char statusMatrix code
 * (`${head}${workdir}${stage}`) to git's two-column `XY` porcelain-v1 output.
 * The mapping was cross-checked against real git 2.50.1 (host) — see
 * {@link porcelainXY}.
 */
import {
  AmbiguousArgError,
  BranchExistsError,
  CheckoutConflictError,
  type CheckoutResult,
  PathspecError,
  type StatusEntry,
  makeGit,
  vfsToGitFs,
} from '@riftydev/git';
import { NotImplementedError } from '@riftydev/io';
import { asyncVfs } from '@riftydev/vfs';
import type { CommandContext, ShellCommand } from '../types.ts';

/**
 * The facade returned by {@link makeGit}. Its named interface (`Git`) is not on
 * the package's public surface, so we derive it from the factory's return type
 * (public API only — no deep import of package internals).
 */
type Git = ReturnType<typeof makeGit>;

const DEFAULT_AUTHOR_NAME = 'rifty';
const DEFAULT_AUTHOR_EMAIL = 'rifty@localhost';

/** Short (7-char) oid, git's default abbreviation length. */
function short(oid: string): string {
  return oid.slice(0, 7);
}

/**
 * isomorphic-git statusMatrix code (`${head}${workdir}${stage}`) → git
 * porcelain-v1 `XY` (X = staged/index column, Y = worktree column). Codes
 * verified against real git 2.50.1:
 *   020 untracked              → `??`
 *   022 staged-new (added)     → `A `
 *   003 staged-new then rm'd   → `AD`
 *   111 unchanged              → (omitted)
 *   121 modified, unstaged     → ` M`
 *   122 modified, staged       → `M `
 *   123 staged then modified   → `MM`
 *   101 deleted, unstaged      → ` D`
 *   100 deleted, staged        → `D `
 * Any unmapped code falls through to a best-effort `??`-style raw so a gap is
 * visible, never silently dropped.
 */
function porcelainXY(code: string): string | null {
  switch (code) {
    case '111': // HEAD==WORKDIR==STAGE — unchanged, nothing to report
      return null;
    case '020': // untracked
      return '??';
    case '022': // staged new (added to index, no HEAD)
      return 'A ';
    case '003': // staged new then deleted from workdir
      return 'AD';
    case '121': // modified, unstaged
      return ' M';
    case '122': // modified, staged
      return 'M ';
    case '123': // staged then modified again
      return 'MM';
    case '101': // deleted, unstaged
      return ' D';
    case '100': // deleted, staged
      return 'D ';
    default:
      // Unknown matrix code — surface the raw code rather than hide a gap.
      return code;
  }
}

/** Render `git status --porcelain` v1: one `XY filepath` line per changed file. */
function renderPorcelain(entries: StatusEntry[]): string {
  let out = '';
  for (const e of entries) {
    const xy = porcelainXY(e.status);
    if (xy === null) continue;
    out += `${xy} ${e.filepath}\n`;
  }
  return out;
}

/** Human-readable default `git status` summary (not byte-exact git). */
function renderStatusSummary(branch: string | undefined, entries: StatusEntry[]): string {
  const lines: string[] = [];
  lines.push(`On branch ${branch ?? '(no branch)'}`);
  const changed = entries.filter((e) => porcelainXY(e.status) !== null);
  if (changed.length === 0) {
    lines.push('nothing to commit, working tree clean');
    return `${lines.join('\n')}\n`;
  }
  for (const e of changed) {
    const xy = porcelainXY(e.status);
    lines.push(`  ${xy} ${e.filepath}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Resolve author/committer identity + timestamp from the shell env. */
function identityFrom(env: Record<string, string>): {
  name: string;
  email: string;
  timestamp: number;
  timezoneOffset: number;
} {
  const name = env.GIT_AUTHOR_NAME ?? DEFAULT_AUTHOR_NAME;
  const email = env.GIT_AUTHOR_EMAIL ?? DEFAULT_AUTHOR_EMAIL;
  const date = env.GIT_AUTHOR_DATE;
  const timestamp =
    date !== undefined && /^\d+$/.test(date) ? Number(date) : Math.floor(Date.now() / 1000);
  return { name, email, timestamp, timezoneOffset: 0 };
}

function committerFrom(
  env: Record<string, string>,
  author: ReturnType<typeof identityFrom>,
): ReturnType<typeof identityFrom> {
  const name = env.GIT_COMMITTER_NAME ?? author.name;
  const email = env.GIT_COMMITTER_EMAIL ?? author.email;
  const date = env.GIT_COMMITTER_DATE;
  const timestamp = date !== undefined && /^\d+$/.test(date) ? Number(date) : author.timestamp;
  return { name, email, timestamp, timezoneOffset: 0 };
}

/** `git add` of `.` / `-A` — stage every changed path from the statusMatrix. */
async function addAll(g: Git): Promise<void> {
  const entries = await g.status();
  for (const e of entries) {
    // Skip unchanged (111) — adding it is a wasteful no-op; everything else
    // (untracked / modified / deleted) is a real change to stage.
    if (e.status === '111') continue;
    if (e.status === '101' || e.status === '100') {
      // Deletion: `git add` of a removed path stages the removal.
      await g.remove(e.filepath);
    } else {
      await g.add(e.filepath);
    }
  }
}

/** `commit -m <msg>` flag parse — returns the message or null on a usage error. */
function parseCommitMessage(args: string[]): string | null {
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '-m' || a === '--message') return args[i + 1] ?? null;
    if (a?.startsWith('-m')) return a.slice(2); // -mMSG
  }
  return null;
}

async function doStatus(g: Git, args: string[], ctx: CommandContext): Promise<number> {
  const porcelain = args.includes('--porcelain') || args.includes('-s');
  const entries = await g.status();
  if (porcelain) {
    ctx.stdout.write(renderPorcelain(entries));
  } else {
    const branch = await g.currentBranch();
    ctx.stdout.write(renderStatusSummary(branch, entries));
  }
  return 0;
}

async function doAdd(g: Git, args: string[], ctx: CommandContext): Promise<number> {
  const specs = args.slice(1);
  if (specs.length === 0) {
    ctx.stderr.write('git: nothing specified, nothing added\n');
    return 1;
  }
  if (specs.includes('.') || specs.includes('-A') || specs.includes('--all')) {
    await addAll(g);
    return 0;
  }
  for (const spec of specs) {
    if (spec.startsWith('-')) continue; // ignore unknown flags here (e.g. -v)
    await g.add(spec);
  }
  return 0;
}

async function doCommit(g: Git, args: string[], ctx: CommandContext): Promise<number> {
  const message = parseCommitMessage(args);
  if (message === null) {
    ctx.stderr.write('git: commit requires -m <message>\n');
    return 1;
  }
  const author = identityFrom(ctx.env);
  const committer = committerFrom(ctx.env, author);
  const oid = await g.commit({ message, author, committer });
  const branch = (await g.currentBranch()) ?? 'HEAD';
  ctx.stdout.write(`[${branch} ${short(oid)}] ${message}\n`);
  return 0;
}

async function doLog(g: Git, args: string[], ctx: CommandContext): Promise<number> {
  const oneline = args.includes('--oneline');
  const entries = await g.log();
  for (const e of entries) {
    if (oneline) {
      const firstLine = e.message.split('\n', 1)[0] ?? '';
      ctx.stdout.write(`${short(e.oid)} ${firstLine}\n`);
    } else {
      ctx.stdout.write(`commit ${e.oid}\n`);
      ctx.stdout.write(`Author: ${e.author.name} <${e.author.email}>\n`);
      ctx.stdout.write('\n');
      ctx.stdout.write(`    ${e.message.trimEnd()}\n`);
      ctx.stdout.write('\n');
    }
  }
  return 0;
}

async function doDiff(g: Git, ctx: CommandContext): Promise<number> {
  const entries = await g.diff();
  for (const e of entries) {
    ctx.stdout.write(`diff --git a/${e.filepath} b/${e.filepath}\n`);
    for (const h of e.hunks) {
      ctx.stdout.write(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n`);
      for (const line of h.lines) ctx.stdout.write(`${line}\n`);
    }
  }
  return 0;
}

async function doBranch(g: Git, ctx: CommandContext): Promise<number> {
  const [branches, current] = await Promise.all([g.listBranches(), g.currentBranch()]);
  for (const b of branches) {
    ctx.stdout.write(`${b === current ? '* ' : '  '}${b}\n`);
  }
  return 0;
}

/**
 * Run a network verb over smart-HTTP. Any failure — an unsupported-transport /
 * cross-origin NotImplementedError, or a real network/protocol error from
 * isomorphic-git — is surfaced as a loud exit-128 with its message on stderr
 * (never a fake success). `clone` requires a `<url>` positional; `fetch`/`pull`/
 * `push` take an optional one (else the remote config is used). `pull` commits
 * the merge under the shell-env identity.
 */
async function doNetwork(
  g: Git,
  verb: 'clone' | 'fetch' | 'pull' | 'push',
  args: string[],
  ctx: CommandContext,
): Promise<number> {
  const url = args[1];
  if (verb === 'clone' && url === undefined) {
    ctx.stderr.write('git: clone requires a <url>\n');
    return 128;
  }
  try {
    switch (verb) {
      case 'clone':
        await g.clone({ url: url as string });
        break;
      case 'fetch':
        await g.fetch(url === undefined ? {} : { url });
        break;
      case 'pull':
        await g.pull({ ...(url === undefined ? {} : { url }), author: identityFrom(ctx.env) });
        break;
      case 'push':
        await g.push(url === undefined ? {} : { url });
        break;
    }
    return 0;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    ctx.stderr.write(`${message}\n`);
    return 128;
  }
}

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

/** git's glob/magic pathspec chars — unsupported (loud ceiling, not silent). */
function hasGlobMagic(spec: string): boolean {
  return /[*?[]/.test(spec);
}

/**
 * Render a `switch`-result to stderr (stdout stays empty, matching real git —
 * every checkout message is stderr). `arg` is the verbatim ref the user typed,
 * needed for the detached advisory's `Note: switching to '<ARG>'.` line.
 */
function renderSwitch(
  res: Extract<CheckoutResult, { op: 'switch' }>,
  arg: string,
  ctx: CommandContext,
): void {
  if (res.detached) {
    ctx.stderr.write(
      `Note: switching to '${arg}'.\n\n${DETACHED_ADVISORY_BODY}\n\nHEAD is now at ${res.oid.slice(0, 7)} ${res.headSubject}\n`,
    );
    return;
  }
  const target = res.target ?? '';
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
function renderCheckoutError(e: unknown, ctx: CommandContext): number {
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
  if (e instanceof BranchExistsError) {
    ctx.stderr.write(`fatal: a branch named '${e.branch}' already exists\n`);
    return 128;
  }
  if (e instanceof AmbiguousArgError) {
    ctx.stderr.write(`fatal: '${e.arg}' could be both a revision and a path\n`);
    return 128;
  }
  if (e instanceof NotImplementedError) {
    ctx.stderr.write(`${e.message}\n`);
    return 128;
  }
  throw e; // not a git user-error — a real bug, surface it.
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

/**
 * Parse `args` (args[0]==='checkout'). Throws {@link NotImplementedError} for any
 * ceiling flag/arg so the gap is loud (exit 128). `--` splits tree-ish source
 * (before, ≤1) from pathspecs (after). `-b <name> [<start>]` → create.
 */
function parseCheckout(args: string[]): CheckoutPlan {
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
    if (t === '-B') throw new NotImplementedError('git.checkout.B');
    if (t === '--orphan') throw new NotImplementedError('git.checkout.orphan');
    if (t === '-p' || t === '--patch') throw new NotImplementedError('git.checkout.patch');
    if (t === '-m' || t === '--merge') throw new NotImplementedError('git.checkout.merge');
    if (t === '--ours') throw new NotImplementedError('git.checkout.ours');
    if (t === '--theirs') throw new NotImplementedError('git.checkout.theirs');
    if (t === '-t' || t === '--track') throw new NotImplementedError('git.checkout.track');
    if (t === '-') throw new NotImplementedError('git.checkout.previous');
    if (t.startsWith('-')) throw new NotImplementedError(`git.checkout.${t.replace(/^-+/, '')}`);
    positionals.push(t);
  }

  if (createName !== undefined) {
    startPoint = positionals[0];
    return { kind: 'create', name: createName, startPoint, force };
  }
  if (dashDash !== -1) {
    for (const p of afterDashDash) {
      if (hasGlobMagic(p)) throw new NotImplementedError('git.checkout.glob-pathspec');
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
 * `git checkout` — branch-switch + file-restore over the {@link makeGit} facade,
 * byte-exact to real git 2.50.1. ALL messages go to stderr; stdout stays empty.
 * Ceiling flags/globs throw loud (exit 128); typed git user-errors map to git's
 * exact stderr (caught here, never reaching the generic handler).
 */
async function doCheckout(g: Git, args: string[], ctx: CommandContext): Promise<number> {
  let plan: CheckoutPlan;
  try {
    plan = parseCheckout(args);
  } catch (e) {
    return renderCheckoutError(e, ctx);
  }

  try {
    if (plan.kind === 'create') {
      const res = await g.checkout({
        op: 'switch',
        ref: plan.name,
        create: true,
        ...(plan.startPoint !== undefined ? { startPoint: plan.startPoint } : {}),
        force: plan.force,
      });
      if (res.op === 'switch') renderSwitch(res, plan.name, ctx);
      return 0;
    }

    if (plan.kind === 'restore-explicit') {
      if (plan.pathspecs.length === 0) {
        // `git checkout -- ` with no pathspecs (or `git checkout <ref> --`).
        ctx.stderr.write('error: you must specify path(s) to restore\n');
        return 1;
      }
      await g.checkout({
        op: 'restore',
        pathspecs: plan.pathspecs,
        ...(plan.source !== undefined ? { source: plan.source } : {}),
      });
      return 0; // restore is silent
    }

    // `await` so a rejection lands in THIS try/catch (not returned unawaited).
    return await doCheckoutPositional(g, plan.positionals, plan.force, ctx);
  } catch (e) {
    return renderCheckoutError(e, ctx);
  }
}

/**
 * `git checkout` with no `--` and no `-b`: disambiguate positionals (git's
 * ref-vs-path rules). Zero → "must specify path(s)". One → ref/path/both/neither.
 * Many → `<ref> <pathspec...>` restore-from-tree if the first resolves, else all
 * are index pathspecs.
 */
async function doCheckoutPositional(
  g: Git,
  positionals: string[],
  force: boolean,
  ctx: CommandContext,
): Promise<number> {
  if (positionals.length === 0) {
    ctx.stderr.write('error: you must specify path(s) to restore\n');
    return 1;
  }

  if (positionals.length === 1) {
    const x = positionals[0] as string;
    const isRef = await g
      .resolveRef(x)
      .then(() => true)
      .catch(() => false);
    const tracked = await g.listFiles();
    const isPath = tracked.some((p) => p === x || p.startsWith(`${x}/`));
    if (isRef && isPath) throw new AmbiguousArgError(x);
    if (isRef) {
      const res = await g.checkout({ op: 'switch', ref: x, force });
      if (res.op === 'switch') renderSwitch(res, x, ctx);
      return 0;
    }
    if (isPath) {
      await g.checkout({ op: 'restore', pathspecs: [x] });
      return 0;
    }
    // Neither a ref nor a tracked path — glob-magic is a ceiling, else pathspec miss.
    if (hasGlobMagic(x)) throw new NotImplementedError('git.checkout.glob-pathspec');
    throw new PathspecError(x);
  }

  // Multiple positionals: `<tree-ish> <pathspec...>` if the first resolves.
  const first = positionals[0] as string;
  const restSpecs = positionals.slice(1);
  for (const p of restSpecs) {
    if (hasGlobMagic(p)) throw new NotImplementedError('git.checkout.glob-pathspec');
  }
  const firstIsRef = await g
    .resolveRef(first)
    .then(() => true)
    .catch(() => false);
  if (firstIsRef) {
    await g.checkout({ op: 'restore', pathspecs: restSpecs, source: first });
    return 0;
  }
  // First isn't a ref → treat ALL positionals as index pathspecs.
  if (hasGlobMagic(first)) throw new NotImplementedError('git.checkout.glob-pathspec');
  await g.checkout({ op: 'restore', pathspecs: positionals });
  return 0;
}

/**
 * `git <subcommand> ...` — version control over `@riftydev/git` (isomorphic-git)
 * on the ambient VFS. Local verbs (init/status/add/commit/log/diff/branch) run;
 * network verbs (clone/fetch/pull/push) drive smart-HTTP and surface any failure
 * (unsupported transport, CORS wall, network error) as exit 128. Unknown/missing
 * subcommand → exit 1.
 */
/**
 * Real git subcommands rifty does NOT implement (browser git subset, ADR-0167).
 * These throw a directed "not implemented" (exit 128) — never silently absent and
 * never mislabeled as a typo. A subcommand outside both this set and the dispatch
 * below is a genuine "not a git command" (exit 1, matching real git's wording).
 */
const UNIMPLEMENTED_SUBCOMMANDS = new Set([
  'rebase',
  'merge',
  'reset',
  'revert',
  'stash',
  'cherry-pick',
  'tag',
  'remote',
  'config',
  'show',
  'reflog',
  'bisect',
  'blame',
  'submodule',
  'worktree',
  'switch',
  'restore',
  'clean',
  'rm',
  'mv',
  'gc',
  'prune',
  'repack',
  'fsck',
  'apply',
  'am',
  'format-patch',
  'notes',
  'describe',
  'shortlog',
  'mergetool',
  'sparse-checkout',
  'archive',
  'bundle',
  'grep',
]);

export const git: ShellCommand = async (args, ctx) => {
  if (ctx.signal?.aborted) return 130;

  const sub = args[0];
  const vfs = asyncVfs();
  if (!vfs) {
    ctx.stderr.write('git: no filesystem\n');
    return 128;
  }
  const g = makeGit({ fs: vfsToGitFs(vfs), dir: ctx.cwd });

  switch (sub) {
    case 'init':
      await g.init();
      ctx.stdout.write('Initialized empty Git repository\n');
      return 0;
    case 'status':
      return doStatus(g, args, ctx);
    case 'add':
      return doAdd(g, args, ctx);
    case 'commit':
      return doCommit(g, args, ctx);
    case 'log':
      return doLog(g, args, ctx);
    case 'diff':
      return doDiff(g, ctx);
    case 'branch':
      return doBranch(g, ctx);
    case 'checkout':
      return doCheckout(g, args, ctx);
    case 'clone':
    case 'fetch':
    case 'pull':
    case 'push':
      return doNetwork(g, sub, args, ctx);
    default:
      if (sub && UNIMPLEMENTED_SUBCOMMANDS.has(sub)) {
        ctx.stderr.write(
          `git: '${sub}' is not implemented in rifty (browser git subset — see docs/public/compat/git.md)\n`,
        );
        return 128;
      }
      ctx.stderr.write(`git: '${sub ?? ''}' is not a git command\n`);
      return 1;
  }
};
