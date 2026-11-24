/**
 * Node's pure `node:http`/`node:net` data and functions, free of side effects
 * and transports: the isolate guest builds its own modules on them (no network
 * there, ADR-0557 §6), the browser modules here use the same copies.
 */
export { isIP, isIPv4, isIPv6 } from './ip-address.ts';
export { METHODS, maxHeaderSize } from './http/methods.ts';
export { STATUS_CODES } from './http/status-codes.ts';
