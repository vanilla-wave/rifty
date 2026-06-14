import type { ParityCase } from '../../src/types.ts';

// T7 review — host→guest membrane cross-realm ISOLATION (Node oracle).
// The membrane must NEVER hand a host reference back to guest code that the guest
// did not legitimately receive. Two regressions guarded:
//   1) FORGERY: guest fabricating a host-origin marker (any predictable id) must
//      NOT exfiltrate a real host object. Node: `forged === secret` is false.
//   2) OBSERVABILITY: the membrane's identity tracking must not appear as a
//      guest-visible own symbol. Node: `Object.getOwnPropertySymbols(secret)` is
//      empty (length 0).
//   3) Legit round-trip identity still works: a host object marshalled IN then
//      returned OUT is the SAME host reference. Node: true.
const c: ParityCase = {
  code: `
    globalThis.__RIFTY_VM_ENGINE = 'quickjs';
    const vm = require('node:vm');
    const secret = { token: 'sekret' };
    const ctx = vm.createContext({ secret });
    // Forge the marker for every plausible host-origin id (0..7). With the old
    // sequential ids \`secret\` was id 0, so a forged id-0 marker exfiltrated it.
    let leaked = false;
    for (let i = 0; i < 8; i++) {
      const forged = vm.runInContext(
        '(() => { const f = {}; f[Symbol.for("rifty.vm.hostOrigin")] = ' + i + '; return f; })()',
        ctx,
      );
      if (forged === secret) leaked = true;
    }
    console.log(leaked);
    console.log(vm.runInContext('Object.getOwnPropertySymbols(secret).length', ctx));
    console.log(vm.runInContext('secret', ctx) === secret);
  `,
  expected: 'false\n0\ntrue\n',
};

export default c;
