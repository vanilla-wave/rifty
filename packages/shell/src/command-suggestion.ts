/** Pure fuzzy command-name selection over the resolver's live discovery set. */

const DENYLIST = new Set([
  'npx',
  'yarn',
  'pnpm',
  'bun',
  'sed',
  'awk',
  'cut',
  'tree',
  'code',
  'vim',
  'nano',
  'python',
  'cls',
  'curl',
  'wget',
]);

function distance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist = Array.from({ length: rows * cols }, () => 0);
  const at = (row: number, col: number): number => dist[row * cols + col] ?? 0;
  const set = (row: number, col: number, value: number): void => {
    dist[row * cols + col] = value;
  };
  for (let row = 0; row < rows; row++) set(row, 0, row);
  for (let col = 0; col < cols; col++) set(0, col, col);
  for (let row = 1; row < rows; row++) {
    for (let col = 1; col < cols; col++) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      let best = Math.min(at(row - 1, col) + 1, at(row, col - 1) + 1, at(row - 1, col - 1) + cost);
      if (row > 1 && col > 1 && a[row - 1] === b[col - 2] && a[row - 2] === b[col - 1]) {
        best = Math.min(best, at(row - 2, col - 2) + 1);
      }
      set(row, col, best);
    }
  }
  return at(a.length, b.length);
}

export function suggestCommandName(input: string, names: readonly string[]): string | null {
  if (DENYLIST.has(input)) return null;
  let best: { readonly name: string; readonly distance: number } | null = null;
  for (const name of names) {
    const next = distance(input, name);
    if (
      best &&
      (next > best.distance || (next === best.distance && name.length <= best.name.length))
    ) {
      continue;
    }
    best = { name, distance: next };
  }
  const threshold = input.length <= 2 ? 0 : input.length <= 5 ? 1 : 2;
  return !best || best.distance > threshold ? null : best.name;
}
