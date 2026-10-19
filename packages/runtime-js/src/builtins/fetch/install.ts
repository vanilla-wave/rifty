import { HOST_FETCH } from '@riftydev/io';
import { Buffer } from '../buffer.ts';
import { loadBuiltin } from '../index.ts';
import createFetchClasses from './generated/classes.js';
import { createGuestFetch } from './network.ts';
import { installFetchPlatformBindings } from './platform.ts';

const installed = Symbol.for('rifty.fetch.installed');
interface FetchTarget {
  fetch?: typeof fetch;
}

/** Install before guest entry; no network builtin registration is needed. */
export function installNodeFetch(target: FetchTarget = globalThis): void {
  if (Object.hasOwn(target, installed) || typeof target.fetch !== 'function') return;
  const realm = globalThis as typeof globalThis & { [HOST_FETCH]?: typeof fetch };
  const nativeFetch =
    target === globalThis
      ? (realm[HOST_FETCH] ?? target.fetch.bind(target))
      : target.fetch.bind(target);
  if (target === globalThis && !Object.hasOwn(realm, HOST_FETCH))
    Object.defineProperty(realm, HOST_FETCH, { value: nativeFetch });
  const classes = createFetchClasses(
    (id) => {
      const builtin = loadBuiltin(id);
      if (builtin == null) throw new Error(`Fetch requires builtin ${id}`);
      return builtin;
    },
    loadBuiltin('node:process'),
    Buffer,
    installFetchPlatformBindings(),
  );
  Object.assign(target, {
    Request: classes.Request,
    Response: classes.Response,
    Headers: classes.Headers,
    FormData: classes.FormData,
    fetch: createGuestFetch(classes, nativeFetch),
  });
  Object.defineProperty(target, installed, { value: true });
}
