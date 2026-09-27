import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    for (const filename of ['/virtual/a(b).js', '/virtual/space name.js', '/virtual/雪.js', '/virtual/\\ud800.js']) {
      try {
        const stack = vm.runInThisContext('new Error().stack', {filename, lineOffset: 2, columnOffset: -5});
        console.log(JSON.stringify({ filename, frame: String(stack).includes(filename + ':3:-4') }));
      } catch (error) { console.log(error.name + ':' + error.message); }
    }
  `,
};

export default c;
