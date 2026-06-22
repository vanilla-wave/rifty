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
  type StatusEntry,
  assertSupportedTransport,
  makeGit,
  pathspecMatch,
  vfsToGitFs,
} from '@riftydev/git';
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

/** Parsed `git commit`. `messages` is one entry per `-m` (git joins them as paragraphs). */
interface CommitPlan {
  amend: boolean;
  all: boolean;
  messages: string[];
}

/**
 * Join repeated `-m` values the way git does: each is a paragraph, blank-line
 * separated, and empty values are dropped. Returns `null` if no `-m` was given,
 * `''` if every `-m` was empty (→ "Aborting commit due to empty commit message.").
 */
function joinCommitMessages(messages: string[]): string | null {
  if (messages.length === 0) return null;
  const nonEmpty = messages.filter((m) => m !== '');
  return nonEmpty.length === 0 ? '' : nonEmpty.join('\n\n');
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
  const messages: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i] as string;
    if (t === '--amend') {
      amend = true;
    } else if (t === '-a' || t === '--all') {
      all = true;
    } else if (t === '-m' || t === '--message') {
      messages.push(rest[++i] ?? '');
    } else if (t.startsWith('--message=')) {
      messages.push(t.slice('--message='.length));
    } else if (t.startsWith('-')) {
      throw new NotImplementedError(`git.commit.${t.replace(/^-+/, '')}`);
    } else {
      throw new NotImplementedError(
        'git.commit.pathspec',
        'commit with explicit paths is unsupported',
      );
    }
  }
  return { amend, all, messages };
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
  try {
    const entries = await g.status();
    if (porcelain) {
      ctx.stdout.write(renderPorcelain(entries));
    } else {
      const branch = await g.currentBranch();
      ctx.stdout.write(renderStatusSummary(branch, entries));
    }
    return 0;
  } catch (e) {
    // Defense-in-depth: a corrupt repo throws iso-git NotFoundError — map to a
    // `fatal:` exit 128 rather than leak it as the shell's generic exit-1.
    if (isNotFound(e)) {
      ctx.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
      return 128;
    }
    throw e;
  }
}

/** True when an iso-git error is a "not found" plumbing error (vs a real bug). */
function isNotFound(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (e as { name?: string })?.name === 'NotFoundError' || /could not find/i.test(msg);
}

/** Parsed `git add`: the recognized flags + the pathspecs. */
interface AddPlan {
  all: boolean;
  update: boolean;
  force: boolean;
  pathspecs: string[];
}

/**
 * Parse `git add` flags. Recognizes `-A`/`--all`, `-u`/`--update`, `-f`/`--force`
 * (incl. combined short clusters `-Af`). Any OTHER flag loud-throws
 * `git.add.<flag>` (exit 128) — never silently dropped (the flag discipline
 * commit/switch/restore enforce). `--` separates flags from pathspecs.
 */
function parseAdd(args: string[]): AddPlan {
  let all = false;
  let update = false;
  let force = false;
  const pathspecs: string[] = [];
  let flagsDone = false;
  for (const t of args.slice(1)) {
    if (flagsDone) {
      pathspecs.push(t);
      continue;
    }
    if (t === '--') {
      flagsDone = true;
    } else if (t === '--all') {
      all = true;
    } else if (t === '--update') {
      update = true;
    } else if (t === '--force') {
      force = true;
    } else if (t.startsWith('--')) {
      throw new NotImplementedError(`git.add.${t.replace(/^-+/, '')}`);
    } else if (t.length > 1 && t.startsWith('-')) {
      for (const c of t.slice(1)) {
        if (c === 'A') all = true;
        else if (c === 'u') update = true;
        else if (c === 'f') force = true;
        else throw new NotImplementedError(`git.add.${c}`);
      }
    } else {
      pathspecs.push(t);
    }
  }
  return { all, update, force, pathspecs };
}

async function doAdd(
  g: Git,
  args: string[],
  ctx: CommandContext,
  vfs: Vfs,
  dir: string,
): Promise<number> {
  let plan: AddPlan;
  try {
    plan = parseAdd(args);
  } catch (e) {
    return renderCheckoutError(e, ctx); // unknown flag → loud exit 128
  }

  // `-A`/`--all`/`.` → stage every change (incl. untracked, excl. .gitignore'd).
  if (plan.all || plan.pathspecs.includes('.')) {
    await addAll(g);
    return 0;
  }
  // `git add -u` (no pathspec) → stage tracked modifications + deletions only.
  if (plan.update && plan.pathspecs.length === 0) {
    await stageTrackedChanges(g);
    return 0;
  }
  if (plan.pathspecs.length === 0) {
    // Real git: advisory to stderr, exit 0 (NOT an error).
    ctx.stderr.write('Nothing specified, nothing added.\n');
    ctx.stderr.write("hint: Maybe you wanted to say 'git add .'?\n");
    return 0;
  }

  // Explicit pathspecs: ALL-OR-NOTHING (real git validates every pathspec before
  // touching the index — a single miss stages nothing). A path absent from both
  // the worktree and the index → `fatal: pathspec … did not match`. An untracked
  // path matched only by .gitignore → refuse unless `-f` (real git). Ignored
  // detection is via statusMatrix, which excludes .gitignore'd paths: a worktree
  // path that is neither tracked NOR surfaced as a status change IS ignored.
  const [tracked, changed] = await Promise.all([g.listFiles(), g.status()]);
  const surfaced = (spec: string): boolean => changed.some((e) => pathspecMatch(e.filepath, spec));
  const resolved: { spec: string; exists: boolean }[] = [];
  for (const spec of plan.pathspecs) {
    const exists = await vfs.exists(normalizePath(joinPath(dir, spec)));
    const isTracked = tracked.some((p) => pathspecMatch(p, spec));
    if (!exists && !isTracked) {
      ctx.stderr.write(`fatal: pathspec '${spec}' did not match any files\n`);
      return 128;
    }
    if (exists && !isTracked && !plan.force && !surfaced(spec)) {
      ctx.stderr.write('The following paths are ignored by one of your .gitignore files:\n');
      ctx.stderr.write(`${spec}\n`);
      ctx.stderr.write('hint: Use -f if you really want to add them.\n');
      return 1;
    }
    resolved.push({ spec, exists });
  }
  for (const { spec, exists } of resolved) {
    // Present → stage content; gone-but-tracked → stage the deletion (real git).
    if (exists) await g.add(spec);
    else await g.remove(spec);
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

  let message = joinCommitMessages(plan.messages);
  // An explicit empty `-m ''` is git's `Aborting commit due to empty commit
  // message.` (exit 1) — not a leaked iso-git MissingParameterError. `--amend`
  // with an empty `-m` still aborts; with no `-m` it reuses the prior message.
  if (message === '' && !plan.amend) {
    ctx.stderr.write('Aborting commit due to empty commit message.\n');
    return 1;
  }
  if (plan.amend) {
    // `--amend` reads the prior commit defensively: an UNBORN HEAD (fresh repo,
    // no commit) makes g.log() throw "Could not find HEAD" → real git's
    // "fatal: You have nothing to amend." (exit 128), never a leaked exit-1.
    const prior = (await g.log().catch(() => []))[0];
    if (prior === undefined) {
      ctx.stderr.write('fatal: You have nothing to amend.\n');
      return 128;
    }
    if (message === '') {
      ctx.stderr.write('Aborting commit due to empty commit message.\n');
      return 1;
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
  // git's one-line summary shows only the first line of the message.
  const subject = message.split('\n', 1)[0] ?? '';
  ctx.stdout.write(`[${branch} ${short(oid)}] ${subject}\n`);
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

async function doDiff(g: Git, args: string[], ctx: CommandContext): Promise<number> {
  // Only bare `git diff` (unstaged, index↔workdir) is implemented. `--staged`/
  // `--cached`/`HEAD`/two-ref/pathspec forms select DIFFERENT content — surfacing
  // the bare diff for them would be a SILENT-WRONG result, so loud-throw instead.
  const extra = args.slice(1).filter((a) => a !== '--');
  if (extra.length > 0) {
    return renderCheckoutError(
      new NotImplementedError(
        `git.diff.${extra[0]?.replace(/^-+/, '') || 'args'}`,
        'only bare `git diff` (unstaged, index↔workdir) is supported',
      ),
      ctx,
    );
  }
  const entries = await g.diff();
  for (const e of entries) {
    ctx.stdout.write(`diff --git a/${e.filepath} b/${e.filepath}\n`);
    if (e.binary) {
      // git renders binary changes as a single marker line, never a text hunk.
      ctx.stdout.write(`Binary files a/${e.filepath} and b/${e.filepath} differ\n`);
      continue;
    }
    for (const h of e.hunks) {
      ctx.stdout.write(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n`);
      for (const line of h.lines) ctx.stdout.write(`${line}\n`);
    }
  }
  return 0;
}

async function doBranch(g: Git, ctx: CommandContext): Promise<number> {
  try {
    const [branches, current] = await Promise.all([g.listBranches(), g.currentBranch()]);
    for (const b of branches) {
      ctx.stdout.write(`${b === current ? '* ' : '  '}${b}\n`);
    }
    return 0;
  } catch (e) {
    // Defense-in-depth (corrupt repo): map iso-git NotFoundError to fatal 128
    // rather than leak it as the shell's generic exit-1.
    if (isNotFound(e)) {
      ctx.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
      return 128;
    }
    throw e;
  }
}

/**
 * Run a NETWORK verb (`fetch`/`pull`/`push`) over smart-HTTP on an existing repo.
 * Any failure — an unsupported-transport / cross-origin NotImplementedError, or a
 * real network/protocol error from isomorphic-git — surfaces as a loud exit-128
 * with its message on stderr (never a fake success). The `<url>` positional is
 * optional (else the remote config is used). `pull` commits the merge under the
 * shell-env identity. (`clone` is separate — see {@link doClone}.)
 */
/** True if a token is a clone/remote URL (has a scheme, is scp-like, or a path) vs a remote NAME. */
function isUrlLike(s: string): boolean {
  return (
    /:\/\//.test(s) ||
    /^([^@/]+@)?[A-Za-z0-9._-]+:(?![/0-9])/.test(s) ||
    s.startsWith('/') ||
    s.startsWith('.')
  );
}

async function doNetwork(
  g: Git,
  verb: 'fetch' | 'pull' | 'push',
  args: string[],
  ctx: CommandContext,
): Promise<number> {
  // The first positional is a URL only if it LOOKS like one; otherwise it is a
  // remote NAME (`git push origin main`) — passing a bare name as `url` would
  // wrongly hit the transport ceiling. A second positional is the refspec.
  const positionals: string[] = [];
  let force = false;
  for (const t of args.slice(1)) {
    if (t === '-f' || t === '--force') {
      force = true;
    } else if (t.startsWith('-')) {
      return renderCheckoutError(
        new NotImplementedError(`git.${verb}.${t.replace(/^-+/, '')}`),
        ctx,
      );
    } else {
      positionals.push(t);
    }
  }
  const first = positionals[0];
  const url = first !== undefined && isUrlLike(first) ? first : undefined;
  const remote = first !== undefined && !isUrlLike(first) ? first : undefined;
  const ref = positionals[1];
  const target = {
    ...(url !== undefined ? { url } : {}),
    ...(remote !== undefined ? { remote } : {}),
    ...(ref !== undefined ? { ref } : {}),
  };
  try {
    switch (verb) {
      case 'fetch':
        await g.fetch(target);
        break;
      case 'pull':
        await g.pull({ ...target, author: await identityFrom(g, ctx.env) });
        break;
      case 'push':
        await g.push({ ...target, ...(force ? { force: true } : {}) });
        break;
    }
    return 0;
  } catch (e) {
    ctx.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 128;
  }
}

/**
 * Repo name from a clone URL: last path segment, trailing slashes + `.git`
 * stripped. Falls back to the URL host when the path segment is empty (e.g.
 * `https://host/.git`) so the destination is never an empty string (real git).
 */
function basenameFromUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  const seg = trimmed.slice(trimmed.lastIndexOf('/') + 1).replace(/\.git$/, '');
  if (seg) return seg;
  try {
    return new URL(url).hostname || 'repo';
  } catch {
    return 'repo';
  }
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
    ctx.stderr.write('fatal: You must specify a repository to clone.\n');
    return 128;
  }
  const { display, target } = cloneDestination(url, args[2], ctx.cwd);
  try {
    // Real git's order: the destination-exists guard fires BEFORE transport
    // handling, so an ssh url + a non-empty dest reports the dest fatal (not the
    // transport ceiling).
    if (await vfs.exists(target)) {
      const entries = await vfs.readdir(target);
      if (entries.length > 0) {
        ctx.stderr.write(
          `fatal: destination path '${display}' already exists and is not an empty directory.\n`,
        );
        return 128;
      }
    }
    assertSupportedTransport(url); // ssh/git/… → loud, before any "Cloning into".
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
 * Walk up from `start` for the directory that holds a VALID `.git` (real git's
 * repository discovery). Validity = `.git/HEAD` exists — a bare `mkdir .git`,
 * an empty/partial `.git`, or a `.git` FILE (gitlink, which rifty never creates)
 * is NOT a repo, so discovery keeps walking up (else a stray `.git` would make a
 * non-repo falsely look clean). Returns the repo root, or `null` if none governs.
 */
async function findRepoRoot(vfs: Vfs, start: string): Promise<string | null> {
  let dir = normalizePath(start);
  for (;;) {
    if (await vfs.exists(joinPath(dir, '.git/HEAD'))) return dir;
    const parent = parentDir(dir);
    if (parent === dir) return null; // reached `/` without finding a valid `.git`
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
        return doAdd(g, args, ctx, vfs, root);
      case 'commit':
        return doCommit(g, args, ctx);
      case 'log':
        return doLog(g, args, ctx);
      case 'diff':
        return doDiff(g, args, ctx);
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
