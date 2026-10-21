/**
 * Guard every native structured-clone entry of a realm with `assertCloneable`
 * (clone-marks.ts): `structuredClone`, realm `postMessage`,
 * `MessagePort#`/`Worker#`/`BroadcastChannel#postMessage`. Native order is
 * kept: the transfer argument is read first where the surface takes one (a
 * `transfer` getter may mutate the message), then the message is checked and
 * the original is cloned. Wrapped once per realm; names,
 * lengths and descriptors stay native (ADR-0447 transfer wrappers in
 * message-port-ref.ts are untouched and run after this check).
 */

import { assertCloneable } from './clone-marks.ts';
import { ownerOf, readTransfer, wrapMethod } from './message-port-ref.ts';

const INSTALLED = Symbol.for('rifty.runtime-js.clone-admission.v1');

export function installCloneAdmission(): void {
  const realm = globalThis as typeof globalThis & { [INSTALLED]?: true };
  if (realm[INSTALLED] === true) return;
  Object.defineProperty(realm, INSTALLED, { value: true });
  /** `transfer`: `null` = the surface takes no transfer argument (BroadcastChannel). */
  const admit =
    (transfer: 'sequence' | 'options' | null) =>
    (
      native: (this: unknown, ...args: unknown[]) => unknown,
      receiver: unknown,
      args: unknown[],
    ): unknown => {
      const forwarded = args.slice();
      const read =
        transfer !== null && args.length >= 2
          ? readTransfer(args[1], transfer === 'sequence')
          : null;
      if (read !== null) forwarded[1] = read.forward(read.list);
      assertCloneable(args[0]);
      return Reflect.apply(native, receiver, forwarded);
    };
  for (const Ctor of [realm.MessagePort, realm.Worker]) {
    if (typeof Ctor === 'function') wrapMethod(Ctor.prototype, 'postMessage', admit('sequence'));
  }
  if (typeof realm.BroadcastChannel === 'function') {
    wrapMethod(realm.BroadcastChannel.prototype, 'postMessage', admit(null));
  }
  for (const [key, transfer] of [
    ['postMessage', 'sequence'],
    ['structuredClone', 'options'],
  ] as const) {
    const owner = ownerOf(realm, key);
    if (owner !== null) wrapMethod(owner, key, admit(transfer));
  }
}
