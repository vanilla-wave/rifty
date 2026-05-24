/**
 * Minimal shell tokenizer. Splits on whitespace, honours single/double quotes
 * (no escape interpretation inside), treats `>` and `>>` as their own tokens.
 *
 * Intentionally not POSIX — we don't need backticks, command substitution,
 * globbing, or variable expansion. The shell drives an in-browser playground;
 * keep it small and predictable.
 */

export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line[i]!;
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    if (ch === '>' || ch === '<') {
      let op = ch;
      if (ch === '>' && line[i + 1] === '>') {
        op = '>>';
        i++;
      }
      tokens.push(op);
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let buf = '';
      while (i < n && line[i] !== quote) {
        buf += line[i];
        i++;
      }
      if (line[i] === quote) i++;
      tokens.push(buf);
      continue;
    }
    let buf = '';
    while (i < n && line[i] !== ' ' && line[i] !== '\t' && line[i] !== '>' && line[i] !== '<') {
      if (line[i] === '"' || line[i] === "'") {
        const q = line[i]!;
        i++;
        while (i < n && line[i] !== q) {
          buf += line[i];
          i++;
        }
        if (line[i] === q) i++;
      } else {
        buf += line[i];
        i++;
      }
    }
    tokens.push(buf);
  }
  return tokens;
}
