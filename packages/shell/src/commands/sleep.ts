/**
 * `sleep` builtin — pause for the summed durations of its operands.
 *
 * Each operand is a non-negative number with an optional suffix: `s` (seconds,
 * default), `m` (minutes), `h` (hours), `d` (days). Multiple operands SUM (GNU).
 * Exit 0 when the delay completes; 130 (128+SIGINT) when cancelled via
 * `ctx.signal` — the wait races the abort so Ctrl+C returns promptly (ADR-0082).
 * A non-numeric value or unknown suffix is a usage error (stderr + exit 1), NOT
 * a NotImplementedError: GNU sleep itself rejects these at parse time.
 */

import type { ShellCommand } from '../types.ts';

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** Operand → seconds; null on anything GNU rejects (non-numeric / bad suffix). */
function parseInterval(s: string): number | null {
  if (s === '') return null;
  const last = s[s.length - 1] as string;
  const scale = UNIT_SECONDS[last];
  // Trailing non-digit must be a known unit; a digit-terminated value is seconds.
  const numPart = scale !== undefined ? s.slice(0, -1) : s;
  if (scale === undefined && !/^[0-9]/.test(last) && last !== '.') return null;
  if (numPart === '') return null;
  const n = Number(numPart);
  if (!Number.isFinite(n) || n < 0) return null;
  return n * (scale ?? 1);
}

/** Race a `seconds` delay against `signal`; 0 on completion, 130 on abort. */
function delay(seconds: number, signal: AbortSignal | undefined): Promise<number> {
  return new Promise<number>((res) => {
    const ms = seconds * 1000;
    const id = setTimeout(() => res(0), ms);
    const onAbort = (): void => {
      clearTimeout(id);
      res(130);
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export const sleep: ShellCommand = async (args, ctx) => {
  if (args.length === 0) {
    ctx.stderr.write('sleep: missing operand\n');
    return 1;
  }
  let total = 0;
  for (const a of args) {
    const secs = parseInterval(a);
    if (secs === null) {
      ctx.stderr.write(`sleep: invalid time interval '${a}'\n`);
      return 1;
    }
    total += secs;
  }
  return delay(total, ctx.signal);
};
