import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const original = Error.prepareStackTrace;
    try {
      Error.prepareStackTrace = (error, frames) => {
        const frame = frames[0];
        return {
          filename: frame.getFileName(),
          source: frame.getScriptNameOrSourceURL(),
          line: frame.getLineNumber(),
          column: frame.getColumnNumber(),
          eval: frame.isEval(),
        };
      };
      for (const [lineOffset, columnOffset] of [[10, 5], [10, -20], [-3, 5]]) {
        const result = vm.runInThisContext('new Error().stack', {
          filename: '/virtual/custom-renderer.js', lineOffset, columnOffset,
        });
        console.log(JSON.stringify(result));
      }
    } finally { Error.prepareStackTrace = original; }
  `,
};

export default c;
