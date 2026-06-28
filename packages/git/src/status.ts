/**
 * Shared rifty-git status classification.
 *
 * isomorphic-git statusMatrix code (`${head}${workdir}${stage}`) → git
 * porcelain-v1 `XY` (X = staged/index column, Y = worktree column). Codes are
 * verified against real git 2.50.1 in @riftydev/shell's golden fixtures.
 */
export function porcelainXY(code: string): string | null {
  switch (code) {
    case '111':
      return null;
    case '020':
      return '??';
    case '022':
      return 'A ';
    case '003':
      return 'AD';
    case '121':
      return ' M';
    case '122':
      return 'M ';
    case '123':
      return 'MM';
    case '101':
      return ' D';
    case '100':
      return 'D ';
    default:
      return code;
  }
}
