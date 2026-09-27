import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const filename = '/virtual/vm-offsets.js';
    function frame(stack) {
      const line = String(stack).split('\\n').find((line) => line.trim().startsWith('at ') && line.includes(filename + ':'));
      return line ? line.slice(line.indexOf(filename)).replace(/\\)$/, '') : 'missing-frame';
    }
    function record(label, run) {
      try { console.log(label + ' ' + frame(run())); }
      catch (error) { console.log(label + ' ' + error.name + ':' + error.message); }
    }
    for (const [label, source] of [
      ['first', 'new Error().stack'],
      ['second', '\\nnew Error().stack'],
    ]) {
      for (const [lineOffset, columnOffset] of [[0, 0], [0, -20], [10, 5], [10, -20], [-3, -20]]) {
        record(label + ':' + lineOffset + ':' + columnOffset, () =>
          vm.runInThisContext(source, { filename, lineOffset, columnOffset }));
      }
    }
    record('returned-function', () => {
      const fn = vm.runInThisContext('(function(){ return new Error().stack; })', {
        filename, lineOffset: 10, columnOffset: -20,
      });
      return fn();
    });
    record('late-stack-same-filename', () => {
      const old = vm.runInThisContext('new Error()', { filename, lineOffset: 10, columnOffset: 5 });
      vm.runInThisContext('new Error()', { filename, lineOffset: 20, columnOffset: -20 });
      return old.stack;
    });
    record('thrown-error', () => {
      try { vm.runInThisContext('throw new Error("offset")', { filename, lineOffset: 10, columnOffset: -20 }); }
      catch (error) { if (error.message === 'offset') return error.stack; throw error; }
    });
  `,
};

export default c;
