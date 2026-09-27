import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const filename = '/virtual/vm-script-offsets.js';
    function frame(stack) {
      const line = String(stack).split('\\n').find((line) => line.trim().startsWith('at ') && line.includes(filename + ':'));
      return line ? line.slice(line.indexOf(filename)).replace(/\\)$/, '') : 'missing-frame';
    }
    function record(label, run) {
      try { console.log(label + ' ' + frame(run())); }
      catch (error) { console.log(label + ' ' + error.name + ':' + error.message); }
    }
    for (const [label, source] of [['first', 'new Error().stack'], ['second', '\\nnew Error().stack']]) {
      for (const [lineOffset, columnOffset] of [[0, 0], [0, -20], [10, 5], [10, -20], [-3, -20]]) {
        record(label + ':' + lineOffset + ':' + columnOffset, () =>
          new vm.Script(source, { filename, lineOffset, columnOffset }).runInThisContext());
      }
    }
    record('constructor-options', () => {
      const script = new vm.Script('new Error().stack', { filename, lineOffset: 10, columnOffset: 5 });
      script.runInThisContext();
      return script.runInThisContext({ lineOffset: 200, columnOffset: 200, filename: '/ignored.js' });
    });
    record('late-function-same-filename', () => {
      const script = new vm.Script('(function(){ return new Error().stack; })', {
        filename, lineOffset: 10, columnOffset: -20,
      });
      const fn = script.runInThisContext();
      new vm.Script('0', { filename, lineOffset: 20, columnOffset: 5 }).runInThisContext();
      return fn();
    });
  `,
};

export default c;
