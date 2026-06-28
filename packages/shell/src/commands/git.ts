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
  porcelainXY,
  vfsToGitFs,
} from '@riftydev/git';
import { NotImplementedError } from '@riftydev/io';
import { asyncVfs, isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';
import type { CommandContext, ShellCommand } from '../types.ts';
import {
  OutsideRepoPathspecError,
  doCheckout,
  renderCheckoutError,
  renderCheckoutOrFatal,
  renderRevisionAndPathAmbiguity,
  revisionExists,
} from './_git-checkout.ts';
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

function isIndexDeletion(e: StatusEntry): boolean {
  return e.status[0] === '1' && e.status[1] === '0';
}

async function stageStatusEntries(
  g: Git,
  entries: StatusEntry[],
  opts: { force?: boolean } = {},
): Promise<void> {
  for (const e of entries) {
    if (e.status === '111') continue;
    if (isIndexDeletion(e)) await g.remove(e.filepath);
    else await g.add(e.filepath, opts);
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

type PathspecMapper = (pathspec: string) => string;

const identityPathspec: PathspecMapper = (pathspec) => pathspec;

function makeRepoPathspecMapper(root: string, cwd: string): PathspecMapper {
  const repoRoot = normalizePath(root);
  const repoCwd = normalizePath(cwd);
  return (pathspec: string): string => {
    if (pathspec === '') return pathspec;
    const absolute =
      pathspec === '.'
        ? repoCwd
        : isAbsolute(pathspec)
          ? normalizePath(pathspec)
          : normalizePath(joinPath(repoCwd, pathspec));
    if (absolute === repoRoot) return '.';
    if (absolute.startsWith(`${repoRoot}/`)) return absolute.slice(repoRoot.length + 1);
    throw new OutsideRepoPathspecError(pathspec, repoRoot);
  };
}

function renderAmbiguousArgument(arg: string, ctx: CommandContext): number {
  ctx.stderr.write(
    `fatal: ambiguous argument '${arg}': unknown revision or path not in the working tree.\n`,
  );
  ctx.stderr.write("Use '--' to separate paths from revisions, like this:\n");
  ctx.stderr.write("'git <command> [<revision>...] -- [<file>...]'\n");
  return 128;
}

async function validateImplicitPathspecs(
  g: Git,
  rawPathspecs: string[],
  mappedPathspecs: string[],
  ctx: CommandContext,
): Promise<number | null> {
  const entries = await g.status();
  for (let i = 0; i < mappedPathspecs.length; i++) {
    const spec = mappedPathspecs[i] as string;
    if (entries.some((entry) => pathspecMatch(entry.filepath, spec))) continue;
    return renderAmbiguousArgument(rawPathspecs[i] ?? spec, ctx);
  }
  return null;
}

async function tokenMatchesWorktreePath(
  g: Git,
  token: string,
  mapPathspec: PathspecMapper,
): Promise<boolean> {
  let mapped: string;
  try {
    mapped = mapPathspec(token);
  } catch {
    return false;
  }
  return (await g.status()).some((entry) => pathspecMatch(entry.filepath, mapped));
}

async function tokenIsRevision(g: Git, token: string): Promise<boolean> {
  try {
    return await revisionExists(g, token);
  } catch (e) {
    if (e instanceof NotImplementedError) throw e;
    return false;
  }
}

async function renderIfRevisionAndPath(
  g: Git,
  token: string,
  ctx: CommandContext,
  mapPathspec: PathspecMapper,
): Promise<number | null> {
  if (
    (await tokenIsRevision(g, token)) &&
    (await tokenMatchesWorktreePath(g, token, mapPathspec))
  ) {
    return renderRevisionAndPathAmbiguity(token, ctx);
  }
  return null;
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
  root: string,
  mapPathspec: PathspecMapper = identityPathspec,
): Promise<number> {
  let plan: AddPlan;
  try {
    plan = parseAdd(args);
  } catch (e) {
    return renderCheckoutError(e, ctx); // unknown flag → loud exit 128
  }
  let pathspecs: string[];
  try {
    pathspecs = plan.pathspecs.map(mapPathspec);
  } catch (e) {
    return renderCheckoutError(e, ctx);
  }

  // `-A`/`--all` with no pathspec → stage every change (incl. untracked,
  // excl. .gitignore'd). With a pathspec, fall through to pathspec-scoped
  // status staging below.
  if (plan.all && pathspecs.length === 0) {
    await addAll(g);
    return 0;
  }
  // `git add -u` (no pathspec) → stage tracked modifications + deletions only.
  if (plan.update && pathspecs.length === 0) {
    await stageTrackedChanges(g);
    return 0;
  }
  if (pathspecs.length === 0) {
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
  for (const spec of pathspecs) {
    const exists = await vfs.exists(normalizePath(joinPath(root, spec)));
    const isTracked = tracked.some((p) => pathspecMatch(p, spec));
    if (plan.update && !isTracked) {
      ctx.stderr.write(`error: pathspec '${spec}' did not match any file(s) known to git\n`);
      return 128;
    }
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
  const toStage = changed.filter((e) => {
    if (!pathspecs.some((spec) => pathspecMatch(e.filepath, spec))) return false;
    return !plan.update || e.status[0] === '1';
  });
  await stageStatusEntries(g, toStage, { force: plan.force });

  const stagedPaths = new Set(toStage.map((e) => e.filepath));
  for (const { spec, exists } of resolved) {
    if (!exists || plan.update) continue;
    if (stagedPaths.has(spec) && !plan.force) continue;
    if (plan.force || !changed.some((e) => pathspecMatch(e.filepath, spec))) {
      await g.add(spec, { force: plan.force });
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

async function doLog(
  g: Git,
  args: string[],
  ctx: CommandContext,
  mapPathspec: PathspecMapper = identityPathspec,
): Promise<number> {
  let oneline = false;
  let depth: number | undefined;
  let format: string | undefined;
  const refs: string[] = [];
  const pathspecs: string[] = [];
  let flagsDone = false;
  let implicitPathspecs = false;
  for (let i = 1; i < args.length; i++) {
    const t = args[i] as string;
    if (flagsDone) pathspecs.push(t);
    else if (t === '--') flagsDone = true;
    else if (t === '--oneline') oneline = true;
    else if (t === '-n' || t === '--max-count') {
      const raw = args[++i];
      if (raw === undefined || !/^\d+$/.test(raw)) {
        ctx.stderr.write(`fatal: '${raw ?? ''}': not an integer\n`);
        return 128;
      }
      depth = Number(raw);
    } else if (t.startsWith('-n') && /^-n\d+$/.test(t)) {
      depth = Number(t.slice(2));
    } else if (t.startsWith('--max-count=')) {
      const raw = t.slice('--max-count='.length);
      if (!/^\d+$/.test(raw)) {
        ctx.stderr.write(`fatal: '${raw}': not an integer\n`);
        return 128;
      }
      depth = Number(raw);
    } else if (t.startsWith('--format=')) {
      format = t.slice('--format='.length);
    } else if (t === '--format') {
      format = args[++i] ?? '';
    } else if (t.startsWith('-')) {
      return renderCheckoutError(new NotImplementedError(`git.log.${t.replace(/^-+/, '')}`), ctx);
    } else {
      refs.push(t);
    }
  }
  let refArgs = refs;
  let pathspecArgs = pathspecs;
  if (!flagsDone && pathspecs.length === 0 && refs.length > 0) {
    const first = refs[0] as string;
    if (first.includes('..')) {
      refArgs = [first];
      pathspecArgs = refs.slice(1);
      implicitPathspecs = pathspecArgs.length > 0;
    } else {
      let firstIsRev: boolean;
      try {
        firstIsRev = await revisionExists(g, first);
      } catch (e) {
        return renderCheckoutError(e, ctx);
      }
      if (firstIsRev) {
        if (await tokenMatchesWorktreePath(g, first, mapPathspec)) {
          return renderRevisionAndPathAmbiguity(first, ctx);
        }
        refArgs = [first];
        pathspecArgs = refs.slice(1);
        implicitPathspecs = pathspecArgs.length > 0;
      } else {
        refArgs = [];
        pathspecArgs = refs;
        implicitPathspecs = true;
      }
    }
  }
  if (pathspecArgs.length > 1)
    return renderCheckoutError(new NotImplementedError('git.log.multiple-pathspecs'), ctx);
  if (refArgs.length > 1) return renderCheckoutError(new NotImplementedError('git.log.refs'), ctx);
  const unsupportedFormat = format === undefined ? undefined : unsupportedLogFormatToken(format);
  if (unsupportedFormat !== undefined) {
    return renderCheckoutError(new NotImplementedError(`git.log.format.${unsupportedFormat}`), ctx);
  }
  if (implicitPathspecs) {
    try {
      for (const token of pathspecArgs) {
        const ambiguity = await renderIfRevisionAndPath(g, token, ctx, mapPathspec);
        if (ambiguity !== null) return ambiguity;
      }
    } catch (e) {
      return renderCheckoutError(e, ctx);
    }
  }
  const mappedPathspecs = pathspecArgs.map(mapPathspec);
  if (implicitPathspecs && mappedPathspecs.length > 0) {
    const ambiguity = await validateImplicitPathspecs(g, pathspecArgs, mappedPathspecs, ctx);
    if (ambiguity !== null) return ambiguity;
  }
  let entries: Awaited<ReturnType<Git['log']>>;
  try {
    const ref = refArgs[0];
    const filepath = mappedPathspecs[0];
    if (ref?.includes('..')) {
      const [base, tip] = ref.split('..');
      const include = await g.log({ ref: tip || 'HEAD', ...(filepath ? { filepath } : {}) });
      const exclude = new Set(
        (await g.log({ ref: base || 'HEAD', ...(filepath ? { filepath } : {}) })).map((e) => e.oid),
      );
      entries = include.filter((e) => !exclude.has(e.oid));
      if (depth !== undefined) entries = entries.slice(0, depth);
    } else {
      entries = await g.log({
        ...(ref ? { ref } : {}),
        ...(depth !== undefined ? { depth } : {}),
        ...(filepath ? { filepath } : {}),
      });
    }
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
  renderLogEntries(entries, { oneline, ...(format !== undefined ? { format } : {}) }, ctx);
  return 0;
}

function unsupportedLogFormatToken(format: string): string | undefined {
  const supported = new Set(['H', 'h', 's', 'an', 'ae']);
  for (let i = 0; i < format.length; i++) {
    if (format[i] !== '%') continue;
    const rest = format.slice(i + 1);
    if (rest.startsWith('%')) {
      i += 1;
      continue;
    }
    const two = rest.slice(0, 2);
    if (supported.has(two)) {
      i += 2;
      continue;
    }
    const one = rest.slice(0, 1);
    if (supported.has(one)) {
      i += 1;
      continue;
    }
    return two.length === 2 && /^[A-Za-z]{2}$/.test(two) ? two : one || 'trailing-percent';
  }
  return undefined;
}

type DiffOutputMode = 'patch' | 'name-only' | 'name-status' | 'stat';

async function doDiff(
  g: Git,
  args: string[],
  ctx: CommandContext,
  mapPathspec: PathspecMapper = identityPathspec,
): Promise<number> {
  const rest = args.slice(1);
  const dashDash = rest.indexOf('--');
  const beforeDash = dashDash === -1 ? rest : rest.slice(0, dashDash);
  const afterDash = dashDash === -1 ? [] : rest.slice(dashDash + 1);
  const positionals: string[] = [];
  let staged = false;
  let outputMode: DiffOutputMode = 'patch';
  for (const t of beforeDash) {
    if (t === '--cached' || t === '--staged') staged = true;
    else if (t === '--name-only') outputMode = 'name-only';
    else if (t === '--name-status') outputMode = 'name-status';
    else if (t === '--stat') outputMode = 'stat';
    else if (t.startsWith('-')) {
      return renderCheckoutError(new NotImplementedError(`git.diff.${t.replace(/^-+/, '')}`), ctx);
    } else positionals.push(t);
  }
  let refs = positionals;
  let pathspecs = afterDash;
  let implicitPathspecs = false;
  let entries: Awaited<ReturnType<Git['diff']>>;
  try {
    if (dashDash === -1 && positionals.length > 0) {
      const first = positionals[0] as string;
      const firstIsRev = await revisionExists(g, first);
      if (!firstIsRev) {
        refs = [];
        pathspecs = positionals;
        implicitPathspecs = true;
      } else {
        if (await tokenMatchesWorktreePath(g, first, mapPathspec)) {
          return renderRevisionAndPathAmbiguity(first, ctx);
        }
        const second = positionals[1];
        const secondIsRev = second === undefined ? false : await revisionExists(g, second);
        if (
          second !== undefined &&
          secondIsRev &&
          (await tokenMatchesWorktreePath(g, second, mapPathspec))
        ) {
          return renderRevisionAndPathAmbiguity(second, ctx);
        }
        refs = secondIsRev ? positionals.slice(0, 2) : positionals.slice(0, 1);
        pathspecs = secondIsRev ? positionals.slice(2) : positionals.slice(1);
        implicitPathspecs = pathspecs.length > 0;
      }
    }
    const rawPathspecs = pathspecs;
    if (implicitPathspecs) {
      for (const token of rawPathspecs) {
        const ambiguity = await renderIfRevisionAndPath(g, token, ctx, mapPathspec);
        if (ambiguity !== null) return ambiguity;
      }
    }
    pathspecs = pathspecs.map(mapPathspec);
    if (implicitPathspecs && pathspecs.length > 0) {
      const ambiguity = await validateImplicitPathspecs(g, rawPathspecs, pathspecs, ctx);
      if (ambiguity !== null) return ambiguity;
    }
    if (staged) {
      if (refs.length > 1)
        return renderCheckoutError(new NotImplementedError('git.diff.cached-refs'), ctx);
      entries = await g.diff({ kind: 'staged', ...(refs[0] ? { ref: refs[0] } : {}), pathspecs });
    } else if (refs.length === 0) {
      entries = await g.diff({ kind: 'unstaged', pathspecs });
    } else if (refs.length === 1) {
      const ref = refs[0] as string;
      entries =
        ref === 'HEAD'
          ? await g.diff({ kind: 'head-workdir', pathspecs })
          : await g.diff({ kind: 'ref-workdir', ref, pathspecs });
    } else if (refs.length === 2) {
      entries = await g.diff({
        kind: 'refs',
        oldRef: refs[0] as string,
        newRef: refs[1] as string,
        pathspecs,
      });
    } else {
      return renderCheckoutError(new NotImplementedError('git.diff.args'), ctx);
    }
  } catch (e) {
    return renderCheckoutOrFatal(e, ctx);
  }
  renderDiffEntries(entries, ctx, outputMode);
  return 0;
}

function diffStatus(change: Awaited<ReturnType<Git['diff']>>[number]['change']): string {
  if (change === 'add') return 'A';
  if (change === 'delete') return 'D';
  return 'M';
}

function renderDiffEntries(
  entries: Awaited<ReturnType<Git['diff']>>,
  ctx: CommandContext,
  mode: DiffOutputMode = 'patch',
): void {
  if (mode === 'name-only') {
    for (const e of entries) ctx.stdout.write(`${e.filepath}\n`);
    return;
  }
  if (mode === 'name-status') {
    for (const e of entries) ctx.stdout.write(`${diffStatus(e.change)}\t${e.filepath}\n`);
    return;
  }
  if (mode === 'stat') {
    let files = 0;
    let insertions = 0;
    let deletions = 0;
    for (const e of entries) {
      files += 1;
      let adds = 0;
      let dels = 0;
      for (const h of e.hunks) {
        for (const line of h.lines) {
          if (line.startsWith('+')) adds += 1;
          if (line.startsWith('-')) dels += 1;
        }
      }
      insertions += adds;
      deletions += dels;
      const total = e.binary ? 'Bin' : String(adds + dels);
      const graph = e.binary
        ? ''
        : ` ${'+'.repeat(Math.min(adds, 20))}${'-'.repeat(Math.min(dels, 20))}`;
      ctx.stdout.write(` ${e.filepath} | ${total}${graph}\n`);
    }
    if (files > 0) {
      const parts = [`${files} ${files === 1 ? 'file' : 'files'} changed`];
      if (insertions > 0)
        parts.push(`${insertions} ${insertions === 1 ? 'insertion' : 'insertions'}(+)`);
      if (deletions > 0)
        parts.push(`${deletions} ${deletions === 1 ? 'deletion' : 'deletions'}(-)`);
      ctx.stdout.write(` ${parts.join(', ')}\n`);
    }
    return;
  }
  for (const e of entries) {
    ctx.stdout.write(`diff --git a/${e.filepath} b/${e.filepath}\n`);
    if (e.binary) {
      // git renders binary changes as a single marker line, never a text hunk.
      ctx.stdout.write(`Binary files a/${e.filepath} and b/${e.filepath} differ\n`);
      continue;
    }
    ctx.stdout.write(`${e.change === 'add' ? '--- /dev/null' : `--- a/${e.filepath}`}\n`);
    ctx.stdout.write(`${e.change === 'delete' ? '+++ /dev/null' : `+++ b/${e.filepath}`}\n`);
    for (const h of e.hunks) {
      ctx.stdout.write(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n`);
      for (const line of h.lines) ctx.stdout.write(`${line}\n`);
    }
  }
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

function formatLogEntry(e: Awaited<ReturnType<Git['log']>>[number], format: string): string {
  const subject = e.message.split('\n', 1)[0] ?? '';
  return format
    .replaceAll('%H', e.oid)
    .replaceAll('%h', short(e.oid))
    .replaceAll('%s', subject)
    .replaceAll('%an', e.author.name)
    .replaceAll('%ae', e.author.email);
}

function renderLogEntries(
  entries: Awaited<ReturnType<Git['log']>>,
  mode: { oneline: boolean; format?: string },
  ctx: CommandContext,
): void {
  for (const e of entries) {
    if (mode.format !== undefined) {
      ctx.stdout.write(`${formatLogEntry(e, mode.format)}\n`);
    } else if (mode.oneline) {
      const firstLine = e.message.split('\n', 1)[0] ?? '';
      ctx.stdout.write(`${short(e.oid)} ${firstLine}\n`);
    } else {
      ctx.stdout.write(`commit ${e.oid}\n`);
      if (e.parents.length > 1) {
        ctx.stdout.write(`Merge: ${e.parents.map(short).join(' ')}\n`);
      }
      ctx.stdout.write(`Author: ${e.author.name} <${e.author.email}>\n`);
      ctx.stdout.write('\n');
      ctx.stdout.write(`    ${e.message.trimEnd()}\n`);
      ctx.stdout.write('\n');
    }
  }
}

async function doReset(
  g: Git,
  args: string[],
  ctx: CommandContext,
  mapPathspec: PathspecMapper = identityPathspec,
): Promise<number> {
  let mode: 'soft' | 'mixed' | 'hard' = 'mixed';
  const rest = args.slice(1);
  const dashDash = rest.indexOf('--');
  const beforeDash = dashDash === -1 ? rest : rest.slice(0, dashDash);
  const afterDash = dashDash === -1 ? [] : rest.slice(dashDash + 1);
  const positionals: string[] = [];

  for (const t of beforeDash) {
    if (t === '--soft') {
      mode = 'soft';
    } else if (t === '--mixed') {
      mode = 'mixed';
    } else if (t === '--hard') {
      mode = 'hard';
    } else if (t.startsWith('-')) {
      return renderCheckoutError(new NotImplementedError(`git.reset.${t.replace(/^-+/, '')}`), ctx);
    } else {
      positionals.push(t);
    }
  }

  let target = 'HEAD';
  let pathspecs: string[] = [];
  if (dashDash !== -1) {
    if (positionals.length > 1)
      return renderCheckoutError(new NotImplementedError('git.reset.args'), ctx);
    if (positionals[0] !== undefined) target = positionals[0];
    pathspecs = afterDash;
  } else if (positionals.length > 0) {
    const first = positionals[0] as string;
    let firstIsRev: boolean;
    try {
      firstIsRev = await revisionExists(g, first);
    } catch (e) {
      return renderCheckoutError(e, ctx);
    }
    if (firstIsRev) {
      if (await tokenMatchesWorktreePath(g, first, mapPathspec)) {
        return renderRevisionAndPathAmbiguity(first, ctx);
      }
      target = first;
      pathspecs = positionals.slice(1);
    } else {
      pathspecs = positionals;
    }
  }

  if (pathspecs.length > 0) {
    try {
      pathspecs = pathspecs.map(mapPathspec);
    } catch (e) {
      return renderCheckoutError(e, ctx);
    }
    if (mode !== 'mixed') {
      return renderCheckoutError(new NotImplementedError('git.reset.mode-with-pathspec'), ctx);
    }
    if (target !== 'HEAD') {
      let targetOid: string;
      let headOid: string;
      try {
        [targetOid, headOid] = await Promise.all([
          g.resolveRevision(target),
          g.resolveRevision('HEAD'),
        ]);
      } catch (e) {
        return renderCheckoutOrFatal(e, ctx);
      }
      if (targetOid !== headOid) {
        return renderCheckoutError(new NotImplementedError('git.reset.path-source'), ctx);
      }
    }
    const tracked = await g.listFiles();
    const paths = new Set<string>();
    for (const spec of pathspecs) {
      const matches = tracked.filter((p) => pathspecMatch(p, spec));
      if (matches.length === 0) {
        ctx.stderr.write(
          `fatal: ambiguous argument '${spec}': unknown revision or path not in the working tree.\n`,
        );
        return 128;
      }
      for (const p of matches) paths.add(p);
    }
    for (const p of paths) await g.unstage(p);
    return 0;
  }

  try {
    await g.reset({ target, mode });
    if (mode === 'hard') {
      const head = (await g.log({ depth: 1 }))[0];
      if (head !== undefined) {
        const subject = head.message.split('\n', 1)[0] ?? '';
        ctx.stdout.write(`HEAD is now at ${short(head.oid)} ${subject}\n`);
      }
    } else if (mode === 'mixed') {
      const unstaged = (await g.status()).filter(
        (e) => e.status[0] === '1' && e.status[1] !== e.status[2],
      );
      if (unstaged.length > 0) {
        ctx.stdout.write('Unstaged changes after reset:\n');
        for (const e of unstaged) {
          ctx.stdout.write(`${e.status[1] === '0' ? 'D' : 'M'}\t${e.filepath}\n`);
        }
      }
    }
    return 0;
  } catch (e) {
    ctx.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    return 128;
  }
}

async function doShow(g: Git, args: string[], ctx: CommandContext): Promise<number> {
  const rev = args[1] ?? 'HEAD';
  if (args.length > 2) return renderCheckoutError(new NotImplementedError('git.show.args'), ctx);
  try {
    const object = await g.show(rev);
    if (object.type === 'blob') {
      ctx.stdout.write(new TextDecoder().decode(object.content));
    } else if (object.type === 'commit') {
      renderLogEntries([object.commit], { oneline: false }, ctx);
      if (object.commit.parents.length <= 1) renderDiffEntries(object.diff, ctx);
    } else if (object.type === 'tree') {
      for (const e of object.entries) ctx.stdout.write(`${e.mode} ${e.type} ${e.oid}\t${e.path}\n`);
    } else {
      ctx.stdout.write(`tag ${object.tag.tag}\n`);
      ctx.stdout.write(`object ${object.tag.object}\n`);
      ctx.stdout.write(`type ${object.tag.type}\n\n`);
      ctx.stdout.write(object.tag.message);
    }
    return 0;
  } catch (e) {
    ctx.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    return 128;
  }
}

async function doTag(g: Git, args: string[], ctx: CommandContext): Promise<number> {
  const rest = args.slice(1);
  if (rest.length === 0) {
    for (const tag of await g.listTags()) ctx.stdout.write(`${tag}\n`);
    return 0;
  }
  let annotated = false;
  let force = false;
  let deleteMode = false;
  let message: string | undefined;
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i] as string;
    if (t === '-a' || t === '--annotate') annotated = true;
    else if (t === '-f' || t === '--force') force = true;
    else if (t === '-d' || t === '--delete') deleteMode = true;
    else if (t === '-m' || t === '--message') {
      const next = rest[++i];
      if (next === undefined)
        return renderCheckoutError(new NotImplementedError('git.tag.message-missing'), ctx);
      annotated = true;
      message = next;
    } else if (t.startsWith('-m')) {
      annotated = true;
      message = t.slice(2);
    } else if (t.startsWith('-'))
      return renderCheckoutError(new NotImplementedError(`git.tag.${t.replace(/^-+/, '')}`), ctx);
    else positionals.push(t);
  }
  try {
    if (deleteMode) {
      for (const name of positionals) {
        const oid = await g.resolveRef(name);
        await g.deleteTag(name);
        ctx.stdout.write(`Deleted tag '${name}' (was ${short(oid)})\n`);
      }
      return 0;
    }
    const name = positionals[0];
    if (name === undefined)
      return renderCheckoutError(new NotImplementedError('git.tag.args'), ctx);
    if (positionals.length > 2)
      return renderCheckoutError(new NotImplementedError('git.tag.args'), ctx);
    if (annotated && message === undefined)
      return renderCheckoutError(new NotImplementedError('git.tag.editor'), ctx);
    await g.createTag({
      name,
      annotated,
      ...(positionals[1] !== undefined ? { object: positionals[1] } : {}),
      ...(message !== undefined ? { message } : {}),
      tagger: await identityFrom(g, ctx.env),
      ...(force ? { force: true } : {}),
    });
    return 0;
  } catch (e) {
    ctx.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    return 128;
  }
}

async function doRemote(g: Git, args: string[], ctx: CommandContext): Promise<number> {
  const rest = args.slice(1);
  const verboseList = rest.length > 0 && rest.every((a) => a === '-v' || a === '--verbose');
  const sub = verboseList ? undefined : rest[0];
  try {
    if (sub === undefined) {
      const remotes = await g.listRemotes();
      for (const r of remotes) {
        if (verboseList) {
          ctx.stdout.write(`${r.remote}\t${r.url} (fetch)\n`);
          ctx.stdout.write(`${r.remote}\t${r.url} (push)\n`);
        } else {
          ctx.stdout.write(`${r.remote}\n`);
        }
      }
      return 0;
    }
    if (sub === 'add') {
      const operands = rest.slice(1);
      const flag = operands.find((a) => a.startsWith('-'));
      if (flag !== undefined) {
        return renderCheckoutError(
          new NotImplementedError(`git.remote.add.${flag.replace(/^-+/, '')}`),
          ctx,
        );
      }
      if (operands.length !== 2)
        return renderCheckoutError(new NotImplementedError('git.remote.add.args'), ctx);
      const [remote, url] = operands as [string, string];
      await g.addRemote(remote, url);
      return 0;
    }
    if (sub === 'remove' || sub === 'rm') {
      const operands = rest.slice(1);
      const flag = operands.find((a) => a.startsWith('-'));
      if (flag !== undefined) {
        return renderCheckoutError(
          new NotImplementedError(`git.remote.remove.${flag.replace(/^-+/, '')}`),
          ctx,
        );
      }
      if (operands.length !== 1)
        return renderCheckoutError(new NotImplementedError('git.remote.remove.args'), ctx);
      const [remote] = operands as [string];
      await g.deleteRemote(remote);
      return 0;
    }
    return renderCheckoutError(new NotImplementedError(`git.remote.${sub}`), ctx);
  } catch (e) {
    ctx.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    return 128;
  }
}

async function doGitRm(
  g: Git,
  args: string[],
  ctx: CommandContext,
  vfs: Vfs,
  root: string,
  mapPathspec: PathspecMapper = identityPathspec,
): Promise<number> {
  let cached = false;
  let force = false;
  let recursive = false;
  const specs: string[] = [];
  try {
    for (const t of args.slice(1)) {
      if (t === '--cached') cached = true;
      else if (t === '--force') {
        force = true;
      } else if (t === '--recursive') {
        recursive = true;
      } else if (t.startsWith('-') && !t.startsWith('--')) {
        for (const c of t.slice(1)) {
          if (c === 'f') force = true;
          else if (c === 'r') recursive = true;
          else return renderCheckoutError(new NotImplementedError(`git.rm.${c}`), ctx);
        }
      } else if (t.startsWith('-'))
        return renderCheckoutError(new NotImplementedError(`git.rm.${t.replace(/^-+/, '')}`), ctx);
      else specs.push(mapPathspec(t));
    }
  } catch (e) {
    return renderCheckoutError(e, ctx);
  }
  if (specs.length === 0)
    return renderCheckoutError(new NotImplementedError('git.rm.no-pathspec'), ctx);
  const tracked = await g.listFiles();
  const status = new Map((await g.status()).map((e) => [e.filepath, e.status]));
  const removals = new Set<string>();
  for (const spec of specs) {
    const matches = tracked.filter((p) => pathspecMatch(p, spec));
    if (matches.length === 0) {
      ctx.stderr.write(`fatal: pathspec '${spec}' did not match any files\n`);
      return 128;
    }
    const normalizedSpec = spec.replace(/\/+$/, '') || spec;
    if (!recursive && matches.some((p) => p !== normalizedSpec)) {
      ctx.stderr.write(`fatal: not removing '${normalizedSpec}' recursively without -r\n`);
      return 128;
    }
    if (!cached && !force) {
      const modified = matches.filter((p) => {
        const code = status.get(p);
        return code !== '111' && code !== '022' && code !== '003';
      });
      if (modified.length > 0) {
        ctx.stderr.write('error: the following file has local modifications:\n');
        for (const p of modified) ctx.stderr.write(`    ${p}\n`);
        ctx.stderr.write('(use --cached to keep the file, or -f to force removal)\n');
        return 1;
      }
    }
    for (const p of matches) removals.add(p);
  }
  for (const p of removals) {
    if (!cached) await vfs.rm(normalizePath(joinPath(root, p)), { force: true });
    await g.remove(p);
    ctx.stdout.write(`rm '${p}'\n`);
  }
  return 0;
}

async function doGitMv(
  g: Git,
  args: string[],
  ctx: CommandContext,
  vfs: Vfs,
  root: string,
  mapPathspec: PathspecMapper = identityPathspec,
): Promise<number> {
  let force = false;
  const operands: string[] = [];
  try {
    for (const t of args.slice(1)) {
      if (t === '--') continue;
      if (t === '-f' || t === '--force') force = true;
      else if (t.startsWith('-'))
        return renderCheckoutError(new NotImplementedError(`git.mv.${t.replace(/^-+/, '')}`), ctx);
      else operands.push(mapPathspec(t));
    }
  } catch (e) {
    return renderCheckoutError(e, ctx);
  }
  if (operands.length !== 2)
    return renderCheckoutError(new NotImplementedError('git.mv.args'), ctx);
  const [src, dst] = operands as [string, string];
  const srcAbs = normalizePath(joinPath(root, src));
  const dstAbs = normalizePath(joinPath(root, dst));
  try {
    const tracked = await g.listFiles();
    if (!tracked.includes(src)) {
      if (tracked.some((p) => pathspecMatch(p, src))) {
        return renderCheckoutError(new NotImplementedError('git.mv.directory'), ctx);
      }
      ctx.stderr.write(`fatal: not under version control, source=${src}, destination=${dst}\n`);
      return 128;
    }
    const dstIsDir = await vfs
      .readdir(dstAbs)
      .then(() => true)
      .catch(() => false);
    const srcName = src.replace(/\/+$/, '').split('/').pop() ?? src;
    const finalDst = dstIsDir ? normalizePath(joinPath(dst, srcName)) : dst;
    const finalDstAbs = dstIsDir ? normalizePath(joinPath(dstAbs, srcName)) : dstAbs;
    if (!force && (await vfs.exists(finalDstAbs))) {
      ctx.stderr.write(`fatal: destination exists, source=${src}, destination=${dst}\n`);
      return 128;
    }
    const bytes = await vfs.readFile(srcAbs);
    const parent = finalDstAbs.slice(0, finalDstAbs.lastIndexOf('/')) || '/';
    await vfs.mkdir(parent, { recursive: true });
    await vfs.writeFile(finalDstAbs, bytes);
    await vfs.rm(srcAbs);
    await g.remove(src);
    await g.add(finalDst);
    return 0;
  } catch (e) {
    ctx.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    return 128;
  }
}

async function doMerge(g: Git, args: string[], ctx: CommandContext): Promise<number> {
  const operands = args.slice(1);
  const flag = operands.find((a) => a.startsWith('-'));
  if (flag !== undefined) {
    return renderCheckoutError(
      new NotImplementedError(`git.merge.${flag.replace(/^-+/, '')}`),
      ctx,
    );
  }
  if (operands.length > 1)
    return renderCheckoutError(new NotImplementedError('git.merge.args'), ctx);
  const theirs = operands[0];
  if (!theirs) return renderCheckoutError(new NotImplementedError('git.merge.no-target'), ctx);
  try {
    const author = await identityFrom(g, ctx.env);
    const res = await g.merge({ theirs, author, committer: committerFrom(ctx.env, author) });
    if (res.alreadyMerged) ctx.stdout.write('Already up to date.\n');
    else if (res.fastForward) ctx.stdout.write('Fast-forward\n');
    else if (res.mergeCommit) ctx.stdout.write(`Merge made by the 'ort' strategy.\n`);
    return 0;
  } catch (e) {
    ctx.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    return 128;
  }
}

async function doCherryPick(g: Git, args: string[], ctx: CommandContext): Promise<number> {
  const operands = args.slice(1);
  const flag = operands.find((a) => a.startsWith('-'));
  if (flag !== undefined) {
    return renderCheckoutError(
      new NotImplementedError(`git.cherry-pick.${flag.replace(/^-+/, '')}`),
      ctx,
    );
  }
  if (operands.length > 1)
    return renderCheckoutError(new NotImplementedError('git.cherry-pick.multiple-commits'), ctx);
  const rev = operands[0];
  if (!rev) return renderCheckoutError(new NotImplementedError('git.cherry-pick.no-commit'), ctx);
  try {
    const oid = await g.resolveRevision(rev);
    const newOid = await g.cherryPick({
      oid,
      committer: committerFrom(ctx.env, await identityFrom(g, ctx.env)),
    });
    const branch = (await g.currentBranch()) ?? 'HEAD';
    const subject = (await g.log({ depth: 1 }))[0]?.message.split('\n', 1)[0] ?? '';
    ctx.stdout.write(`[${branch} ${short(newOid)}] ${subject}\n`);
    return 0;
  } catch (e) {
    ctx.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    return 128;
  }
}

interface RevertPlan {
  rev: string;
}

function parseRevert(args: string[]): RevertPlan {
  const operands: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const t = args[i] as string;
    if (t === '--') continue;
    if (t === '--continue') throw new NotImplementedError('git.revert.continue');
    if (t === '--abort') throw new NotImplementedError('git.revert.abort');
    if (t === '--quit') throw new NotImplementedError('git.revert.quit');
    if (t === '--skip') throw new NotImplementedError('git.revert.skip');
    if (t === '-n' || t === '--no-commit')
      throw new NotImplementedError('git.revert.no-commit-mode');
    if (t === '-m' || t === '--mainline' || t.startsWith('-m') || t.startsWith('--mainline=')) {
      throw new NotImplementedError('git.revert.mainline');
    }
    if (t === '-e' || t === '--edit' || t === '--no-edit')
      throw new NotImplementedError('git.revert.editor');
    if (t.startsWith('-')) throw new NotImplementedError(`git.revert.${t.replace(/^-+/, '')}`);
    operands.push(t);
  }
  if (operands.length === 0) throw new NotImplementedError('git.revert.no-commit');
  if (operands.length > 1) throw new NotImplementedError('git.revert.multiple-commits');
  return { rev: operands[0] as string };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function readRepoFile(vfs: Vfs, root: string, filepath: string): Promise<Uint8Array | null> {
  const abs = normalizePath(joinPath(root, filepath));
  if (!(await vfs.exists(abs))) return null;
  return vfs.readFile(abs);
}

async function writeRepoFile(
  vfs: Vfs,
  root: string,
  filepath: string,
  bytes: Uint8Array,
): Promise<void> {
  const abs = normalizePath(joinPath(root, filepath));
  await vfs.mkdir(parentDir(abs), { recursive: true });
  await vfs.writeFile(abs, bytes);
}

async function removeRepoFile(vfs: Vfs, root: string, filepath: string): Promise<void> {
  await vfs.rm(normalizePath(joinPath(root, filepath)), { force: true });
}

async function readBlobAt(g: Git, rev: string, filepath: string): Promise<Uint8Array | null> {
  try {
    const object = await g.show(`${rev}:${filepath}`);
    if (object.type !== 'blob') throw new NotImplementedError('git.revert.non-blob');
    return object.content;
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

async function assertCleanForRevert(g: Git): Promise<void> {
  const dirty = (await g.status()).filter((e) => e.status !== '111');
  if (dirty.length > 0) throw new NotImplementedError('git.revert.dirty-worktree');
}

type RevertAction =
  | { kind: 'delete'; filepath: string }
  | { kind: 'write'; filepath: string; bytes: Uint8Array };

async function planCleanRevert(
  g: Git,
  vfs: Vfs,
  root: string,
  oid: string,
  commit: Extract<Awaited<ReturnType<Git['show']>>, { type: 'commit' }>,
): Promise<RevertAction[]> {
  if (commit.commit.parents.length > 1) throw new NotImplementedError('git.revert.merge');
  if (commit.diff.length === 0) throw new NotImplementedError('git.revert.empty');

  const parent = commit.commit.parents[0];
  const actions: RevertAction[] = [];
  for (const entry of commit.diff) {
    const current = await readRepoFile(vfs, root, entry.filepath);
    const postImage = entry.change === 'delete' ? null : await readBlobAt(g, oid, entry.filepath);
    if (postImage === null) {
      if (current !== null) throw new NotImplementedError('git.revert.conflict');
    } else if (current === null || !bytesEqual(current, postImage)) {
      throw new NotImplementedError('git.revert.conflict');
    }

    if (entry.change === 'add') {
      actions.push({ kind: 'delete', filepath: entry.filepath });
      continue;
    }

    if (parent === undefined) throw new NotImplementedError('git.revert.conflict');
    const preImage = await readBlobAt(g, parent, entry.filepath);
    if (preImage === null) throw new NotImplementedError('git.revert.conflict');
    actions.push({ kind: 'write', filepath: entry.filepath, bytes: preImage });
  }
  return actions;
}

async function doRevert(
  g: Git,
  args: string[],
  ctx: CommandContext,
  vfs: Vfs,
  root: string,
): Promise<number> {
  let plan: RevertPlan;
  try {
    plan = parseRevert(args);
  } catch (e) {
    return renderCheckoutError(e, ctx);
  }

  try {
    await assertCleanForRevert(g);
    const oid = await g.resolveRevision(plan.rev);
    const object = await g.show(oid);
    if (object.type !== 'commit') {
      return renderCheckoutError(new NotImplementedError('git.revert.non-commit'), ctx);
    }
    const actions = await planCleanRevert(g, vfs, root, oid, object);
    for (const action of actions) {
      if (action.kind === 'delete') {
        await removeRepoFile(vfs, root, action.filepath);
        await g.remove(action.filepath);
      } else {
        await writeRepoFile(vfs, root, action.filepath, action.bytes);
        await g.add(action.filepath);
      }
    }

    const subject = object.commit.message.split('\n', 1)[0] ?? '';
    const message = `Revert "${subject}"\n\nThis reverts commit ${oid}.\n`;
    const author = await identityFrom(g, ctx.env);
    const newOid = await g.commit({ message, author, committer: committerFrom(ctx.env, author) });
    const branch = (await g.currentBranch()) ?? 'HEAD';
    ctx.stdout.write(`[${branch} ${short(newOid)}] Revert "${subject}"\n`);
    return 0;
  } catch (e) {
    if (e instanceof NotImplementedError) return renderCheckoutError(e, ctx);
    ctx.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    return 128;
  }
}

type ApplySource = { kind: 'file'; path: string } | { kind: 'stdin' };

function parseApply(args: string[]): ApplySource {
  const patchFiles: string[] = [];
  let flagsDone = false;
  for (const t of args.slice(1)) {
    if (flagsDone) {
      patchFiles.push(t);
      continue;
    }
    if (t === '--') {
      flagsDone = true;
      continue;
    }
    if (t === '--3way' || t === '-3') throw new NotImplementedError('git.apply.3way');
    if (t === '--cached') throw new NotImplementedError('git.apply.cached');
    if (t === '--index') throw new NotImplementedError('git.apply.index');
    if (t === '--check') throw new NotImplementedError('git.apply.check');
    if (t === '--reverse' || t === '-R') throw new NotImplementedError('git.apply.reverse');
    if (t === '--reject') throw new NotImplementedError('git.apply.reject');
    if (t === '--binary') throw new NotImplementedError('git.apply.binary');
    if (t === '--stat') throw new NotImplementedError('git.apply.stat');
    if (t === '--numstat') throw new NotImplementedError('git.apply.numstat');
    if (t === '--summary') throw new NotImplementedError('git.apply.summary');
    if (t === '--whitespace' || t.startsWith('--whitespace='))
      throw new NotImplementedError('git.apply.whitespace');
    if (/^-p\d*$/.test(t)) throw new NotImplementedError('git.apply.strip');
    if (t.startsWith('-') && t !== '-') {
      throw new NotImplementedError(`git.apply.${t.replace(/^-+/, '')}`);
    }
    patchFiles.push(t);
  }
  if (patchFiles.length === 0) return { kind: 'stdin' };
  if (patchFiles.length > 1) throw new NotImplementedError('git.apply.multiple-files');
  const patchFile = patchFiles[0] as string;
  return patchFile === '-' ? { kind: 'stdin' } : { kind: 'file', path: patchFile };
}

interface PatchLine {
  op: ' ' | '-' | '+';
  text: string;
}

interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: PatchLine[];
}

interface PatchFile {
  oldPath: string | null;
  newPath: string | null;
  hunks: PatchHunk[];
}

class ApplyPatchFailure extends Error {
  constructor(
    readonly filepath: string,
    readonly line: number,
  ) {
    super(`patch failed: ${filepath}:${line}`);
    this.name = 'ApplyPatchFailure';
  }
}

class ApplyPathFailure extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = 'ApplyPathFailure';
  }
}

function patchPath(raw: string): string | null {
  const token = raw.split('\t', 1)[0]?.trim() ?? '';
  if (token === '/dev/null') return null;
  if (token === '' || token.startsWith('"')) throw new NotImplementedError('git.apply.path');
  const stripped = token.startsWith('a/') || token.startsWith('b/') ? token.slice(2) : token;
  if (stripped === '' || isAbsolute(stripped)) throw new NotImplementedError('git.apply.path');
  const parts = stripped.split('/').filter((p) => p.length > 0);
  if (parts.length === 0 || parts.some((p) => p === '..')) {
    throw new NotImplementedError('git.apply.path');
  }
  return parts.join('/');
}

function parseHunkHeader(line: string): Omit<PatchHunk, 'lines'> {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!match) throw new NotImplementedError('git.apply.format');
  return {
    oldStart: Number(match[1]),
    oldLines: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newLines: match[4] === undefined ? 1 : Number(match[4]),
  };
}

function parseUnifiedPatch(text: string): PatchFile[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const files: PatchFile[] = [];
  let current: PatchFile | null = null;
  let i = 0;

  const ensureFile = (): PatchFile => {
    if (current === null) {
      current = { oldPath: null, newPath: null, hunks: [] };
      files.push(current);
    }
    return current;
  };

  while (i < lines.length) {
    const line = lines[i] as string;
    if (line === '') {
      i += 1;
      continue;
    }
    if (line.startsWith('diff --git ')) {
      current = { oldPath: null, newPath: null, hunks: [] };
      files.push(current);
      i += 1;
      continue;
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      throw new NotImplementedError('git.apply.binary');
    }
    if (line.startsWith('\\')) throw new NotImplementedError('git.apply.no-newline');
    if (line.startsWith('rename from ') || line.startsWith('rename to ')) {
      throw new NotImplementedError('git.apply.rename');
    }
    if (line.startsWith('copy from ') || line.startsWith('copy to ')) {
      throw new NotImplementedError('git.apply.copy');
    }
    if (line.startsWith('old mode ') || line.startsWith('new mode ')) {
      throw new NotImplementedError('git.apply.mode');
    }
    if (line.startsWith('--- ')) {
      const f = ensureFile();
      f.oldPath = patchPath(line.slice(4));
      i += 1;
      const next = lines[i];
      if (next === undefined || !next.startsWith('+++ ')) {
        throw new NotImplementedError('git.apply.format');
      }
      f.newPath = patchPath(next.slice(4));
      i += 1;
      continue;
    }
    if (line.startsWith('@@ ')) {
      const f = ensureFile();
      const header = parseHunkHeader(line);
      const hunk: PatchHunk = { ...header, lines: [] };
      let oldSeen = 0;
      let newSeen = 0;
      i += 1;
      while (oldSeen < header.oldLines || newSeen < header.newLines) {
        if (i >= lines.length) throw new NotImplementedError('git.apply.format');
        const hline = lines[i] as string;
        if (hline === '') {
          throw new NotImplementedError('git.apply.format');
        }
        if (hline.startsWith('\\')) throw new NotImplementedError('git.apply.no-newline');
        const op = hline[0];
        if (op !== ' ' && op !== '-' && op !== '+') {
          throw new NotImplementedError('git.apply.format');
        }
        if (op === ' ' || op === '-') oldSeen += 1;
        if (op === ' ' || op === '+') newSeen += 1;
        if (oldSeen > header.oldLines || newSeen > header.newLines) {
          throw new NotImplementedError('git.apply.format');
        }
        hunk.lines.push({ op, text: hline.slice(1) });
        i += 1;
      }
      f.hunks.push(hunk);
      continue;
    }
    if (
      line.startsWith('index ') ||
      line.startsWith('similarity index ') ||
      line.startsWith('dissimilarity index ') ||
      line.startsWith('new file mode ') ||
      line.startsWith('deleted file mode ')
    ) {
      i += 1;
      continue;
    }
    throw new NotImplementedError('git.apply.format');
  }

  return files.filter((f) => f.oldPath !== null || f.newPath !== null || f.hunks.length > 0);
}

function assertTextFile(bytes: Uint8Array): void {
  for (let i = 0; i < Math.min(bytes.byteLength, 8000); i++) {
    if (bytes[i] === 0) throw new NotImplementedError('git.apply.binary');
  }
}

function splitPatchableText(text: string): string[] {
  if (text === '') return [];
  if (!text.endsWith('\n')) throw new NotImplementedError('git.apply.no-newline');
  return text.slice(0, -1).split('\n');
}

function applyHunks(text: string, hunks: PatchHunk[], filepath: string): string {
  const input = splitPatchableText(text);
  const output: string[] = [];
  let cursor = 0;

  for (const hunk of hunks) {
    const start = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1;
    if (start < cursor || start > input.length)
      throw new ApplyPatchFailure(filepath, hunk.oldStart);
    while (cursor < start) output.push(input[cursor++] as string);

    let oldCount = 0;
    let newCount = 0;
    for (const line of hunk.lines) {
      if (line.op === ' ') {
        if (input[cursor] !== line.text) throw new ApplyPatchFailure(filepath, hunk.oldStart);
        output.push(line.text);
        cursor += 1;
        oldCount += 1;
        newCount += 1;
      } else if (line.op === '-') {
        if (input[cursor] !== line.text) throw new ApplyPatchFailure(filepath, hunk.oldStart);
        cursor += 1;
        oldCount += 1;
      } else {
        output.push(line.text);
        newCount += 1;
      }
    }
    if (oldCount !== hunk.oldLines || newCount !== hunk.newLines) {
      throw new NotImplementedError('git.apply.format');
    }
  }

  while (cursor < input.length) output.push(input[cursor++] as string);
  return output.length === 0 ? '' : `${output.join('\n')}\n`;
}

type ApplyAction =
  | { kind: 'delete'; filepath: string }
  | { kind: 'write'; filepath: string; content: string };

async function planApply(vfs: Vfs, root: string, files: PatchFile[]): Promise<ApplyAction[]> {
  const seen = new Set<string>();
  const actions: ApplyAction[] = [];
  for (const file of files) {
    if (file.hunks.length === 0) throw new NotImplementedError('git.apply.mode');
    const target = file.newPath ?? file.oldPath;
    if (target === null) throw new NotImplementedError('git.apply.format');
    if (file.oldPath !== null && file.newPath !== null && file.oldPath !== file.newPath) {
      throw new NotImplementedError('git.apply.rename');
    }
    if (seen.has(target)) throw new NotImplementedError('git.apply.duplicate-path');
    seen.add(target);

    const abs = normalizePath(joinPath(root, target));
    const exists = await vfs.exists(abs);
    if (file.oldPath === null && exists)
      throw new ApplyPathFailure(`${target}: already exists in working directory`);
    if (file.oldPath !== null && !exists)
      throw new ApplyPathFailure(`${target}: No such file or directory`);
    const currentBytes = exists ? await vfs.readFile(abs) : new Uint8Array();
    assertTextFile(currentBytes);
    const current = new TextDecoder().decode(currentBytes);
    const next = applyHunks(current, file.hunks, target);
    if (file.newPath === null) {
      if (next !== '') throw new ApplyPatchFailure(target, file.hunks[0]?.oldStart ?? 0);
      actions.push({ kind: 'delete', filepath: target });
    } else {
      actions.push({ kind: 'write', filepath: target, content: next });
    }
  }
  return actions;
}

function repoRelativeCwd(root: string, cwd: string): string {
  const normalizedRoot = normalizePath(root);
  const normalizedCwd = normalizePath(cwd);
  if (normalizedCwd === normalizedRoot) return '';
  return normalizedCwd.startsWith(`${normalizedRoot}/`)
    ? normalizedCwd.slice(normalizedRoot.length + 1)
    : '';
}

function filterPatchFilesForCwd(files: PatchFile[], root: string, cwd: string): PatchFile[] {
  const prefix = repoRelativeCwd(root, cwd);
  if (prefix === '') return files;
  return files.filter((file) => {
    const path = file.newPath ?? file.oldPath;
    return path !== null && pathspecMatch(path, prefix);
  });
}

function diffGitPaths(line: string): string[] | null {
  const match = /^diff --git\s+(\S+)\s+(\S+)$/.exec(line);
  if (!match) return null;
  try {
    return [patchPath(match[1] as string), patchPath(match[2] as string)].filter(
      (path): path is string => path !== null,
    );
  } catch {
    return null;
  }
}

function filterPatchTextForCwd(text: string, root: string, cwd: string): string {
  const prefix = repoRelativeCwd(root, cwd);
  if (prefix === '') return text;

  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const kept: string[] = [];
  let current: string[] | null = null;
  let keepCurrent = true;

  const flush = (): void => {
    if (current !== null && keepCurrent) kept.push(...current);
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush();
      current = [line];
      const paths = diffGitPaths(line);
      keepCurrent = paths === null || paths.some((path) => pathspecMatch(path, prefix));
      continue;
    }
    if (current === null) kept.push(line);
    else current.push(line);
  }
  flush();
  return kept.join('\n');
}

async function readApplySource(
  vfs: Vfs,
  ctx: CommandContext,
  source: ApplySource,
): Promise<string> {
  if (source.kind === 'file') {
    const path = isAbsolute(source.path)
      ? normalizePath(source.path)
      : normalizePath(joinPath(ctx.cwd, source.path));
    const bytes = await vfs.readFile(path);
    assertTextFile(bytes);
    return new TextDecoder().decode(bytes);
  }
  if (ctx.stdin === undefined) throw new NotImplementedError('git.apply.stdin');
  const chunks: Uint8Array[] = [];
  for (;;) {
    const chunk = await ctx.stdin.read();
    if (chunk === null) break;
    chunks.push(chunk);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  assertTextFile(merged);
  return new TextDecoder().decode(merged);
}

async function doApply(
  args: string[],
  ctx: CommandContext,
  vfs: Vfs,
  root: string,
): Promise<number> {
  let source: ApplySource;
  try {
    source = parseApply(args);
    const patch = await readApplySource(vfs, ctx, source);
    const scopedPatch = filterPatchTextForCwd(patch, root, ctx.cwd);
    const files = filterPatchFilesForCwd(parseUnifiedPatch(scopedPatch), root, ctx.cwd);
    const actions = await planApply(vfs, root, files);
    for (const action of actions) {
      if (action.kind === 'delete') {
        await removeRepoFile(vfs, root, action.filepath);
      } else {
        await writeRepoFile(vfs, root, action.filepath, new TextEncoder().encode(action.content));
      }
    }
    return 0;
  } catch (e) {
    if (e instanceof ApplyPatchFailure) {
      ctx.stderr.write(`error: patch failed: ${e.filepath}:${e.line}\n`);
      ctx.stderr.write(`error: ${e.filepath}: patch does not apply\n`);
      return 1;
    }
    if (e instanceof ApplyPathFailure) {
      ctx.stderr.write(`error: ${e.detail}\n`);
      return 1;
    }
    if (e instanceof NotImplementedError) return renderCheckoutError(e, ctx);
    ctx.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    return 128;
  }
}

function stashRefIndex(ref: string): number | undefined {
  const match = /^stash@\{(\d+)\}$/.exec(ref);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

async function doStash(
  g: Git,
  args: string[],
  ctx: CommandContext,
  vfs: Vfs,
  root: string,
): Promise<number> {
  const first = args[1];
  const sub = first === undefined || first.startsWith('-') ? 'push' : first;
  const legacySave = sub === 'save';
  const op = sub === 'save' ? 'push' : sub;
  if (!['push', 'pop', 'apply', 'drop', 'list', 'clear', 'create'].includes(op)) {
    return renderCheckoutError(new NotImplementedError(`git.stash.${op}`), ctx);
  }
  let message: string | undefined;
  let refIdx: number | undefined;
  const rest = first === undefined || first.startsWith('-') ? args.slice(1) : args.slice(2);
  if (op === 'push' || op === 'create') {
    const parts: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i] as string;
      if (t === '-u' || t === '--include-untracked' || t === '--all') {
        return renderCheckoutError(new NotImplementedError('git.stash.include-untracked'), ctx);
      }
      if (t === '-m' || t === '--message') {
        const msg = rest[++i];
        if (msg === undefined)
          return renderCheckoutError(new NotImplementedError('git.stash.message-missing'), ctx);
        parts.push(msg);
      } else if (t.startsWith('-m') && t.length > 2) {
        parts.push(t.slice(2));
      } else if (t.startsWith('--message=')) {
        parts.push(t.slice('--message='.length));
      } else if (t.startsWith('-')) {
        return renderCheckoutError(
          new NotImplementedError(`git.stash.${t.replace(/^-+/, '')}`),
          ctx,
        );
      } else {
        if (!legacySave) {
          return renderCheckoutError(new NotImplementedError('git.stash.pathspec'), ctx);
        }
        parts.push(t);
      }
    }
    message = parts.join(' ') || undefined;
  } else if (op === 'pop' || op === 'apply' || op === 'drop') {
    for (const t of rest) {
      if (t.startsWith('-')) {
        return renderCheckoutError(
          new NotImplementedError(`git.stash.${t.replace(/^-+/, '')}`),
          ctx,
        );
      }
      if (refIdx !== undefined)
        return renderCheckoutError(new NotImplementedError('git.stash.args'), ctx);
      refIdx = stashRefIndex(t);
      if (refIdx === undefined)
        return renderCheckoutError(new NotImplementedError('git.stash.ref'), ctx);
    }
  } else if (rest.length > 0) {
    return renderCheckoutError(new NotImplementedError('git.stash.args'), ctx);
  }
  try {
    const ident = await identityFrom(g, ctx.env);
    const configPath = normalizePath(joinPath(root, '.git/config'));
    const hadConfig = await vfs.exists(configPath);
    const configBefore = hadConfig ? await vfs.readFile(configPath) : undefined;
    let result: Awaited<ReturnType<Git['stash']>>;
    try {
      if ((await g.getConfig('user.name')) === undefined)
        await g.setConfig('user.name', ident.name);
      if ((await g.getConfig('user.email')) === undefined)
        await g.setConfig('user.email', ident.email);
      result = await g.stash(op as Parameters<Git['stash']>[0], message, refIdx);
    } finally {
      if (configBefore !== undefined) {
        await vfs.writeFile(configPath, configBefore);
      } else if (!hadConfig) {
        await vfs.rm(configPath, { force: true });
      }
    }
    if (Array.isArray(result)) {
      for (const e of result) ctx.stdout.write(`stash@{${e.index}}: ${e.message}\n`);
    } else if (typeof result === 'string') {
      ctx.stdout.write(`${result}\n`);
    }
    return 0;
  } catch (e) {
    ctx.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    return 128;
  }
}

async function doLsRemote(
  g: Git | undefined,
  vfs: Vfs,
  args: string[],
  ctx: CommandContext,
): Promise<number> {
  let prefix: string | undefined;
  let forPush = false;
  const positionals: string[] = [];
  for (const t of args.slice(1)) {
    if (t === '--tags' || t === '-t') prefix = 'refs/tags/';
    else if (t === '--heads' || t === '-h') prefix = 'refs/heads/';
    else if (t === '--refs') continue;
    else if (t === '--get-url')
      return renderCheckoutError(new NotImplementedError('git.ls-remote.get-url'), ctx);
    else if (t === '--exit-code')
      return renderCheckoutError(new NotImplementedError('git.ls-remote.exit-code'), ctx);
    else if (t === '--symref')
      return renderCheckoutError(new NotImplementedError('git.ls-remote.symref'), ctx);
    else if (t === '--upload-pack')
      return renderCheckoutError(new NotImplementedError('git.ls-remote.upload-pack'), ctx);
    else if (t === '--for-push') forPush = true;
    else if (t.startsWith('-'))
      return renderCheckoutError(
        new NotImplementedError(`git.ls-remote.${t.replace(/^-+/, '')}`),
        ctx,
      );
    else positionals.push(t);
  }
  if (positionals.length > 1)
    return renderCheckoutError(new NotImplementedError('git.ls-remote.args'), ctx);
  const target = positionals[0] ?? 'origin';
  try {
    const client = g ?? makeGit({ fs: vfsToGitFs(vfs), dir: ctx.cwd });
    const url = isUrlLike(target)
      ? target
      : (await client.listRemotes()).find((r) => r.remote === target)?.url;
    if (url === undefined) {
      if (positionals[0] === undefined) {
        ctx.stderr.write('fatal: No remote configured to list refs from.\n');
        return 128;
      }
      ctx.stderr.write(`fatal: '${target}' does not appear to be a git repository\n`);
      return 128;
    }
    const refs = await client.lsRemote({
      url,
      ...(prefix ? { prefix } : {}),
      ...(forPush ? { forPush } : {}),
    });
    for (const ref of refs) ctx.stdout.write(`${ref.oid}\t${ref.ref}\n`);
    return 0;
  } catch (e) {
    ctx.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 128;
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

function refspecHasWildcard(refspec: string): boolean {
  return refspec.includes('*');
}

function fetchRefspec(refspec: string): {
  ref?: string;
  remoteRef?: string;
  singleBranch?: boolean;
} {
  if (!refspec.includes(':')) return { ref: refspec };
  const [remoteRef, ref] = refspec.split(':', 2) as [string, string];
  if (remoteRef === '' || ref === '') throw new NotImplementedError('git.fetch.refspec');
  return { remoteRef, ref, singleBranch: true };
}

function pushRefspec(refspec: string): { ref?: string; remoteRef?: string; delete?: boolean } {
  if (!refspec.includes(':')) return { ref: refspec };
  const [ref, remoteRef] = refspec.split(':', 2) as [string, string];
  if (remoteRef === '') throw new NotImplementedError('git.push.refspec');
  if (ref === '') return { remoteRef, delete: true };
  return { ref, remoteRef };
}

async function assertPushTagsRemoteReachable(
  g: Git,
  target: { url?: string; remote?: string },
): Promise<void> {
  const url =
    target.url ??
    (await g.listRemotes()).find((r) => r.remote === (target.remote ?? 'origin'))?.url;
  if (url === undefined) throw new Error('No configured push destination.');
  assertSupportedTransport(url);
  await g.lsRemote({ url, forPush: true });
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
  let depth: number | undefined;
  let singleBranch = false;
  let tags = false;
  let prune = false;
  let pruneTags = false;
  let pushTags = false;
  const rest = args.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i] as string;
    if (t === '-f' || t === '--force') {
      force = true;
    } else if (t === '--tags') {
      if (verb === 'push') pushTags = true;
      else if (verb === 'pull')
        return renderCheckoutError(new NotImplementedError('git.pull.tags'), ctx);
      else tags = true;
    } else if (t === '--prune' || t === '-p') {
      if (verb === 'push')
        return renderCheckoutError(new NotImplementedError('git.push.prune'), ctx);
      prune = true;
    } else if (t === '--prune-tags') {
      if (verb === 'push')
        return renderCheckoutError(new NotImplementedError('git.push.prune-tags'), ctx);
      pruneTags = true;
    } else if (t === '--depth') {
      if (verb === 'push')
        return renderCheckoutError(new NotImplementedError('git.push.depth'), ctx);
      const raw = rest[++i];
      if (raw === undefined)
        return renderCheckoutError(new NotImplementedError(`git.${verb}.depth`), ctx);
      depth = Number(raw);
    } else if (t.startsWith('--depth=')) {
      if (verb === 'push')
        return renderCheckoutError(new NotImplementedError('git.push.depth'), ctx);
      depth = Number(t.slice('--depth='.length));
    } else if (t === '--single-branch') {
      if (verb === 'push')
        return renderCheckoutError(new NotImplementedError('git.push.single-branch'), ctx);
      singleBranch = true;
    } else if (t.startsWith('-')) {
      return renderCheckoutError(
        new NotImplementedError(`git.${verb}.${t.replace(/^-+/, '')}`),
        ctx,
      );
    } else {
      positionals.push(t);
    }
  }
  if (force && verb !== 'push')
    return renderCheckoutError(new NotImplementedError(`git.${verb}.force`), ctx);
  if (depth !== undefined && (!Number.isFinite(depth) || depth < 1)) {
    return renderCheckoutError(new NotImplementedError(`git.${verb}.depth`), ctx);
  }
  if (depth !== undefined && verb === 'pull')
    return renderCheckoutError(new NotImplementedError('git.pull.depth'), ctx);
  if (positionals.length > 2)
    return renderCheckoutError(new NotImplementedError(`git.${verb}.refspecs`), ctx);
  const first = positionals[0];
  const url = first !== undefined && isUrlLike(first) ? first : undefined;
  const remote = first !== undefined && !isUrlLike(first) ? first : undefined;
  const rawRefspec = positionals[1];
  if (rawRefspec !== undefined && refspecHasWildcard(rawRefspec)) {
    return renderCheckoutError(new NotImplementedError(`git.${verb}.wildcard-refspec`), ctx);
  }
  let refspec: { ref?: string; remoteRef?: string; singleBranch?: boolean; delete?: boolean } = {};
  try {
    if (rawRefspec !== undefined) {
      refspec = verb === 'push' ? pushRefspec(rawRefspec) : fetchRefspec(rawRefspec);
    }
  } catch (e) {
    return renderCheckoutError(e, ctx);
  }
  const target = {
    ...(url !== undefined ? { url } : {}),
    ...(remote !== undefined ? { remote } : {}),
    ...(refspec.ref !== undefined ? { ref: refspec.ref } : {}),
    ...(refspec.remoteRef !== undefined ? { remoteRef: refspec.remoteRef } : {}),
    ...(depth !== undefined ? { depth } : {}),
    ...(singleBranch || refspec.singleBranch ? { singleBranch: true } : {}),
    ...(tags ? { tags: true } : {}),
    ...(prune ? { prune: true } : {}),
    ...(pruneTags ? { pruneTags: true } : {}),
  };
  try {
    switch (verb) {
      case 'fetch':
        await g.fetch(target);
        break;
      case 'pull':
        await g.pull({ ...target, author: await identityFrom(g, ctx.env) });
        break;
      case 'push': {
        if (pushTags) {
          const tagNames = await g.listTags();
          if (tagNames.length === 0) {
            await assertPushTagsRemoteReachable(g, target);
            break;
          }
          for (const tag of tagNames) {
            await g.push({
              ...target,
              ref: `refs/tags/${tag}`,
              ...(force ? { force: true } : {}),
            });
          }
          break;
        }
        await g.push({
          ...target,
          ...(refspec.delete ? { delete: true } : {}),
          ...(force ? { force: true } : {}),
        });
        break;
      }
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
  const positionals: string[] = [];
  let depth: number | undefined;
  let singleBranch = false;
  let noTags = false;
  const rest = args.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i] as string;
    if (t === '--depth') {
      const raw = rest[++i];
      if (raw === undefined)
        return renderCheckoutError(new NotImplementedError('git.clone.depth'), ctx);
      depth = Number(raw);
    } else if (t.startsWith('--depth=')) {
      depth = Number(t.slice('--depth='.length));
    } else if (t === '--single-branch') {
      singleBranch = true;
    } else if (t === '--no-tags') {
      noTags = true;
    } else if (t.startsWith('-')) {
      return renderCheckoutError(new NotImplementedError(`git.clone.${t.replace(/^-+/, '')}`), ctx);
    } else {
      positionals.push(t);
    }
  }
  if (depth !== undefined && (!Number.isFinite(depth) || depth < 1)) {
    return renderCheckoutError(new NotImplementedError('git.clone.depth'), ctx);
  }
  if (positionals.length > 2)
    return renderCheckoutError(new NotImplementedError('git.clone.args'), ctx);
  const url = positionals[0];
  if (url === undefined) {
    ctx.stderr.write('fatal: You must specify a repository to clone.\n');
    ctx.stderr.write('usage: git clone [<options>] [--] <repo> [<dir>]\n');
    return 129;
  }
  const { display, target } = cloneDestination(url, positionals[1], ctx.cwd);
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
    await g.clone({
      url,
      ...(depth !== undefined ? { depth } : {}),
      ...(singleBranch ? { singleBranch } : {}),
      ...(noTags ? { noTags } : {}),
    });
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
  'reflog',
  'bisect',
  'blame',
  'submodule',
  'worktree',
  'clean',
  'gc',
  'prune',
  'repack',
  'fsck',
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
  'reset',
  'show',
  'tag',
  'remote',
  'ls-remote',
  'rm',
  'mv',
  'merge',
  'cherry-pick',
  'revert',
  'apply',
  'stash',
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
  if (sub === 'ls-remote') {
    const target = args.slice(1).find((arg) => !arg.startsWith('-'));
    if (target !== undefined && isUrlLike(target)) return doLsRemote(undefined, vfs, args, ctx);
  }

  // Every other known verb needs a repository. Real git verifies one governs the
  // cwd FIRST (else `fatal: not a git repository`) — we mirror that so a non-repo
  // never silently false-succeeds (e.g. `status` reporting a clean tree).
  if (sub !== undefined && REPO_VERBS.has(sub)) {
    const root = await findRepoRoot(vfs, ctx.cwd);
    if (root === null) {
      ctx.stderr.write('fatal: not a git repository (or any of the parent directories): .git\n');
      return 128;
    }
    const mapPathspec = makeRepoPathspecMapper(root, ctx.cwd);
    const g = makeGit({ fs: vfsToGitFs(vfs), dir: root });
    switch (sub) {
      case 'status':
        return doStatus(g, args, ctx);
      case 'add':
        return doAdd(g, args, ctx, vfs, root, mapPathspec);
      case 'commit':
        return doCommit(g, args, ctx);
      case 'log':
        return doLog(g, args, ctx, mapPathspec);
      case 'diff':
        return doDiff(g, args, ctx, mapPathspec);
      case 'branch':
        return doBranch(g, ctx);
      case 'checkout':
        return doCheckout(g, args, ctx, mapPathspec);
      case 'switch':
        return doSwitch(g, args, ctx);
      case 'restore':
        return doRestore(g, args, ctx, mapPathspec);
      case 'config':
        return doConfig(g, args, ctx);
      case 'reset':
        return doReset(g, args, ctx, mapPathspec);
      case 'show':
        return doShow(g, args, ctx);
      case 'tag':
        return doTag(g, args, ctx);
      case 'remote':
        return doRemote(g, args, ctx);
      case 'ls-remote':
        return doLsRemote(g, vfs, args, ctx);
      case 'rm':
        return doGitRm(g, args, ctx, vfs, root, mapPathspec);
      case 'mv':
        return doGitMv(g, args, ctx, vfs, root, mapPathspec);
      case 'merge':
        return doMerge(g, args, ctx);
      case 'cherry-pick':
        return doCherryPick(g, args, ctx);
      case 'revert':
        return doRevert(g, args, ctx, vfs, root);
      case 'apply':
        return doApply(args, ctx, vfs, root);
      case 'stash':
        return doStash(g, args, ctx, vfs, root);
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
