/**
 * Bundled cac runs `this.runMatchedCommand()` and drops the action promise.
 * The same tracker Vite's install patch calls keeps that promise on the loop.
 * Already-patched sources contain the tracker call and are left alone.
 */
const BARE_CALL = 'this.runMatchedCommand();';
const TRACKER = '__riftyTrackCliPromise';

export function trackUnawaitedCliAction(source: string): string {
  if (source.includes(TRACKER) || !source.includes(BARE_CALL)) return source;
  return source.replaceAll(
    BARE_CALL,
    `var __riftyAction = this.runMatchedCommand();
if (__riftyAction && typeof __riftyAction.then === "function" && globalThis.${TRACKER}) globalThis.${TRACKER}(__riftyAction);`,
  );
}
