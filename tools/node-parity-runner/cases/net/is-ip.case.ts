import type { ParityCase } from '../../src/types.ts';

/**
 * `net.isIP` / `net.isIPv4` / `net.isIPv6` — pure classification, but on the
 * critical path of every dev-server request: vite 7's hostValidationMiddleware
 * calls `net.isIP(hostname)` BEFORE its unconditional localhost allow. A
 * missing export throws inside an async connect middleware → the rejection is
 * swallowed → the request hangs forever (observed as the preview-bridge 30s
 * timeout that forced `server.allowedHosts: true` in the vite wrapper).
 *
 * Edge rows pin real-Node semantics: leading zeros / whitespace / port suffix
 * reject IPv4; zone ids ARE valid IPv6 (`fe80::1%eth0` → 6); brackets are not
 * accepted; embedded IPv4 tails only after ≤6 groups; non-strings → 0/false.
 *
 * `kind: 'http'` only for builtin registration — `require('node:net')` lives
 * in `@riftydev/net`, which the runner's default modes never import.
 */
const c: ParityCase = {
  kind: 'http',
  code: `
    const net = require('node:net');
    const inputs = [
      '127.0.0.1', '0.0.0.0', '255.255.255.255',
      '256.0.0.1', '1.2.3', '1.2.3.4.5',
      '01.2.3.4', '127.0.0.001', ' 127.0.0.1', '127.0.0.1 ',
      '0x7f.0.0.1', '-1.2.3.4', '127.0.0.1:80',
      '::1', '::', '::ffff:127.0.0.1', '::ffff:127.0.0.256',
      '2001:db8::1', '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      '2001:db8::1::2', 'fe80::1%eth0', 'fe80::1%25eth0',
      '1:2:3:4:5:6:7:8', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7',
      'g::1', '[::1]', '::1.2.3.4', '1:2:3:4:5:6:1.2.3.4', '1:2:3:4:5:6:7:1.2.3.4',
      'localhost', 'sub.localhost', '',
    ];
    for (const s of inputs) console.log(JSON.stringify(s), net.isIP(s), net.isIPv4(s), net.isIPv6(s));
    console.log('undefined', net.isIP(undefined), net.isIPv4(undefined), net.isIPv6(undefined));
    console.log('null', net.isIP(null), net.isIPv4(null), net.isIPv6(null));
    console.log('number', net.isIP(123), net.isIPv4(123), net.isIPv6(123));
    console.log('object', net.isIP({}), net.isIPv4({}), net.isIPv6({}));
    console.log('types', typeof net.isIP, typeof net.isIPv4, typeof net.isIPv6);
  `,
};

export default c;
