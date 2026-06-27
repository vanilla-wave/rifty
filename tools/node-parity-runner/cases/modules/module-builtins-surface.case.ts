import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const mod = require('node:module');
    const out = {
      constants: mod.constants.compileCacheStatus,
      functionTypes: [
        typeof mod.enableCompileCache,
        typeof mod.flushCompileCache,
        typeof mod.getCompileCacheDir,
        typeof mod.isBuiltin,
        typeof mod.Module.isBuiltin,
      ],
      builtins: [
        mod.isBuiltin('node:path'),
        mod.isBuiltin('path'),
        mod.isBuiltin('node:not-a-real-builtin'),
        mod.Module.isBuiltin('node:path'),
      ],
      moduleMirrorsConstants: mod.Module.constants === mod.constants,
    };
    console.log(JSON.stringify(out));
  `,
};

export default c;
