/**
 * How a Worker child inherits the parent's stdin. Node shares fd 0: the child
 * reads it and the parent's `process.stdin` stays untouched (not flowing, not
 * holding the parent). rifty's child gets input through this hook on the
 * parent's stdin reader instead of a `'data'` listener, which would switch the
 * parent's stream to flowing and hold its realm past the child's close.
 */

export const INHERIT_STDIN = Symbol('rifty.process.stdin.inherit');

export interface StdinInheritor {
  data(chunk: string | Uint8Array): void;
  end(): void;
}

/** Subscribes an inheriting child; the returned function detaches it. */
export type InheritStdin = (inheritor: StdinInheritor) => () => void;

export function stdinInheritHook(source: unknown): InheritStdin | undefined {
  if ((typeof source !== 'object' || source === null) && typeof source !== 'function') {
    return undefined;
  }
  const hook = (source as { [INHERIT_STDIN]?: unknown })[INHERIT_STDIN];
  return typeof hook === 'function' ? (hook.bind(source) as InheritStdin) : undefined;
}
