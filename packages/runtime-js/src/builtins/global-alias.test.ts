/**
 * Regression: Node exposes `global` as the realm global (`global === globalThis`).
 * CJS packages built for Node reference bare `global` — notably `@emnapi/*`,
 * which the Rolldown WASI binding (Vite 8) loads; without the alias they die
 * with "global is not defined", hanging the bundler's worker pool. The kernel
 * pre-entry hook installs it for every Node worker realm (incl. the
 * worker_threads pthread children) via `installGlobalAlias`/`installWorkerRealmCompat`
 * (worker-realm-compat.ts), folded into `installNodeRuntime` (ADR-0157).
 *
 * Node's vitest env already defines `global`, so each test DELETES it first to
 * make the assertion meaningful (RED-checkable).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installGlobalAlias } from '../ipc/worker-realm-compat.ts';

type G = { global?: unknown };

let hadGlobal: boolean;
let savedGlobal: unknown;

beforeEach(() => {
  hadGlobal = 'global' in globalThis;
  savedGlobal = (globalThis as G).global;
  (globalThis as G).global = undefined;
});

afterEach(() => {
  (globalThis as G).global = hadGlobal ? savedGlobal : undefined;
});

describe('Node `global` realm alias', () => {
  it('installGlobalAlias() installs global === globalThis', () => {
    expect((globalThis as G).global).toBeUndefined();
    installGlobalAlias();
    expect((globalThis as G).global).toBe(globalThis);
  });

  it('does not clobber a pre-existing global', () => {
    const sentinel = { iAmGlobal: true };
    (globalThis as G).global = sentinel;
    installGlobalAlias();
    expect((globalThis as G).global).toBe(sentinel);
  });
});
