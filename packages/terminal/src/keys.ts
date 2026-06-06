/**
 * Pure key-classification helpers for the line-mode terminal handler.
 *
 * `xterm.js` delivers raw byte sequences via `onData`. We turn them into
 * a high-level {@link KeyEvent} discriminated union so the orchestrator
 * in {@link RiftyTerminal} stays simple and testable.
 *
 * Byte conventions match xterm.js defaults (VT100 / common DEC terminal),
 * e.g. arrows are `ESC [ A..D`, Enter `\r`, Backspace `\x7f` (DEL).
 *
 * Multi-byte UTF-8 input and bracketed-paste chunks are classified as
 * printable so the caller appends them to the line buffer.
 */

/** A logical key event derived from raw `onData` bytes. */
export type KeyEvent =
  | { readonly kind: 'enter' }
  | { readonly kind: 'backspace' }
  | { readonly kind: 'tab' }
  | { readonly kind: 'arrow-up' }
  | { readonly kind: 'arrow-down' }
  | { readonly kind: 'arrow-right' }
  | { readonly kind: 'arrow-left' }
  | { readonly kind: 'ctrl-c' }
  | { readonly kind: 'printable'; readonly text: string }
  | { readonly kind: 'ignored'; readonly reason: string };

/**
 * Classify a single `onData` payload from xterm.js into a {@link KeyEvent}.
 *
 * A payload may be a single byte, a multi-byte escape sequence, or a
 * multi-character paste chunk mixing `\n` and printable text.
 *
 * Pastes that contain control bytes other than `\n`/`\r`/`\t` have those
 * bytes stripped — they could inject escape sequences into the buffer that
 * the host runtime wouldn't expect from line-mode stdin.
 */
export function classifyKey(data: string): KeyEvent {
  if (data === '') return { kind: 'ignored', reason: 'empty' };

  if (data === '\r') return { kind: 'enter' };
  if (data === '\x7f') return { kind: 'backspace' };
  if (data === '\x08') return { kind: 'backspace' };
  if (data === '\t') return { kind: 'tab' };
  if (data === '\x03') return { kind: 'ctrl-c' };

  // xterm.js delivers each CSI as one chunk per key press, so match the
  // full sequence — not just the trailing letter.
  if (data === '\x1b[A') return { kind: 'arrow-up' };
  if (data === '\x1b[B') return { kind: 'arrow-down' };
  if (data === '\x1b[C') return { kind: 'arrow-right' };
  if (data === '\x1b[D') return { kind: 'arrow-left' };

  // Standalone LF (some terminals send `\n` instead of `\r` for Enter) is
  // treated like Enter — Node's readline does the same.
  if (data === '\n') return { kind: 'enter' };

  // Unrecognised escape: ignore. Letting unknown CSIs reach the buffer
  // would corrupt line input.
  if (data.charCodeAt(0) === 0x1b) {
    return { kind: 'ignored', reason: 'unrecognised-escape' };
  }

  if (data.length === 1 && data.charCodeAt(0) < 32) {
    return { kind: 'ignored', reason: 'control-byte' };
  }
  if (data.length === 1 && data.charCodeAt(0) === 0x7f) {
    return { kind: 'backspace' };
  }

  // Multi-character payload (printable text or paste). Embedded escape
  // sequences are dropped wholesale to avoid CSI injection.
  const cleaned = stripUnsafeControls(data);
  if (cleaned.length === 0) return { kind: 'ignored', reason: 'paste-all-control' };
  return { kind: 'printable', text: cleaned };
}

/**
 * Remove control bytes from a multi-character payload that shouldn't be
 * appended to a line buffer.
 *
 * Keeps `\n` (LF) and `\t` (HT) — useful inside pastes (newlines between
 * lines, indented code). Drops any other byte `< 32`, plus DEL (`\x7f`).
 *
 * On ESC (`\x1b`) also consumes the rest of the CSI sequence; otherwise
 * pasting `safe\x1b[Aevil` would leave `safe[Aevil` in the buffer.
 */
function stripUnsafeControls(data: string): string {
  let out = '';
  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i);
    if (code === 0x1b) {
      // Skip the CSI sequence ESC [ <params> <final>: 0x40..0x7e is the
      // final byte. Malformed sequences still drop ESC and `[`.
      if (i + 1 < data.length && data.charCodeAt(i + 1) === 0x5b) {
        let j = i + 2;
        while (j < data.length) {
          const c = data.charCodeAt(j);
          j += 1;
          if (c >= 0x40 && c <= 0x7e) break;
        }
        i = j - 1;
      }
      continue;
    }
    if (code === 0x09 || code === 0x0a) {
      out += data[i];
      continue;
    }
    if (code < 32) continue;
    if (code === 0x7f) continue;
    out += data[i];
  }
  return out;
}
