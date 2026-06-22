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
import { type StatusEntry, makeGit, vfsToGitFs } from '@riftydev/git';
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
 * `git <subcommand> ...` — version control over `@riftydev/git` (isomorphic-git)
 * on the ambient VFS. Local verbs (init/status/add/commit/log/diff/branch) run;
 * network verbs (clone/fetch/pull/push) drive smart-HTTP and surface any failure
 * (unsupported transport, CORS wall, network error) as exit 128. Unknown/missing
 * subcommand → exit 1.
 */
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
    case 'clone':
    case 'fetch':
    case 'pull':
    case 'push':
      return doNetwork(g, sub, args, ctx);
    default:
      ctx.stderr.write(`git: '${sub ?? ''}' is not a git command\n`);
      return 1;
  }
};
