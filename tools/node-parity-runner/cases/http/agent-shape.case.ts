/**
 * `http.Agent` is a Node-own class that playwright-core extends at load
 * (`utilsBundle.js` `class … extends http.Agent`; vitest browser mode). Shape
 * only: constructing one is a rifty ceiling (no socket pool —
 * `packages/net/src/http/agent.test.ts`), not parity.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'http',
  code: `
    const http = require('node:http');
    const d = Object.getOwnPropertyDescriptor(http, 'Agent');
    class Sub extends http.Agent {}
    console.log(JSON.stringify({
      descriptor: [typeof d.value, d.writable, d.enumerable, d.configurable, Object.keys(http).includes('Agent')],
      name: http.Agent.name,
      length: http.Agent.length,
      subclass: Object.getPrototypeOf(Sub) === http.Agent,
    }));
  `,
};

export default c;
