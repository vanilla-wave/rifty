import type { ParityCase } from '../../src/types.ts';

// `http` mode registers @riftydev/net's builtins for guest `node:net`.
const c: ParityCase = {
  kind: 'http',
  code: `
    const net = require('node:net');
    const { Buffer } = require('node:buffer');
    const methods = ['isIP', 'isIPv4', 'isIPv6'];

    function observe(run) {
      try {
        return { value: run() };
      } catch (error) {
        return {
          error: {
            name: error instanceof Error ? error.name : typeof error,
            code: error && typeof error === 'object' ? (error.code ?? null) : null,
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }

    function printRow(label, makeInput) {
      const row = {};
      for (const method of methods) {
        const fn = net[method];
        row[method] = typeof fn === 'function'
          ? observe(() => fn(makeInput()))
          : { missing: true };
      }
      console.log(label, JSON.stringify(row));
    }

    const inputs = [
      '127.0.0.1', '0.0.0.0', '255.255.255.255',
      '256.0.0.1', '1.2.3', '1.2.3.4.5',
      '01.2.3.4', '127.0.0.001', ' 127.0.0.1', '127.0.0.1 ',
      '0x7f.0.0.1', '-1.2.3.4', '127.0.0.1:80', '127.0.0.1/8',
      '::1', '::', '::ffff:127.0.0.1', '::ffff:127.0.0.256',
      '2001:db8::1', '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      '2001:db8::1::2', 'fe80::1%eth0', 'fe80::1%25eth0', 'fe80::1%',
      'fe80::1%eth_0', 'fe80::1%eth/0',
      '1:2:3:4:5:6:7:8', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7',
      'g::1', '[::1]', '::1.2.3.4', '1:2:3:4:5:6:1.2.3.4', '1:2:3:4:5:6:7:1.2.3.4',
      '::ffff:127.0.0.01', '2001:db8::1/64', 'localhost', 'sub.localhost', '',
    ];
    for (const input of inputs) {
      printRow(JSON.stringify(input), () => input);
    }
    printRow('undefined', () => undefined);
    printRow('null', () => null);
    printRow('number', () => 123);
    printRow('plain-object', () => ({}));
    printRow('buffer-v4', () => Buffer.from('127.0.0.1'));
    printRow('boxed-v4', () => new String('127.0.0.1'));
    printRow('array-v6', () => ['::1']);
    printRow('custom-v6', () => ({ toString: () => '::1' }));
    printRow('symbol', () => Symbol('ip'));
    printRow('throwing-coercion', () => ({
      toString() {
        const error = new Error('coercion failed');
        error.code = 'EBOOM';
        throw error;
      },
    }));

    let coercions = 0;
    const staged = {
      toString() {
        coercions += 1;
        return coercions === 1 ? 'not-an-ip' : '::1';
      },
    };
    const stagedResult = typeof net.isIP === 'function'
      ? observe(() => net.isIP(staged))
      : { missing: true };
    console.log('staged-isIP', JSON.stringify({ result: stagedResult, coercions }));
    console.log('surface', JSON.stringify({
      alias: require('net') === net,
      types: Object.fromEntries(methods.map((method) => [method, typeof net[method]])),
    }));
  `,
};

export default c;
