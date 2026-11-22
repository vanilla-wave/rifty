import { parse as acornParse } from 'acorn';

const NODE_PARAMS = ['exports', 'require', 'module', '__filename', '__dirname'];
const compileErrors = new WeakSet<object>();

/**
 * Node's compile failure of a CommonJS source: a `SyntaxError` with V8's own
 * message from `new Function` over the source alone (nothing executes). No
 * Node header — JS cannot read V8's position; the stack's second line names
 * the file and rifty's parser position instead (compat process.md "Fatal
 * error stderr bytes"). Null when V8 accepts `source`.
 */
export function cjsSyntaxError(source: string, filename: string): SyntaxError | null {
  let message: string;
  try {
    new Function(...NODE_PARAMS, source);
    return null;
  } catch (caught) {
    if (!(caught instanceof SyntaxError)) return null;
    message = caught.message;
  }
  const error = new SyntaxError(message);
  const at = parserPosition(source);
  const place = at === null ? filename : `${filename}:${at.line}:${at.column + 1}`;
  const stack = error.stack ?? `SyntaxError: ${message}`;
  const newline = stack.indexOf('\n');
  const head = newline === -1 ? stack : stack.slice(0, newline);
  error.stack = `${head}\n    (rifty parser position: ${place})${newline === -1 ? '' : stack.slice(newline)}`;
  compileErrors.add(error);
  return error;
}

/** Whether `error` is a CJS file's compile failure (`cjsSyntaxError`). */
export function isCjsSyntaxError(error: object): boolean {
  return compileErrors.has(error);
}

function parserPosition(source: string): { line: number; column: number } | null {
  try {
    acornParse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      locations: true,
    });
    return null;
  } catch (caught) {
    return (caught as { loc?: { line: number; column: number } }).loc ?? null;
  }
}
