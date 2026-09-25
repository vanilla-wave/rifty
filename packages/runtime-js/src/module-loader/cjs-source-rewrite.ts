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
  const identifiers = escapedIdentifierNames(source);
  let candidate = base;
  let suffix = 0;
  while (reserved.has(candidate) || identifiers.has(candidate) || source.includes(candidate)) {
    suffix++;
    candidate = `${base}${suffix}`;
  }
  return candidate;
}

function escapedIdentifierNames(source: string): ReadonlySet<string> {
  const names = new Set<string>();
  if (!source.includes('\\u')) return names;
  try {
    for (const token of tokenizer(source, { ecmaVersion: 'latest', allowHashBang: true })) {
      const value = (token as { readonly value?: unknown }).value;
      if (token.type.label === 'name' && typeof value === 'string') names.add(value);
    }
  } catch {
    // The caller's parser owns syntax diagnostics; invalid source never executes.
  }
  return names;
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
import { tokenizer } from 'acorn';
