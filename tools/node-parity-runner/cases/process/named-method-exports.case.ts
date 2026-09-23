import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  code: `
    import process, { cwd, chdir, hrtime, uptime, exit, kill } from 'node:process';
    import * as namespace from 'node:process';
    const names = ['cwd', 'chdir', 'hrtime', 'uptime', 'exit', 'kill'];
    console.log(JSON.stringify({
      own: names.map((name) => Object.hasOwn(process, name)),
      enumerable: names.map((name) => Object.getOwnPropertyDescriptor(process, name)?.enumerable),
      namedIdentity: names.map((name) => namespace[name] === process[name]),
      importedIdentity: [cwd === process.cwd, chdir === process.chdir,
        hrtime === process.hrtime, uptime === process.uptime,
        exit === process.exit, kill === process.kill],
      callableCwd: cwd() === process.cwd(),
      bigint: typeof hrtime.bigint,
      absent: ['pushStdin', 'on', 'emit'].map((name) => name in namespace),
    }));
  `,
};

export default c;
