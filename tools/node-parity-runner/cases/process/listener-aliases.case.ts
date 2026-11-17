import type { ParityCase } from '../../src/types.ts';

/**
 * `process` and its stdio are EventEmitters: `on === addListener` and
 * `off === removeListener` on each, as in Node; `process` keeps the inherited
 * EventEmitter methods (Node hooks its IPC hold through meta-listeners).
 * rifty's stdin overrides `addListener` to start flowing, so the alias must
 * carry the override — `addListener('data')` starts stdin like `on`.
 */
const c: ParityCase = {
  stdin: [new TextEncoder().encode('hi')],
  expected:
    '{"process":[true,true],"inherited":[true,true],"stdin":[true,true],"stdout":[true,true],"stderr":[true,true]}\ntext:hi\n',
  code: `
    const process = require('node:process');
    const EventEmitter = require('node:events');
    const pairs = (o) => [o.on === o.addListener, o.off === o.removeListener];
    console.log(JSON.stringify({
      process: pairs(process),
      inherited: [process.on === EventEmitter.prototype.on, process.off === EventEmitter.prototype.off],
      stdin: pairs(process.stdin),
      stdout: pairs(process.stdout),
      stderr: pairs(process.stderr),
    }));
    let out = '';
    process.stdin.addListener('data', (chunk) => { out += chunk; });
    process.stdin.on('end', () => { console.log('text:' + out); });
  `,
};

export default c;
