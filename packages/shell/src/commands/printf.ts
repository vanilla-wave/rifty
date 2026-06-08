/**
 * `printf FORMAT [ARGS...]` — GNU-faithful formatted output.
 *
 * Conversions: %s %d %i %x %o %c %% . Escapes in FORMAT: \n \t \\ \r plus \xNN
 * (hex) and \NNN (octal). FORMAT is recycled over ARGS until they are consumed
 * (`printf '%s ' a b c` => "a b c "); a pass that consumes no argument runs once
 * and stops (no infinite loop). No trailing newline is added — that's echo, not
 * printf. Exit 0 on success, 1 if any numeric conversion got a bad operand.
 *
 * NotImplementedError for %b, %q, and any field-width/precision spec (%5.2f).
 */

import { NotImplementedError } from '@riftydev/io';
import type { ShellCommand } from '../types.ts';

/** One conversion directive or a literal run, in FORMAT order. */
type Token = { kind: 'lit'; text: string } | { kind: 'conv'; spec: string };

/** Decode FORMAT backslash escapes (\xNN hex, \NNN octal, the named ones). */
function decodeEscapes(s: string): string {
  let r = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\' || i + 1 >= s.length) {
      r += s[i];
      continue;
    }
    const c = s[++i] ?? ''; // guarded: i+1<length, so always defined
    if (c === 'x') {
      // \xNN: up to two hex digits.
      let hex = '';
      while (hex.length < 2 && /[0-9a-fA-F]/.test(s[i + 1] ?? '')) hex += s[++i];
      r += hex ? String.fromCharCode(Number.parseInt(hex, 16)) : '\\x';
      continue;
    }
    if (c >= '0' && c <= '7') {
      // \NNN: up to three octal digits (c is the first).
      let oct = c;
      while (oct.length < 3 && /[0-7]/.test(s[i + 1] ?? '')) oct += s[++i] ?? '';
      r += String.fromCharCode(Number.parseInt(oct, 8));
      continue;
    }
    switch (c) {
      case 'n':
        r += '\n';
        break;
      case 't':
        r += '\t';
        break;
      case 'r':
        r += '\r';
        break;
      case '\\':
        r += '\\';
        break;
      default:
        r += `\\${c}`; // unknown escape: keep literal (GNU behaviour)
    }
  }
  return r;
}

/** Split FORMAT into literal/conversion tokens; decode escapes inside literals. */
function tokenize(format: string): Token[] {
  const tokens: Token[] = [];
  let lit = '';
  const flush = () => {
    if (lit) tokens.push({ kind: 'lit', text: decodeEscapes(lit) });
    lit = '';
  };
  for (let i = 0; i < format.length; i++) {
    if (format[i] !== '%') {
      lit += format[i];
      continue;
    }
    flush();
    // Capture from '%' up to and including the conversion letter (or another %).
    const m = /^%[^A-Za-z%]*[A-Za-z%]/.exec(format.slice(i));
    if (!m) {
      // A trailing bare '%' — emit it literally.
      lit += '%';
      continue;
    }
    tokens.push({ kind: 'conv', spec: m[0] });
    i += m[0].length - 1;
  }
  flush();
  return tokens;
}

/** Format one numeric conversion; null on a bad operand (caller sets status 1). */
function formatNumber(letter: string, arg: string): string | null {
  const n = Number.parseInt(arg, 10);
  if (arg !== '' && Number.isNaN(n)) return null;
  const v = Number.isNaN(n) ? 0 : n; // empty/absent operand => 0
  switch (letter) {
    case 'd':
    case 'i':
      return String(v);
    case 'x':
      return (v >>> 0).toString(16);
    case 'o':
      return (v >>> 0).toString(8);
    default:
      return String(v);
  }
}

export const printf: ShellCommand = async (args, ctx) => {
  const format = args[0] ?? '';
  const operands = args.slice(1);
  const tokens = tokenize(format);
  let status = 0;
  let argIdx = 0;

  // GNU recycling: re-run FORMAT while operands remain AND the previous pass
  // consumed at least one (guards against a no-conversion FORMAT looping).
  do {
    const startIdx = argIdx;
    for (const tok of tokens) {
      if (tok.kind === 'lit') {
        ctx.stdout.write(tok.text);
        continue;
      }
      const spec = tok.spec;
      const letter = spec[spec.length - 1] ?? '';
      if (letter === '%') {
        ctx.stdout.write('%');
        continue;
      }
      // Reject %b/%q and any flag/width/precision (anything between % and letter).
      if (letter === 'b' || letter === 'q') {
        throw new NotImplementedError(`shell.printf.%${letter}`, 'conversion not supported');
      }
      if (spec.length > 2 || !'sdioxc'.includes(letter)) {
        throw new NotImplementedError(
          `shell.printf.${spec}`,
          'flags/width/precision specifiers not supported',
        );
      }
      const arg = operands[argIdx++] ?? '';
      if (letter === 's') {
        ctx.stdout.write(arg);
      } else if (letter === 'c') {
        ctx.stdout.write(arg.slice(0, 1));
      } else {
        const formatted = formatNumber(letter, arg);
        if (formatted === null) {
          ctx.stderr.write(`printf: ${arg}: expected a numeric value\n`);
          status = 1;
          ctx.stdout.write('0'); // GNU prints 0 for the failed conversion
        } else {
          ctx.stdout.write(formatted);
        }
      }
    }
    if (argIdx === startIdx) break; // no operand consumed this pass → stop
  } while (argIdx < operands.length);

  return status;
};
