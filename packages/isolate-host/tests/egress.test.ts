/**
 * I5 no network (goal isolate-host-run-code, scenario step 4): every egress
 * surface throws NotImplementedError — never `undefined`/`MODULE_NOT_FOUND`.
 */
import { describe, expect, it } from 'vitest';
import { runCode } from '../src/index.ts';

const PROBES: Readonly<Record<string, string>> = {
  fetch: "await fetch('http://example.com/')",
  'http.request': "require('node:http').request('http://example.com/').end()",
  'https.get': "require('https').get('https://example.com/')",
  'net.connect': "require('net').connect(80, 'example.com')",
  tls: "require('tls').connect(443, 'example.com')",
  dgram: "require('dgram').createSocket('udp4')",
  http2: "require('http2').connect('https://example.com')",
  WebSocket: "new WebSocket('ws://example.com/')",
};

describe('guest egress is a loud gap (I5)', () => {
  for (const [label, expression] of Object.entries(PROBES)) {
    it(label, async () => {
      const result = await runCode(
        `(async () => { try { ${expression}; console.log('REACHED') } catch (e) { console.log(e.name, e instanceof Error) } })()`,
      );
      expect(result).toEqual({ stdout: 'NotImplementedError true\n', stderr: '', exitCode: 0 });
    });
  }
});
