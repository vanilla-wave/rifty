import type { ParityCase } from '../../src/types.ts';

// vm.runInThisContext / vm.Script lineOffset + columnOffset (unit
// runtime-js/vm-run-in-this-context-offsets). Frames are compared by their
// `file:line:col` token only: rifty's host-realm carrier is an indirect eval,
// so a script's TOP-LEVEL frame is named `eval` (pre-existing, not an offset
// behavior), and Node's displayErrors arrow decoration is a separate gap.
const c: ParityCase = {
  code: String.raw`
    const vm = require('node:vm');
    const tokenOf = (line, re) => (re.exec(line) || ['?'])[0];
    const framesOf = (stack, re) =>
      String(stack)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('at ') && re.test(line))
        .map((line) => tokenOf(line, re))
        .join(' | ');
    const VIRTUAL = /\/virtual\/[^\s():]+(?::-?\d+){0,2}/;
    const frames = (stack) => framesOf(stack, VIRTUAL);
    const thrown = (fn, re = VIRTUAL) => {
      try {
        fn();
        return 'no-throw';
      } catch (error) {
        return framesOf(error.stack, re);
      }
    };
    const run = (code, options) => () => vm.runInThisContext(code, options);

    // columnOffset shifts physical line 1 only and never clamps.
    console.log('line1-negative-column', thrown(run('throw new Error("boom")', { filename: '/virtual/mod.js', lineOffset: 0, columnOffset: -20 })));
    console.log('line1-positive', thrown(run('throw new Error("boom")', { filename: '/virtual/b.js', lineOffset: 10, columnOffset: 5 })));
    console.log('line2-positive', thrown(run('\n         throw new Error("boom")', { filename: '/virtual/c.js', lineOffset: 10, columnOffset: 5 })));
    console.log('fn-line1-called-line2', thrown(run('function f() { throw new Error("x") }\n         f()', { filename: '/virtual/d.js', lineOffset: 10, columnOffset: 5 })));
    console.log('fn-line3-called-line1', thrown(run('f();\nfunction f() {\n  throw new Error("x") }', { filename: '/virtual/e.js', lineOffset: 10, columnOffset: 5 })));
    console.log('lineOffset-only', thrown(run('  throw new Error("i")', { filename: '/virtual/i.js', lineOffset: 3 })));
    console.log('columnOffset-only', thrown(run('  throw new Error("j")', { filename: '/virtual/j.js', columnOffset: 7 })));

    // Shifted positions <= 0: negative printed, zero line/column omitted.
    console.log('negative-line', thrown(run('\n\nthrow new Error("neg")', { filename: '/virtual/f.js', lineOffset: -5 })));
    console.log('zero-line', thrown(run('(function top() { throw new Error("z") })()', { filename: '/virtual/zl.js', lineOffset: -1 })));
    console.log('zero-column', thrown(run('(function top() { throw new Error("z") })()', { filename: '/virtual/zc.js', columnOffset: -25 })));

    // vm.Script carries its constructor offsets; run options do not.
    console.log('Script-line2', thrown(() => new vm.Script('\n  throw new Error("s")', { filename: '/virtual/s.js', lineOffset: 4, columnOffset: 9 }).runInThisContext()));
    console.log('Script-line1', thrown(() => new vm.Script('throw new Error("s")', { filename: '/virtual/s2.js', lineOffset: 4, columnOffset: 9 }).runInThisContext()));
    console.log('Script-run-options-ignored', thrown(() => new vm.Script('throw new Error("s")', { filename: '/virtual/s3.js' }).runInThisContext({ lineOffset: 40, columnOffset: 40 })));
    const reused = new vm.Script('(function reused() { return new Error("r") })', { filename: '/virtual/reused.js', lineOffset: 6, columnOffset: 2 });
    console.log('Script-reused', frames(reused.runInThisContext()().stack), '||', frames(reused.runInThisContext()().stack));

    // Offsets belong to the script, not to its filename.
    const first = vm.runInThisContext('(function a() { return new Error("a") })', { filename: '/virtual/same.js', lineOffset: 100 });
    const second = vm.runInThisContext('(function b() { return new Error("b") })', { filename: '/virtual/same.js', lineOffset: 200, columnOffset: 50 });
    const plain = vm.runInThisContext('(function c() { return new Error("c") })', { filename: '/virtual/same.js' });
    console.log('per-script', frames(first().stack), '||', frames(second().stack), '||', frames(plain().stack), '||', frames(first().stack));

    // Error.captureStackTrace inside an offset script.
    const captured = vm.runInThisContext('(function () { const o = {}; Error.captureStackTrace(o); return o })()', { filename: '/virtual/cap.js', lineOffset: 1, columnOffset: 100 });
    console.log('captureStackTrace', frames(captured.stack));

    // Node's default filename carries the offsets too.
    console.log('default-filename', thrown(run('\n  throw new Error("d")', { lineOffset: 5, columnOffset: 3 }), /evalmachine\.<anonymous>(?::-?\d+){0,2}/));

    // Execution semantics are unchanged.
    console.log('exec', vm.runInThisContext('var __vmOffsetVar = 7; this === globalThis && __vmOffsetVar * 6', { filename: '/virtual/x.js', lineOffset: 3, columnOffset: -9 }), globalThis.__vmOffsetVar);
    delete globalThis.__vmOffsetVar;

    // Offset validation (int32).
    const rejects = [
      ['lineOffset string', { lineOffset: '1' }],
      ['lineOffset fraction', { lineOffset: 1.5 }],
      ['lineOffset NaN', { lineOffset: NaN }],
      ['lineOffset 2**31', { lineOffset: 2 ** 31 }],
      ['lineOffset -(2**31)-1', { lineOffset: -(2 ** 31) - 1 }],
      ['lineOffset 2**33', { lineOffset: 2 ** 33 }],
      ['lineOffset null', { lineOffset: null }],
      ['lineOffset boolean', { lineOffset: true }],
      ['lineOffset bigint', { lineOffset: 10n }],
      ['columnOffset string', { columnOffset: '1' }],
      ['columnOffset fraction', { columnOffset: 1.5 }],
      ['columnOffset 2**31', { columnOffset: 2 ** 31 }],
      ['lineOffset before columnOffset', { lineOffset: 'x', columnOffset: 'y' }],
      ['int32 bounds', { lineOffset: -(2 ** 31), columnOffset: 2 ** 31 - 1 }],
      ['negative zero', { lineOffset: -0, columnOffset: -0 }],
    ];
    for (const [label, options] of rejects) {
      for (const [entry, call] of [
        ['runInThisContext', () => vm.runInThisContext('1', options)],
        ['Script', () => new vm.Script('1', options)],
      ]) {
        try {
          call();
          console.log('validate', label, entry, 'ok');
        } catch (error) {
          console.log('validate', label, entry, error.name, error.code, error.message);
        }
      }
    }

    // Frames captured after runInThisContext returned.
    const outer = vm.runInThisContext('(function outer() {\n  return function inner() { throw new Error("late") } })', { filename: '/virtual/late.js', lineOffset: 2, columnOffset: -4 });
    const outer1 = vm.runInThisContext('(function outer1() { return function inner1() { throw new Error("late1") } })', { filename: '/virtual/late1.js', lineOffset: 2, columnOffset: -4 });
    const inner = outer();
    const inner1 = outer1();
    setTimeout(() => {
      console.log('deferred-line2', thrown(inner));
      console.log('deferred-line1', thrown(inner1));
    }, 0);
  `,
};

export default c;
