import type { ParityCase } from '../../src/types.ts';

/**
 * `http.METHODS` + `http.maxHeaderSize` static surface (backlog
 * `net/http-server-introspection`). Like `STATUS_CODES`, this diffs STABLE
 * membership + sortedness rather than the exact list/length, so a future Node
 * adding a verb does not falsely fail. `maxHeaderSize` is the 16384 default
 * (advisory in rifty — never enforced; see the compat matrix). Uses the http
 * registration mode purely so `require('node:http')` resolves; no server bound.
 */
const c: ParityCase = {
  kind: 'http',
  expected: [
    'isArray:true',
    'hasGET:true',
    'hasPOST:true',
    'hasDELETE:true',
    'sorted:true',
    'maxHeaderSize:16384',
  ].join('\n'),
  code: `
    const http = require('node:http');
    console.log('isArray:' + Array.isArray(http.METHODS));
    console.log('hasGET:' + http.METHODS.includes('GET'));
    console.log('hasPOST:' + http.METHODS.includes('POST'));
    console.log('hasDELETE:' + http.METHODS.includes('DELETE'));
    console.log('sorted:' + (JSON.stringify(http.METHODS) === JSON.stringify([...http.METHODS].sort())));
    console.log('maxHeaderSize:' + http.maxHeaderSize);
  `,
};

export default c;
