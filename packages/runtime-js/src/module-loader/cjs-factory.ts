// biome-ignore lint/security/noGlobalEval: validated CJS function bodies need native source coordinates.
const indirectEval = eval;
type Factory = (...args: unknown[]) => unknown;

/** Keep executable source lines intact when line one is only a strict directive. */
export function compileCjsFactory(parameters: string[], source: string, filename: string): Factory {
  const sourceURL = `\n//# sourceURL=${filename}`;
  // Validate the body before eval: otherwise a closing brace could escape the
  // expression and execute code during compilation. Also the general fallback.
  const factory = new Function(...parameters, source + sourceURL) as Factory;
  if (!/^(["'])use strict\1;[\t ]*(?:\r?\n|$)/.test(source) || /[\r\n\u2028\u2029]/.test(filename))
    return factory;
  // The prefix shares the non-executable directive line; line 2+ stays native.
  // Anonymous + strict keeps function-name bindings and callee reflection out.
  return indirectEval(`(function(${parameters.join(',')}){${source}\n})${sourceURL}`) as Factory;
}
