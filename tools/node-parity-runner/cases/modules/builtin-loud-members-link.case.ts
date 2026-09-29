/**
 * `fs.statfsSync`, `child_process.spawnSync` and `process.memoryUsage` are
 * Node-own members, so their named imports link (vitest 4.1.11 `cli-api`,
 * tinyexec 1.3.1) and vitest's worker init `process.memoryUsage.bind(process)`
 * works. Shape only: Node returns host values the browser realm cannot supply;
 * rifty's call-time `NotImplementedError` is a rifty ceiling contract
 * (`packages/runtime-js/src/builtins/loud-members.test.ts`), not parity.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  code: `
    import fs, { statfsSync } from 'node:fs';
    import childProcess, { spawnSync } from 'node:child_process';
    import process, { memoryUsage } from 'node:process';
    import * as fsNs from 'node:fs';
    import * as cpNs from 'node:child_process';
    import * as processNs from 'node:process';
    const shape = (o, k) => {
      const d = Object.getOwnPropertyDescriptor(o, k);
      return d
        ? [typeof d.value, d.writable, d.enumerable, d.configurable, Object.keys(o).includes(k)]
        : null;
    };
    const bound = process.memoryUsage.bind(process);
    console.log(JSON.stringify({
      statfsSync: [typeof statfsSync, shape(fs, 'statfsSync'), statfsSync === fs.statfsSync, fsNs.statfsSync === fs.statfsSync],
      spawnSync: [typeof spawnSync, shape(childProcess, 'spawnSync'), spawnSync === childProcess.spawnSync, cpNs.spawnSync === childProcess.spawnSync],
      memoryUsage: [typeof memoryUsage, shape(process, 'memoryUsage'), memoryUsage === process.memoryUsage, processNs.memoryUsage === process.memoryUsage],
      rss: shape(process.memoryUsage, 'rss'),
      bound: typeof bound,
    }));
  `,
};

export default c;
