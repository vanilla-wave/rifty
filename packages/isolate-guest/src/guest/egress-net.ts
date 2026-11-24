/**
 * The guest's `node:net` (ADR-0557 §6, 2026-11-24): Node v24.16.0's export list in
 * its order; IP grammar, `_normalizeArgs` and the autoselect defaults real
 * (Node's `lib/net.js`); sockets, servers and handles named gaps.
 */
import { Duplex, EventEmitter } from '@riftydev/io';
import { isIP, isIPv4, isIPv6 } from '@riftydev/net/node-data';
import { NO_CONNECTION, gap, loudClass, loudFunction, loudMethod, named } from './egress-gaps.ts';
import { validateBoolean, validateInteger } from './node-validators.ts';

const NOT_IN_RIFTY = 'not implemented in the rifty isolate host (Node backs it natively), ADR-0557';

const normalizedArgsSymbol = Symbol('normalizedArgs');

/** Node's `isPipeName`: a string that is not a non-negative number. */
const isPipeName = (s: unknown): boolean => typeof s === 'string' && !(Number(s) >= 0);

type NormalizedArgs = [Record<string, unknown>, unknown] & { [normalizedArgsSymbol]?: true };

function normalizeArgs(args: readonly unknown[]): NormalizedArgs {
  let arr: NormalizedArgs;
  if (args.length === 0) {
    arr = [{}, null];
    arr[normalizedArgsSymbol] = true;
    return arr;
  }
  const arg0 = args[0];
  let options: Record<string, unknown> = {};
  if (typeof arg0 === 'object' && arg0 !== null) options = arg0 as Record<string, unknown>;
  else if (isPipeName(arg0)) options.path = arg0;
  else {
    options.port = arg0;
    if (args.length > 1 && typeof args[1] === 'string') options.host = args[1];
  }
  const cb = args[args.length - 1];
  arr = typeof cb !== 'function' ? [options, null] : [options, cb];
  arr[normalizedArgsSymbol] = true;
  return arr;
}

// Node's `RegExp#test` coerces any argument (`isIP(5)` is 0).
function netIsIP(s: unknown): number {
  return isIP(s as string);
}
function netIsIPv4(s: unknown): boolean {
  return isIPv4(s as string);
}
function netIsIPv6(s: unknown): boolean {
  return isIPv6(s as string);
}

let autoSelectFamilyDefault = true;
// Node's `--network-family-autoselection-attempt-timeout` default; the guest has no CLI options.
let autoSelectFamilyAttemptTimeoutDefault = 250;

function getDefaultAutoSelectFamily(): boolean {
  return autoSelectFamilyDefault;
}
function setDefaultAutoSelectFamily(value: unknown): void {
  validateBoolean(value, 'value');
  autoSelectFamilyDefault = value as boolean;
}
function getDefaultAutoSelectFamilyAttemptTimeout(): number {
  return autoSelectFamilyAttemptTimeoutDefault;
}
function setDefaultAutoSelectFamilyAttemptTimeout(value: unknown): void {
  validateInteger(value, 'value', 1, 2 ** 31 - 1);
  autoSelectFamilyAttemptTimeoutDefault = value < 10 ? 10 : value;
}

/** Node's C++-backed address classes: no network, but no rifty implementation. */
class BlockList {
  constructor() {
    throw gap('net.BlockList', NOT_IN_RIFTY);
  }
}
class SocketAddress {
  constructor() {
    throw gap('net.SocketAddress', NOT_IN_RIFTY);
  }
}
function withStatics<C extends object>(C: C, name: string, statics: readonly string[]): C {
  named(C, name);
  for (const s of statics)
    Object.defineProperty(C, s, {
      value: loudMethod(s, 1, `net.${name}.${s}`, NOT_IN_RIFTY),
      writable: true,
      configurable: true,
    });
  return C;
}

export function createNet(): Record<string, unknown> {
  const Server = loudClass('Server', 2, 'net.Server', EventEmitter, NO_CONNECTION);
  const Socket = loudClass('Socket', 1, 'net.Socket', Duplex, NO_CONNECTION);
  const connect = loudFunction('connect', 0, 'net.connect');
  withStatics(BlockList, 'BlockList', ['isBlockList']);
  withStatics(SocketAddress, 'SocketAddress', ['isSocketAddress', 'parse']);
  const net: Record<string, unknown> = {
    _createServerHandle: loudFunction('createServerHandle', 5, 'net._createServerHandle'),
    _normalizeArgs: named(normalizeArgs, 'normalizeArgs'),
  };
  Object.defineProperties(net, {
    BlockList: { get: () => BlockList, enumerable: true, configurable: true },
    SocketAddress: { get: () => SocketAddress, enumerable: true, configurable: true },
  });
  return Object.assign(net, {
    connect,
    createConnection: connect,
    createServer: loudFunction('createServer', 2, 'net.createServer'),
    isIP: named(netIsIP, 'isIP'),
    isIPv4: named(netIsIPv4, 'isIPv4'),
    isIPv6: named(netIsIPv6, 'isIPv6'),
    Server,
    Socket,
    Stream: Socket,
    getDefaultAutoSelectFamily: named(getDefaultAutoSelectFamily, 'getDefaultAutoSelectFamily'),
    setDefaultAutoSelectFamily: named(setDefaultAutoSelectFamily, 'setDefaultAutoSelectFamily'),
    getDefaultAutoSelectFamilyAttemptTimeout: named(
      getDefaultAutoSelectFamilyAttemptTimeout,
      'getDefaultAutoSelectFamilyAttemptTimeout',
    ),
    setDefaultAutoSelectFamilyAttemptTimeout: named(
      setDefaultAutoSelectFamilyAttemptTimeout,
      'setDefaultAutoSelectFamilyAttemptTimeout',
    ),
  });
}
