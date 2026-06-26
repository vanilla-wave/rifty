import type { ParityCase } from '../../src/types.ts';

/**
 * Standard TS decorators must lower before rifty's post-strip AST pass. The
 * Node reference is `tsx`, which lowers this sample and prints the method name
 * from the standard decorator context.
 */
const c: ParityCase = {
  kind: 'ts-esm',
  code:
    'function logged(value: (this: unknown) => number, context: ClassMethodDecoratorContext) {\n' +
    '  return function(this: unknown) {\n' +
    "    console.log('decorated:' + String(context.name));\n" +
    '    return value.call(this);\n' +
    '  };\n' +
    '}\n' +
    'class C {\n' +
    '  @logged\n' +
    '  m() { return 4; }\n' +
    '}\n' +
    'console.log(new C().m());\n',
  expected: 'decorated:m\n4',
};

export default c;
