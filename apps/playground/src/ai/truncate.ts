/**
 * Shared tool-result size cap (ADR-0190 decision: 16 KiB per result,
 * head+tail with an explicit `[truncated N bytes]` marker). One constant for
 * every tool AND the trace recorder, so the cap recorded in the trace is the
 * cap actually applied.
 */

export const TOOL_RESULT_CAP_BYTES = 16 * 1024;

export interface CappedText {
  readonly text: string;
  /** Bytes removed by the cap; 0 when the input fit. */
  readonly truncatedBytes: number;
}

const enc = new TextEncoder();
// Non-fatal: a byte-boundary slice may split a code point; the replacement
// char is trimmed at the cut edges below.
const dec = new TextDecoder('utf-8');

function decodeTrimmed(bytes: Uint8Array, edge: 'head' | 'tail'): string {
  const text = dec.decode(bytes);
  // A byte cut can leave one U+FFFD at the cut edge — drop it, never mid-text.
  return edge === 'head' ? text.replace(/�+$/u, '') : text.replace(/^�+/u, '');
}

/**
 * Cap `text` to `capBytes` (UTF-8), keeping head+tail halves around an
 * explicit `[truncated N bytes]` marker. Never silent: the marker names the
 * exact byte count removed.
 */
export function capToolText(text: string, capBytes: number = TOOL_RESULT_CAP_BYTES): CappedText {
  const bytes = enc.encode(text);
  if (bytes.byteLength <= capBytes) return { text, truncatedBytes: 0 };
  const headBytes = Math.floor(capBytes / 2);
  const tailBytes = capBytes - headBytes;
  const truncatedBytes = bytes.byteLength - capBytes;
  const head = decodeTrimmed(bytes.subarray(0, headBytes), 'head');
  const tail = decodeTrimmed(bytes.subarray(bytes.byteLength - tailBytes), 'tail');
  return {
    text: `${head}\n[truncated ${truncatedBytes} bytes]\n${tail}`,
    truncatedBytes,
  };
}
