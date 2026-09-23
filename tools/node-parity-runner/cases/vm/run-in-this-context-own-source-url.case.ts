import type { ParityCase } from '../../src/types.ts';

// A vm script whose code carries its own `sourceURL` magic comment (unit
// runtime-js/vm-run-in-this-context-offsets). V8 names such a script by the
// LAST valid `//# sourceURL=` / `//@ sourceURL=` comment and drops the vm
// offsets from line/column getters and rendering, yet keeps them on the
// enclosing getters. A comment-shaped text inside a string / template / regex
// is not a comment; a trailing invalid comment clears the name.
const c: ParityCase = {
  code: String.raw`
    const vm = require('node:vm');
    const MARK = /(?:\/virtual\/|rifty-vm:\/\/|"\/virtual)/;
    const frames = (stack) =>
      String(stack)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('at ') && MARK.test(line))
        .join(' | ');
    const made = (code, options) => frames(vm.runInThisContext(code, options)().stack);
    const TICK = String.fromCharCode(96);
    const fn = (name, own) => '(function ' + name + '() {\n  return new Error("s") })\n' + own;

    console.log('own offsets line2', made(fn('f', '//# sourceURL=/virtual/own.js'), { filename: '/virtual/file.js', lineOffset: 3, columnOffset: 2 }));
    console.log('own offsets line1', made('(function g() { return new Error("s") })\n//# sourceURL=/virtual/own1.js', { filename: '/virtual/file1.js', lineOffset: 5, columnOffset: -3 }));
    console.log('own Script', frames(new vm.Script(fn('h', '//# sourceURL=/virtual/ownS.js'), { filename: '/virtual/fileS.js', lineOffset: 5, columnOffset: -3 }).runInThisContext()().stack));
    console.log('own legacy at', made(fn('l', '//@ sourceURL=/virtual/legacy.js'), { filename: '/virtual/fileL.js', lineOffset: 2, columnOffset: 4 }));
    console.log('own last wins', made(fn('w', '//# sourceURL=/virtual/first.js\n//# sourceURL=/virtual/second.js'), { filename: '/virtual/fileW.js', lineOffset: 2, columnOffset: 4 }));
    console.log('own last invalid', made(fn('i', '//# sourceURL=/virtual/valid.js\n//# sourceURL=not valid'), { filename: '/virtual/fileI.js', lineOffset: 2, columnOffset: 4 }));
    console.log('own quoted', made(fn('q', '//# sourceURL="/virtual/q.js"'), { filename: '/virtual/fileQ.js', lineOffset: 2, columnOffset: 4 }));
    console.log('own no filename', made(fn('n', '//# sourceURL=/virtual/nofn.js'), { lineOffset: 2, columnOffset: 4 }));
    console.log('own after hashbang', made('#!/usr/bin/env node\n' + fn('b', '//# sourceURL=/virtual/hb.js'), { filename: '/virtual/fileB.js', lineOffset: 2, columnOffset: 4 }));
    console.log('own zero offsets', made(fn('z', '//# sourceURL=/virtual/own0.js'), { filename: '/virtual/file0.js' }));
    console.log('own identity-shaped', made(fn('r', '//# sourceURL=rifty-vm://5/5/x.js'), { filename: '/virtual/fileR.js', lineOffset: 2, columnOffset: 4 }));
    console.log('own identity-shaped zero', made(fn('r0', '//# sourceURL=rifty-vm://5/5/y.js'), { filename: '/virtual/fileR0.js' }));

    // Comment-shaped text that is not a comment keeps the vm filename and offsets.
    console.log('not own string', made('var s = "//# sourceURL=/virtual/str.js";\n' + fn('s', ''), { filename: '/virtual/fileStr.js', lineOffset: 2, columnOffset: 4 }));
    console.log('not own template', made('var t = ' + TICK + '\n//# sourceURL=/virtual/tpl.js\n' + TICK + ';\n' + fn('t', ''), { filename: '/virtual/fileTpl.js', lineOffset: 2, columnOffset: 4 }));
    console.log('not own regex', made('var r = /[//]# sourceURL=x/;\n' + fn('x', ''), { filename: '/virtual/fileRe.js', lineOffset: 2, columnOffset: 4 }));
    console.log('not own block', made('/*\n//# sourceURL=/virtual/blk.js\n*/\n' + fn('k', ''), { filename: '/virtual/fileBlk.js', lineOffset: 2, columnOffset: 4 }));

    // Guest hook CallSites: name and line/column without offsets, enclosing with them.
    const pick = (site) =>
      [
        site.getScriptNameOrSourceURL(),
        site.getLineNumber(),
        site.getColumnNumber(),
        site.getEnclosingLineNumber(),
        site.getEnclosingColumnNumber(),
        String(site),
      ].map(String).join(',');
    const hooked = (make) => {
      const saved = Error.prepareStackTrace;
      Error.prepareStackTrace = (error, sites) => sites.filter((site) => MARK.test(String(site.getScriptNameOrSourceURL()))).map(pick).join(' | ');
      try {
        return make().stack;
      } finally {
        Error.prepareStackTrace = saved;
      }
    };
    console.log('hook own line2', hooked(vm.runInThisContext(fn('f2', '//# sourceURL=/virtual/hown.js'), { filename: '/virtual/hfile.js', lineOffset: 3, columnOffset: 2 })));
    console.log('hook own line1', hooked(vm.runInThisContext('(function g2() { return new Error("s") })\n//# sourceURL=/virtual/hown1.js', { filename: '/virtual/hfile1.js', lineOffset: 5, columnOffset: -3 })));
    console.log('hook own zero', hooked(vm.runInThisContext(fn('z2', '//# sourceURL=/virtual/hown0.js'), { filename: '/virtual/hfile0.js' })));
    console.log('hook own identity-shaped', hooked(vm.runInThisContext(fn('r2', '//# sourceURL=rifty-vm://1/1/h.js'), { filename: '/virtual/hfileR.js', lineOffset: 3, columnOffset: 2 })));

    // Execution is unchanged.
    console.log('own exec', vm.runInThisContext('var __vmOwnUrl = 5; this === globalThis && __vmOwnUrl * 2\n//# sourceURL=/virtual/exec.js', { filename: '/virtual/fileX.js', lineOffset: 1, columnOffset: 1 }), globalThis.__vmOwnUrl);
    delete globalThis.__vmOwnUrl;
  `,
};

export default c;
