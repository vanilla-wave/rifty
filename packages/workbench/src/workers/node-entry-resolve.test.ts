import { describe, expect, it } from 'vitest';
import {
  buildNodeEvalSource,
  classifyNodeInvocation,
  resolveNodeEntry,
} from './node-entry-resolve.ts';

describe('classifyNodeInvocation', () => {
  it('-v / --version → version (not a /workspace/--version path)', () => {
    expect(classifyNodeInvocation(['-v'])).toEqual({ kind: 'version' });
    expect(classifyNodeInvocation(['--version'])).toEqual({ kind: 'version' });
  });

  it('-e SRC → eval with the source from the NEXT arg (never absolutized)', () => {
    expect(classifyNodeInvocation(['-e', 'console.log(1)'])).toEqual({
      kind: 'eval',
      source: 'console.log(1)',
      print: false,
      scriptArgs: [],
    });
  });

  it('--eval=SRC inline form', () => {
    expect(classifyNodeInvocation(['--eval=1+1'])).toEqual({
      kind: 'eval',
      source: '1+1',
      print: false,
      scriptArgs: [],
    });
  });

  it('-p / --print EXPR → eval with print', () => {
    expect(classifyNodeInvocation(['-p', '1+1'])).toEqual({
      kind: 'eval',
      source: '1+1',
      print: true,
      scriptArgs: [],
    });
    expect(classifyNodeInvocation(['--print=process.platform'])).toEqual({
      kind: 'eval',
      source: 'process.platform',
      print: true,
      scriptArgs: [],
    });
  });

  it('eval carries trailing script args', () => {
    expect(classifyNodeInvocation(['-e', 'x', 'a', 'b'])).toEqual({
      kind: 'eval',
      source: 'x',
      print: false,
      scriptArgs: ['a', 'b'],
    });
  });

  it('unknown leading-dash flag → badOption (never MODULE_NOT_FOUND on /workspace/<flag>)', () => {
    expect(classifyNodeInvocation(['--frobnicate'])).toEqual({
      kind: 'badOption',
      flag: '--frobnicate',
    });
    expect(classifyNodeInvocation(['-i'])).toEqual({ kind: 'badOption', flag: '-i' });
    expect(classifyNodeInvocation(['--inspect'])).toEqual({
      kind: 'badOption',
      flag: '--inspect',
    });
    expect(classifyNodeInvocation(['--env-file=.env'])).toEqual({
      kind: 'badOption',
      flag: '--env-file=.env',
    });
  });

  it('-e / -p with no value → badOption (loud, never silent)', () => {
    expect(classifyNodeInvocation(['-e'])).toEqual({ kind: 'badOption', flag: '-e' });
    expect(classifyNodeInvocation(['-p'])).toEqual({ kind: 'badOption', flag: '-p' });
  });

  it('a non-flag path → entry (today behavior preserved)', () => {
    expect(classifyNodeInvocation(['app.js', '--port', '3000'])).toEqual({
      kind: 'entry',
      arg: 'app.js',
      scriptArgs: ['--port', '3000'],
    });
  });

  it('no args → missing (bare REPL stays the documented ceiling)', () => {
    expect(classifyNodeInvocation([])).toEqual({ kind: 'missing' });
    expect(classifyNodeInvocation([''])).toEqual({ kind: 'missing' });
  });
});

describe('buildNodeEvalSource', () => {
  it('eval source is verbatim (CJS, no implicit print)', () => {
    expect(buildNodeEvalSource('console.log(2+2)', false)).toBe('console.log(2+2)');
  });

  it('print wraps the expr in util.inspect + newline', () => {
    const src = buildNodeEvalSource('1+1', true);
    expect(src).toContain("require('node:util')");
    expect(src).toContain('inspect((1+1))');
    expect(src).toContain("+ '\\n'");
  });
});

describe('resolveNodeEntry', () => {
  it('absolutizes a relative path against cwd', () => {
    expect(resolveNodeEntry('/w', 'app.js')).toEqual({ ok: true, path: '/w/app.js' });
  });

  it('returns ok for a missing file too — the loader emits the real Node MODULE_NOT_FOUND', () => {
    // backlog/runtime-js/node-entry-miss-node-shape: the owner no longer
    // pre-checks existence (the old terse `node: cannot find module` form). A
    // missing entry now flows into runNodeEntry → the module loader, which throws
    // real Node's `Error: Cannot find module '<abs>' … { code:'MODULE_NOT_FOUND',
    // requireStack: [] }` on the child stderr.
    expect(resolveNodeEntry('/w', 'nope.js')).toEqual({ ok: true, path: '/w/nope.js' });
  });

  it('keeps an absolute path as-is', () => {
    expect(resolveNodeEntry('/w', '/abs/app.js')).toEqual({ ok: true, path: '/abs/app.js' });
  });

  it('errors with usage when no file is given', () => {
    expect(resolveNodeEntry('/w', undefined)).toEqual({
      ok: false,
      message: 'node: missing entry file\nUsage: node <file> [args]\n',
    });
    expect(resolveNodeEntry('/w', '')).toEqual({
      ok: false,
      message: 'node: missing entry file\nUsage: node <file> [args]\n',
    });
  });
});
