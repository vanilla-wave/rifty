/**
 * `import.meta.resolve(specifier, parent)` under Node 24's
 * `--experimental-import-meta-resolve` (ADR-0449 §5). Without the flag Node
 * ignores `parent`; with it `parent` (a string or URL) is the resolution base.
 */

import { NotImplementedError } from '@riftydev/io';
import { isBuiltinSpecifier } from '../builtins/index.ts';
import { invalidArgType } from '../internal/node-received.ts';
import { nodeStartupOptions } from '../internal/node-startup-options.ts';
import { fileURLToPathPosix, isNodeUrl } from '../internal/posix-file-url.ts';

/** What the resolver resolves, or the final URL of a non-file relative target. */
export type MetaResolveRequest =
  | { readonly specifier: string; readonly from: string }
  | { readonly href: string };

function parseUrl(href: string, base?: string): URL | null {
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}

function isRelativeOrAbsolutePath(specifier: string): boolean {
  return (
    specifier.startsWith('/') ||
    specifier === '.' ||
    specifier === '..' ||
    specifier.startsWith('./') ||
    specifier.startsWith('../')
  );
}

export function metaResolveRequest(
  specifier: string,
  args: readonly unknown[],
  ownId: string,
): MetaResolveRequest {
  const parent = args[0];
  if (parent === undefined || !nodeStartupOptions().importMetaResolve) {
    return { specifier, from: ownId };
  }
  if (typeof parent !== 'string' && !isNodeUrl(parent)) {
    throw invalidArgType('"parentURL" argument', 'of type string or an instance of URL', parent);
  }
  const parentHref = String(parent);
  if (isRelativeOrAbsolutePath(specifier)) {
    const target = parseUrl(specifier, parentHref);
    if (target === null) {
      throw Object.assign(
        new TypeError(
          `Failed to resolve module specifier "${specifier}" from "${parentHref}": Invalid relative URL or base scheme is not hierarchical.`,
        ),
        { code: 'ERR_UNSUPPORTED_RESOLVE_REQUEST' },
      );
    }
    return target.protocol === 'file:'
      ? { specifier: target.href, from: ownId }
      : { href: target.href };
  }
  if (isBuiltinSpecifier(specifier) || parseUrl(specifier) !== null) {
    return { specifier, from: ownId };
  }
  const base = parseUrl(parentHref);
  if (base === null) throw Object.assign(new TypeError('Invalid URL'), { code: 'ERR_INVALID_URL' });
  if (base.protocol !== 'file:') {
    throw new NotImplementedError(
      'module.import.meta.resolve.parent',
      `package resolution from a ${base.protocol} parent is not implemented`,
    );
  }
  // Node looks packages up from the parent URL's directory.
  return { specifier, from: fileURLToPathPosix(new URL('./', base)) };
}
