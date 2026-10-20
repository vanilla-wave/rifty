/**
 * Route every native structured-clone entry of a realm through `admitClone`
 * (clone-marks.ts): `structuredClone`, realm `postMessage`,
 * `MessagePort#`/`Worker#`/`BroadcastChannel#postMessage`. Native order is
 * kept: the transfer argument is read first (a `transfer` getter may mutate the
 * message), then the message is admitted. Wrapped once per realm; names,
 * lengths and descriptors stay native (ADR-0447 transfer wrappers in
 * message-port-ref.ts are untouched and run after this check).
 */

import { admitClone } from './clone-marks.ts';
import { ownerOf, readTransfer, wrapMethod } from './message-port-ref.ts';

const INSTALLED = Symbol.for('rifty.runtime-js.clone-admission.v1');

export function installCloneAdmission(): void {
  const realm = globalThis as typeof globalThis & { [INSTALLED]?: true };
  if (realm[INSTALLED] === true) return;
  Object.defineProperty(realm, INSTALLED, { value: true });
  const admit =
    (sequenceOverload: boolean) =>
    (
      native: (this: unknown, ...args: unknown[]) => unknown,
      receiver: unknown,
      args: unknown[],
    ): unknown => {
      const forwarded = args.slice();
      const read = args.length >= 2 ? readTransfer(args[1], sequenceOverload) : null;
      if (read !== null) forwarded[1] = read.forward(read.list);
      forwarded[0] = admitClone(args[0]);
      return Reflect.apply(native, receiver, forwarded);
    };
  for (const Ctor of [realm.MessagePort, realm.Worker]) {
    if (typeof Ctor === 'function') wrapMethod(Ctor.prototype, 'postMessage', admit(true));
  }
  if (typeof realm.BroadcastChannel === 'function') {
    wrapMethod(realm.BroadcastChannel.prototype, 'postMessage', admit(false));
  }
  for (const [key, sequenceOverload] of [
    ['postMessage', true],
    ['structuredClone', false],
  ] as const) {
    const owner = ownerOf(realm, key);
    if (owner !== null) wrapMethod(owner, key, admit(sequenceOverload));
  }
}
