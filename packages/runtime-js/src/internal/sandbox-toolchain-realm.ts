const SANDBOX_TOOLCHAIN_REALM = Symbol.for('rifty.runtime-js.sandbox-toolchain.v1');
const SANDBOX_TOOLCHAIN_RESIDENT_TRANSITION = Symbol.for(
  'rifty.runtime-js.sandbox-toolchain.resident-transition.v1',
);

/** True only when the selected Workbench toolchain Worker claimed this realm. */
export function isSandboxToolchainRealm(): boolean {
  return Reflect.get(globalThis, SANDBOX_TOOLCHAIN_REALM) === true;
}

export function claimSandboxToolchainResidentTransition(): boolean {
  if (Reflect.get(globalThis, SANDBOX_TOOLCHAIN_RESIDENT_TRANSITION) === true) return false;
  Reflect.set(globalThis, SANDBOX_TOOLCHAIN_RESIDENT_TRANSITION, true);
  return true;
}

export function releaseSandboxToolchainResidentTransition(): void {
  Reflect.set(globalThis, SANDBOX_TOOLCHAIN_RESIDENT_TRANSITION, false);
}

export function isSandboxToolchainResidentTransitionActive(): boolean {
  return Reflect.get(globalThis, SANDBOX_TOOLCHAIN_RESIDENT_TRANSITION) === true;
}
