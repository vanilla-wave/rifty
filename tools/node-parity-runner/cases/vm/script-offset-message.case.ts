import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    for (const message of [
      'rifty-vm://offset/10/-20/%2Fvirtual%2Fx.js:1:7',
      'rifty-vm://offset/10/-20/%ZZ:1:7',
    ]) {
      const source = '() => new Error(' + JSON.stringify(message) + ').stack';
      const delayed = vm.runInThisContext(source, {
        filename: '/virtual/delayed.js', lineOffset: 10, columnOffset: -20,
      });
      console.log(delayed().split('\\n')[0]);
    }
  `,
};

export default c;
