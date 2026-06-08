/**
 * GNU `ls -C` column packing: arrange names into the MOST columns that fit
 * `width`, filling DOWN each column then across, 2-space gutters, each column
 * padded to its widest entry. The trailing column on every row is NOT padded
 * (GNU emits no trailing whitespace). Verified byte-for-byte vs GNU coreutils.
 */

const GUTTER = 2;

/**
 * Lay out `names` for a terminal `width` (caller passes `ctx.cols ?? 80`).
 * Returns the multi-line block with a trailing newline, or '' for empty input.
 *
 * `decorate` (default identity) wraps each cell for display AFTER layout — pass
 * the SGR colorizer here so column widths are measured on the PLAIN names and
 * the invisible escape bytes never inflate the alignment.
 */
export function packColumns(
  names: string[],
  width: number,
  decorate: (name: string) => string = (s) => s,
): string {
  const n = names.length;
  if (n === 0) return '';

  const lens = names.map((s) => s.length);

  // Most-columns-first: pick the largest `cols` whose padded total fits `width`.
  // Down-then-across => column k holds names[k*rows .. k*rows+rows-1].
  for (let cols = n; cols >= 1; cols--) {
    const rows = Math.ceil(n / cols);
    // A `cols` value is only valid if it actually uses every column (else it
    // collapses to fewer); skip layouts whose last column would be empty.
    if (rows * (cols - 1) >= n) continue;

    const colWidth: number[] = new Array(cols).fill(0);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const i = c * rows + r;
        if (i < n) colWidth[c] = Math.max(colWidth[c] as number, lens[i] as number);
      }
    }

    let total = 0;
    for (let c = 0; c < cols; c++) total += (colWidth[c] as number) + (c > 0 ? GUTTER : 0);
    if (cols > 1 && total > width) continue;

    return render(names, rows, cols, colWidth, decorate);
  }

  // Unreachable: cols=1 always satisfies the `total > width` guard (skipped for
  // cols===1) and the non-empty-column check. Kept for type totality.
  return render(names, n, 1, [Math.max(...lens)], decorate);
}

function render(
  names: string[],
  rows: number,
  cols: number,
  colWidth: number[],
  decorate: (name: string) => string,
): string {
  const n = names.length;
  let out = '';
  for (let r = 0; r < rows; r++) {
    // Find this row's last populated column so we can skip padding it.
    let lastCol = -1;
    for (let c = cols - 1; c >= 0; c--) {
      if (c * rows + r < n) {
        lastCol = c;
        break;
      }
    }
    for (let c = 0; c <= lastCol; c++) {
      const i = c * rows + r;
      const name = names[i] as string;
      if (c < lastCol) {
        // Pad by the PLAIN visible length — `decorate` (SGR) bytes are invisible
        // and must not count toward column alignment.
        const pad = (colWidth[c] as number) + GUTTER - name.length;
        out += decorate(name) + ' '.repeat(Math.max(0, pad));
      } else {
        out += decorate(name); // trailing cell: no padding
      }
    }
    out += '\n';
  }
  return out;
}
