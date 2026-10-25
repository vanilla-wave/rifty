import type { ParityCase } from '../../src/types.ts';

// vm scripts evaluated while a stack is being formatted (unit
// runtime-js/vm-run-in-this-context-offsets): inside a guest
// `Error.prepareStackTrace` hook and inside an error `message` getter read by
// the default formatter. V8 skips a nested JS stack hook there; the script
// must still get the name Node gives it — its own `sourceURL`, else the vm
// filename with the offsets. Rows run first in the realm: a guest hook before
// and after an offset script owns the slot, then the owner's default.
const c: ParityCase = {
  code: String.raw`
    const vm = require('node:vm');
    const frameOf = (stack, name) =>
      String(stack)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('at ' + name + ' '))
        .join(' | ');
    const own = (name, url) => '(function ' + name + '() {\n  return new Error("s") })\n//# sourceURL=' + url;
    const plain = (name) => 'var s = "sourceURL";\n(function ' + name + '() {\n  return new Error("s") })';
    const evaluate = (tag) => [
      ['own0', 'z' + tag, vm.runInThisContext(own('z' + tag, '/virtual/own0' + tag + '.js'), { filename: '/virtual/file0' + tag + '.js' })],
      ['plain0', 'q' + tag, vm.runInThisContext(plain('q' + tag), { filename: '/virtual/plain0' + tag + '.js' })],
      ['anonymous0', 'a' + tag, vm.runInThisContext(own('a' + tag, '<anonymous>'), { filename: '/virtual/anon0' + tag + '.js' })],
      ['own', 'f' + tag, vm.runInThisContext(own('f' + tag, '/virtual/own' + tag + '.js'), { filename: '/virtual/file' + tag + '.js', lineOffset: 3, columnOffset: 2 })],
      ['plain', 'p' + tag, vm.runInThisContext(plain('p' + tag), { filename: '/virtual/plain' + tag + '.js', lineOffset: 3, columnOffset: 2 })],
      ['Script', 's' + tag, new vm.Script(own('s' + tag, '/virtual/ownS' + tag + '.js'), { filename: '/virtual/fileS' + tag + '.js', lineOffset: 5, columnOffset: -3 }).runInThisContext()],
    ];
    const report = (row, made) => {
      if (!made) return console.log(row, 'never evaluated');
      for (const [label, name, make] of made) console.log(row, label, frameOf(make().stack, name));
    };
    const inMessageGetter = (tag) => {
      let made;
      const error = new Error();
      Object.defineProperty(error, 'message', {
        configurable: true,
        get() {
          made ??= evaluate(tag);
          return 'm';
        },
      });
      void error.stack;
      return made;
    };
    const inGuestHook = (tag) => {
      let made;
      const saved = Error.prepareStackTrace;
      Error.prepareStackTrace = (error, sites) => {
        made ??= evaluate(tag);
        return 'hooked';
      };
      try {
        void new Error('x').stack;
      } finally {
        Error.prepareStackTrace = saved;
      }
      return made;
    };

    // A guest hook V8 calls directly (no offset script ran yet).
    report('in guest hook', inGuestHook('1'));
    // Offset scripts ran: the guest hook is reached through the offset owner.
    report('in owned guest hook', inGuestHook('2'));
    // No guest hook: the offset owner's default formatter reads the getter.
    report('in owned default', inMessageGetter('3'));
  `,
};

export default c;
