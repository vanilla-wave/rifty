import { basename, joinPath } from '@riftydev/vfs';
import { requireModuleEnabled } from '../internal/esm-loader.ts';
import { hasModuleSyntax } from './resolver-profile.ts';
import type { ResolvedModule } from './resolver.ts';

const DYNAMIC_IMPORT = 'dynamic import() which is available in all CommonJS modules';

// Node's `NodeError` prototype for the code: `constructor` Error, `toString` with the code.
const ERR_REQUIRE_ESM_PROTOTYPE = Object.create(Error.prototype, {
  constructor: { value: Error, writable: true, configurable: true },
  toString: {
    value: function toString(this: Error): string {
      return `${this.name} [ERR_REQUIRE_ESM]: ${this.message}`;
    },
    writable: true,
    configurable: true,
  },
}) as Error;

/**
 * Node's `require` of an ES module without `require(esm)`: `ERR_REQUIRE_ESM`, its v24
 * message and shape (`constructor` Error; own `stack`, `code`, `message`; `stack` head and
 * `toString` `Error [ERR_REQUIRE_ESM]: `). No-op while `require(esm)` is on.
 */
export function refuseRequireEsm(
  resolved: ResolvedModule,
  parent: { readonly filename?: unknown } | null | undefined,
): void {
  if (requireModuleEnabled()) return;
  const file = resolved.id;
  const parentPath = typeof parent?.filename === 'string' ? parent.filename : null;
  let message = `require() of ES Module ${file}${parentPath ? ` from ${parentPath}` : ''} not supported.`;
  if (file.endsWith('.mjs')) {
    message += `\nInstead change the require of ${file} to a ${DYNAMIC_IMPORT}.`;
  } else if (resolved.packageRoot !== null) {
    const pkg = joinPath(resolved.packageRoot, 'package.json');
    const name = parentPath && basename(file) === basename(parentPath) ? file : basename(file);
    message += hasModuleSyntax(resolved.source)
      ? `\nInstead change the require of ${name} in ${String(parentPath)} to a ${DYNAMIC_IMPORT}.`
      : `\n${name} is treated as an ES module file as it is a .js file whose nearest parent package.json contains "type": "module" which declares all .js files in that package scope as ES modules.\nInstead either rename ${name} to end in .cjs, change the requiring code to use ${DYNAMIC_IMPORT}, or change "type": "module" to "type": "commonjs" in ${pkg} to treat all .js files as CommonJS (using .mjs for all ES modules instead).\n`;
  }
  const error = new Error() as Error & { code: string };
  Object.setPrototypeOf(error, ERR_REQUIRE_ESM_PROTOTYPE);
  error.code = 'ERR_REQUIRE_ESM';
  Object.defineProperty(error, 'message', { value: message, writable: true, configurable: true });
  error.stack = `Error [ERR_REQUIRE_ESM]: ${message}${String(error.stack).slice('Error'.length)}`;
  throw error;
}
