// biome-ignore lint/security/noGlobalEval: validated CJS function bodies need native source coordinates.
const indirectEval = eval;
const objectDefineProperty = Object.defineProperty;
type Factory = (...args: unknown[]) => unknown;
/** Line-1 prefix length of the last shared-line factory compiled per filename. */
const lineOnePrefix = new Map<string, number>();

/**
 * How far line 1 columns of `filename`'s CJS factory frames sit right of the
 * source (the fatal report projects them back); undefined when not compiled.
 */
export function cjsLineOnePrefix(filename: string): number | undefined {
  return lineOnePrefix.get(filename);
}

/**
 * Node's `compileFunction` wrapper keeps every source line where it is. The
 * anonymous indirect-eval prefix shares the source's first line, so every
 * line keeps its native number; only line 1 columns move by the prefix
 * (compat modules.md "CJS stack positions"). Named as V8 renders Node's
 * nameless wrapper called on `module.exports`: `Object.<anonymous>`.
 */
export function compileCjsFactory(parameters: string[], source: string, filename: string): Factory {
  const sourceURL = `\n//# sourceURL=${filename}`;
  // Validate the body before eval: otherwise a closing brace could escape the
  // expression and execute code during compilation. Also the general fallback.
  const factory = new Function(...parameters, source + sourceURL) as Factory;
  if (/[\r\n\u2028\u2029]/.test(filename)) return factory;
  // Anonymous + strict keeps function-name bindings and callee reflection out.
  const prefix = `(function(${parameters.join(',')}){`;
  const shared = indirectEval(`${prefix}${source}\n})${sourceURL}`) as Factory;
  lineOnePrefix.set(filename, prefix.length);
  objectDefineProperty(shared, 'name', { value: 'Object.<anonymous>' });
  return shared;
}
