import { NotImplementedError } from '@riftydev/io';
import type { Edit } from './cjs-source-rewrite.ts';

const ownKeys = Reflect.ownKeys;
const apply = Reflect.apply;
const mutationMethods = new Set<unknown>([
  Object.defineProperty,
  Reflect.defineProperty,
  Reflect.set,
  Reflect.deleteProperty,
]);
export type GlobalWriteGuard = ((key: unknown) => object) & {
  mutation(method: unknown): (...args: unknown[]) => unknown;
};

/** Keep native GetValue/PutValue conversion order, including RHS effects. */
export function globalWriteKeyGuard(kind: 'esm' | 'cjs'): GlobalWriteGuard {
  const convert = (key: unknown): PropertyKey => {
    const converted = ownKeys({ [key as PropertyKey]: 0 })[0]!;
    if (converted === 'Function')
      throw new NotImplementedError(`module-loader.${kind}-global-function-assignment`);
    return converted;
  };
  const deferred = (key: unknown): object => ({ [Symbol.toPrimitive]: () => convert(key) });
  return Object.assign(deferred, {
    mutation(method: unknown) {
      if (!mutationMethods.has(method))
        throw new NotImplementedError(`module-loader.${kind}-custom-global-mutation`);
      return (...args: unknown[]): unknown => {
        if (args[0] === globalThis) args[1] = convert(args[1]);
        return apply(method as (...args: unknown[]) => unknown, undefined, args);
      };
    },
  });
}

export function guardComputedWrite(edits: Edit[], node: unknown, helper: string): void {
  const property = node as { start: number; end: number };
  edits.push({ start: property.start, end: property.start, text: `${helper}(` });
  edits.push({ start: property.end, end: property.end, text: ')' });
}

export function guardMutationCallee(edits: Edit[], node: unknown, helper: string): void {
  const callee = node as { start: number; end: number };
  edits.push({ start: callee.start, end: callee.start, text: `${helper}.mutation(` });
  edits.push({ start: callee.end, end: callee.end, text: ')' });
}
