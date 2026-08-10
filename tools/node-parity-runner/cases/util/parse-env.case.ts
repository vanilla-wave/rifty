import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  code: `
    import util, { parseEnv } from 'node:util';

    const basic = parseEnv([
      '# comment',
      ' ZETA = first ',
      'ALPHA=one',
      ' ZETA = last ',
      'EMPTY=',
      'BAD-NAME=accepted',
    ].join('\\r\\n'));
    console.log('basic', JSON.stringify(basic));
    console.log('keys', JSON.stringify(Object.keys(basic)));

    const tick = String.fromCharCode(96);
    const quoted = parseEnv([
      "SINGLE='  one # =  '",
      'DOUBLE="line\\\\nfirst',
      'second # =" trailing',
      'BACKTICK=' + tick + 'back',
      'line # =' + tick,
      'export EXPORTED = yes # ignored',
      'PLAIN = value # ignored',
    ].join('\\n'));
    console.log('quoted', JSON.stringify(quoted));

    const malformed = parseEnv('NO_EQUALS\\n=\\nEMPTY=\\nUNFINISHED="value');
    console.log('malformed', JSON.stringify(malformed));

    const unicode = parseEnv('UNICODE=😀\\nLONE=\\ud800');
    console.log('unicode', JSON.stringify(unicode));

    const proto = parseEnv('__proto__=ignored\\nconstructor=own');
    console.log(
      'object',
      Object.getPrototypeOf(proto) === Object.prototype,
      Object.hasOwn(proto, '__proto__'),
      Object.hasOwn(proto, 'constructor'),
      proto.constructor,
    );

    const descriptor = Object.getOwnPropertyDescriptor(util, 'parseEnv');
    console.log(
      'surface',
      parseEnv === util.parseEnv,
      parseEnv.name,
      parseEnv.length,
      descriptor?.writable,
      descriptor?.enumerable,
      descriptor?.configurable,
    );

    const invalid = [];
    for (const input of [undefined, null, 123, new String('A=x')]) {
      try {
        parseEnv(input);
      } catch (error) {
        invalid.push(error.code);
      }
    }
    console.log('invalid', invalid.join(','));
  `,
  expected: [
    'basic {"ALPHA":"one","BAD-NAME":"accepted","EMPTY":"","ZETA":"last"}',
    'keys ["ALPHA","BAD-NAME","EMPTY","ZETA"]',
    'quoted {"BACKTICK":"back\\nline # =","DOUBLE":"line\\nfirst\\nsecond # =","EXPORTED":"yes","PLAIN":"value","SINGLE":"  one # =  "}',
    'malformed {"":"","EMPTY":"","UNFINISHED":"\\"value"}',
    'unicode {"LONE":"�","UNICODE":"😀"}',
    'object true false true own',
    'surface true parseEnv 1 true true true',
    'invalid ERR_INVALID_ARG_TYPE,ERR_INVALID_ARG_TYPE,ERR_INVALID_ARG_TYPE,ERR_INVALID_ARG_TYPE',
  ].join('\n'),
};

export default c;
