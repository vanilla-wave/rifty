import type { ParityCase } from '../../src/types.ts';

// node:timers/promises — resolved values are deterministic across Node and rifty
// (timing stays well within the runner's post-import drain). Abort-error SHAPE is
// realm-specific so it is covered in the conformance test, not here; this case
// pins the happy-path value semantics opencode's `setTimeout as sleep` relies on.
const c: ParityCase = {
  code: `
    const { setTimeout, setImmediate, setInterval } = require('node:timers/promises');
    (async () => {
      console.log('timeout:', await setTimeout(1, 'A'));
      console.log('immediate:', await setImmediate('B'));
      const out = [];
      for await (const v of setInterval(1, 'tick')) {
        out.push(v);
        if (out.length === 3) break;
      }
      console.log('interval:', JSON.stringify(out));
    })();
  `,
};

export default c;
