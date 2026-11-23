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

/**
 * A helper name exactly `length` characters long, absent from `source`: a
 * rewrite of an identifier that long keeps every column after it (Node's
 * frames point there).
 */
export function sameLengthHelperName(
  source: string,
  length: number,
  reserved: ReadonlySet<string> = new Set(),
): string {
  for (let n = 0; ; n += 1) {
    const candidate = `$r${n.toString(36).padStart(length - 2, '0')}`;
    if (!reserved.has(candidate) && !source.includes(candidate)) return candidate;
  }
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
