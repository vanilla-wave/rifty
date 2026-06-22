/**
 * `git restore` — restore worktree / unstage paths over the {@link makeGit}
 * facade. SILENT like real git 2.50.1 (both streams empty on success; see
 * packages/git/fixtures/restore-*). Worktree restore REUSES the checkout engine
 * (`g.checkout({op:'restore'})`); `--staged` unstages each path via `g.unstage`
 * (index ← HEAD). `--source=<tree>` restores from a tree-ish. Combining `--staged`
 * with `--source` is a bounded ceiling (loud); a revspec in `--source` reuses the
 * checkout revspec ceiling. No-match → PathspecError (exit 1).
 */
import { PathspecError, type makeGit, pathspecMatch } from '@riftydev/git';
import { NotImplementedError } from '@riftydev/io';
import type { CommandContext } from '../types.ts';
import { REVSPEC_MARKER, renderCheckoutError } from './_git-checkout.ts';
import { hasGlobMeta } from './_glob.ts';

/**
 * The facade returned by {@link makeGit}. Its named interface (`Git`) is not on
 * the package's public surface, so we derive it from the factory's return type.
 */
type Git = ReturnType<typeof makeGit>;

/**
 * Parsed `git restore`: which trees to write (`staged` = index←HEAD, `worktree`
 * = files←index/source) + the pathspecs + optional tree-ish `source`. Default
 * (no `--staged`/`--worktree`) is worktree-only, matching real git.
 */
interface RestorePlan {
  staged: boolean;
  worktree: boolean;
  source?: string;
  pathspecs: string[];
}

/**
 * Parse `args` (args[0]==='restore'). `--staged`/`-S` + `--worktree`/`-W` pick
 * the trees (default worktree-only). `--source=<tree>` / `--source <tree>` sets
 * the source. `--` splits flags from pathspecs. Ceiling: `--staged --source`
 * (bounded) and a revspec in `--source` (reuse checkout's revspec ceiling) →
 * loud-throw. Unknown flags → loud-throw.
 */
function parseRestore(args: string[]): RestorePlan {
  const rest = args.slice(1);
  const dashDash = rest.indexOf('--');
  const flagTokens = dashDash === -1 ? rest : rest.slice(0, dashDash);
  const afterDashDash = dashDash === -1 ? [] : rest.slice(dashDash + 1);

  let staged = false;
  let worktree = false;
  let source: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < flagTokens.length; i++) {
    const t = flagTokens[i] as string;
    if (t === '--staged' || t === '-S') {
      staged = true;
      continue;
    }
    if (t === '--worktree' || t === '-W') {
      worktree = true;
      continue;
    }
    if (t.startsWith('--source=')) {
      source = t.slice('--source='.length);
      continue;
    }
    if (t === '--source' || t === '-s') {
      source = flagTokens[++i];
      if (source === undefined) throw new NotImplementedError('git.restore.source-missing');
      continue;
    }
    if (t.startsWith('-')) throw new NotImplementedError(`git.restore.${t.replace(/^-+/, '')}`);
    positionals.push(t);
  }

  // `--staged` with `--source` is unsupported here (iso-git resetIndex restores
  // the index from HEAD only) — bounded ceiling, loud rather than wrong.
  if (staged && source !== undefined) {
    throw new NotImplementedError('git.restore.staged-source', 'index restore is from HEAD only');
  }
  // Revspec arithmetic in `--source` is the same ceiling as checkout's source.
  if (source !== undefined && REVSPEC_MARKER.test(source)) {
    throw new NotImplementedError(
      'git.checkout.revspec',
      'rev arithmetic (HEAD~1, main^, @{-1}, HEAD@{1}) is not supported',
    );
  }
  const pathspecs = [...positionals, ...afterDashDash];
  for (const p of pathspecs) {
    if (hasGlobMeta(p)) throw new NotImplementedError('git.restore.glob-pathspec');
  }
  // Default (neither flag) = worktree-only, matching real git.
  if (!staged && !worktree) worktree = true;
  return { staged, worktree, source, pathspecs };
}

/**
 * `git restore` — silent on success (both streams empty). `--staged` unstages
 * (index←HEAD); worktree restore reuses the checkout engine (files←index, or
 * ←`--source`). Typed git user-errors (pathspec-miss, ceilings) map via
 * {@link renderCheckoutError}.
 */
export async function doRestore(g: Git, args: string[], ctx: CommandContext): Promise<number> {
  let plan: RestorePlan;
  try {
    plan = parseRestore(args);
  } catch (e) {
    return renderCheckoutError(e, ctx);
  }

  if (plan.pathspecs.length === 0) {
    // Real git: `fatal: you must specify path(s) to restore` (exit 128). Bounded
    // — loud rather than a silent no-op (that would lie about doing nothing).
    // Render here (exit 128) so it never leaks as the shell's generic `git: ` exit-1.
    return renderCheckoutError(
      new NotImplementedError('git.restore.no-pathspec', 'you must specify path(s) to restore'),
      ctx,
    );
  }

  try {
    if (plan.staged) {
      // Unstage each matched path (index ← HEAD). `g.unstage` is per-path; a
      // pathspec matching no tracked file would be a no-op, so validate against
      // the index first (all-or-nothing, like the checkout restore engine).
      const tracked = await g.listFiles();
      for (const spec of plan.pathspecs) {
        const matches = tracked.filter((p) => pathspecMatch(p, spec));
        if (matches.length === 0) throw new PathspecError(spec);
        for (const p of matches) await g.unstage(p);
      }
    }
    if (plan.worktree) {
      await g.checkout({
        op: 'restore',
        pathspecs: plan.pathspecs,
        ...(plan.source !== undefined ? { source: plan.source } : {}),
      });
    }
    return 0; // restore is silent
  } catch (e) {
    return renderCheckoutError(e, ctx);
  }
}
