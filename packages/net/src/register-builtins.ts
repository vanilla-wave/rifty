/**
 * Side-effect module: registers `node:net`, `node:http`, `node:https` shapes
 * with the shared builtin registry in `@riftydev/io` (ADR-0035). Import this
 * from a higher layer (e.g. `apps/playground` bootstrap or test setup) to
 * enable `require('http')` inside the runtime. Keeping registration here,
 * rather than in runtime-js, preserves the top-down layering rule
 * (runtime-* must not depend on net).
 */
import { registerBuiltin } from '@riftydev/io';
import http from './http.ts';
import https from './https.ts';
import net from './net.ts';

let netBuiltinsRegistered = false;

export function registerNetBuiltins(): void {
  if (netBuiltinsRegistered) return;
  netBuiltinsRegistered = true;

  registerBuiltin('net', () => net);
  registerBuiltin('http', () => http);
  // `https` client `request`/`get` route over the page fetch (ADR-0181); the
  // TLS server/socket surface (`createServer`/`Agent`/TLS opts) still throws —
  // ADR-0010 ceiling. Imports always resolve.
  registerBuiltin('https', () => https);
}

registerNetBuiltins();
