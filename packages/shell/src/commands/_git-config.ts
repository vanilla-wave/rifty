/**
 * `git config` — bounded get/set over the {@link makeGit} facade (iso-git's
 * getConfig/setConfig on `.git/config`). `config <key>` (or `--get`) prints the
 * value + `\n` (exit 0); an UNSET key → exit 1, no output (real git 2.50.1).
 * `config <key> <value>` writes it, silent (exit 0). Full-dump / multi-value /
 * unset flags (`--list`/`--get-all`/`--unset`/…) have no iso-git analog → loud
 * {@link NotImplementedError} (exit 128). Bounded v1, never a silent partial.
 */
import type { makeGit } from '@riftydev/git';
import type { CommandContext } from '../types.ts';

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
      ctx.stderr.write(`Not implemented: git.config.${t.replace(/^-+/, '')}\n`);
      return 128;
    }
    positionals.push(t);
  }

  const key = positionals[0];
  if (key === undefined) {
    // Bare `git config` (no key) — not a get/set; loud ceiling, never silent.
    ctx.stderr.write('Not implemented: git.config (no key)\n');
    return 128;
  }

  // `<key> <value>` → set (silent, exit 0). `--get <key> <value>` is a misuse;
  // git rejects it, but the `--get` + 2 positionals path is not a v1 target —
  // treat a value as a set only without `--get`.
  if (positionals.length >= 2 && !getFlag) {
    await g.setConfig(key, positionals.slice(1).join(' '));
    return 0;
  }

  const value = await g.getConfig(key);
  if (value === undefined) return 1; // unset → exit 1, no output (real git)
  ctx.stdout.write(`${value}\n`);
  return 0;
}
