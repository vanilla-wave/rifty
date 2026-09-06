// Honest ceiling — gaps that loud-throw rather than fake success. Rendered by
// sections/arch.ts in the main chunk (not the deferred explorer chunk).

export type CeilCompat = 'warn' | 'no';

export interface CeilDef {
  readonly id: string;
  readonly label: string;
  readonly chip: string;
  readonly compat: CeilCompat;
  readonly role: string;
}

export const CEIL: readonly CeilDef[] = [
  {
    id: 'c_https',
    label: 'node:https',
    chip: 'node:https — fetch-backed',
    compat: 'warn',
    role: 'https.request/get use browser-validated fetch. TLS servers, custom Agents, and certificate controls throw loudly.',
  },
  {
    id: 'c_tcp',
    label: 'net.connect (raw TCP)',
    chip: 'raw TCP connect',
    compat: 'no',
    role: 'Raw sockets throw. The HttpFramedSocket is HTTP-framed only.',
  },
  {
    id: 'c_native',
    label: 'native modules',
    chip: 'native modules',
    compat: 'no',
    role: 'Native (non-WASM) addons abort with ENATIVEUNSUPPORTED — e.g. better-sqlite3 → use sql.js.',
  },
  {
    id: 'c_sqlite',
    label: 'node:sqlite',
    chip: 'node:sqlite — in-memory',
    compat: 'warn',
    role: 'DatabaseSync subset over sql.js WASM — in-memory only.',
  },
  {
    id: 'c_vm',
    label: 'node:vm',
    chip: 'node:vm — QuickJS realm',
    compat: 'warn',
    role: 'Real realm via QuickJS-WASM — about ES2023, not V8 parity.',
  },
  {
    id: 'c_drain',
    label: 'event-loop drain',
    chip: '30s force-kill drain',
    compat: 'warn',
    role: '30s wall-clock force-kill — a deliberate, disclosed divergence from Node.',
  },
  {
    id: 'c_preview',
    label: 'cross-realm preview',
    chip: 'preview — buffered (unbounded → 502)',
    compat: 'warn',
    role: 'Page preview buffers finite bodies; unbounded SSE/NDJSON fails loudly. Service-to-service loopback streams live.',
  },
];
