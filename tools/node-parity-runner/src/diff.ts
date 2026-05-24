/**
 * Normalise stdout before comparing. Both Node and rifty add a trailing newline
 * after the last `console.log`; we strip it to keep the diff focused on real
 * differences. Other normalisations (e.g. timing-sensitive values, IDs) are
 * intentionally NOT applied — those belong in the case's `code` itself.
 */
export function normalise(out: string): string {
  return out.replace(/\r\n/g, '\n').replace(/\n+$/, '');
}

export function diff(a: string, b: string): string {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const max = Math.max(aLines.length, bLines.length);
  const lines: string[] = [];
  for (let i = 0; i < max; i++) {
    const av = aLines[i] ?? '';
    const bv = bLines[i] ?? '';
    if (av !== bv) lines.push(`- ${av}\n+ ${bv}`);
  }
  return lines.join('\n');
}
