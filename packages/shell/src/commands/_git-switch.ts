/**
 * `git switch` — branch-only switching over the {@link makeGit} facade, byte-exact
 * to real git 2.50.1 (see packages/git/fixtures/switch-*). REUSES the checkout
 * engine (`g.checkout({op:'switch'})`) + its typed-error renderer; the ONLY render
 * difference is detached HEAD: `switch --detach` prints the HEAD-line ONLY, no
 * advisory block (unlike `checkout <sha>`). NO pathspec forms — `switch` is
 * branch-only in git. All messages → stderr (stdout empty), same as checkout.
 */
import type { makeGit } from '@riftydev/git';
import { NotImplementedError } from '@riftydev/io';
import type { CommandContext } from '../types.ts';
import {
  renderCheckoutError,
  renderCheckoutOrFatal,
  renderSwitch,
  revisionExists,
} from './_git-checkout.ts';

/**
 * The facade returned by {@link makeGit}. Its named interface (`Git`) is not on
 * the package's public surface, so we derive it from the factory's return type.
 */
type Git = ReturnType<typeof makeGit>;

/**
 * Parsed `git switch`: switch to an existing branch, create+switch (`-c`), or
 * detach onto a commit (`--detach`). Ceiling args (the bare `-` previous-branch)
 * throw during parse (loud {@link NotImplementedError}).
 */
type SwitchPlan =
  | { kind: 'branch'; ref: string }
  | { kind: 'create'; name: string; startPoint?: string }
  | { kind: 'detach'; commit: string };

/**
 * Parse `args` (args[0]==='switch'). `-c <new> [<start>]` → create; `--detach
 * <commit>` (or `-d`) → detach; bare `-` (previous branch) → loud-throw (no
 * reflog). A lone positional → switch to that branch (commit-vs-branch is
 * resolved at dispatch, since it needs the repo).
 */
function parseSwitch(args: string[]): SwitchPlan {
  const rest = args.slice(1);
  let createName: string | undefined;
  let detach = false;
  const positionals: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const t = rest[i] as string;
    if (t === '-c' || t === '--create') {
      createName = rest[++i];
      if (createName === undefined) throw new NotImplementedError('git.switch.c-missing-name');
      continue;
    }
    if (t === '-d' || t === '--detach') {
      detach = true;
      continue;
    }
    if (t === '-') {
      // Previous-branch (`@{-1}`) needs the reflog rifty has no analog for → loud.
      throw new NotImplementedError('git.switch.previous', 'no reflog (previous-branch)');
    }
    if (t.startsWith('-')) throw new NotImplementedError(`git.switch.${t.replace(/^-+/, '')}`);
    positionals.push(t);
  }

  if (createName !== undefined) {
    if (positionals.length > 1) throw new NotImplementedError('git.switch.args');
    return { kind: 'create', name: createName, startPoint: positionals[0] };
  }
  if (detach) {
    if (positionals.length > 1) throw new NotImplementedError('git.switch.args');
    const commit = positionals[0];
    if (commit === undefined) throw new NotImplementedError('git.switch.detach-missing-commit');
    return { kind: 'detach', commit };
  }
  if (positionals.length > 1) throw new NotImplementedError('git.switch.args');
  const ref = positionals[0];
  if (ref === undefined) throw new NotImplementedError('git.switch.no-target');
  return { kind: 'branch', ref };
}

/**
 * `git switch` — branch-only switch / create / detach over the facade. REUSES the
 * checkout engine; the detached render omits the advisory (switch style). Typed
 * git user-errors map via {@link renderCheckoutError}. A non-`--detach` arg that
 * is a commit (not a branch) is real git's `fatal: a branch is expected, got
 * commit '<arg>'` (exit 128).
 */
export async function doSwitch(g: Git, args: string[], ctx: CommandContext): Promise<number> {
  let plan: SwitchPlan;
  try {
    plan = parseSwitch(args);
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
      });
      if (res.op === 'switch') renderSwitch(res, plan.name, ctx, 'switch');
      return 0;
    }

    if (plan.kind === 'detach') {
      const res = await g.checkout({ op: 'switch', ref: plan.commit });
      if (res.op === 'switch') renderSwitch(res, plan.commit, ctx, 'switch');
      return 0;
    }

    // `git switch <arg>`: must be a BRANCH. A bare commit (resolvable ref that is
    // NOT a branch) is real git's `fatal: a branch is expected, got commit`; a
    // name that is neither a branch nor any ref is `fatal: invalid reference`.
    const branches = await g.listBranches();
    if (!branches.includes(plan.ref)) {
      const isRef = await revisionExists(g, plan.ref);
      if (isRef) {
        ctx.stderr.write(`fatal: a branch is expected, got commit '${plan.ref}'\n`);
        return 128;
      }
      // Neither a branch nor a ref → git's `fatal: invalid reference: <arg>`
      // (exit 128), never a leaked iso-git plumbing error.
      ctx.stderr.write(`fatal: invalid reference: ${plan.ref}\n`);
      return 128;
    }
    const res = await g.checkout({ op: 'switch', ref: plan.ref });
    if (res.op === 'switch') renderSwitch(res, plan.ref, ctx, 'switch');
    return 0;
  } catch (e) {
    return renderCheckoutOrFatal(e, ctx);
  }
}
