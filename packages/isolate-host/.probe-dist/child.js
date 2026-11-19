// src/child/main.ts
import { readFileSync } from "node:fs";
import { Socket } from "node:net";

// ../isolate-guest/src/bridge.ts
import { randomBytes } from "node:crypto";
var MAX_TIMER = 2 ** 31 - 1;
var refusals = /* @__PURE__ */ new WeakSet();
function refuse(message) {
  const error = new TypeError(`isolate-host bridge: ${message}`);
  error.stack = `TypeError: ${error.message}`;
  refusals.add(error);
  throw error;
}
var isInt = (v, min, max) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
function guard(name, fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      if (refusals.has(error)) throw error;
      return refuse(`${name} failed`);
    }
  };
}
function createHostBridge(hooks) {
  const origin = performance.now();
  const timers = /* @__PURE__ */ new Map();
  let closed = false;
  const clear = (id) => {
    const slot = timers.get(id);
    if (slot?.handle) clearTimeout(slot.handle);
    timers.delete(id);
  };
  const functions = {
    write: guard("write", (fd, bytes) => {
      if (fd !== 1 && fd !== 2) refuse("write: fd must be 1 or 2");
      if (!(bytes instanceof Uint8Array)) refuse("write: bytes must be a Uint8Array");
      hooks.write(fd, bytes);
    }),
    timerStart: guard("timerStart", (id, ms, repeat) => {
      if (!isInt(id, 1, MAX_TIMER)) refuse("timerStart: id must be an integer in 1..2^31-1");
      if (typeof ms !== "number" || !(ms >= 0 && ms <= MAX_TIMER))
        refuse("timerStart: ms out of range");
      if (typeof repeat !== "boolean") refuse("timerStart: repeat must be a boolean");
      if (closed) return;
      clear(id);
      const slot = { handle: null };
      timers.set(id, slot);
      const live2 = () => !closed && timers.get(id) === slot;
      const arm = (delay) => {
        slot.handle = setTimeout(tick, delay);
      };
      const tick = () => {
        const started = performance.now();
        slot.handle = null;
        if (!repeat) timers.delete(id);
        const rearm = () => {
          if (repeat && live2()) arm(Math.max(1, Math.ceil(started + ms - performance.now())));
        };
        const end = () => {
          if (live2()) timers.delete(id);
        };
        try {
          const delivered = hooks.fire(id);
          const then = delivered?.then;
          if (typeof then === "function") then.call(delivered, rearm, end);
          else rearm();
        } catch {
          if (live2()) clear(id);
        }
      };
      arm(ms);
    }),
    timerClear: guard("timerClear", (id) => {
      if (!isInt(id, 1, MAX_TIMER)) refuse("timerClear: id must be an integer in 1..2^31-1");
      clear(id);
    }),
    now: guard("now", () => performance.now() - origin),
    random: guard("random", (n) => {
      if (!isInt(n, 0, 65536)) refuse("random: length must be an integer in 0..65536");
      return new Uint8Array(randomBytes(n));
    })
  };
  return {
    functions,
    timeOrigin: performance.timeOrigin + origin,
    close() {
      closed = true;
      for (const slot of timers.values()) if (slot.handle) clearTimeout(slot.handle);
      timers.clear();
    }
  };
}
function exitStatus(value) {
  return isInt(value, 0, 255) ? value : 1;
}

// ../isolate-guest/src/contract.ts
var UNCOPYABLE_REJECTION = "isolate-host:uncopyable-rejection-reason";
var IMPORT_GAP = "Not implemented: isolate-host.dynamic-import (import() is not available in the rifty isolate host; use require(), ADR-0557)";

// src/child/main.ts
import ivm from "isolated-vm";

// src/protocol.ts
var FRAME_CHANNEL_FD = 3;
var MAX_ERROR_TEXT = 4096;
var KIND = { output: 1, exit: 2, memory: 3, error: 4, retire: 5 };
var HEADER = 9;
var STUCK_GRACE_MS = 1e3;
var RECYCLE_RSS_BYTES = 256 * 1024 * 1024;
function rssCeilingBytes(memoryLimitsMb) {
  let sum = 0;
  for (const mb of memoryLimitsMb) sum += mb;
  return RECYCLE_RSS_BYTES + 3 * sum * 1024 * 1024;
}
function frame(kind, call, payload) {
  const out = new Uint8Array(HEADER + payload.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.byteLength);
  out[4] = kind;
  view.setUint32(5, call);
  out.set(payload, HEADER);
  return out;
}

// src/child/bridge.ts
function importGapError() {
  return Object.assign(new Error(IMPORT_GAP), { stack: `Error: ${IMPORT_GAP}` });
}
var OutputBudget = class {
  constructor(cap) {
    this.cap = cap;
  }
  cap;
  #kept = 0;
  #truncated = false;
  #pending = {
    1: { buf: new Uint8Array(0), len: 0 },
    2: { buf: new Uint8Array(0), len: 0 }
  };
  get truncated() {
    return this.#truncated;
  }
  /** Accept a guest write; true when new bytes or the truncation flip await a flush. */
  write(fd, bytes) {
    const room = this.cap - this.#kept;
    const flipped = bytes.byteLength > room && !this.#truncated;
    if (flipped) this.#truncated = true;
    const take = Math.min(room, bytes.byteLength);
    if (take <= 0) return flipped;
    const slot = this.#pending[fd];
    if (slot.len + take > slot.buf.byteLength) {
      const size = Math.max(slot.len + take, Math.min(this.cap, slot.buf.byteLength * 2 || 4096));
      const grown = new Uint8Array(size);
      grown.set(slot.buf.subarray(0, slot.len));
      slot.buf = grown;
    }
    slot.buf.set(bytes.subarray(0, take), slot.len);
    slot.len += take;
    this.#kept += take;
    return true;
  }
  /** At most one chunk per fd. */
  drain() {
    const out = [];
    for (const fd of [1, 2]) {
      const slot = this.#pending[fd];
      if (slot.len > 0) out.push([fd, slot.buf.slice(0, slot.len)]);
      slot.len = 0;
    }
    return out;
  }
};

// src/child/main.ts
var channel = new Socket({ fd: FRAME_CHANNEL_FD, readable: false, writable: true });
var die = () => process.kill(process.pid, "SIGKILL");
channel.on("error", die);
var send = (kind, call, payload) => {
  channel.write(frame(kind, call, payload));
};
var dieAfterFlush = () => {
  channel.write(new Uint8Array(0), die);
  setTimeout(die, 200).unref();
};
var guestSource = readFileSync(new URL("./guest.js", import.meta.url), "utf8");
var cachedData;
var producing;
var live = /* @__PURE__ */ new Map();
var busyAllowanceMb = 0;
var retiring = false;
var retire = () => {
  if (retiring) return;
  retiring = true;
  send(KIND.retire, 0, new Uint8Array(0));
};
setInterval(() => {
  for (const call of live.values()) {
    if (call.isolate.isDisposed && !call.disposedHere) call.report(KIND.memory, new Uint8Array(0));
  }
  const rss = process.memoryUsage.rss();
  if (live.size === 0) {
    busyAllowanceMb = 0;
    if (rss > RECYCLE_RSS_BYTES) retire();
    return;
  }
  let liveMb = 0;
  for (const call of live.values()) liveMb += call.limitMb;
  busyAllowanceMb = Math.max(busyAllowanceMb, liveMb);
  if (rss > rssCeilingBytes([busyAllowanceMb])) {
    for (const call of live.values()) if (call.solo) call.report(KIND.memory, new Uint8Array(0));
    dieAfterFlush();
  }
}, 25);
async function run(request) {
  const id = request.call;
  let started = false;
  const output = new OutputBudget(request.maxOutputBytes);
  let flushScheduled = false;
  let sentTruncated = false;
  let closeBridge = () => {
  };
  const flush = () => {
    flushScheduled = false;
    if (state.reported) return;
    const chunks = output.drain();
    if (chunks.length === 0 && (!output.truncated || sentTruncated)) return;
    const t = output.truncated ? 1 : 0;
    if (chunks.length === 0) send(KIND.output, id, Uint8Array.of(1, t));
    for (const [fd, bytes] of chunks) {
      const payload = new Uint8Array(2 + bytes.byteLength);
      payload[0] = fd;
      payload[1] = t;
      payload.set(bytes, 2);
      send(KIND.output, id, payload);
    }
    sentTruncated = output.truncated;
  };
  let rejection;
  const isolate = new ivm.Isolate({
    memoryLimit: request.memoryLimitMb,
    // V8 cannot recover this process: report the culprit, then the consumer reruns the rest.
    onCatastrophicError: () => {
      state.report(KIND.memory, new Uint8Array(0));
      dieAfterFlush();
    },
    // `import()` is a gap this host cannot serve, and a rejection the guest may
    // never observe (it can drain first, or swallow it): the run ends here,
    // loudly; the guest's promise rejects too, with no worker frame in its stack.
    importModuleDynamically: () => {
      output.write(2, new TextEncoder().encode(`Error: ${IMPORT_GAP}
`));
      state.report(KIND.exit, Uint8Array.of(1));
      throw importGapError();
    },
    onUnhandledRejection: (reason) => {
      try {
        rejection?.applyIgnored(void 0, [reason], { arguments: { copy: true } });
      } catch {
        try {
          rejection?.applyIgnored(void 0, [UNCOPYABLE_REJECTION]);
        } catch {
        }
      }
    }
  });
  const forget = () => {
    state.unwound = true;
    if (!live.has(id)) return;
    if (state.reported) live.delete(id);
    if (live.size === 0 && process.memoryUsage.rss() > RECYCLE_RSS_BYTES) retire();
  };
  const state = {
    limitMb: request.memoryLimitMb,
    solo: request.solo === true,
    isolate,
    disposedHere: false,
    reported: false,
    cancelled: false,
    unwound: false,
    /** The call's one terminal frame; the isolate ends with it. */
    report(kind, payload) {
      if (state.reported) return;
      flush();
      state.reported = true;
      closeBridge();
      const idle = [...live.values()].every((c) => c === state || c.reported);
      if (state.unwound && idle && process.memoryUsage.rss() > RECYCLE_RSS_BYTES) retire();
      send(kind, id, payload);
      if (!isolate.isDisposed) {
        state.disposedHere = true;
        setImmediate(() => isolate.isDisposed || isolate.dispose());
      }
      if (state.unwound) live.delete(id);
      else {
        setTimeout(() => state.unwound || retire(), STUCK_GRACE_MS).unref();
      }
    }
  };
  if (live.size === 0) busyAllowanceMb = 0;
  live.set(id, state);
  try {
    const context = await isolate.createContext();
    const jail = context.global;
    const guestFire = {};
    const bridge = createHostBridge({
      write: (fd, bytes) => {
        if (!output.write(fd, bytes) || flushScheduled) return;
        flushScheduled = true;
        setTimeout(flush, 5);
      },
      // Settles once the guest ran the callback: an interval re-arms only then (ADR-0558).
      fire: (timer) => guestFire.ref?.apply(void 0, [timer])
    });
    closeBridge = bridge.close;
    if (state.reported) closeBridge();
    const names = Object.keys(bridge.functions);
    for (const [name, fn] of Object.entries(bridge.functions)) {
      await jail.set(`__riftyHost_${name}`, new ivm.Callback(fn));
    }
    await context.eval(`{
      const bridge = { timeOrigin: ${bridge.timeOrigin} };
      for (const name of ${JSON.stringify(names)}) {
        bridge[name] = globalThis['__riftyHost_' + name];
        delete globalThis['__riftyHost_' + name];
      }
      Object.defineProperty(globalThis, '__riftyIsolateHost', { value: Object.freeze(bridge), configurable: true });
    }`);
    if (cachedData === void 0 && producing !== void 0) await producing.catch(() => {
    });
    const compiling = isolate.compileScript(guestSource, {
      filename: "rifty-isolate-guest.js",
      ...cachedData === void 0 ? { produceCachedData: true } : { cachedData }
    });
    if (cachedData === void 0) producing = compiling;
    const script = await compiling;
    const cache = script;
    if (cachedData === void 0) cachedData = cache.cachedData;
    else if (cache.cachedDataRejected === true) cachedData = void 0;
    await script.run(context);
    const guest = await jail.get("__riftyGuest", { reference: true });
    guestFire.ref = await guest.get("fire", { reference: true });
    rejection = await guest.get("rejection", { reference: true });
    const start = await guest.get("run", { reference: true });
    await jail.delete("__riftyGuest");
    started = true;
    const code = await start.apply(void 0, [request.code], {
      arguments: { copy: true },
      result: { promise: true, copy: true }
    });
    state.unwound = true;
    state.report(KIND.exit, Uint8Array.of(exitStatus(code)));
  } catch (error) {
    state.unwound = true;
    if (state.cancelled) state.report(KIND.exit, Uint8Array.of(1));
    else if (isolate.isDisposed && !state.disposedHere)
      state.report(KIND.memory, new Uint8Array(0));
    else if (started) state.report(KIND.exit, Uint8Array.of(1));
    else {
      const text = error instanceof Error ? error.message : String(error);
      state.report(KIND.error, new TextEncoder().encode(text).subarray(0, MAX_ERROR_TEXT));
    }
  } finally {
    forget();
  }
}
function cancel(id) {
  const state = live.get(id);
  if (state === void 0 || state.reported) return;
  state.cancelled = true;
  state.disposedHere = true;
  if (!state.isolate.isDisposed) state.isolate.dispose();
  setTimeout(() => state.unwound || retire(), STUCK_GRACE_MS).unref();
}
var pending = [];
process.stdin.setEncoding("utf8");
process.stdin.on("data", (data) => {
  let from = 0;
  for (let nl = data.indexOf("\n"); nl >= 0; nl = data.indexOf("\n", from)) {
    pending.push(data.slice(from, nl));
    const request = JSON.parse(pending.join(""));
    pending = [];
    from = nl + 1;
    if (request.type === "run") void run(request);
    else cancel(request.call);
  }
  if (from < data.length) pending.push(data.slice(from));
});
process.stdin.on("end", die);
