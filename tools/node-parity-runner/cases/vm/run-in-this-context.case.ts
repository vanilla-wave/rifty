import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const vm = require('node:vm');

    delete globalThis.__riftyVmThisContextCount;
    const result = vm.runInThisContext(\`
      globalThis.__riftyVmThisContextCount = (globalThis.__riftyVmThisContextCount || 0) + 42;
      globalThis.__riftyVmThisContextCount;
    \`);
    console.log(result);
    console.log(globalThis.__riftyVmThisContextCount);

    const script = new vm.Script(\`
      globalThis.__riftyVmThisContextCount += 8;
      globalThis.__riftyVmThisContextCount;
    \`);
    console.log(script.runInThisContext());
  `,
};

export default c;
