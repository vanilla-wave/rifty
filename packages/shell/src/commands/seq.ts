/**
 * `seq` builtin — print an arithmetic sequence.
 *
 * Forms (GNU): `seq LAST` (FIRST=1) | `seq FIRST LAST` (INCR=1) |
 * `seq FIRST INCR LAST`. Flags: `-s SEP` (separator, no trailing SEP),
 * `-w` (equal-width, zero-pad to the widest value). Float increments are
 * allowed; output precision is the max decimal places of FIRST and INCR. A
 * descending range without a negative increment prints nothing (GNU). Exit 0
 * on success, 1 on a bad/missing operand or zero increment. `-f FORMAT` throws
 * NotImplementedError.
 */

import { NotImplementedError } from '@riftydev/io';
import type { ShellCommand } from '../types.ts';

const HINT = "Try 'seq --help' for more information.\n";

/** Decimal places in an operand's textual form (precision driver; ignores 'e' forms). */
function decimals(s: string): number {
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** Parse a finite float operand; null on anything GNU rejects. */
function parseNum(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export const seq: ShellCommand = async (args, ctx) => {
  let sep = '\n';
  let equalWidth = false;
  const operands: string[] = [];
  let optsDone = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (optsDone || a === '-' || !a.startsWith('-')) {
      operands.push(a);
      continue;
    }
    if (a === '--') {
      optsDone = true;
      continue;
    }
    // A bare negative number (e.g. "-5") is an operand, not a flag cluster.
    if (parseNum(a) !== null) {
      operands.push(a);
      continue;
    }
    // Short-flag cluster: -w / -s SEP / -f FORMAT may be bundled (e.g. -ws,).
    let consumedRest = false;
    for (let k = 1; k < a.length && !consumedRest; k++) {
      const f = a[k];
      if (f === 'w') {
        equalWidth = true;
      } else if (f === 's') {
        const rest = a.slice(k + 1);
        if (rest !== '') {
          sep = rest;
        } else {
          const v = args[++i];
          if (v === undefined) {
            ctx.stderr.write("seq: option requires an argument -- 's'\n");
            ctx.stderr.write(HINT);
            return 1;
          }
          sep = v;
        }
        consumedRest = true;
      } else if (f === 'f') {
        throw new NotImplementedError('shell.seq.-f', 'printf-style FORMAT not supported');
      } else {
        ctx.stderr.write(`seq: invalid option -- '${f}'\n`);
        ctx.stderr.write(HINT);
        return 1;
      }
    }
  }

  if (operands.length === 0) {
    ctx.stderr.write('seq: missing operand\n');
    ctx.stderr.write(HINT);
    return 1;
  }
  if (operands.length > 3) {
    ctx.stderr.write(`seq: extra operand '${operands[3]}'\n`);
    ctx.stderr.write(HINT);
    return 1;
  }

  // Map operands to FIRST/INCR/LAST per the 1/2/3-arg forms.
  const firstS = operands.length >= 2 ? (operands[0] as string) : '1';
  const incrS = operands.length === 3 ? (operands[1] as string) : '1';
  const lastS = operands[operands.length - 1] as string;

  const first = parseNum(firstS);
  const incr = parseNum(incrS);
  const last = parseNum(lastS);
  for (const [v, raw] of [
    [first, firstS],
    [incr, incrS],
    [last, lastS],
  ] as const) {
    if (v === null) {
      ctx.stderr.write(`seq: invalid floating point argument: '${raw}'\n`);
      ctx.stderr.write(HINT);
      return 1;
    }
  }
  if (incr === 0) {
    ctx.stderr.write(`seq: invalid Zero increment value: '${incrS}'\n`);
    ctx.stderr.write(HINT);
    return 1;
  }

  // Precision tracks FIRST and INCR only (GNU); LAST does not raise it.
  const prec = Math.max(decimals(firstS), decimals(incrS));
  const fmt = (n: number): string => (n as number).toFixed(prec);

  // Generate values: first + i*incr avoids repeated-add float drift.
  const vals: number[] = [];
  for (let i = 0; ; i++) {
    const v = (first as number) + i * (incr as number);
    // Direction is the sign of INCR; the opposite-direction range is empty.
    if ((incr as number) > 0 ? v > (last as number) : v < (last as number)) break;
    vals.push(v);
  }

  if (vals.length === 0) return 0;

  const strs = vals.map(fmt);
  if (equalWidth) {
    const width = strs.reduce((m, s) => Math.max(m, s.length), 0);
    for (let i = 0; i < strs.length; i++) {
      const s = strs[i] as string;
      // Zero-pad after a leading sign (GNU: '-1' .. '00' .. '01').
      const neg = s.startsWith('-');
      const body = neg ? s.slice(1) : s;
      strs[i] = (neg ? '-' : '') + body.padStart(width - (neg ? 1 : 0), '0');
    }
  }

  ctx.stdout.write(`${strs.join(sep)}\n`);
  return 0;
};
