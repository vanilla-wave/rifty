import type { ParityCase } from '../../src/types.ts';

/**
 * Loop-phase order around fs completions, as Node's poll → check → timers: inside an fs
 * callback an immediate runs before a 0 ms timer even once the timer is due (Node's
 * documented guarantee), and a completion comes after both; a cleared immediate leaves
 * no turn that an immediate queued later could take. Node v24.16.0: 240/240 under load
 * (8 parallel). The browser hosts have no such phases and the isolate guest races its host's
 * loop: declared there (`runtime-js/fs-completion-loop-phase-order`).
 */
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    const { setTimeout, setImmediate, clearImmediate } = require('node:timers');
    fs.writeFileSync('a.txt', 'abc');
    const fd = fs.openSync('a.txt', 'r');
    const busy = (ms) => { const until = Date.now() + ms; while (Date.now() < until); };
    const inside = [
      ['readFile', (cb) => fs.readFile('a.txt', cb)],
      ['stat', (cb) => fs.stat('a.txt', cb)],
      ['read', (cb) => fs.read(fd, Buffer.alloc(3), 0, 3, 0, cb)],
      ['promises.readFile', (cb) => fs.promises.readFile('a.txt').then(() => cb())],
    ];
    const row = (name, body) => new Promise((done) => {
      const seen = [];
      body(seen);
      setTimeout(() => { console.log(name + ' => ' + seen.join(',')); done(); }, 40);
    });
    (async () => {
      for (const [name, op] of inside) {
        await row('in a ' + name + ' callback: timer, immediate, 3 ms busy', (seen) => op(() => {
          setTimeout(() => seen.push('timeout'), 0);
          setImmediate(() => seen.push('immediate'));
          busy(3);
        }));
        await row('in a ' + name + ' callback: the next stat beside immediates and timers', (seen) => op(() => {
          setImmediate(() => seen.push('immediate<'));
          setTimeout(() => seen.push('timeout<'), 0);
          fs.stat('a.txt', () => seen.push('cb'));
          setImmediate(() => seen.push('immediate>'));
          setTimeout(() => seen.push('timeout>'), 0);
          busy(3);
        }));
      }
      await row('a cleared immediate, then one queuing a timer and a nested immediate', (seen) => {
        clearImmediate(setImmediate(() => seen.push('cleared')));
        setImmediate(() => {
          seen.push('first');
          setTimeout(() => seen.push('timer'), 0);
          busy(10);
          setImmediate(() => seen.push('nested'));
        });
      });
      fs.closeSync(fd);
    })();
  `,
};

export default c;
