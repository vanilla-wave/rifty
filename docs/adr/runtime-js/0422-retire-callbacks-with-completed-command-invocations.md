# ADR 0422: Retire callbacks with completed command invocations

Status: Accepted
Date: 2026-09-11

## Context

ADR-0418 reuses a Worker. A completed command's SIGINT listener survived into
Stop of the next command, writing old stdout and filesystem effects. Sibling
REDs found unref watchFile pollers, FSWatcher abort callbacks and timers/promises
abort closures surviving the existing timer boundary.

## Decision

Extend existing lifecycle owners. IO exposes captureEventEmitterListenerScope
for process and stdio: retain surviving original registrations, silently retire
new ones after drain. Never resurrect fired once handlers or explicit removals.
Resetting all listeners would destroy host registrations; remove/add through
public APIs would invoke guest meta-events during retirement.

Existing timer handles own scope-disposal callbacks, using their existing id
sequence. Registrations need their own id because a command can append a
watchFile listener to a poller created before its boundary. Retirement detaches
only new listeners; empty pollers retire their timer and map entry. FSWatcher
and promise timers detach abort listeners without invoking old guest callbacks.
Normal explicit close retains Node's asynchronous close event.

No second global resource registry. Unsafe drain retains ownership until actual
Worker termination. This is command lifecycle cleanup, not a fresh realm or
rollback of filesystem effects.

## Consequences

Completed commands cannot receive a later command's Stop through retained
process/stdio listeners. Unref watcher/timer cleanup preserves live host owners.
Real regression suites cover each callback family and pre-existing owners.
