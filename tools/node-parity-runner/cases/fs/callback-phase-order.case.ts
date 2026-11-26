import type { ParityCase } from '../../src/types.ts';

/**
 * Loop-phase order around fs completions, as Node's poll → check → timers: inside an fs
 * callback an immediate runs before a 0 ms timer even once the timer is due (Node's
 * documented guarantee), and a completion comes after both; a call made in an fs callback beside
 * a timer and an immediate completes after both (`I,T,cb`); a cleared immediate leaves no turn
 * that an immediate queued later could take. Node v24.16.0: 240/240 under load (8 parallel);
 * `I,T,cb` 300/300 alone and under load (16 parallel + 8 CPU burners).
 * Node races, printed as «an order Node gives» (300 processes, alone / under load): the main
 * module's `stat` then immediate `cb,I` 289 / 284, else `I,cb` (rifty in-process `I,cb`); from an
 * immediate `T,cb,I` 298 / 300, else `T,I,cb` (rifty `T,I,cb`). Not here: from a timer Node gives
 * `cb,I,T` 296 / 300, else `I,T,cb`; rifty in-process also `I,cb,T` (26/30 in this case under
 * load), an order Node never gave. The browser hosts have no such phases and the isolate guest
 * races its host's loop: declared there, with every host's outcome
 * (`runtime-js/loop-phase-of-current-turn`).
 */
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    const { setTimeout, setImmediate, clearImmediate } = require('node:timers');
    fs.writeFileSync('a.txt', 'abc');
    // Node races (the pool read is done or not by the next poll; header): an order Node gives.
    const nodeGives = (name, seen, orders) => console.log(name + ' => an order Node gives: ' + orders.includes(seen.join(',')));
    const top = [];
    fs.stat('a.txt', () => top.push('cb'));
    setImmediate(() => top.push('I'));
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
      await new Promise((r) => setTimeout(r, 1));
      nodeGives('main module: stat, immediate', top, ['cb,I', 'I,cb']);
      // From other turns: a 0 ms timer, an fs call and an immediate queued, 3 ms busy (both due).
      const outside = (arm) => (seen) => arm(() => {
        setTimeout(() => seen.push('T'), 0);
        fs.stat('a.txt', () => seen.push('cb'));
        setImmediate(() => seen.push('I'));
        busy(3);
      });
      await row('in an fs callback: timer, stat, immediate, 3 ms busy', outside((f) => fs.stat('a.txt', f)));
      const fromImmediate = [];
      await new Promise((done) => { outside((f) => setImmediate(f))(fromImmediate); setTimeout(done, 40); });
      nodeGives('in an immediate: timer, stat, immediate, 3 ms busy', fromImmediate, ['T,cb,I', 'T,I,cb']);
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
