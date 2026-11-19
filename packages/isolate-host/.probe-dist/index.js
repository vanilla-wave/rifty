import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

// src/pool.ts

// src/protocol.ts
var FRAME_CHANNEL_FD = 3;
var MAX_ERROR_TEXT = 4096;
var KIND = { output: 1, exit: 2, memory: 3, error: 4, retire: 5 };
var HEADER = 9;
var SHARD = 4;
var FrameReader = class {
  /** `maxPayload(kind, call)` → the largest payload this frame may legally have now, or a violation. */
  constructor(maxPayload) {
    this.maxPayload = maxPayload;
  }
  maxPayload;
  #buf = new Uint8Array(0);
  #len = 0;
  /**
   * Feed bytes, handing each complete frame to `onFrame` as it is parsed, so
   * parsing and handling interleave (the caller ignores frames once it gave up
   * on the worker). Returns a violation, or null.
   */
  push(chunk, onFrame) {
    if (this.#len + chunk.byteLength > this.#buf.byteLength) {
      const grown = new Uint8Array(
        Math.max(this.#len + chunk.byteLength, this.#buf.byteLength * 2, 64)
      );
      grown.set(this.#buf.subarray(0, this.#len));
      this.#buf = grown;
    }
    this.#buf.set(chunk, this.#len);
    this.#len += chunk.byteLength;
    let at = 0;
    while (this.#len - at >= HEADER) {
      const view = new DataView(this.#buf.buffer, at, HEADER);
      const length = view.getUint32(0);
      const kind = view.getUint8(4);
      const call = view.getUint32(5);
      const max = this.maxPayload(kind, call);
      if (typeof max === "string") return max;
      if (length > max) return `frame length ${length} > ${max}`;
      if (this.#len - at - HEADER < length) break;
      const payload = this.#buf.slice(at + HEADER, at + HEADER + length);
      at += HEADER + length;
      const bad = onFrame(kind, call, payload);
      if (bad !== void 0) return bad;
    }
    this.#buf.copyWithin(0, at, this.#len);
    this.#len -= at;
    if (this.#buf.byteLength > 4096 && this.#len < this.#buf.byteLength / 4) {
      this.#buf = this.#buf.slice(0, Math.max(this.#len, 64));
    }
    return null;
  }
};

// src/pool.ts
var WORKER_ENTRY = fileURLToPath(new URL("../dist/child.js", import.meta.url));
var CHANNEL_END_GRACE_MS = 50;
var MAX_CALL_ID = 2 ** 32 - 1;
var FdBytes = class {
  #buf = new Uint8Array(0);
  #len = 0;
  append(bytes) {
    if (this.#len + bytes.byteLength > this.#buf.byteLength) {
      const grown = new Uint8Array(
        Math.max(this.#len + bytes.byteLength, this.#buf.byteLength * 2, 4096)
      );
      grown.set(this.#buf.subarray(0, this.#len));
      this.#buf = grown;
    }
    this.#buf.set(bytes, this.#len);
    this.#len += bytes.byteLength;
  }
  text() {
    return Buffer.from(this.#buf.buffer, 0, this.#len).toString("utf8");
  }
};
var Call = class {
  constructor(id, spec, resolve, reject, onDeadline) {
    this.id = id;
    this.spec = spec;
    this.resolve = resolve;
    this.reject = reject;
    this.deadline = setTimeout(() => onDeadline(this), spec.timeoutMs);
  }
  id;
  spec;
  resolve;
  reject;
  out = new FdBytes();
  err = new FdBytes();
  /** What the consumer accepted in this attempt: the state each frame is judged against. */
  kept = 0;
  truncated = false;
  attempts = 0;
  settled = false;
  /** Settled here at the deadline; the worker still owes its terminal frame. */
  cancelled = false;
  /** Why the previous attempt's worker was lost. */
  lost;
  worker;
  deadline;
  /** A fresh attempt: nothing of the previous one reaches the result. */
  restart() {
    this.out = new FdBytes();
    this.err = new FdBytes();
    this.kept = 0;
    this.truncated = false;
    this.attempts++;
  }
  result(exitCode, termination) {
    return {
      stdout: this.out.text(),
      stderr: this.err.text(),
      exitCode,
      ...termination === void 0 ? {} : { termination },
      ...this.truncated ? { truncated: true } : {}
    };
  }
  resolveWith(result) {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.deadline);
    this.resolve(result);
  }
  rejectWith(error) {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.deadline);
    this.reject(error);
  }
};
function lostError(message) {
  return Object.assign(new Error(message), { code: "ERR_ISOLATE_HOST_WORKER_LOST" });
}
var Worker = class {
  constructor(pool2, solo) {
    this.pool = pool2;
    this.solo = solo;
    this.child = spawn(process.execPath, ["--no-node-snapshot", ...JSON.parse(process.getBuiltinModule("node:fs").readFileSync("/tmp/rjx/flags.json","utf8")), WORKER_ENTRY], {
      env: {},
      stdio: ["pipe", "ignore", "ignore", "pipe"]
    });
    const child = this.child;
    child.unref();
    const stdin = child.stdin;
    stdin?.unref();
    stdin?.on("error", () => {
    });
    const frames = child.stdio[FRAME_CHANNEL_FD];
    frames?.unref();
    frames?.on("error", () => {
    });
    const reader = new FrameReader((kind, call) => this.#maxPayload(kind, call));
    frames?.on("data", (chunk) => {
      if (this.ended !== void 0) return;
      const bad = reader.push(
        chunk,
        (kind, call, payload) => this.ended === void 0 ? this.#onFrame(kind, call, payload) : void 0
      );
      if (bad !== null) this.#violated(bad);
    });
    frames?.on("end", () => {
      setTimeout(() => {
        if (!this.dead && this.ended === void 0) {
          this.ended = { lost: "after closing its result channel without a result" };
          this.kill();
        }
      }, CHANNEL_END_GRACE_MS).unref();
    });
    child.on("exit", () => {
      this.exited = true;
    });
    child.on("error", (error) => {
      if (child.pid !== void 0 || this.dead) return;
      this.dead = true;
      this.pool.forget(this);
      for (const call of this.calls.values())
        call.rejectWith(
          call.lost === void 0 ? error : lostError(
            `${call.lost}; its rerun could not start (${String(error.code ?? error.message)})`
          )
        );
      this.calls.clear();
    });
    child.on("close", (code, signal) => this.#exited(code, signal));
  }
  pool;
  solo;
  /** Calls placed here that have no terminal frame yet. */
  calls = /* @__PURE__ */ new Map();
  retiring = false;
  dead = false;
  exited = false;
  /**
   * Why the consumer itself ended this worker; unset = an exit nobody asked for.
   * `done`: nothing left on it (idle, retired, solo finished).
   */
  ended;
  child;
  send(request) {
    this.child.stdin?.write(`${JSON.stringify(request)}
`);
  }
  place(call) {
    call.worker = this;
    this.calls.set(call.id, call);
    const { code, memoryLimitMb, maxOutputBytes } = call.spec;
    const request = {
      type: "run",
      call: call.id,
      code,
      memoryLimitMb,
      maxOutputBytes,
      ...this.solo ? { solo: true } : {}
    };
    this.send(request);
  }
  kill() {
    this.child.kill("SIGKILL");
  }
  /** Nothing left to do here: from now on no call is placed on it, and its exit loses nothing. */
  end() {
    if (this.ended !== void 0) return;
    this.ended = { done: true };
    this.kill();
  }
  /** Largest payload a frame may carry now, or the violation. */
  #maxPayload(kind, id) {
    if (kind === KIND.retire) return id === 0 ? 0 : `retire for call ${id}`;
    const call = this.calls.get(id);
    if (call === void 0) return `frame for call ${id}, not in flight on this worker`;
    switch (kind) {
      case KIND.output:
        return 2 + (call.spec.maxOutputBytes - call.kept);
      case KIND.exit:
        return 1;
      case KIND.memory:
        return 0;
      case KIND.error:
        return MAX_ERROR_TEXT;
      default:
        return `frame kind ${kind}`;
    }
  }
  /** One frame within its size bound, judged against the call's state; a string is the violation. */
  #onFrame(kind, id, p) {
    if (kind === KIND.retire) {
      this.retiring = true;
      this.pool.settleWorker(this);
      return void 0;
    }
    const call = this.calls.get(id);
    if (kind === KIND.output) {
      const fd = p[0];
      const truncated = p[1] === 0 ? false : p[1] === 1 ? true : null;
      if (p.byteLength < 2 || fd !== 1 && fd !== 2 || truncated === null) return "output header";
      const bytes = p.subarray(2);
      if (call.truncated && !truncated) return "output truncation reverted";
      if (bytes.byteLength === 0 && !(truncated && !call.truncated))
        return "output without new bytes";
      call.truncated ||= truncated;
      call.kept += bytes.byteLength;
      if (!call.cancelled) (fd === 2 ? call.err : call.out).append(bytes);
      return void 0;
    }
    if (kind === KIND.exit && p.byteLength !== 1) return "exit payload";
    this.calls.delete(id);
    if (kind === KIND.exit) call.resolveWith(call.result(p[0]));
    else if (kind === KIND.memory) call.resolveWith(call.result(null, "memory"));
    else if (kind === KIND.error)
      call.rejectWith(new Error(`isolate-host child failed: ${new TextDecoder().decode(p)}`));
    this.pool.settleWorker(this);
    return void 0;
  }
  /** A hostile worker: it ends, and every call still on it rejects. No rerun. */
  #violated(what) {
    if (this.ended !== void 0) return;
    this.ended = { violation: what };
    this.kill();
    for (const call of this.calls.values())
      call.rejectWith(new Error(`isolate-host child protocol violation: ${what}`));
  }
  #exited(code, signal) {
    if (this.dead) return;
    this.dead = true;
    this.pool.forget(this);
    const ended = this.ended;
    if (ended !== void 0 && "violation" in ended) return;
    const detail = ended !== void 0 && "lost" in ended ? ` ${ended.lost}` : "";
    const reason = `isolate-host child exited unexpectedly (code ${code}, signal ${signal})${detail}`;
    const lost = [...this.calls.values()].filter((call) => !call.settled);
    this.calls.clear();
    this.pool.rerun(lost, reason);
  }
};
var Pool = class {
  #workers = [];
  #nextId = 1;
  run(spec) {
    return new Promise((resolve, reject) => {
      const id = this.#nextId;
      this.#nextId = id === MAX_CALL_ID ? 1 : id + 1;
      const call = new Call(id, spec, resolve, reject, (c) => this.#deadline(c));
      call.restart();
      try {
        this.#placeFresh(call);
      } catch (error) {
        call.rejectWith(error);
      }
    });
  }
  /** Packed: the oldest worker with a free slot that takes fresh calls, else a new one. */
  #placeFresh(call) {
    const worker = this.#workers.find(
      (w) => !w.solo && !w.retiring && !w.exited && w.ended === void 0 && w.calls.size < SHARD
    ) ?? this.#spawn(false);
    worker.place(call);
  }
  #spawn(solo) {
    const worker = new Worker(this, solo);
    this.#workers.push(worker);
    return worker;
  }
  /**
   * The calls of a lost worker with no culprit: each reruns once, alone, on a
   * solo worker (I5, ADR-0563 Corrections 2026-11-19). There any exhaustion is
   * that call's own: an RSS crossing is its `memory`. Processes at most equal the
   * calls lost: never more than one process per call.
   */
  rerun(lost, reason) {
    for (const call of lost) {
      if (call.attempts >= 2) {
        call.rejectWith(lostError(reason));
        continue;
      }
      call.lost = reason;
      call.restart();
      try {
        this.#spawn(true).place(call);
      } catch {
        call.rejectWith(lostError(reason));
      }
    }
  }
  #deadline(call) {
    if (call.lost !== void 0)
      call.rejectWith(lostError(`${call.lost}; its rerun did not finish within timeoutMs`));
    else call.resolveWith(call.result(null, "timeout"));
    const worker = call.worker;
    if (worker === void 0 || worker.dead || !worker.calls.has(call.id)) return;
    call.cancelled = true;
    worker.send({ type: "cancel", call: call.id });
    this.settleWorker(worker);
  }
  /** After a call or the worker's state changed: end what has nothing left to do. */
  settleWorker(worker) {
    if (worker.dead || worker.ended !== void 0) return;
    const unsettled = [...worker.calls.values()].some((call) => !call.settled);
    if (unsettled) return;
    if (worker.retiring || worker.solo) {
      worker.end();
      return;
    }
    if (worker.calls.size > 0) return;
    const idle = this.#workers.filter(
      (w) => !w.solo && !w.retiring && w.ended === void 0 && w.calls.size === 0
    );
    if (idle.length > 1) worker.end();
  }
  forget(worker) {
    const at = this.#workers.indexOf(worker);
    if (at >= 0) this.#workers.splice(at, 1);
  }
};

// src/run-code.ts
var MAX_TIMER_MS = 2 ** 31 - 1;
function limit(name, value, fallback, min, max = Number.MAX_SAFE_INTEGER) {
  if (value === void 0) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw Object.assign(
      new RangeError(
        `The "options.${name}" must be a finite number in ${min}..${max}. Received ${String(value)}`
      ),
      { code: "ERR_OUT_OF_RANGE" }
    );
  }
  return value;
}
var pool;
function runCode(code, options = {}) {
  if (typeof code !== "string") {
    return Promise.reject(
      Object.assign(new TypeError('The "code" argument must be of type string'), {
        code: "ERR_INVALID_ARG_TYPE"
      })
    );
  }
  try {
    const spec = {
      code,
      timeoutMs: limit("timeoutMs", options.timeoutMs, 3e4, 1, MAX_TIMER_MS),
      memoryLimitMb: limit("memoryLimitMb", options.memoryLimitMb, 256, 8),
      maxOutputBytes: Math.floor(limit("maxOutputBytes", options.maxOutputBytes, 1 << 20, 0))
    };
    pool ??= new Pool();
    return pool.run(spec);
  } catch (error) {
    return Promise.reject(error);
  }
}

export { runCode };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map