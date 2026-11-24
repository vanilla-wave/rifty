// EventTarget/Event + AbortController/AbortSignal only.
const ets = require('event-target-shim');
const acp = require('abortcontroller-polyfill/dist/cjs-ponyfill');
globalThis.__npm = {
  EventTarget: ets.EventTarget,
  Event: ets.Event,
  CustomEvent: undefined,
  AbortController: acp.AbortController,
  AbortSignal: acp.AbortSignal,
  DOMException: globalThis.DOMException, // the guest's (web-shim)
};
