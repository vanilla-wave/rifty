import type { ParityCase } from '../../src/types.ts';

/**
 * `node:http.STATUS_CODES` parity — the status-code → reason-phrase map.
 *
 * Real packages read `http.STATUS_CODES[code]` to format messages (e.g.
 * opencode's provider error path). rifty exposes a faithful copy
 * (`packages/net/src/http/status-codes.ts`). This diffs a spread of entries —
 * one per status class plus an `undefined`-on-unknown-code check — head-to-head
 * against real Node, catching a partial/empty/wrong map. Specific spec-stable
 * codes (not the full count) so a future Node adding a code does not falsely
 * fail. Uses the runner's opt-in `kind: 'http'` net-registration mode so
 * `require('node:http')` resolves to rifty's `@rifty/net` builtin.
 */
const c: ParityCase = {
  kind: 'http',
  expected: [
    '100:Continue',
    '204:No Content',
    '301:Moved Permanently',
    '404:Not Found',
    "418:I'm a Teapot",
    '429:Too Many Requests',
    '500:Internal Server Error',
    '503:Service Unavailable',
    'unknown-299:undefined',
  ].join('\n'),
  code: `
    const http = require('node:http');
    const codes = [100, 204, 301, 404, 418, 429, 500, 503];
    for (const code of codes) {
      console.log(code + ':' + http.STATUS_CODES[code]);
    }
    console.log('unknown-299:' + http.STATUS_CODES[299]);
  `,
};

export default c;
