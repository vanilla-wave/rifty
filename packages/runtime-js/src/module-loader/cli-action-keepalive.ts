/**
 * Bundled cac runs `this.runMatchedCommand()` and drops the action promise.
 * The same tracker Vite's install patch calls keeps that promise on the loop.
 * Already-patched sources contain the tracker call and are left alone.
 * The rewrite touches that statement only in code, not in strings or comments,
 * and stays on the same line so the recorded source map does not shift.
 */
const BARE_CALL = 'this.runMatchedCommand();';
const TRACKER = '__riftyTrackCliPromise';
const REPLACEMENT = `var __riftyAction = this.runMatchedCommand(); if (__riftyAction && typeof __riftyAction.then === "function" && globalThis.${TRACKER}) globalThis.${TRACKER}(__riftyAction);`;

type Mode = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';

interface Frame {
  kind: Mode;
  braces: number;
}

export function trackUnawaitedCliAction(source: string): string {
  if (source.includes(TRACKER) || !source.includes(BARE_CALL)) return source;
  return rewriteCodeCalls(source);
}

function rewriteCodeCalls(source: string): string {
  let out = '';
  const stack: Frame[] = [{ kind: 'code', braces: 0 }];
  let i = 0;
  while (i < source.length) {
    const frame = stack[stack.length - 1];
    if (!frame) break;
    const c = source[i] ?? '';
    const next = source[i + 1] ?? '';
    if (frame.kind === 'line') {
      out += c;
      i += 1;
      if (c === '\n') stack.pop();
      continue;
    }
    if (frame.kind === 'block') {
      if (c === '*' && next === '/') {
        out += '*/';
        i += 2;
        stack.pop();
        continue;
      }
      out += c;
      i += 1;
      continue;
    }
    if (frame.kind === 'sq' || frame.kind === 'dq') {
      out += c;
      i += 1;
      if (c === '\\' && i < source.length) {
        out += source[i];
        i += 1;
        continue;
      }
      if (c === (frame.kind === 'sq' ? "'" : '"')) stack.pop();
      continue;
    }
    if (frame.kind === 'tpl') {
      out += c;
      i += 1;
      if (c === '\\' && i < source.length) {
        out += source[i];
        i += 1;
        continue;
      }
      if (c === '`') stack.pop();
      else if (c === '$' && next === '{') {
        out += next;
        i += 1;
        stack.push({ kind: 'code', braces: 1 });
      }
      continue;
    }
    if (c === '/' && next === '/') {
      stack.push({ kind: 'line', braces: 0 });
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      stack.push({ kind: 'block', braces: 0 });
      out += c;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"') {
      stack.push({ kind: c === "'" ? 'sq' : 'dq', braces: 0 });
      out += c;
      i += 1;
      continue;
    }
    if (c === '`') {
      stack.push({ kind: 'tpl', braces: 0 });
      out += c;
      i += 1;
      continue;
    }
    if (c === '{') frame.braces += 1;
    if (c === '}') {
      if (frame.braces > 0) frame.braces -= 1;
      const parent = stack[stack.length - 2];
      if (frame.braces === 0 && parent?.kind === 'tpl') {
        out += c;
        i += 1;
        stack.pop();
        continue;
      }
    }
    if (source.startsWith(BARE_CALL, i)) {
      out += REPLACEMENT;
      i += BARE_CALL.length;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}
