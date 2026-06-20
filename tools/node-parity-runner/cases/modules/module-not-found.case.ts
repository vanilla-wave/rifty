import type { ParityCase } from '../../src/types.ts';

/**
 * `MODULE_NOT_FOUND` error-object parity (backlog/runtime-js/node-entry-miss-node-shape).
 *
 * A missing `require('./nope.js')` must throw the SAME observable error real Node
 * throws: `err.code === 'MODULE_NOT_FOUND'`, an `err.requireStack` array listing
 * the requiring module, and a message `Cannot find module '<spec>'` followed by a
 * `Require stack:` block. rifty's resolver used to emit the terser, non-Node
 * `Cannot find module '<spec>' (imported from '<importer>')` with no `requireStack`.
 *
 * Absolute paths differ between the two runtimes (Node runs in a temp dir, rifty
 * mounts `/work`), so the case prints path-agnostic basenames + the message head
 * rather than the raw paths — the shape, not the root, is what parity checks.
 */
const c: ParityCase = {
  code: [
    'try {',
    "  require('./nope.js');",
    "  console.log('NO THROW');",
    '} catch (err) {',
    '  const e = err;',
    "  console.log('code:', e.code);",
    "  console.log('requireStack isArray:', Array.isArray(e.requireStack));",
    "  console.log('requireStack basenames:', JSON.stringify((e.requireStack || []).map((p) => String(p).split('/').pop())));",
    "  console.log('message head:', String(e.message).split('\\n')[0]);",
    "  console.log('has Require stack block:', String(e.message).includes('Require stack:'));",
    '}',
  ].join('\n'),
};

export default c;
