/**
 * Node-own `process` members are own enumerable properties, so their ESM named
 * imports link (tinyexec/rolldown `import { cwd } from 'node:process'`) and
 * work unbound. Never prints cwd paths or the exitCode value.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  code: `
    import process, { cwd, chdir, hrtime, uptime, exit, kill, nextTick } from 'node:process';
    import * as ns from 'node:process';
    const names = ['cwd', 'chdir', 'hrtime', 'uptime', 'exit', 'kill', 'nextTick'];
    const d = (k) => Object.getOwnPropertyDescriptor(process, k);
    const before = cwd();
    console.log(JSON.stringify({
      types: [cwd, chdir, hrtime, uptime, exit, kill, nextTick].map((f) => typeof f),
      own: names.map((k) => (d(k) ? [d(k).writable, d(k).enumerable, d(k).configurable] : null)),
      exitCode: (({ get, set, enumerable, configurable }) =>
        [typeof get, typeof set, enumerable, configurable])(d('exitCode') ?? {}),
      keys: [...names, 'exitCode'].map((k) => Object.keys(process).includes(k)),
      nsHas: [...names, 'exitCode'].map((k) => k in ns),
      identity: names.map((k) => ns[k] === process[k]),
      unbound: [
        typeof cwd(),
        cwd() === process.cwd(),
        hrtime().length,
        typeof hrtime.bigint(),
        Object.hasOwn(hrtime, 'bigint'),
        typeof uptime(),
        chdir(before),
        cwd() === before,
      ],
    }));
  `,
};

export default c;
