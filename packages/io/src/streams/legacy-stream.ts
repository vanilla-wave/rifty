/**
 * Legacy `Stream` base — Node's `require('stream')` IS this constructor: a
 * function inheriting EventEmitter, with the modern stream classes attached as
 * static properties (`Stream.Readable`, …, `Stream.Stream === Stream`).
 *
 * Why it exists: our {@link Readable}/{@link Writable} extend EventEmitter
 * directly — we collapse Node's `Readable → Stream → EventEmitter` chain. But
 * real packages do `util.inherits(SubStream, require('stream'))` then
 * `Stream.call(this)` (e.g. `send/index.js`'s `SendStream`). `util.inherits`
 * requires a *callable* constructor (a class throws when invoked without
 * `new`), and `Stream.call(this)` must initialise the EventEmitter state. This
 * base satisfies both so the stream module behaves like Node's.
 */
import { EventEmitter } from '../event-emitter.ts';

// Declaration merge: the `Stream` value is a function whose instances carry the
// EventEmitter instance shape (matches Node, where Stream instances are EEs).
export interface Stream extends EventEmitter {}
// Empty body: EventEmitter state is lazily created on first use (see
// event-emitter.ts), so `Stream.call(this)` needs to do nothing — it exists
// only so `util.inherits(X, require('stream'))` has a callable constructor.
export function Stream(this: object): void {}

// Inherit EventEmitter on both the instance side (prototype chain) and the
// static side (Stream.defaultMaxListeners, etc.) — mirrors Node's Stream.
Object.setPrototypeOf(Stream.prototype, EventEmitter.prototype);
Object.setPrototypeOf(Stream, EventEmitter);
