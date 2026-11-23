export interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** `source` with `\u` escapes decoded: an escaped identifier names the same binding. */
function decodedNames(source: string): string {
  if (!source.includes('\\u')) return source;
  return source.replace(/\\u(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/gu, (escape, braced, plain) => {
    const code = Number.parseInt((braced ?? plain) as string, 16);
    return code <= 0x10ffff ? String.fromCodePoint(code) : escape;
  });
}

export function uniqueHelperName(
  sourceText: string,
  base: string,
  reserved: ReadonlySet<string> = new Set(),
): string {
  const source = decodedNames(sourceText);
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
  sourceText: string,
  length: number,
  reserved: ReadonlySet<string> = new Set(),
): string {
  const source = decodedNames(sourceText);
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
