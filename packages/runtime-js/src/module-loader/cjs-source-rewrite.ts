export interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export function uniqueHelperName(
  source: string,
  base: string,
  reserved: ReadonlySet<string> = new Set(),
): string {
  let candidate = base;
  let suffix = 0;
  while (reserved.has(candidate) || source.includes(candidate)) {
    suffix++;
    candidate = `${base}${suffix}`;
  }
  return candidate;
}

export function applyEdits(source: string, edits: readonly Edit[]): string {
  let out = '';
  let pos = 0;
  for (const edit of [...edits].sort((a, b) => a.start - b.start || a.end - b.end)) {
    out += source.slice(pos, edit.start);
    out += edit.text;
    pos = edit.end;
  }
  return out + source.slice(pos);
}
