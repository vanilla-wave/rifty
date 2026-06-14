import type { ParityCase } from '../../src/types.ts';

// T9 — bidirectional callable membrane.
//   - A HOST fn seeded into the guest is callable from guest code; the guest arg
//     marshals OUT to host (typeof 'object', `instanceof hostArray` FALSE, #16),
//     the host result marshals back IN (so `rr.ok` works in guest) and OUT again
//     as the completion (`r === true`).
//   - A variadic host fn (`log(...a)`) is callable from guest.
//   - A GUEST callback passed to a host fn is HELD by the host and called AFTER
//     the synchronous run (`stored()` → 123) — the guest fn handle survives the
//     run on the still-alive context.
const c: ParityCase = {
  code: `
    globalThis.__RIFTY_VM_ENGINE = 'quickjs';
    const vm = require('node:vm');
    let seenType, seenIsArr;
    const ctx = vm.createContext({
      host: (x) => { seenType = typeof x; seenIsArr = (x instanceof Array); return { ok: true }; },
      log: (...a) => console.log('guest:', ...a),
    });
    const r = vm.runInContext('var rr = host([9]); log(rr.ok); rr.ok', ctx);
    console.log(seenType, seenIsArr, r);
    let stored;
    const ctx2 = vm.createContext({ keep: (cb) => { stored = cb; } });
    vm.runInContext('keep(() => 123)', ctx2);
    console.log(stored());
  `,
  expected: 'guest: true\nobject false true\n123\n',
};

export default c;
