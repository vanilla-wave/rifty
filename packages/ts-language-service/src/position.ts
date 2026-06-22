/**
 * Offset ↔ {line, character} mapping over a document's text.
 *
 * 0-based line & character (LSP convention; TS's own `lineAndCharacter` is also
 * 0-based, so diagnostic ranges map straight through). A `\n` terminating a line
 * belongs to that line — the first character of the next line starts at the
 * offset just after it. UTF-16 code units throughout (JS string indexing),
 * matching both TS source positions and LSP's default `utf-16` position
 * encoding.
 */

import type { Position } from './lsp-types.ts';

/** Convert a 0-based UTF-16 offset into a 0-based {line, character}. */
export function offsetToPosition(text: string, offset: number): Position {
  let line = 0;
  let lineStart = 0;
  // Count newlines strictly before `offset`; the last one fixes the line start.
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: offset - lineStart };
}

/** Convert a 0-based {line, character} back into a 0-based UTF-16 offset. */
export function positionToOffset(text: string, position: Position): number {
  let offset = 0;
  let line = 0;
  while (line < position.line && offset < text.length) {
    if (text.charCodeAt(offset) === 10 /* \n */) line++;
    offset++;
  }
  return offset + position.character;
}
