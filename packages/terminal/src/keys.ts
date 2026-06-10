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
  | { readonly kind: 'command-prev' }
  | { readonly kind: 'command-next' }
  | { readonly kind: 'command-prev-select' }
  | { readonly kind: 'command-next-select' }
  | { readonly kind: 'word-right' }
  | { readonly kind: 'word-left' }
  | { readonly kind: 'home' }
  | { readonly kind: 'end' }
  | { readonly kind: 'delete' }
  | { readonly kind: 'ctrl-c' }
  | { readonly kind: 'kill-before-cursor' }
  | { readonly kind: 'kill-after-cursor' }
  | { readonly kind: 'kill-word-left' }
  | { readonly kind: 'kill-word-right' }
  | { readonly kind: 'yank' }
  | { readonly kind: 'yank-pop' }
  | { readonly kind: 'reverse-search' }
  | { readonly kind: 'search-cancel' }
  | { readonly kind: 'clear-screen' }
  | { readonly kind: 'transpose' }
  | { readonly kind: 'undo' }
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
  if (data === '\x02') return { kind: 'arrow-left' };
  if (data === '\x04') return { kind: 'delete' };
  if (data === '\x06') return { kind: 'arrow-right' };
  if (data === '\x7f') return { kind: 'backspace' };
  if (data === '\x08') return { kind: 'backspace' };
  if (data === '\t') return { kind: 'tab' };
  if (data === '\x03') return { kind: 'ctrl-c' };
  if (data === '\x07') return { kind: 'search-cancel' };
  if (data === '\x0b') return { kind: 'kill-after-cursor' };
  if (data === '\x0c') return { kind: 'clear-screen' };
  if (data === '\x0e') return { kind: 'arrow-down' };
  if (data === '\x10') return { kind: 'arrow-up' };
  if (data === '\x12') return { kind: 'reverse-search' };
  if (data === '\x14') return { kind: 'transpose' };
  if (data === '\x15') return { kind: 'kill-before-cursor' };
  if (data === '\x1a' || data === '\x1f') return { kind: 'undo' };
  if (data === '\x17') return { kind: 'kill-word-left' };
  if (data === '\x19') return { kind: 'yank' };
  if (data === '\x01') return { kind: 'home' }; // Ctrl+A → line start
  if (data === '\x05') return { kind: 'end' }; // Ctrl+E → line end

  // xterm.js delivers each CSI as one chunk per key press, so match the
  // full sequence — not just the trailing letter.
  if (data === '\x1b[A') return { kind: 'arrow-up' };
  if (data === '\x1b[B') return { kind: 'arrow-down' };
  if (data === '\x1b[C') return { kind: 'arrow-right' };
  if (data === '\x1b[D') return { kind: 'arrow-left' };

  if (data === '\x1b[1;5A' || data === '\x1b[5A') return { kind: 'command-prev' };
  if (data === '\x1b[1;5B' || data === '\x1b[5B') return { kind: 'command-next' };
  if (data === '\x1b[1;6A' || data === '\x1b[6A') return { kind: 'command-prev-select' };
  if (data === '\x1b[1;6B' || data === '\x1b[6B') return { kind: 'command-next-select' };
  if (data === '\x1b[1;5D' || data === '\x1b[5D' || data === '\x1bb') return { kind: 'word-left' };
  if (data === '\x1b[1;5C' || data === '\x1b[5C' || data === '\x1bf') return { kind: 'word-right' };
  if (data === '\x1bd') return { kind: 'kill-word-right' };
  if (data === '\x1b\x7f' || data === '\x1b\b') return { kind: 'kill-word-left' };
  if (data === '\x1by') return { kind: 'yank-pop' };

  // Home: CSI H, CSI 1 ~, and the SS3 form (`\x1bOH`) some terminals send
  // in application-cursor mode. End: CSI F, CSI 4 ~, SS3 `\x1bOF`.
  if (data === '\x1b[H' || data === '\x1b[1~' || data === '\x1bOH') return { kind: 'home' };
  if (data === '\x1b[F' || data === '\x1b[4~' || data === '\x1bOF') return { kind: 'end' };
  if (data === '\x1b') return { kind: 'search-cancel' };
  // Delete (forward-delete): CSI 3 ~.
  if (data === '\x1b[3~') return { kind: 'delete' };

  // Standalone LF (some terminals send `\n` instead of `\r` for Enter) is
  // treated like Enter — Node's readline does the same.
  if (data === '\n') return { kind: 'enter' };

  // Unrecognised escape: ignore. Letting unknown CSIs reach the buffer
  // would corrupt line input.
  if (data.charCodeAt(0) === 0x1b) {
    const cleaned = stripUnsafeControls(data);
    if (cleaned.length > 0) return { kind: 'printable', text: cleaned };
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
