import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  code: `
    import p, { cwd, chdir, hrtime, uptime, exit, kill } from 'node:process';
    import * as ns from 'node:process';
    for (const [name, value] of Object.entries({ cwd, chdir, hrtime, uptime, exit, kill })) {
      console.log(name, typeof value, value === p[name], Object.hasOwn(p, name));
    }
    console.log('cwd', cwd() === p.cwd());
    console.log('hrtime', Array.isArray(hrtime()), typeof hrtime.bigint());
    console.log('uptime', typeof uptime());
    console.log('inherited', 'on' in ns, 'constructor' in ns, 'toString' in ns);
  `,
};

export default c;
