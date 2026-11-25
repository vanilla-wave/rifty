/**
 * `node:url`. Legacy API (`Url`, `parse`, `resolve`, `resolveObject`, `format`): Node v24.16.0's
 * own `lib/url.js`, generated (ADR-0574, `url-legacy/`). WHATWG members: the realm's `URL` /
 * `URLSearchParams` and rifty's POSIX file-URL conversions. ada-backed helpers are named gaps.
 */

import { NotImplementedError } from '@riftydev/io';
import {
  URLConstructor,
  fileURLFromResolvedPath,
  fileURLToPathPosix,
} from '../internal/posix-file-url.ts';
import { resolve as resolvePath } from './path.ts';
import { legacy } from './url-legacy/bindings.ts';

export const URL = URLConstructor;
export const URLSearchParams = globalThis.URLSearchParams;

export function pathToFileURL(p: string): URL {
  let resolved = resolvePath(p);
  if (p.length > 0 && p[p.length - 1] === '/' && resolved[resolved.length - 1] !== '/') {
    resolved += '/';
  }
  return fileURLFromResolvedPath(resolved);
}

export function fileURLToPath(u: URL | string): string {
  return fileURLToPathPosix(u);
}

/** ada's WHATWG host parser and `urlToHttpOptions` (owner: backlog node-url-legacy-format-and-helpers). */
function domainToASCII(..._args: unknown[]): never {
  throw new NotImplementedError('url.domainToASCII');
}
function domainToUnicode(..._args: unknown[]): never {
  throw new NotImplementedError('url.domainToUnicode');
}
function urlToHttpOptions(..._args: unknown[]): never {
  throw new NotImplementedError('url.urlToHttpOptions');
}

const { url: node } = legacy;

// Node's key order; `URLPattern` and `fileURLToPathBuffer` are not rifty members.
const url = {
  Url: node.Url,
  parse: node.parse,
  resolve: node.resolve,
  resolveObject: node.resolveObject,
  format: node.format,
  URL,
  URLSearchParams,
  domainToASCII,
  domainToUnicode,
  pathToFileURL,
  fileURLToPath,
  urlToHttpOptions,
};
export default url;
