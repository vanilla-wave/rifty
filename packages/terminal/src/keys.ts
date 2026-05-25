/**
 * Pure key-classification helpers for the line-mode terminal handler.
 *
 * `xterm.js` delivers raw byte sequences via `onData`. We turn them into
 * a high-level {@link KeyEvent} discriminated union so the orchestrator
 * in {@link RiftyTerminal} stays simple and testable.
 *
 * Conventions chosen here match xterm.js defaults (which match a VT100 /
 * common DEC terminal):
 *   - Up arrow:    `ESC [ A`     (`\x1b[A`)
 *   - Down arrow:  `ESC [ B`     (`\x1b[B`)
 *   - Right arrow: `ESC [ C`     (`\x1b[C`)
 *   - Left arrow:  `ESC [ D`     (`\x1b[D`)
 *   - Enter:       `\r`          (`\x0d`)
 *   - Tab:         `\t`          (`\x09`)
 *   - Backspace:   `\x7f` (DEL)  — xterm.js default for the Backspace key
 *   - Ctrl+C:      `\x03`        (ETX)
 *
 * Multi-byte UTF-8 input and bracketed-paste chunks are classified as
 * {@link PrintableEvent} so the caller appends them to the line buffer.
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
 * A payload may contain:
 *   - A single byte (most key presses, e.g. `'a'`, `'\r'`, `'\x7f'`).
 *   - A multi-byte escape sequence (e.g. `'\x1b[A'` for up arrow).
 *   - A multi-character chunk from a paste, possibly containing `\n` and
 *     printable text mixed together.
 *
 * Pastes that contain control bytes other than `\n`/`\r`/`\t` have those
 * bytes stripped (they could insert escape sequences into the buffer that
 * the host runtime wouldn't expect from line-mode stdin).
 */
export function classifyKey(data: string): KeyEvent {
  if (data === '') return { kind: 'ignored', reason: 'empty' };

  // Single-byte control sequences.
  if (data === '\r') return { kind: 'enter' };
  if (data === '\x7f') return { kind: 'backspace' };
  if (data === '\x08') return { kind: 'backspace' };
  if (data === '\t') return { kind: 'tab' };
  if (data === '\x03') return { kind: 'ctrl-c' };

  // CSI escape sequences. xterm.js delivers these as one chunk per key
  // press (the user can't break them apart with the keyboard), so we
  // match the full sequence — not just the trailing letter.
  if (data === '\x1b[A') return { kind: 'arrow-up' };
  if (data === '\x1b[B') return { kind: 'arrow-down' };
  if (data === '\x1b[C') return { kind: 'arrow-right' };
  if (data === '\x1b[D') return { kind: 'arrow-left' };

  // Any other lone control byte: drop. We allow LF inside multi-char
  // pastes below, but a *standalone* LF (e.g. some terminals send `\n`
  // instead of `\r` for Enter) is treated like Enter — Node's readline
  // does the same.
  if (data === '\n') return { kind: 'enter' };

  // Any other escape sequence we don't recognise — ignore. Letting
  // unknown CSIs reach the buffer would corrupt line input.
  if (data.charCodeAt(0) === 0x1b) {
    return { kind: 'ignored', reason: 'unrecognised-escape' };
  }

  // Single unprintable control byte that isn't whitelisted above — drop.
  // We keep the whitelist explicit so paste behaviour is predictable.
  if (data.length === 1 && data.charCodeAt(0) < 32) {
    return { kind: 'ignored', reason: 'control-byte' };
  }
  if (data.length === 1 && data.charCodeAt(0) === 0x7f) {
    return { kind: 'backspace' };
  }

  // Multi-character payload — either real printable text or a paste.
  // Strip control bytes we don't expect in a line buffer, but KEEP `\n`
  // (paste between lines) and `\t` (literal tabs in pasted code).
  // We don't try to interpret embedded escape sequences inside a paste
  // payload — those are dropped wholesale to avoid CSI injection.
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
 * When we encounter an ESC (`\x1b`), we also consume the rest of the
 * CSI sequence (ESC `[` + parameter bytes + final letter). Otherwise
 * pasting `safe\x1b[Aevil` would leave `safe[Aevil` in the buffer and
 * the `[A` would still look like garbage to the user.
 */
function stripUnsafeControls(data: string): string {
  let out = '';
  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i);
    if (code === 0x1b) {
      // Skip the CSI sequence: ESC [ <params> <final>. We accept any
      // bytes in 0x20..0x3f as parameter/intermediate and the next
      // 0x40..0x7e byte as the final. If the sequence is malformed,
      // we still skip the ESC and the `[` so they don't pollute the
      // buffer.
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
