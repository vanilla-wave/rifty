import type { ParityCase } from '../../src/types.ts';

// AsyncLocalStorage SYNCHRONOUS-scope behavior — byte-for-byte vs Node. Cross-
// `await` propagation is a documented partial-fidelity gap in rifty (no native
// async-context tracking in the browser/WASI realm), so this case stays fully
// synchronous, exercising exactly what opencode's LocalContext relies on:
// run/getStore/nested-restore/return+args/enterWith/exit/disable.
const c: ParityCase = {
  code: `
    const { AsyncLocalStorage } = require('node:async_hooks');
    const als = new AsyncLocalStorage();
    console.log('outside:', als.getStore());
    const ret = als.run({ id: 1 }, (a, b) => {
      console.log('inside-id:', als.getStore().id, 'args:', a, b);
      const inner = als.run({ id: 2 }, () => als.getStore().id);
      console.log('nested-inner:', inner);
      console.log('after-nested:', als.getStore().id);
      return a + b;
    }, 2, 3);
    console.log('run-return:', ret);
    console.log('after-run:', als.getStore());
    als.enterWith({ id: 9 });
    console.log('enterWith:', als.getStore().id);
    const exited = als.exit(() => als.getStore());
    console.log('exit-store:', exited);
    console.log('after-exit:', als.getStore().id);
    als.disable();
    console.log('after-disable:', als.getStore());
  `,
};

export default c;
