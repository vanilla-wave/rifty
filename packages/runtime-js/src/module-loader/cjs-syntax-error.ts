import { parse as acornParse, tokenizer as acornTokenizer } from 'acorn';
import { setFatalHeader } from '../builtins/fatal-report.ts';

const NODE_PARAMS = ['exports', 'require', 'module', '__filename', '__dirname'];

/**
 * Node's compile failure of a CommonJS source: a `SyntaxError` with
 * `compileFunction`'s message — V8's own from `new Function` over the source
 * alone, nothing executes; at the end of input `new Function`'s closing
 * token reads instead of Node's `Unexpected end of input`, so acorn's
 * end-of-input failure picks that message. The header only where acorn's
 * failing token is the one V8 names (or the end of input); JS cannot read
 * V8's position otherwise (compat process.md). Null when V8 accepts `source`.
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
  const failure = acornFailure(source);
  // `new Function` closes the body with `\n})`: V8 meets that closer where
  // Node's compileFunction meets the end of input.
  const atEnd =
    failure?.pos !== undefined &&
    source.slice(failure.pos).trim() === '' &&
    /^Unexpected token '[})]'$/u.test(message);
  if (atEnd) message = 'Unexpected end of input';
  // An unmatched `}` ends `new Function`'s own body early, so V8 names a
  // later token; Node's compileFunction names that `}`.
  else if (failure?.pos !== undefined && source[failure.pos] === '}')
    message = "Unexpected token '}'";
  const error = new SyntaxError(message);
  const header = failure === null ? null : syntaxHeader(source, filename, failure, message, atEnd);
  if (header !== null) setFatalHeader(error, header);
  return error;
}

type AcornFailure = { readonly pos?: number; readonly loc?: { line: number; column: number } };

function acornFailure(source: string): AcornFailure | null {
  try {
    acornParse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      allowHashBang: true,
      locations: true,
    });
    return null;
  } catch (caught) {
    return caught as AcornFailure;
  }
}

function syntaxHeader(
  source: string,
  filename: string,
  failure: AcornFailure,
  message: string,
  atEnd: boolean,
): string | null {
  const pos = failure.pos;
  if (failure.loc === undefined || pos === undefined) return null;
  const lines = source.split(/\r\n|[\n\r\u2028\u2029]/u);
  let { line, column } = failure.loc;
  let width = 0;
  if (atEnd) {
    // End of input: V8 points past the last line terminator.
    line = lines.length;
    column = 0;
  } else {
    // Only a message naming the token acorn stopped at locates it as V8 does.
    const named = /^Unexpected (?:token|identifier) '(.+)'$/u.exec(message)?.[1];
    let token: string | null = null;
    try {
      const t = acornTokenizer(source.slice(pos), { ecmaVersion: 'latest' }).getToken();
      token = source.slice(pos + t.start, pos + t.end);
      width = Math.max(1, t.end - t.start);
    } catch {
      token = null;
    }
    if (named === undefined || token !== named) return null;
  }
  const text = lines[line - 1] ?? '';
  let pad = '';
  for (let i = 0; i < column && i < text.length; i += 1) pad += text[i] === '\t' ? '\t' : ' ';
  return `${filename}:${line}\n${text}\n${pad}${'^'.repeat(width)}\n`;
}
