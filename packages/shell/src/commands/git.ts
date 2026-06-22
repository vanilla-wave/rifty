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
import { type StatusEntry, assertSupportedTransport, makeGit, vfsToGitFs } from '@riftydev/git';
import { NotImplementedError } from '@riftydev/io';
import { asyncVfs, isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';
import type { CommandContext, ShellCommand } from '../types.ts';
import { doCheckout, renderCheckoutError } from './_git-checkout.ts';
import { doConfig } from './_git-config.ts';
import { doRestore } from './_git-restore.ts';
import { doSwitch } from './_git-switch.ts';

/** The ambient async VFS the `git` builtin binds to (never undefined past the guard). */
type Vfs = NonNullable<ReturnType<typeof asyncVfs>>;

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

/** Author/committer identity — timestamp seconds, offset minutes (git canon). */
interface Identity {
  name: string;
  email: string;
  timestamp: number;
  timezoneOffset: number;
}

/**
 * Resolve author identity + timestamp. Name/email precedence: `GIT_AUTHOR_*` env
 * → git config (`user.name`/`user.email`) → built-in default. (This is the real
 * payoff: `git config user.email x` then `git commit` with no env authors as x.)
 */
async function identityFrom(g: Git, env: Record<string, string>): Promise<Identity> {
  const name = env.GIT_AUTHOR_NAME ?? (await g.getConfig('user.name')) ?? DEFAULT_AUTHOR_NAME;
  const email = env.GIT_AUTHOR_EMAIL ?? (await g.getConfig('user.email')) ?? DEFAULT_AUTHOR_EMAIL;
  const date = env.GIT_AUTHOR_DATE;
  const timestamp =
    date !== undefined && /^\d+$/.test(date) ? Number(date) : Math.floor(Date.now() / 1000);
  return { name, email, timestamp, timezoneOffset: 0 };
}

function committerFrom(env: Record<string, string>, author: Identity): Identity {
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

/**
 * `git commit -a`/`--all`: stage modifications + deletions of files ALREADY
 * TRACKED in HEAD (real git's `-a` == `git add -u` then commit). Untracked files
 * are NOT staged (head !== '1'); staged-new files stay as-is.
 */
async function stageTrackedChanges(g: Git): Promise<void> {
  const entries = await g.status();
  for (const e of entries) {
    if (e.status[0] !== '1') continue; // only files present in HEAD (tracked)
    if (e.status[1] === '0')
      await g.remove(e.filepath); // gone from workdir → stage the deletion
    else if (e.status !== '111') await g.add(e.filepath); // modified → stage it
  }
}

/** Parsed `git commit`. `message === null` = none supplied. */
interface CommitPlan {
  amend: boolean;
  all: boolean;
  message: string | null;
}

/**
 * Expand combined short-flag clusters (`-am` → `-a -m`), honoring that `-m` is
 * value-taking: the remainder of its cluster (or the next token) is its value
 * (`-mMSG`/`-amMSG` → `-m MSG`; `-ma` → `-m a`).
 */
function expandShortFlags(tokens: string[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    if (t.length < 2 || t[0] !== '-' || t[1] === '-') {
      out.push(t);
      continue;
    }
    for (let j = 1; j < t.length; j++) {
      if (t[j] === 'm') {
        out.push('-m');
        const inline = t.slice(j + 1);
        if (inline) out.push(inline);
        break;
      }
      out.push(`-${t[j]}`);
    }
  }
  return out;
}

/**
 * Parse `git commit` flags. Recognizes `--amend`, `-a`/`--all`, and the message
 * forms (`-m MSG`/`-mMSG`/`--message MSG`/`--message=MSG`). ANY other flag (or a
 * positional pathspec) is a loud {@link NotImplementedError} (exit 128) — never
 * silently ignored, matching the checkout/switch/restore flag discipline.
 */
function parseCommit(args: string[]): CommitPlan {
  const rest = expandShortFlags(args.slice(1));
  let amend = false;
  let all = false;
  let message: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i] as string;
    if (t === '--amend') {
      amend = true;
    } else if (t === '-a' || t === '--all') {
      all = true;
    } else if (t === '-m' || t === '--message') {
      message = rest[++i] ?? null;
    } else if (t.startsWith('--message=')) {
      message = t.slice('--message='.length);
    } else if (t.startsWith('-')) {
      throw new NotImplementedError(`git.commit.${t.replace(/^-+/, '')}`);
    } else {
      throw new NotImplementedError(
        'git.commit.pathspec',
        'commit with explicit paths is unsupported',
      );
    }
  }
  return { amend, all, message };
}

/**
 * Real git refuses to fabricate an empty commit (exit 1). Returns the exact
 * stdout summary line for the current state, or `null` when there IS a staged
 * change to commit. Mirrors git 2.50.1's wording for the common porcelain states.
 */
async function nothingToCommit(g: Git): Promise<string | null> {
  const entries = await g.status();
  const hasStaged = entries.some((e) => {
    const head = e.status[0];
    const stage = e.status[2];
    return stage !== '1' && !(head === '0' && stage === '0');
  });
  if (hasStaged) return null;
  const hasUnstagedTracked = entries.some(
    (e) => e.status[0] === '1' && e.status[2] === '1' && e.status[1] !== '1',
  );
  if (hasUnstagedTracked)
    return 'no changes added to commit (use "git add" and/or "git commit -a")';
  if (entries.some((e) => e.status === '020'))
    return 'nothing added to commit but untracked files present (use "git add" to track)';
  const unborn = await g
    .resolveRef('HEAD')
    .then(() => false)
    .catch(() => true);
  if (unborn) return 'nothing to commit (create/copy files and use "git add" to track)';
  return 'nothing to commit, working tree clean';
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

/** True when an iso-git error is a "not found" plumbing error (vs a real bug). */
function isNotFound(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (e as { name?: string })?.name === 'NotFoundError' || /could not find/i.test(msg);
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
    try {
      await g.add(spec);
    } catch (e) {
      // A missing path is real git's `fatal: pathspec '<x>' did not match any
      // files` (exit 128) — never the leaked iso-git "Could not find <x>." exit-1.
      if (isNotFound(e)) {
        ctx.stderr.write(`fatal: pathspec '${spec}' did not match any files\n`);
        return 128;
      }
      throw e;
    }
  }
  return 0;
}

async function doCommit(g: Git, args: string[], ctx: CommandContext): Promise<number> {
  let plan: CommitPlan;
  try {
    plan = parseCommit(args);
  } catch (e) {
    return renderCheckoutError(e, ctx); // unknown flag / pathspec → loud exit 128
  }

  // `-a`/`--all`: stage tracked modifications + deletions BEFORE the empty-check.
  if (plan.all) await stageTrackedChanges(g);

  let message = plan.message;
  if (plan.amend) {
    // `--amend` reads the prior commit defensively: an UNBORN HEAD (fresh repo,
    // no commit) makes g.log() throw "Could not find HEAD" → real git's
    // "fatal: You have nothing to amend." (exit 128), never a leaked exit-1.
    const prior = (await g.log().catch(() => []))[0];
    if (prior === undefined) {
      ctx.stderr.write('fatal: You have nothing to amend.\n');
      return 128;
    }
    // `--amend` with no `-m` reuses the previous commit's message.
    if (message === null) message = prior.message;
  } else {
    // Never fabricate an empty commit — real git refuses (exit 1, summary to stdout).
    const refusal = await nothingToCommit(g);
    if (refusal !== null) {
      ctx.stdout.write(`${refusal}\n`);
      return 1;
    }
  }
  if (message === null) {
    ctx.stderr.write('git: commit requires -m <message>\n');
    return 1;
  }
  const author = await identityFrom(g, ctx.env);
  const committer = committerFrom(ctx.env, author);
  const oid = await g.commit({
    message,
    author,
    committer,
    ...(plan.amend ? { amend: true } : {}),
  });
  const branch = (await g.currentBranch()) ?? 'HEAD';
  ctx.stdout.write(`[${branch} ${short(oid)}] ${message}\n`);
  return 0;
}

async function doLog(g: Git, args: string[], ctx: CommandContext): Promise<number> {
  const oneline = args.includes('--oneline');
  let entries: Awaited<ReturnType<Git['log']>>;
  try {
    entries = await g.log();
  } catch (e) {
    // An UNBORN HEAD (no commit yet) is real git's `fatal: your current branch
    // '<b>' does not have any commits yet` (exit 128) — never the leaked iso-git
    // "Could not find refs/heads/<b>." exit-1.
    if (isNotFound(e)) {
      const branch = (await g.currentBranch().catch(() => undefined)) ?? 'main';
      ctx.stderr.write(`fatal: your current branch '${branch}' does not have any commits yet\n`);
      return 128;
    }
    ctx.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    return 128;
  }
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
 * Run a NETWORK verb (`fetch`/`pull`/`push`) over smart-HTTP on an existing repo.
 * Any failure — an unsupported-transport / cross-origin NotImplementedError, or a
 * real network/protocol error from isomorphic-git — surfaces as a loud exit-128
 * with its message on stderr (never a fake success). The `<url>` positional is
 * optional (else the remote config is used). `pull` commits the merge under the
 * shell-env identity. (`clone` is separate — see {@link doClone}.)
 */
async function doNetwork(
  g: Git,
  verb: 'fetch' | 'pull' | 'push',
  args: string[],
  ctx: CommandContext,
): Promise<number> {
  const url = args[1];
  try {
    switch (verb) {
      case 'fetch':
        await g.fetch(url === undefined ? {} : { url });
        break;
      case 'pull':
        await g.pull({
          ...(url === undefined ? {} : { url }),
          author: await identityFrom(g, ctx.env),
        });
        break;
      case 'push':
        await g.push(url === undefined ? {} : { url });
        break;
    }
    return 0;
  } catch (e) {
    ctx.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 128;
  }
}

/** Repo name from a clone URL: last path segment, trailing slashes + `.git` stripped. */
function basenameFromUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1).replace(/\.git$/, '');
}

/**
 * Resolve `git clone <url> [<dir>]`'s destination. `display` is the name as git
 * reports it (the `<dir>` arg verbatim, else the url basename); `target` is the
 * absolute VFS path (relative `<dir>`/basename joined onto `cwd`). Exported for
 * unit coverage.
 */
export function cloneDestination(
  url: string,
  arg: string | undefined,
  cwd: string,
): { display: string; target: string } {
  const display = arg ?? basenameFromUrl(url);
  const target = isAbsolute(display)
    ? normalizePath(display)
    : normalizePath(joinPath(cwd, display));
  return { display, target };
}

/**
 * `git clone <url> [<dir>]` — clone into a NEW subdirectory (the url basename, or
 * the explicit `<dir>`), NOT the cwd; refuses a non-empty destination with git's
 * exact `fatal: destination path ... already exists` (exit 128). Unsupported
 * transports / CORS / network errors surface loud (exit 128), never a fake success.
 */
async function doClone(vfs: Vfs, args: string[], ctx: CommandContext): Promise<number> {
  const url = args[1];
  if (url === undefined) {
    ctx.stderr.write('git: clone requires a <url>\n');
    return 128;
  }
  const { display, target } = cloneDestination(url, args[2], ctx.cwd);
  try {
    assertSupportedTransport(url); // ssh/git/… → loud before any "Cloning into".
    if (await vfs.exists(target)) {
      const entries = await vfs.readdir(target);
      if (entries.length > 0) {
        ctx.stderr.write(
          `fatal: destination path '${display}' already exists and is not an empty directory.\n`,
        );
        return 128;
      }
    }
    await vfs.mkdir(target, { recursive: true });
    ctx.stderr.write(`Cloning into '${display}'...\n`);
    const g = makeGit({ fs: vfsToGitFs(vfs), dir: target });
    await g.clone({ url });
    return 0;
  } catch (e) {
    ctx.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 128;
  }
}

/** Parent path of an absolute, normalized VFS path (`/a/b` → `/a`, `/a` → `/`). */
function parentDir(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

/**
 * Walk up from `start` for the directory that holds `.git` (real git's repository
 * discovery). Returns the repo root, or `null` if no repository governs `start`.
 */
async function findRepoRoot(vfs: Vfs, start: string): Promise<string | null> {
  let dir = normalizePath(start);
  for (;;) {
    if (await vfs.exists(joinPath(dir, '.git'))) return dir;
    const parent = parentDir(dir);
    if (parent === dir) return null; // reached `/` without finding `.git`
    dir = parent;
  }
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
  'show',
  'reflog',
  'bisect',
  'blame',
  'submodule',
  'worktree',
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

/** Verbs that operate on an EXISTING repo (everything but `init`/`clone`). */
const REPO_VERBS = new Set([
  'status',
  'add',
  'commit',
  'log',
  'diff',
  'branch',
  'checkout',
  'switch',
  'restore',
  'config',
  'fetch',
  'pull',
  'push',
]);

export const git: ShellCommand = async (args, ctx) => {
  if (ctx.signal?.aborted) return 130;

  const sub = args[0];
  const vfs = asyncVfs();
  if (!vfs) {
    ctx.stderr.write('git: no filesystem\n');
    return 128;
  }

  // `init`/`clone` CREATE a repo → no repository-existence guard.
  if (sub === 'init') {
    const g = makeGit({ fs: vfsToGitFs(vfs), dir: ctx.cwd });
    await g.init();
    ctx.stdout.write('Initialized empty Git repository\n');
    return 0;
  }
  if (sub === 'clone') return doClone(vfs, args, ctx);

  // Every other known verb needs a repository. Real git verifies one governs the
  // cwd FIRST (else `fatal: not a git repository`) — we mirror that so a non-repo
  // never silently false-succeeds (e.g. `status` reporting a clean tree). A verb
  // from a SUBDIRECTORY needs cwd-relative pathspec translation we don't have yet
  // → loud `git.subdir` ceiling (never a silent wrong-tree result).
  if (sub !== undefined && REPO_VERBS.has(sub)) {
    const root = await findRepoRoot(vfs, ctx.cwd);
    if (root === null) {
      ctx.stderr.write('fatal: not a git repository (or any of the parent directories): .git\n');
      return 128;
    }
    if (root !== normalizePath(ctx.cwd)) {
      ctx.stderr.write(
        `git: not implemented: git.subdir — run git from the repository root '${root}' (no subdirectory prefix support yet)\n`,
      );
      return 128;
    }
    const g = makeGit({ fs: vfsToGitFs(vfs), dir: root });
    switch (sub) {
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
      case 'switch':
        return doSwitch(g, args, ctx);
      case 'restore':
        return doRestore(g, args, ctx);
      case 'config':
        return doConfig(g, args, ctx);
      case 'fetch':
      case 'pull':
      case 'push':
        return doNetwork(g, sub, args, ctx);
    }
  }

  if (sub && UNIMPLEMENTED_SUBCOMMANDS.has(sub)) {
    ctx.stderr.write(
      `git: '${sub}' is not implemented in rifty (browser git subset — see docs/public/compat/git.md)\n`,
    );
    return 128;
  }
  ctx.stderr.write(`git: '${sub ?? ''}' is not a git command\n`);
  return 1;
};
