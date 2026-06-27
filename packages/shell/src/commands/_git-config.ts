/**
 * `git config` — bounded get/set over the {@link makeGit} facade (iso-git's
 * getConfig/setConfig on `.git/config`). `config <key>` (or `--get`) prints the
 * value + `\n` (exit 0); an UNSET key → exit 1, no output (real git 2.50.1).
 * `config <key> <value>` writes it, silent (exit 0). Full-dump / multi-value /
 * value-pattern / unset flags (`--list`/`--get-all`/`--unset`/…) have no iso-git
 * analog → loud {@link NotImplementedError} (exit 128). Bounded v1, never a
 * silent partial.
 */
import type { makeGit } from '@riftydev/git';
import { NotImplementedError } from '@riftydev/io';
import type { CommandContext } from '../types.ts';
import { renderCheckoutError } from './_git-checkout.ts';

/**
 * The facade returned by {@link makeGit}. Its named interface (`Git`) is not on
 * the package's public surface, so we derive it from the factory's return type.
 */
type Git = ReturnType<typeof makeGit>;

/**
 * `git config` — get (`<key>` / `--get <key>`) or set (`<key> <value>`). A
 * bare-key get of an UNSET value → exit 1 silent (git's behavior). Any other
 * flag (`--list`/`--get-all`/`--unset`/…) is a loud ceiling (exit 128); iso-git
 * has no full-dump primitive.
 */
export async function doConfig(g: Git, args: string[], ctx: CommandContext): Promise<number> {
  try {
    return await runConfig(g, args, ctx);
  } catch (e) {
    // Ceilings throw the typed NotImplementedError → exit 128 + bare message
    // (cluster-consistent with checkout/restore), never a leaked generic exit-1.
    return renderCheckoutError(e, ctx);
  }
}

async function runConfig(g: Git, args: string[], ctx: CommandContext): Promise<number> {
  const rest = args.slice(1);
  // `--get <key>` is the one supported flag; everything else loud-throws.
  let getFlag = false;
  const positionals: string[] = [];
  for (const t of rest) {
    if (t === '--get') {
      getFlag = true;
      continue;
    }
    if (t.startsWith('-')) {
      throw new NotImplementedError(`git.config.${t.replace(/^-+/, '')}`);
    }
    positionals.push(t);
  }

  const key = positionals[0];
  if (key === undefined) {
    // Bare `git config` (no key) — not a get/set; loud ceiling, never silent.
    throw new NotImplementedError('git.config', 'no key');
  }

  // `<key> <value>` → set (silent, exit 0). `--get <key> <value-pattern>` is a
  // real git form, but this bounded v1 has no value-pattern primitive; loud
  // ceiling beats a silent false miss/match.
  if (getFlag && positionals.length !== 1) {
    throw new NotImplementedError('git.config.value-pattern');
  }
  if (positionals.length > 2 && !getFlag) {
    throw new NotImplementedError('git.config.value-pattern');
  }
  if (positionals.length === 2 && !getFlag) {
    await g.setConfig(key, positionals[1] as string);
    return 0;
  }

  const value = await g.getConfig(key);
  if (value === undefined) return 1; // unset → exit 1, no output (real git)
  ctx.stdout.write(`${value}\n`);
  return 0;
}
