/**
 * Side-effect module: registers `node:net`, `node:http`, `node:https` shapes
 * with the shared builtin registry in `@rifty/io` (ADR-0035). Import this
 * from a higher layer (e.g. `apps/playground` bootstrap or test setup) to
 * enable `require('http')` inside the runtime. Keeping registration here,
 * rather than in runtime-js, preserves the top-down layering rule
 * (runtime-* must not depend on net).
 */
import { registerBuiltin } from '@rifty/io';
import http from './http.ts';
import https from './https.ts';
import net from './net.ts';

registerBuiltin('net', () => net);
registerBuiltin('http', () => http);
// `https` is a loud-throw stub — see ADR 0010. Imports succeed; calls throw.
registerBuiltin('https', () => https);
