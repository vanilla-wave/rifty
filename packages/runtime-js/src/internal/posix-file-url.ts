export const URLConstructor = globalThis.URL;

const encodeURIPrimordial = globalThis.encodeURI;
const decodeURIComponentPrimordial = globalThis.decodeURIComponent;
const fromCharCodePrimordial = String.fromCharCode;
const charCodeAtPrimordial = String.prototype.charCodeAt;
const reflectApplyPrimordial = Reflect.apply;

type CodedTypeError = TypeError & { code: string };

/** Node's cross-realm-safe URL brand predicate (`internal/url.isURL`). */
export function isNodeUrl(value: unknown): value is URL {
  const candidate = value as
    | {
        readonly href?: unknown;
        readonly protocol?: unknown;
        readonly auth?: unknown;
        readonly path?: unknown;
      }
    | null
    | undefined;
  return Boolean(
    candidate?.href &&
      candidate.protocol &&
      candidate.auth === undefined &&
      candidate.path === undefined,
  );
}

function codedTypeError(code: string, message: string): CodedTypeError {
  const error = new TypeError(message) as CodedTypeError;
  error.code = code;
  return error;
}

function toWellFormed(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const unit = reflectApplyPrimordial(charCodeAtPrimordial, value, [index]) as number;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = reflectApplyPrimordial(charCodeAtPrimordial, value, [index + 1]) as number;
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += fromCharCodePrimordial(unit, next);
        index += 1;
      } else {
        result += '\ufffd';
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      result += '\ufffd';
    } else {
      result += fromCharCodePrimordial(unit);
    }
  }
  return result;
}

function encodePath(path: string): string {
  const encoded = encodeURIPrimordial(toWellFormed(path));
  let result = '';
  for (let index = 0; index < encoded.length; index += 1) {
    const character = encoded[index];
    if (character === '#') result += '%23';
    else if (character === '?') result += '%3F';
    else if (character === '~') result += '%7E';
    else result += character;
  }
  return result;
}

export function fileURLFromResolvedPath(path: string): URL {
  return new URLConstructor(`file://${encodePath(path)}`);
}

export function hasEncodedPathSeparator(pathname: string, includeBackslash = false): boolean {
  for (let index = 0; index <= pathname.length - 3; index += 1) {
    if (pathname[index] !== '%') continue;
    const second = pathname[index + 1];
    const third = pathname[index + 2];
    if (second === '2' && (third === 'f' || third === 'F')) return true;
    if (includeBackslash && second === '5' && (third === 'c' || third === 'C')) return true;
  }
  return false;
}

export function fileURLToPathPosix(input: URL | string): string {
  const url = typeof input === 'string' ? new URLConstructor(input) : input;
  if (url.protocol !== 'file:') {
    throw codedTypeError('ERR_INVALID_URL_SCHEME', 'The URL must be of scheme file');
  }
  if (url.hostname !== '') {
    throw codedTypeError(
      'ERR_INVALID_FILE_URL_HOST',
      'File URL host must be "localhost" or empty on a POSIX platform',
    );
  }
  if (hasEncodedPathSeparator(url.pathname)) {
    const error = codedTypeError(
      'ERR_INVALID_FILE_URL_PATH',
      'File URL path must not include encoded / characters',
    ) as CodedTypeError & { input: URL };
    error.input = url;
    throw error;
  }
  return pathnameHasPercent(url.pathname)
    ? decodeURIComponentPrimordial(url.pathname)
    : url.pathname;
}

function pathnameHasPercent(pathname: string): boolean {
  for (let index = 0; index < pathname.length; index += 1) {
    if (pathname[index] === '%') return true;
  }
  return false;
}
