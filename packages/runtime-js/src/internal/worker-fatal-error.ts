import { NotImplementedError } from '@riftydev/io';
import { inspect } from '../builtins/util.ts';

const clone = globalThis.structuredClone.bind(globalThis);
const isError = Reflect.get(Error, 'isError') as (value: unknown) => boolean;
// Native Node24 error_serdes recognizes these constructors by prototype descriptor name.
const errorTypes = {
  Error,
  EvalError,
  RangeError,
  ReferenceError,
  SyntaxError,
  TypeError,
  URIError,
};
type ErrorType = keyof typeof errorTypes;
interface ErrorProperty {
  value: unknown;
  writable: boolean;
  enumerable: boolean;
  configurable: boolean;
}
type Projection =
  | { kind: 'value'; value: unknown }
  | { kind: 'error'; type: ErrorType; properties: Record<string, ErrorProperty> };
interface WorkerErrorEnvelope {
  format: 'node-worker-error/v1';
  value: Projection;
}

/** Node's Worker error boundary preserves descriptors; RPC diagnostic projections are lossy here. */
export function serializeWorkerFatalError(reason: unknown): WorkerErrorEnvelope {
  const seen = new Map<object, Projection>();
  const project = (value: unknown): Projection => {
    if (isError(value)) {
      const error = value as object;
      const previous = seen.get(error);
      if (previous) return previous;
      try {
        const chain: object[] = [];
        let type: ErrorType | undefined;
        for (
          let current: object | null = error;
          current !== null;
          current = Object.getPrototypeOf(current)
        ) {
          chain.push(current);
          const constructor = Object.getOwnPropertyDescriptor(current, 'constructor')?.value;
          const name =
            constructor !== null &&
            (typeof constructor === 'object' || typeof constructor === 'function')
              ? Object.getOwnPropertyDescriptor(constructor, 'name')?.value
              : undefined;
          if (type === undefined && typeof name === 'string' && Object.hasOwn(errorTypes, name))
            type = name as ErrorType;
        }
        if (type !== undefined) {
          const properties: Record<string, ErrorProperty> = Object.create(null);
          const result: Projection = { kind: 'error', type, properties };
          seen.set(error, result);
          for (const current of chain.reverse())
            for (const key of Object.getOwnPropertyNames(current)) {
              let descriptor: PropertyDescriptor | undefined;
              try {
                descriptor = Object.getOwnPropertyDescriptor(current, key);
              } catch {
                continue;
              }
              if (!descriptor) continue;
              if (descriptor.get && key !== '__proto__') {
                try {
                  descriptor = { ...descriptor, value: Reflect.apply(descriptor.get, error, []) };
                } catch {
                  continue;
                }
              }
              if (
                !Object.hasOwn(descriptor, 'value') ||
                (key !== 'cause' &&
                  (typeof descriptor.value === 'function' || typeof descriptor.value === 'symbol'))
              )
                continue;
              properties[key] = {
                value: key === 'cause' ? project(descriptor.value) : descriptor.value,
                writable: descriptor.writable ?? false,
                enumerable: descriptor.enumerable ?? false,
                configurable: descriptor.configurable ?? false,
              };
            }
          // Native Node abandons the whole descriptor projection when a nested value cannot clone.
          clone(properties);
          return result;
        }
      } catch {
        /* Native Error cloning/inspection is the next truthful serializer. */
      }
    }
    if (
      value !== null &&
      (typeof value === 'object' || typeof value === 'function') &&
      typeof Reflect.get(value, Symbol.for('nodejs.util.inspect.custom')) === 'function'
    ) {
      // TODO(backlog: runtime-js/util-surface-completions): custom inspection is not implemented.
      return project(new NotImplementedError('worker_threads.error.custom-inspect'));
    }
    try {
      return { kind: 'value', value: clone(value) };
    } catch {
      return { kind: 'value', value: inspect(value) };
    }
  };
  try {
    return { format: 'node-worker-error/v1', value: project(reason) };
  } catch {
    // Only an actual serializer failure produces this measured Node terminal error.
    const failure = new errorTypes.Error('Serializing an uncaught exception failed');
    Object.assign(failure, { code: 'ERR_WORKER_UNSERIALIZABLE_ERROR' });
    return { format: 'node-worker-error/v1', value: project(failure) };
  }
}

export function deserializeWorkerFatalError(value: unknown): unknown {
  if (
    typeof value !== 'object' ||
    value === null ||
    Reflect.get(value, 'format') !== 'node-worker-error/v1'
  )
    return value;
  const seen = new Map<Projection, unknown>();
  const restore = (projection: Projection): unknown => {
    if (projection.kind === 'value') return projection.value;
    if (seen.has(projection)) return seen.get(projection);
    const error = Object.create(errorTypes[projection.type].prototype) as Error;
    seen.set(projection, error);
    for (const [key, descriptor] of Object.entries(projection.properties)) {
      Object.defineProperty(error, key, {
        ...descriptor,
        value: key === 'cause' ? restore(descriptor.value as Projection) : descriptor.value,
      });
    }
    Object.defineProperty(error, Symbol.toStringTag, { value: 'Error', configurable: true });
    return error;
  };
  return restore((value as WorkerErrorEnvelope).value);
}
