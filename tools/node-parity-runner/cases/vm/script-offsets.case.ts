import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const frame = (stack, file) => stack.match(new RegExp('/virtual/' + file + ':\\\\d+:\\\\d+'))?.[0];
    const fromRun = vm.runInThisContext(
      'function run(){return new Error("run").stack}\\nrun',
      { filename: '/virtual/run.js', lineOffset: 10, columnOffset: 5 },
    );
    const script = new vm.Script(
      'function scripted(){return new Error("script").stack}\\nscripted',
      { filename: '/virtual/script.js', lineOffset: 10, columnOffset: -20 },
    );
    const fromScript = script.runInThisContext();
    const literal = vm.runInThisContext(
      '(() => \`first\\nsecond\`)()',
      { filename: '/virtual/literal.js', lineOffset: 1, columnOffset: 4 },
    );
    console.log(JSON.stringify({
      run: frame(fromRun(), 'run.js'),
      script: frame(fromScript(), 'script.js'),
      literal,
    }));
  `,
};

export default c;
