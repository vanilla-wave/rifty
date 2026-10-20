import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

const implementation = new URL('./timers.ts', import.meta.url).href;

it('native scheduler port references only pending immediates', () => {
  // Observe the real external MessagePort; the scheduler and queue stay real.
  const source = `const Channel=MessageChannel;let port;
globalThis.MessageChannel=class extends Channel {constructor(){super();port=this.port1;}};
const timers=await import(${JSON.stringify(implementation)});
const states=[port.hasRef()];
const cancelled=timers.setImmediate(()=>{});states.push(port.hasRef());
timers.clearImmediate(cancelled);states.push(port.hasRef());
timers.setImmediate(()=>{states.push(port.hasRef());console.log(JSON.stringify(states));});`;
  const result = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', source],
    { encoding: 'utf8', timeout: 10_000 },
  );
  expect(JSON.parse(result)).toEqual([false, true, false, false]);
}, 30_000);
const programs = [
  ['idle', 'console.log("idle");'],
  ['pending', 'timers.setImmediate(()=>console.log("pending"));'],
  [
    'cancelled',
    'const handle=timers.setImmediate(()=>console.log("unexpected"));timers.clearImmediate(handle);console.log("cancelled");',
  ],
] as const;

// observable-order: importing the scheduler must not leave an idle native
// MessagePort holding its host; actual pending immediates must still run.
it.each(programs)(
  'host immediate lifetime matches Node: %s',
  (_name, program) => {
    const run = (module: string): string =>
      execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '--eval',
          `import * as timers from ${JSON.stringify(module)};${program}`,
        ],
        { encoding: 'utf8', timeout: 10_000 },
      );
    const expected = run('node:timers');
    expect(run(implementation)).toBe(expected);
  },
  30_000,
);
