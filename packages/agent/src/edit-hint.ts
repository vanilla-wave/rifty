/** Hint only. Matching and writing remain exact inside the host's transform. */
export function editMatchFailure(current: string, old: string, path: string): string | undefined {
  let count = 0;
  const lines: number[] = [];
  for (let at = current.indexOf(old); at >= 0; at = current.indexOf(old, at + 1)) {
    count++;
    if (lines.length < 10) lines.push(current.slice(0, at).split('\n').length);
  }
  if (count === 1) return undefined;
  if (count > 1)
    return `edit_file: string is not unique in ${path}: ${count} matches: lines ${lines.join(', ')}${count > lines.length ? ' (first 10)' : ''} — include more context`;
  if (!current)
    return `edit_file: string not found in ${path}: 0 matches; empty file, no line hint`;
  const normalized = (text: string) => text.replace(/\s+/g, '');
  const target = normalized(old.split('\n').find((line) => normalized(line)) ?? old);
  const candidates = current.split('\n');
  // Compare the first nonempty old line's non-whitespace prefix/suffix; ties use first line.
  let best = 0;
  let bestScore = -1;
  for (const [index, line] of candidates.entries()) {
    const value = normalized(line);
    let prefix = 0;
    let suffix = 0;
    while (prefix < Math.min(value.length, target.length) && value[prefix] === target[prefix])
      prefix++;
    while (
      suffix < Math.min(value.length, target.length) - prefix &&
      value[value.length - 1 - suffix] === target[target.length - 1 - suffix]
    )
      suffix++;
    const score =
      value === target ? 2 : (prefix + suffix) / Math.max(value.length, target.length, 1);
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return `edit_file: string not found in ${path}: 0 matches; whitespace-insensitive hint, line ${best + 1}: ${candidates[best]?.slice(0, 240)} — matching remains exact`;
}
