import { NotImplementedError } from '@riftydev/io';
import { inspect } from '../repl/inspect.ts';

export type EmitWarning = (
  warning: unknown,
  type?: unknown,
  code?: unknown,
  ctor?: unknown,
) => void;
interface WarningHost {
  readonly pid: number;
  readonly argv0: string;
  readonly release: { readonly name: string };
  readonly env: Record<string, string | undefined>;
  readonly stderr: { write(value: string): unknown };
  emitWarning: EmitWarning;
  noDeprecation?: boolean;
  throwDeprecation?: boolean;
  traceDeprecation?: boolean;
  traceProcessWarnings?: boolean;
  nextTick(fn: (...args: unknown[]) => void, ...args: unknown[]): void;
  emit(event: string, ...args: unknown[]): boolean;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}
type Warning = Error & { code?: unknown; detail?: unknown };
const ErrorCtor = Error;
const captureStack = Error.captureStackTrace;
const errorToString = Error.prototype.toString;
const string = String;
const arrayIsArray = Array.isArray;
const stringify = JSON.stringify;

function received(value: unknown): string {
  if (value === null || value === undefined) return `${value}`;
  switch (typeof value) {
    case 'bigint':
      return `type bigint (${value}n)`;
    case 'number':
      return `type number (${Object.is(value, -0) ? '-0' : value})`;
    case 'boolean':
      return `type boolean (${value})`;
    case 'symbol':
      return `type symbol (${string(value)})`;
    case 'function':
      return `function ${value.name}`;
    case 'string': {
      const text = value.length > 28 ? `${value.slice(0, 25)}...` : value;
      return `type string (${text.includes("'") ? stringify(text) : `'${text}'`})`;
    }
    default: {
      const object = value as { constructor?: { name?: unknown } };
      return object.constructor && 'name' in object.constructor
        ? `an instance of ${object.constructor.name}`
        : inspect(value, { depth: -1 });
    }
  }
}
function invalid(name: string, expected: string, value: unknown): never {
  throw Object.assign(
    new TypeError(`The "${name}" argument must be ${expected}. Received ${received(value)}`),
    { code: 'ERR_INVALID_ARG_TYPE' },
  );
}

/** Node 24 warning overloads and nextTick event delivery; one default sink per process. */
export function installProcessWarnings(host: WarningHost): void {
  const warningFile = host.env.NODE_REDIRECT_WARNINGS;
  function emitWarning(
    warning: unknown,
    typeArg?: unknown,
    codeArg?: unknown,
    ctorArg?: unknown,
  ): void {
    let type = typeArg;
    let code = codeArg;
    let ctor = ctorArg;
    if (host.noDeprecation && type === 'DeprecationWarning') return;
    let detail: string | undefined;
    if (type !== null && typeof type === 'object' && !arrayIsArray(type)) {
      const options = type as { ctor?: unknown; code?: unknown; detail?: unknown; type?: unknown };
      ctor = options.ctor;
      code = options.code;
      if (typeof options.detail === 'string') detail = options.detail;
      type = options.type || 'Warning';
    } else if (typeof type === 'function') {
      ctor = type;
      code = undefined;
      type = 'Warning';
    }
    if (type !== undefined && typeof type !== 'string') invalid('type', 'of type string', type);
    if (typeof code === 'function') {
      ctor = code;
      code = undefined;
    } else if (code !== undefined && typeof code !== 'string')
      invalid('code', 'of type string', code);
    let value: Warning;
    if (typeof warning === 'string') {
      value = new ErrorCtor(warning);
      value.name = string(type || 'Warning');
      if (code !== undefined) value.code = code;
      if (detail !== undefined) value.detail = detail;
      captureStack?.(value, (ctor || host.emitWarning) as (...args: unknown[]) => unknown);
    } else if (warning instanceof ErrorCtor) value = warning;
    else invalid('warning', 'of type string or an instance of Error', warning);
    if (value.name === 'DeprecationWarning') {
      if (host.noDeprecation) return;
      if (host.throwDeprecation) {
        host.nextTick(() => {
          throw value;
        });
        return;
      }
    }
    host.nextTick(() => {
      host.emit('warning', value);
    });
  }
  Object.defineProperty(emitWarning, 'name', { value: 'emitWarning', configurable: true });
  Object.defineProperty(host, 'emitWarning', {
    value: emitWarning,
    writable: true,
    configurable: true,
    enumerable: true,
  });

  let hintShown = false;
  function onWarning(input: unknown): void {
    if (!(input instanceof ErrorCtor)) return;
    const warning = input as Warning;
    const deprecation = warning.name === 'DeprecationWarning';
    if (deprecation && host.noDeprecation) return;
    const trace = host.traceProcessWarnings || (deprecation && host.traceDeprecation);
    let message = `(${host.release.name}:${host.pid}) `;
    if (warning.code) message += `[${warning.code}] `;
    message +=
      trace && warning.stack
        ? `${warning.stack}`
        : typeof warning.toString === 'function'
          ? `${warning.toString()}`
          : Reflect.apply(errorToString, warning, []);
    if (typeof warning.detail === 'string') message += `\n${warning.detail}`;
    if (!trace && !hintShown) {
      const flag = deprecation ? '--trace-deprecation' : '--trace-warnings';
      const argv0 = (host.argv0 || 'node')
        .replace(/\/+$/u, '')
        .split('/')
        .pop()
        ?.replace(/\.exe$/u, '');
      message += `\n(Use \`${argv0} ${flag} ...\` to show where the warning was created)`;
      hintShown = true;
    }
    // TODO(backlog: runtime-js/process-module-loader-surface)
    if (warningFile) throw new NotImplementedError('process.emitWarning.redirect');
    host.stderr.write(`${message}\n`);
  }
  Object.defineProperty(onWarning, 'name', { value: 'onWarning', configurable: true });
  if (host.env.NODE_NO_WARNINGS !== '1') host.on('warning', onWarning);
}
