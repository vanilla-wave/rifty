import { parse as acornParse, tokenizer as acornTokenizer } from 'acorn';
import { setFatalHeader } from '../builtins/fatal-report.ts';

// biome-ignore lint/security/noGlobalEval: a never-completing parse yields V8's own compile message.
const indirectEval = eval;

/**
 * Node's compile failure of a CommonJS source: V8's own `SyntaxError` with
 * `compileFunction`'s message (no wrapper token: the body is parsed inside an
 * unterminated function, so an end-of-input error reads as Node's and nothing
 * can execute) and the report header Node's V8 message gives it. JS cannot
 * read V8's error position, so acorn locates it (compat process.md "Fatal
 * error stderr bytes" where they disagree). Null when V8 accepts `source`.
 */
export function cjsSyntaxError(source: string, filename: string): SyntaxError | null {
  let error: unknown;
  try {
    indirectEval(`(function(){(function(){${source}`);
  } catch (caught) {
    error = caught;
  }
  if (!(error instanceof SyntaxError) || error.message === 'Unexpected end of input') {
    try {
      // A complete body: V8 accepts it unless it fails to the very end.
      new Function(source);
      return null;
    } catch {
      // fall through with V8's end-of-input diagnostic
    }
  }
  if (!(error instanceof SyntaxError)) return null;
  const header = syntaxHeader(source, filename);
  if (header !== null) setFatalHeader(error, header);
  return error;
}

function syntaxHeader(source: string, filename: string): string | null {
  type AcornFailure = { readonly pos?: number; readonly loc?: { line: number; column: number } };
  let failure: AcornFailure | null = null as AcornFailure | null;
  try {
    acornParse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      allowHashBang: true,
      locations: true,
    });
  } catch (caught) {
    failure = caught as typeof failure;
  }
  const pos = failure?.pos;
  if (failure?.loc === undefined || pos === undefined) return null;
  const lines = source.split(/\r\n|[\n\r\u2028\u2029]/u);
  let { line, column } = failure.loc;
  let width = 0;
  if (source.slice(pos).trim() === '') {
    // End of input: V8 points past the last line terminator.
    line = lines.length;
    column = 0;
  } else {
    try {
      const token = acornTokenizer(source.slice(pos), { ecmaVersion: 'latest' }).getToken();
      width = Math.max(1, token.end - token.start);
    } catch {
      width = 1;
    }
  }
  const text = lines[line - 1] ?? '';
  let pad = '';
  for (let i = 0; i < column && i < text.length; i += 1) pad += text[i] === '\t' ? '\t' : ' ';
  return `${filename}:${line}\n${text}\n${pad}${'^'.repeat(width)}\n`;
}
