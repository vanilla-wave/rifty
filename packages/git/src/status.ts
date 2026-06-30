/**
 * Shared rifty-git status classification.
 *
 * isomorphic-git statusMatrix code (`${head}${workdir}${stage}`) → git
 * porcelain-v1 `XY` (X = staged/index column, Y = worktree column). Codes are
 * verified against real git 2.50.1 in @riftydev/shell's golden fixtures.
 *
 * Covers every reachable single-path matrix code: the staged+worktree combos
 * `023` (AM), `103` (MD), `113`/`123` (MM) round out the M/A/D family so the
 * page SCM/decoration consumers never render a raw 3-char code as garbage or a
 * dropped (clean-looking) row.
 */
export function porcelainXY(code: string): string | null {
  switch (code) {
    case '111':
      return null;
    case '020':
      return '??';
    case '022':
      return 'A ';
    case '023':
      return 'AM';
    case '003':
      return 'AD';
    case '121':
      return ' M';
    case '122':
      return 'M ';
    case '123':
    case '113':
      return 'MM';
    case '103':
      return 'MD';
    case '101':
      return ' D';
    case '100':
      return 'D ';
    default:
      return code;
  }
}
