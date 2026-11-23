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
 * A first-line `-->` (behind whitespace or one-line block comments) is a
 * comment only at the start of input or after a line terminator; behind the
 * shared-line prefix it would be an operator. `//>` is the same comment.
 */
const LEADING_HTML_CLOSE =
  /^(?:[\t\v\f \u00a0\ufeff\p{Zs}]|\/\*(?:[^*\n\r\u2028\u2029]|\*(?!\/))*\*\/)*-->/u;

function asWrappedBody(source: string): string {
  const lead = LEADING_HTML_CLOSE.exec(source)?.[0];
  if (lead === undefined) return source;
  return `${source.slice(0, lead.length - 3)}//>${source.slice(lead.length)}`;
}

/** Node's CommonJS wrapper parameters, in its order. */
const NODE_WRAPPER = 'exports,require,module,__filename,__dirname';
const NODE_PARAMS = NODE_WRAPPER.split(',');

/**
 * Node's `compileFunction` wrapper keeps every source line where it is. The
 * anonymous indirect-eval prefix shares the source's first line, so every
 * line keeps its native number; only line 1 columns move by the prefix
 * (compat modules.md "CJS stack positions"). The factory takes Node's five
 * wrapper arguments (its `arguments`); rifty's loader helpers are closed over
 * from `helpers`. Named as V8 renders Node's nameless wrapper called on
 * `module.exports`: `Object.<anonymous>`.
 */
export function compileCjsFactory(
  helpers: readonly string[],
  source: string,
  filename: string,
): (...helperValues: unknown[]) => Factory {
  const sourceURL = `\n//# sourceURL=${filename}`;
  // The source alone must be a function body (Node compileFunction): only
  // then are its braces its own, so no `}` of it can close the wrapper and
  // run a line outside it. The wrapper text is never part of this check.
  new Function(...NODE_PARAMS, `${source}${sourceURL}`);
  const body = asWrappedBody(source);
  if (/[\r\n\u2028\u2029]/.test(filename)) {
    return new Function(...helpers, `return function(${NODE_WRAPPER}){${body}\n}${sourceURL}`) as (
      ...helperValues: unknown[]
    ) => Factory;
  }
  // Anonymous + strict keeps function-name bindings and callee reflection out.
  const prefix = `(function(${helpers.join(',')}){return function(${NODE_WRAPPER}){`;
  const outer = indirectEval(`${prefix}${body}\n}})${sourceURL}`) as (
    ...helperValues: unknown[]
  ) => Factory;
  lineOnePrefix.set(filename, prefix.length);
  return (...helperValues) => {
    const factory = outer(...helperValues);
    objectDefineProperty(factory, 'name', { value: 'Object.<anonymous>' });
    return factory;
  };
}
