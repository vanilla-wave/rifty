/**
 * REPL evaluation. We use `Function` to evaluate the user's source in a fresh
 * lexical scope; expressions are wrapped so we can return their value.
 *
 * This is intentionally not the same path as the module loader — the REPL is
 * "free-form code", not a module. M1 uses this directly; M3+ event loop work
 * will refine the host-call semantics.
 */
export async function evalInRepl(code: string): Promise<unknown> {
  const trimmed = code.trim();
  if (trimmed === '') return undefined;

  // Detect statement-shaped input (let/const/var/function/class declarations,
  // ifs, loops) and execute as a statement-list rather than as an expression.
  if (looksLikeStatement(trimmed)) {
    const fn = new Function(`return (async () => { ${code}\n})()`);
    return await fn();
  }

  try {
    const fn = new Function(`return (async () => (${code}\n))()`);
    return await fn();
  } catch (err) {
    // Expression parse failed — fall back to statement form so things like
    // `let x = 1` still work without a leading semicolon hack.
    if (err instanceof SyntaxError) {
      const fn = new Function(`return (async () => { ${code}\n})()`);
      return await fn();
    }
    throw err;
  }
}

const STATEMENT_HEADS = [
  'var ',
  'let ',
  'const ',
  'function ',
  'function*',
  'async function',
  'class ',
  'if ',
  'if(',
  'for ',
  'for(',
  'while ',
  'while(',
  'do ',
  'do{',
  'switch ',
  'switch(',
  'try ',
  'try{',
  'throw ',
  'return ',
  'import ',
  'export ',
  '{',
  ';',
];

function looksLikeStatement(code: string): boolean {
  // Multi-line input is almost always statement-shaped in a REPL.
  if (code.includes('\n')) return true;
  for (const head of STATEMENT_HEADS) {
    if (code.startsWith(head)) return true;
  }
  return false;
}
