/**
 * Node's `--[no-]require-module` for this realm: `require()` of an ES module, the
 * `module-sync` condition, `require`'s syntax detection of a typeless `.js`,
 * `process.features.require_module`. On by default (Node 24); a host with no ES module
 * loader turns it off before guest code (the isolate guest).
 */
let requireModule = true;

export function setRequireModule(enabled: boolean): void {
  requireModule = enabled;
}

export function requireModuleEnabled(): boolean {
  return requireModule;
}
