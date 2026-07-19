import { Buffer } from 'node:buffer';

function refuse(note) {
  return { ok: false, note };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

const LEDGER_DIAGNOSTIC_RECORDS = 8;
const LEDGER_DIAGNOSTIC_MAX_LENGTH = 4_096;
const TRACKED_REQUEST_POST_DATA_MAX_BYTES = 16 * 1024;

function boundedDiagnosticString(value, maxLength) {
  if (typeof value !== 'string') return undefined;
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function diagnosticUrl(value) {
  const bounded = boundedDiagnosticString(value, 160);
  if (bounded === undefined) return undefined;
  try {
    const url = new URL(bounded);
    if (url.username !== '') url.username = '<redacted>';
    if (url.password !== '') url.password = '<redacted>';
    if (url.search !== '') url.search = '?<redacted>';
    return url.href;
  } catch {
    return bounded;
  }
}

function diagnosticRecord(record) {
  const value = record !== null && typeof record === 'object' ? record : {};
  return {
    requestId: boundedDiagnosticString(value.requestId, 48),
    lifecycleId: boundedDiagnosticString(value.lifecycleId, 64),
    method: boundedDiagnosticString(value.method, 16),
    url: diagnosticUrl(value.url),
    status: typeof value.status === 'number' ? value.status : undefined,
    protocol: boundedDiagnosticString(value.protocol, 16),
    bodyBytes: typeof value.bodyBytes === 'number' ? value.bodyBytes : undefined,
    observedDataBytes:
      typeof value.observedDataBytes === 'number' ? value.observedDataBytes : undefined,
    complete: value.complete === true,
    fromDiskCache: value.fromDiskCache === true,
    fromServiceWorker: value.fromServiceWorker === true,
    requestServedFromCache: value.requestServedFromCache === true,
    fromPrefetchCache: value.fromPrefetchCache === true,
    error: boundedDiagnosticString(value.error, 120),
  };
}

/** Bounded metadata-only ledger for refusal diagnostics; never includes response bodies. */
export function describeCapturedResponseLedger(captured) {
  if (!Array.isArray(captured)) throw new TypeError('captured CDP responses must be an array');
  const records = captured.slice(0, LEDGER_DIAGNOSTIC_RECORDS).map(diagnosticRecord);
  const prefix = `captured=${captured.length}; shown=${records.length}; ledger=`;
  const omitted = Math.max(0, captured.length - records.length);
  const suffix = `; omitted=${omitted}`;
  const available = LEDGER_DIAGNOSTIC_MAX_LENGTH - prefix.length - suffix.length;
  const serialized = JSON.stringify(records);
  const ledger =
    serialized.length <= available ? serialized : `${serialized.slice(0, available - 1)}…`;
  return `${prefix}${ledger}${suffix}`;
}

function responseRecord(requestId, response, lifecycleId = requestId, method = 'unknown') {
  return {
    requestId,
    ...(lifecycleId !== requestId ? { lifecycleId } : {}),
    method,
    url: typeof response?.url === 'string' ? response.url : '',
    status: typeof response?.status === 'number' ? response.status : 0,
    protocol:
      typeof response?.protocol === 'string' && response.protocol.length > 0
        ? response.protocol
        : 'unknown',
    bodyBytes: 0,
    complete: false,
    fromDiskCache: response?.fromDiskCache === true,
    fromServiceWorker: response?.fromServiceWorker === true,
    ...(response?.fromPrefetchCache === true ? { fromPrefetchCache: true } : {}),
  };
}

function appendError(record, message) {
  record.error =
    typeof record.error === 'string' && record.error.length > 0
      ? `${record.error}; ${message}`
      : message;
}

function strictBase64Bytes(value) {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u.test(value)
  ) {
    throw new TypeError('CDP returned malformed base64 response body');
  }
  return Buffer.from(value, 'base64');
}

function decodedBody(result) {
  if (
    result === null ||
    typeof result !== 'object' ||
    typeof result.body !== 'string' ||
    typeof result.base64Encoded !== 'boolean'
  ) {
    throw new TypeError('CDP returned an invalid Network.getResponseBody result');
  }
  if (!result.base64Encoded) {
    return {
      bytes: new TextEncoder().encode(result.body),
      text: result.body,
    };
  }
  const bytes = strictBase64Bytes(result.body);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Binary response: exact byte count is the required evidence.
  }
  return { bytes, text };
}

function streamedBody(chunks) {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.byteLength;
    if (!Number.isSafeInteger(total)) throw new RangeError('CDP streamed body size is unsafe');
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Binary response: exact byte count is the required evidence.
  }
  return { bytes, text };
}

function loadingFailure(event) {
  const parts = [
    `Network.loadingFailed: ${
      typeof event?.errorText === 'string' && event.errorText.length > 0
        ? event.errorText
        : 'unknown network error'
    }`,
  ];
  if (event?.canceled === true) parts.push('canceled');
  if (typeof event?.blockedReason === 'string') parts.push(`blocked=${event.blockedReason}`);
  if (event?.corsErrorStatus !== undefined) {
    parts.push(`cors=${JSON.stringify(event.corsErrorStatus)}`);
  }
  return parts.join('; ');
}

function cdpSessionPort(session) {
  if (
    session === null ||
    typeof session !== 'object' ||
    typeof session.on !== 'function' ||
    typeof session.off !== 'function' ||
    typeof session.send !== 'function' ||
    typeof session.detach !== 'function'
  ) {
    throw new TypeError('Playwright CDP session does not expose the required Network port');
  }
  return session;
}

const NETWORK_EVENTS = Object.freeze([
  'Network.requestWillBeSent',
  'Network.responseReceived',
  'Network.requestServedFromCache',
  'Network.dataReceived',
  'Network.loadingFinished',
  'Network.loadingFailed',
]);
const NETWORK_BODY_BUFFERS = Object.freeze({
  maxTotalBufferSize: 256 * 1024 * 1024,
  maxResourceBufferSize: 128 * 1024 * 1024,
});
const DISCOVERED_NETWORK_TARGET_TYPES = new Set(['shared_worker', 'service_worker']);

function targetSessionError(value) {
  const message =
    value !== null && typeof value === 'object' && typeof value.message === 'string'
      ? value.message
      : 'unknown target protocol error';
  return new Error(`CDP target session failed: ${message}`);
}

class TargetMessageSession {
  #detached = false;
  #failure;
  #listeners = new Map();
  #nextCommandId = 0;
  #pending = new Map();
  #root;
  #sessionId;

  constructor(root, sessionId, failure) {
    this.#root = root;
    this.#sessionId = sessionId;
    this.#failure = failure;
  }

  get sessionId() {
    return this.#sessionId;
  }

  on(event, listener) {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
  }

  off(event, listener) {
    this.#listeners.get(event)?.delete(listener);
  }

  send(method, params) {
    if (this.#detached) return Promise.reject(new Error('CDP target session is detached'));
    const id = ++this.#nextCommandId;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { reject, resolve });
      void this.#root
        .send('Target.sendMessageToTarget', {
          sessionId: this.#sessionId,
          message: JSON.stringify({ id, method, params: params ?? {} }),
        })
        .catch((error) => {
          this.#pending.delete(id);
          reject(error);
        });
    });
  }

  receive(message) {
    if (this.#detached) return;
    let value;
    try {
      value = JSON.parse(message);
    } catch (error) {
      this.#fail(new Error('CDP target emitted malformed protocol JSON', { cause: error }));
      return;
    }
    if (Number.isSafeInteger(value?.id)) {
      const pending = this.#pending.get(value.id);
      if (pending === undefined) return;
      this.#pending.delete(value.id);
      if (value.error !== undefined) pending.reject(targetSessionError(value.error));
      else pending.resolve(value.result ?? {});
      return;
    }
    if (typeof value?.method !== 'string') {
      this.#fail(new Error('CDP target emitted a protocol message without method or id'));
      return;
    }
    for (const listener of this.#listeners.get(value.method) ?? []) {
      try {
        listener(value.params ?? {});
      } catch (error) {
        this.#fail(error);
      }
    }
  }

  markDetached() {
    if (this.#detached) return;
    this.#detached = true;
    const error = new Error('CDP target detached before pending commands settled');
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  async detach() {
    if (this.#detached) return;
    await this.#root.send('Target.detachFromTarget', { sessionId: this.#sessionId });
    this.markDetached();
  }

  #fail(error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.#failure(normalized);
    this.markDetached();
  }
}

function namespacedRequestId(sessionKey, requestId) {
  return `${sessionKey}\u0000${requestId}`;
}

class BrowserTargetNetworkSession {
  #attachmentOperations = new Set();
  #attachmentTargets = new Set();
  #contextId;
  #failures = [];
  #listeners = new Map();
  #networkEnabled = false;
  #networkEnabledSessions = new WeakSet();
  #pageSession;
  #requestRoutes = new Map();
  #root;
  #sessionBindings = new Map();
  #sessions = new Map();
  #sessionsByTarget = new Map();
  #stopping = false;
  #waitingForDebugger = new Set();

  constructor({ contextId, pageSession, pageTargetId, root }) {
    this.#contextId = contextId;
    this.#pageSession = pageSession;
    this.#root = root;
    this.#addSession(`page:${pageTargetId}`, pageSession);
  }

  async start() {
    this.#pageSession.on('Target.attachedToTarget', this.#onAutoAttachedTarget);
    this.#pageSession.on('Target.detachedFromTarget', this.#onDetachedFromTarget);
    this.#pageSession.on('Target.receivedMessageFromTarget', this.#onTargetMessage);
    this.#root.on('Target.targetCreated', this.#onTargetCreated);
    this.#root.on('Target.targetDestroyed', this.#onTargetDestroyed);
    this.#root.on('Target.detachedFromTarget', this.#onDetachedFromTarget);
    this.#root.on('Target.receivedMessageFromTarget', this.#onTargetMessage);
    await this.#pageSession.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: false,
      filter: [{ type: 'worker' }, { exclude: true }],
    });
    await this.#root.send('Target.setDiscoverTargets', { discover: true });
    const result = await this.#root.send('Target.getTargets');
    for (const targetInfo of result?.targetInfos ?? []) this.#scheduleAttachment(targetInfo);
    await this.#drainAttachments();
    this.#throwFailures('CDP target discovery failed');
    return this;
  }

  on(event, listener) {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
  }

  off(event, listener) {
    this.#listeners.get(event)?.delete(listener);
  }

  async send(method, params) {
    if (method === 'Network.enable') {
      this.#networkEnabled = true;
      await this.#drainAttachments();
      await Promise.all(
        [...this.#sessions.values()].map((session) => this.#enableSession(session)),
      );
      await this.#drainAttachments();
      this.#throwFailures('CDP target Network enable failed');
      return {};
    }
    if (method === 'Network.getResponseBody' || method === 'Network.streamResourceContent') {
      const route = this.#requestRoutes.get(params?.requestId);
      if (route === undefined) throw new Error('CDP response body request has no target route');
      return route.session.send(method, { requestId: route.requestId });
    }
    throw new Error(`unsupported multiplexed CDP command ${method}`);
  }

  async detach() {
    if (this.#stopping) return;
    this.#stopping = true;
    this.#root.off('Target.targetCreated', this.#onTargetCreated);
    this.#root.off('Target.targetDestroyed', this.#onTargetDestroyed);
    const cleanupFailures = [];
    await this.#drainAttachments();
    for (const session of [...this.#waitingForDebugger]) {
      try {
        await this.#resumeSession(session);
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    try {
      await this.#pageSession.send('Target.setAutoAttach', {
        autoAttach: false,
        waitForDebuggerOnStart: false,
        flatten: false,
      });
    } catch (error) {
      cleanupFailures.push(error);
    }
    try {
      await this.#root.send('Target.setDiscoverTargets', { discover: false });
    } catch (error) {
      cleanupFailures.push(error);
    }
    for (const [key, session] of this.#sessions) {
      if (session === this.#pageSession) continue;
      try {
        await session.detach();
      } catch (error) {
        cleanupFailures.push(new Error(`failed to detach CDP target ${key}`, { cause: error }));
      }
    }
    this.#pageSession.off('Target.attachedToTarget', this.#onAutoAttachedTarget);
    this.#pageSession.off('Target.detachedFromTarget', this.#onDetachedFromTarget);
    this.#pageSession.off('Target.receivedMessageFromTarget', this.#onTargetMessage);
    this.#root.off('Target.detachedFromTarget', this.#onDetachedFromTarget);
    this.#root.off('Target.receivedMessageFromTarget', this.#onTargetMessage);
    try {
      await this.#pageSession.detach();
    } catch (error) {
      cleanupFailures.push(error);
    }
    try {
      await this.#root.detach();
    } catch (error) {
      cleanupFailures.push(error);
    }
    cleanupFailures.push(...this.#failures);
    if (cleanupFailures.length > 0) {
      throw new AggregateError(cleanupFailures, 'CDP target recorder cleanup failed');
    }
  }

  #addSession(key, session) {
    if (this.#sessions.has(key)) return;
    this.#sessions.set(key, session);
    const bindings = new Map();
    for (const event of NETWORK_EVENTS) {
      const binding = (payload) => {
        if (typeof payload?.requestId !== 'string') return;
        const requestId = namespacedRequestId(key, payload.requestId);
        this.#requestRoutes.set(requestId, {
          requestId: payload.requestId,
          session,
        });
        const routed = { ...payload, rawRequestId: payload.requestId, requestId };
        for (const listener of this.#listeners.get(event) ?? []) listener(routed);
      };
      bindings.set(event, binding);
      session.on(event, binding);
    }
    this.#sessionBindings.set(session, bindings);
  }

  #removeSession(key, session) {
    const bindings = this.#sessionBindings.get(session);
    if (bindings !== undefined) {
      for (const [event, binding] of bindings) session.off(event, binding);
      this.#sessionBindings.delete(session);
    }
    this.#waitingForDebugger.delete(session);
    this.#sessions.delete(key);
  }

  async #enableSession(session) {
    if (this.#networkEnabledSessions.has(session)) {
      await this.#resumeSession(session);
      return;
    }
    let failure;
    try {
      await session.send('Network.enable', NETWORK_BODY_BUFFERS);
      this.#networkEnabledSessions.add(session);
    } catch (error) {
      failure = error;
    }
    try {
      await this.#resumeSession(session);
    } catch (error) {
      failure =
        failure === undefined
          ? error
          : new AggregateError([failure, error], 'CDP worker setup and resume failed');
    }
    if (failure !== undefined) throw failure;
  }

  async #resumeSession(session) {
    if (!this.#waitingForDebugger.delete(session)) return;
    await session.send('Runtime.runIfWaitingForDebugger');
  }

  #scheduleAttachment(targetInfo) {
    if (
      this.#stopping ||
      targetInfo?.browserContextId !== this.#contextId ||
      !DISCOVERED_NETWORK_TARGET_TYPES.has(targetInfo?.type) ||
      typeof targetInfo?.targetId !== 'string' ||
      this.#sessionsByTarget.has(targetInfo.targetId) ||
      this.#attachmentTargets.has(targetInfo.targetId)
    ) {
      return;
    }
    const targetId = targetInfo.targetId;
    this.#attachmentTargets.add(targetId);
    const operation = (async () => {
      const attached = await this.#root.send('Target.attachToTarget', {
        targetId,
        flatten: false,
      });
      if (typeof attached?.sessionId !== 'string') {
        throw new Error(`CDP target ${targetId} attachment omitted sessionId`);
      }
      const session = new TargetMessageSession(this.#root, attached.sessionId, (error) =>
        this.#failures.push(error),
      );
      this.#sessionsByTarget.set(targetId, session);
      this.#addSession(`target:${targetId}`, session);
      if (this.#networkEnabled) await this.#enableSession(session);
    })()
      .catch((error) => {
        this.#failures.push(
          new Error(`failed to attach CDP network target ${targetId}`, { cause: error }),
        );
      })
      .finally(() => {
        this.#attachmentOperations.delete(operation);
        this.#attachmentTargets.delete(targetId);
      });
    this.#attachmentOperations.add(operation);
  }

  async #drainAttachments() {
    while (this.#attachmentOperations.size > 0) {
      await Promise.all([...this.#attachmentOperations]);
    }
  }

  #throwFailures(message) {
    if (this.#failures.length === 0) return;
    throw new AggregateError([...this.#failures], message);
  }

  #onTargetCreated = (event) => this.#scheduleAttachment(event?.targetInfo);

  #onAutoAttachedTarget = (event) => {
    const targetInfo = event?.targetInfo;
    if (
      this.#stopping ||
      targetInfo?.type !== 'worker' ||
      typeof targetInfo?.targetId !== 'string' ||
      typeof event?.sessionId !== 'string' ||
      this.#sessionsByTarget.has(targetInfo.targetId)
    ) {
      return;
    }
    const targetId = targetInfo.targetId;
    const session = new TargetMessageSession(this.#pageSession, event.sessionId, (error) =>
      this.#failures.push(error),
    );
    this.#sessionsByTarget.set(targetId, session);
    this.#addSession(`target:${targetId}`, session);
    if (event?.waitingForDebugger === true) this.#waitingForDebugger.add(session);
    if (!this.#networkEnabled) return;
    const operation = this.#enableSession(session)
      .catch((error) => {
        this.#failures.push(
          new Error(`failed to enable auto-attached Worker target ${targetId}`, { cause: error }),
        );
      })
      .finally(() => this.#attachmentOperations.delete(operation));
    this.#attachmentOperations.add(operation);
  };

  #onTargetDestroyed = (event) => {
    const targetId = event?.targetId;
    if (typeof targetId !== 'string') return;
    const session = this.#sessionsByTarget.get(targetId);
    if (session === undefined) return;
    this.#sessionsByTarget.delete(targetId);
    this.#removeSession(`target:${targetId}`, session);
    session.markDetached();
  };

  #onDetachedFromTarget = (event) => {
    if (typeof event?.sessionId !== 'string') return;
    for (const [targetId, session] of this.#sessionsByTarget) {
      if (session.sessionId !== event.sessionId) continue;
      this.#sessionsByTarget.delete(targetId);
      this.#removeSession(`target:${targetId}`, session);
      session.markDetached();
      break;
    }
  };

  #onTargetMessage = (event) => {
    if (typeof event?.sessionId !== 'string' || typeof event?.message !== 'string') return;
    for (const session of this.#sessionsByTarget.values()) {
      if (session.sessionId === event.sessionId) {
        session.receive(event.message);
        return;
      }
    }
  };
}

async function cdpNetworkSession(page) {
  const context = typeof page?.context === 'function' ? page.context() : null;
  if (context === null || typeof context.newCDPSession !== 'function') {
    throw new TypeError('Playwright page must expose context().newCDPSession()');
  }
  const pageSession = cdpSessionPort(await context.newCDPSession(page));
  const browser = typeof context.browser === 'function' ? context.browser() : null;
  if (browser === null || typeof browser?.newBrowserCDPSession !== 'function') return pageSession;

  let target;
  let root;
  let multiplexed;
  try {
    target = await pageSession.send('Target.getTargetInfo');
    root = cdpSessionPort(await browser.newBrowserCDPSession());
    const targetInfo = target?.targetInfo;
    if (
      typeof targetInfo?.targetId !== 'string' ||
      typeof targetInfo?.browserContextId !== 'string'
    ) {
      throw new Error('page CDP target omitted browser-context identity');
    }
    multiplexed = new BrowserTargetNetworkSession({
      contextId: targetInfo.browserContextId,
      pageSession,
      pageTargetId: targetInfo.targetId,
      root,
    });
    return await multiplexed.start();
  } catch (error) {
    if (multiplexed !== undefined) await multiplexed.detach().catch(() => {});
    else {
      await root?.detach().catch(() => {});
      await pageSession.detach().catch(() => {});
    }
    throw error;
  }
}

/**
 * Record complete CDP response bodies without projecting away retries,
 * redirects, or failures. stop() drains every body command before detaching.
 */
export async function startCdpResponseRecorder(page, options = {}) {
  const captureUrl = options.captureUrl ?? (() => true);
  const captureRequest = options.captureRequest;
  if (typeof captureUrl !== 'function') {
    throw new TypeError('CDP response recorder captureUrl must be a function');
  }
  if (captureRequest !== undefined && typeof captureRequest !== 'function') {
    throw new TypeError('CDP response recorder captureRequest must be a function');
  }
  const session = cdpSessionPort(await cdpNetworkSession(page));
  const captured = [];
  const active = new Map();
  const requestMethods = new Map();
  const requestPostData = new Map();
  const requestPostDataFailures = new Map();
  const requestDecisions = new Map();
  const requestStarts = new Set();
  const requestUrls = new Map();
  const requestServedFromCache = new Set();
  const responseStreams = new Map();
  const tracked = new Set();
  const unsettledStarted = new Set();
  const terminalWaiters = new Set();
  const requestMetadata = new WeakSet();
  const responseMetadata = new WeakSet();
  const pending = new Set();
  let stopping = false;
  let stopPromise;

  const retainIncomplete = (record, message) => {
    record.bodyBytes = 0;
    record.complete = false;
    // A stale text body must never survive a later lifecycle failure.
    // biome-ignore lint/performance/noDelete: record shape intentionally omits unavailable body text.
    delete record.bodyText;
    appendError(record, message);
  };

  const publicRequestId = (event) =>
    typeof event?.rawRequestId === 'string' ? event.rawRequestId : event.requestId;

  const track = (requestId, url) => {
    if (tracked.has(requestId)) return true;
    if (typeof url !== 'string' || captureUrl(url) !== true) return false;
    tracked.add(requestId);
    return true;
  };

  const applyRequestCacheSignal = (requestId, record) => {
    if (!requestServedFromCache.delete(requestId)) return;
    record.requestServedFromCache = true;
  };

  const applyRequestPostData = (requestId, record) => {
    const postData = requestPostData.get(requestId);
    if (postData !== undefined) record.postData = postData;
    const failure = requestPostDataFailures.get(requestId);
    if (failure !== undefined) appendError(record, failure);
  };

  const forgetRequest = (requestId) => {
    requestMethods.delete(requestId);
    requestPostData.delete(requestId);
    requestPostDataFailures.delete(requestId);
    requestStarts.delete(requestId);
    requestUrls.delete(requestId);
    requestDecisions.delete(requestId);
  };

  const notifyTerminal = (requestId) => {
    if (!unsettledStarted.delete(requestId)) return;
    if (unsettledStarted.size !== 0) return;
    for (const resolve of terminalWaiters) resolve();
    terminalWaiters.clear();
  };

  const waitForStartedTerminals = async (timeoutMs) => {
    if (unsettledStarted.size === 0) return true;
    let timer;
    let resolveTerminal;
    const terminal = new Promise((resolve) => {
      resolveTerminal = resolve;
      terminalWaiters.add(resolve);
    });
    try {
      return await Promise.race([
        terminal.then(() => true),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      terminalWaiters.delete(resolveTerminal);
    }
  };

  const retainPending = (operation) => {
    pending.add(operation);
    void operation.finally(() => pending.delete(operation));
  };

  const bodyStream = (requestId) => {
    let stream = responseStreams.get(requestId);
    if (stream === undefined) {
      stream = {
        buffered: new Uint8Array(),
        chunks: [],
        dataBytes: 0,
        enabled: false,
        integrityFailure: undefined,
        setup: undefined,
        ready: undefined,
      };
      responseStreams.set(requestId, stream);
    }
    return stream;
  };

  const attemptBodyStream = (requestId, stream) => {
    const setup = session
      .send('Network.streamResourceContent', { requestId })
      .then((result) => {
        if (
          result === null ||
          typeof result !== 'object' ||
          typeof result.bufferedData !== 'string'
        ) {
          throw new TypeError('CDP returned an invalid Network.streamResourceContent result');
        }
        const buffered = strictBase64Bytes(result.bufferedData);
        if (!stream.enabled) {
          stream.buffered = buffered;
          stream.enabled = true;
        }
      })
      .catch(() => {});
    stream.setup = setup;
    return setup;
  };

  const startBodyStream = (requestId) => {
    const stream = bodyStream(requestId);
    if (stream.setup !== undefined) return;
    const retained = attemptBodyStream(requestId, stream);
    retainPending(retained);
  };

  const ensureResponseBodyStream = (requestId) => {
    const stream = bodyStream(requestId);
    const ready = (stream.setup ?? Promise.resolve()).then(async () => {
      if (!stream.enabled) await attemptBodyStream(requestId, stream);
    });
    stream.ready = ready;
    retainPending(ready);
  };

  const onRequestWillBeSent = (event) => {
    if (stopping || typeof event?.requestId !== 'string') return;
    const requestId = event.requestId;
    const requestUrl = typeof event.request?.url === 'string' ? event.request.url : undefined;
    const redirectUrl =
      typeof event.redirectResponse?.url === 'string' ? event.redirectResponse.url : undefined;
    const inherited = tracked.has(requestId);
    const decision =
      inherited ||
      (captureRequest === undefined
        ? typeof requestUrl === 'string' && captureUrl(requestUrl) === true
        : captureRequest(event.request ?? {}) === true);
    requestDecisions.set(requestId, decision);
    if (!decision && !inherited) return;
    tracked.add(requestId);
    if (event.redirectResponse !== undefined) {
      const redirect = event.redirectResponse;
      const prior = active.get(requestId);
      if (prior !== undefined && prior.url === redirect?.url && prior.status === redirect?.status) {
        applyRequestCacheSignal(requestId, prior);
        retainIncomplete(
          prior,
          'redirect response body is unavailable through an unambiguous CDP lifecycle',
        );
      } else {
        if (prior !== undefined) {
          retainIncomplete(
            prior,
            'response lifecycle was replaced before Network.loadingFinished/loadingFailed',
          );
        }
        const record = responseRecord(
          publicRequestId(event),
          redirect,
          event.requestId,
          requestMethods.get(requestId),
        );
        applyRequestCacheSignal(requestId, record);
        applyRequestPostData(requestId, record);
        retainIncomplete(
          record,
          'redirect response body is unavailable through an unambiguous CDP lifecycle',
        );
        captured.push(record);
      }
      active.delete(requestId);
      responseStreams.delete(requestId);
    }
    if (requestUrl !== undefined) requestUrls.set(requestId, requestUrl);
    const requestMethod =
      typeof event.request?.method === 'string' && event.request.method.length > 0
        ? event.request.method
        : 'unknown';
    requestMethods.set(requestId, requestMethod);
    const postData = event.request?.postData;
    if (typeof postData === 'string') {
      const bytes = new TextEncoder().encode(postData).byteLength;
      if (bytes <= TRACKED_REQUEST_POST_DATA_MAX_BYTES) requestPostData.set(requestId, postData);
      else {
        requestPostDataFailures.set(
          requestId,
          `request postData exceeded ${TRACKED_REQUEST_POST_DATA_MAX_BYTES} bytes`,
        );
      }
    }
    requestStarts.add(requestId);
    if (event.redirectResponse === undefined) unsettledStarted.add(requestId);
    startBodyStream(requestId);
  };

  const onResponseReceived = (event) => {
    if (stopping || typeof event?.requestId !== 'string') return;
    const decision = requestDecisions.get(event.requestId);
    if (decision === false) return;
    if (!track(event.requestId, event.response?.url)) return;
    const prior = active.get(event.requestId);
    if (prior !== undefined) {
      retainIncomplete(
        prior,
        'response lifecycle was replaced before Network.loadingFinished/loadingFailed',
      );
    }
    const record = responseRecord(
      publicRequestId(event),
      event.response,
      event.requestId,
      requestMethods.get(event.requestId),
    );
    applyRequestCacheSignal(event.requestId, record);
    applyRequestPostData(event.requestId, record);
    captured.push(record);
    active.set(event.requestId, record);
    responseMetadata.add(record);
    if (requestStarts.has(event.requestId)) {
      requestMetadata.add(record);
      unsettledStarted.add(event.requestId);
    } else {
      appendError(record, 'response lifecycle began before CDP capture was ready');
    }
    // The request event can precede the target agent's request registration.
    // Retry a rejected early setup here without perturbing an active stream.
    ensureResponseBodyStream(event.requestId);
  };

  const onRequestServedFromCache = (event) => {
    if (stopping || typeof event?.requestId !== 'string' || !tracked.has(event.requestId)) return;
    const record = active.get(event.requestId);
    if (record !== undefined) {
      record.requestServedFromCache = true;
      return;
    }
    requestServedFromCache.add(event.requestId);
  };

  const onDataReceived = (event) => {
    if (stopping || typeof event?.requestId !== 'string') return;
    const stream = responseStreams.get(event.requestId);
    if (stream === undefined || stream.integrityFailure !== undefined) return;
    try {
      if (!Number.isSafeInteger(event.dataLength) || event.dataLength < 0) {
        throw new TypeError('Network.dataReceived has invalid dataLength');
      }
      stream.dataBytes += event.dataLength;
      if (!Number.isSafeInteger(stream.dataBytes)) {
        throw new RangeError('Network.dataReceived body size is unsafe');
      }
      if (typeof event.data !== 'string') return;
      const chunk = strictBase64Bytes(event.data);
      if (chunk.byteLength !== event.dataLength) {
        throw new Error('Network.dataReceived streamed bytes do not match dataLength');
      }
      stream.chunks.push(chunk);
    } catch (error) {
      stream.integrityFailure = error;
    }
  };

  const applyBody = (record, body) => {
    record.bodyBytes = body.bytes.byteLength;
    if (body.text !== undefined) record.bodyText = body.text;
    if (responseMetadata.has(record)) {
      if (requestMetadata.has(record)) record.complete = true;
    } else {
      appendError(record, 'Network.loadingFinished lacked Network.responseReceived metadata');
    }
  };

  const collectBody = async (requestId, record) => {
    const stream = responseStreams.get(requestId);
    responseStreams.delete(requestId);
    if (stream !== undefined) {
      await (stream.ready ?? stream.setup);
      if (stream.enabled) {
        try {
          if (stream.integrityFailure !== undefined) throw stream.integrityFailure;
          const body = streamedBody([stream.buffered, ...stream.chunks]);
          if (body.bytes.byteLength !== stream.dataBytes) {
            throw new Error('CDP streamed body bytes do not match Network.dataReceived total');
          }
          applyBody(record, body);
        } catch (error) {
          retainIncomplete(record, `Network.streamResourceContent failed: ${errorMessage(error)}`);
        }
        return;
      }
    }
    try {
      const body = decodedBody(await session.send('Network.getResponseBody', { requestId }));
      applyBody(record, body);
    } catch (error) {
      retainIncomplete(record, `Network.getResponseBody failed: ${errorMessage(error)}`);
    }
  };

  const onLoadingFinished = (event) => {
    if (stopping || typeof event?.requestId !== 'string') return;
    const requestId = event.requestId;
    if (!tracked.has(requestId)) {
      requestDecisions.delete(requestId);
      return;
    }
    let record = active.get(requestId);
    if (record === undefined) {
      record = responseRecord(
        publicRequestId(event),
        { url: requestUrls.get(requestId) },
        event.requestId,
        requestMethods.get(requestId),
      );
      captured.push(record);
    }
    applyRequestCacheSignal(requestId, record);
    applyRequestPostData(requestId, record);
    active.delete(requestId);
    forgetRequest(requestId);
    const operation = collectBody(requestId, record);
    retainPending(operation);
    notifyTerminal(requestId);
  };

  const onLoadingFailed = (event) => {
    if (stopping || typeof event?.requestId !== 'string') return;
    const requestId = event.requestId;
    if (!tracked.has(requestId)) {
      requestDecisions.delete(requestId);
      return;
    }
    let record = active.get(requestId);
    if (record === undefined) {
      record = responseRecord(
        publicRequestId(event),
        { url: requestUrls.get(requestId) },
        event.requestId,
        requestMethods.get(requestId),
      );
      captured.push(record);
    }
    applyRequestCacheSignal(requestId, record);
    applyRequestPostData(requestId, record);
    const stream = responseStreams.get(requestId);
    if (stream !== undefined && Number.isSafeInteger(stream.dataBytes)) {
      record.observedDataBytes = stream.dataBytes;
    }
    active.delete(requestId);
    forgetRequest(requestId);
    responseStreams.delete(requestId);
    retainIncomplete(record, loadingFailure(event));
    notifyTerminal(requestId);
  };

  const listeners = [
    ['Network.requestWillBeSent', onRequestWillBeSent],
    ['Network.responseReceived', onResponseReceived],
    ['Network.requestServedFromCache', onRequestServedFromCache],
    ['Network.dataReceived', onDataReceived],
    ['Network.loadingFinished', onLoadingFinished],
    ['Network.loadingFailed', onLoadingFailed],
  ];
  for (const [event, listener] of listeners) session.on(event, listener);

  try {
    await session.send('Network.enable');
  } catch (error) {
    for (const [event, listener] of listeners) session.off(event, listener);
    await session.detach().catch(() => {});
    throw error;
  }

  return {
    stop(stopOptions = {}) {
      if (stopPromise !== undefined) return stopPromise;
      const settleTimeoutMs = stopOptions.settleTimeoutMs;
      if (
        settleTimeoutMs !== undefined &&
        (!Number.isSafeInteger(settleTimeoutMs) || settleTimeoutMs < 1)
      ) {
        throw new TypeError('CDP response recorder settleTimeoutMs must be a positive integer');
      }
      stopPromise = (async () => {
        const timedOut =
          settleTimeoutMs !== undefined && !(await waitForStartedTerminals(settleTimeoutMs));
        stopping = true;
        for (const [event, listener] of listeners) session.off(event, listener);
        while (pending.size > 0) await Promise.all([...pending]);
        for (const requestId of unsettledStarted) {
          let record = active.get(requestId);
          if (record === undefined) {
            record = responseRecord(
              requestId,
              { url: requestUrls.get(requestId) },
              requestId,
              requestMethods.get(requestId),
            );
            applyRequestPostData(requestId, record);
            captured.push(record);
          }
          retainIncomplete(
            record,
            timedOut
              ? `response lifecycle did not settle within ${settleTimeoutMs}ms`
              : 'response lifecycle stopped before Network.loadingFinished/loadingFailed',
          );
        }
        active.clear();
        unsettledStarted.clear();
        await session.detach();
        return Object.freeze(captured.map((record) => Object.freeze({ ...record })));
      })();
      return stopPromise;
    },
  };
}

function packumentUrl(registryUrl, packageName) {
  let parsed;
  try {
    parsed = new URL(registryUrl);
  } catch {
    throw new TypeError('standard asset source registryUrl must be an absolute URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError('standard asset source registryUrl must use http(s)');
  }
  const base = registryUrl.replace(/\/$/u, '');
  return `${base}/${encodeURIComponent(packageName).replace('%40', '@')}`;
}

function validSource(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    typeof value.version === 'string' &&
    value.version.length > 0 &&
    typeof value.integrity === 'string' &&
    value.integrity.length > 0
  );
}

function successfulPackument(record) {
  return record?.status === 200 && record.complete === true;
}

function successfulTarball(record) {
  return record?.status >= 200 && record.status < 300 && record.complete === true;
}

function responseLifecycle(record) {
  if (typeof record?.lifecycleId === 'string') return record.lifecycleId;
  return typeof record?.requestId === 'string' ? record.requestId : undefined;
}

function cacheSignal(record) {
  if (record?.requestServedFromCache === true) return 'Network.requestServedFromCache';
  if (record?.fromPrefetchCache === true) return 'response.fromPrefetchCache';
}

function decodedPackument(record, label) {
  if (typeof record.bodyText !== 'string') {
    return refuse(`${label} successful packument lacks decoded body evidence`);
  }
  if (new TextEncoder().encode(record.bodyText).byteLength !== record.bodyBytes) {
    return refuse(`${label} decoded packument byte evidence is inconsistent`);
  }
  try {
    return { ok: true, value: JSON.parse(record.bodyText) };
  } catch {
    return refuse(`${label} packument response is not valid JSON`);
  }
}

function exactDist(packument, source, label) {
  if (packument === null || typeof packument !== 'object' || Array.isArray(packument)) {
    return refuse(`${label} packument response is not an object`);
  }
  if (packument.name !== undefined && packument.name !== source.name) {
    return refuse(`${label} packument names a different package`);
  }
  const versions = packument.versions;
  if (versions === null || typeof versions !== 'object' || Array.isArray(versions)) {
    return refuse(`${label} packument lacks a versions map`);
  }
  const manifest = versions[source.version];
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return refuse(`${label} packument lacks the exact version`);
  }
  if (manifest.name !== undefined && manifest.name !== source.name) {
    return refuse(`${label} exact manifest names a different package`);
  }
  if (manifest.version !== undefined && manifest.version !== source.version) {
    return refuse(`${label} exact manifest reports a different version`);
  }
  const dist = manifest.dist;
  if (dist === null || typeof dist !== 'object' || Array.isArray(dist)) {
    return refuse(`${label} packument exact version lacks dist evidence`);
  }
  if (dist.integrity !== source.integrity) {
    return refuse(`${label} packument integrity does not match the canonical source`);
  }
  if (typeof dist.tarball !== 'string') {
    return refuse(`${label} packument exact version lacks a tarball URL`);
  }
  try {
    const url = new URL(dist.tarball);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('not http');
    return { ok: true, tarballUrl: url.href };
  } catch {
    return refuse(`${label} packument tarball URL is not absolute http(s)`);
  }
}

function tarballSourceCandidates(registryUrl, distTarballUrl) {
  const dist = new URL(distTarballUrl);
  const proxy = new URL(registryUrl);
  const proxyBasePath = proxy.pathname.replace(/\/+$/u, '');
  proxy.pathname = `${proxyBasePath}${dist.pathname}`;
  proxy.search = dist.search;
  proxy.hash = '';
  return new Set([dist.href, proxy.href]);
}

function sourceResponse(record, source) {
  return {
    source,
    url: record.url,
    method: record.method,
    protocol: record.protocol,
    bodyBytes: record.bodyBytes,
    complete: record.complete,
    fromDiskCache: record.fromDiskCache,
    fromServiceWorker: record.fromServiceWorker,
  };
}

/**
 * Turn raw CDP bodies into the exact standard source response list. Successful
 * packument bytes independently prove the tarball URL and canonical SRI;
 * retries and incomplete redirects remain in the returned byte ledger.
 */
export function finalizeStandardAssetSourceResponses({ registryUrl, source, captured }) {
  if (!validSource(source)) throw new TypeError('standard asset source descriptor is invalid');
  if (!Array.isArray(captured)) throw new TypeError('captured CDP responses must be an array');
  const label = `${source.name}@${source.version}`;
  const expectedPackumentUrl = packumentUrl(registryUrl, source.name);
  const packuments = captured.filter((record) => record?.url === expectedPackumentUrl);
  if (packuments.length === 0) {
    return refuse(`${label} has no exact standard packument response`);
  }

  const tarballUrls = new Set();
  for (const record of packuments) {
    if (!successfulPackument(record)) continue;
    const decoded = decodedPackument(record, label);
    if (!decoded.ok) return decoded;
    const dist = exactDist(decoded.value, source, label);
    if (!dist.ok) return dist;
    tarballUrls.add(dist.tarballUrl);
  }
  if (tarballUrls.size === 0) {
    return refuse(`${label} has no complete successful exact packument response`);
  }
  if (tarballUrls.size !== 1) {
    return refuse(`${label} successful packuments disagree on tarball URL`);
  }
  const [distTarballUrl] = tarballUrls;
  const candidates = tarballSourceCandidates(registryUrl, distTarballUrl);
  const matchedCandidates = new Set(
    captured.filter((record) => candidates.has(record?.url)).map((record) => record.url),
  );
  if (matchedCandidates.size > 1) {
    return refuse(`${label} matched multiple tarball source candidates`);
  }
  if (matchedCandidates.size === 0) return refuse(`${label} has no exact tarball response`);
  const [expectedTarballUrl] = matchedCandidates;
  const tarballs = captured.filter((record) => record?.url === expectedTarballUrl);
  if (tarballs.length === 0) return refuse(`${label} has no exact tarball response`);
  if (!tarballs.some(successfulTarball)) {
    return refuse(`${label} has no complete successful 2xx exact tarball response`);
  }

  const sourceByLifecycle = new Map();
  for (const record of captured) {
    const sourceKind =
      record?.url === expectedPackumentUrl
        ? 'packument'
        : record?.url === expectedTarballUrl
          ? 'tarball'
          : undefined;
    if (sourceKind === undefined) continue;
    const lifecycle = responseLifecycle(record);
    if (lifecycle === undefined) continue;
    const prior = sourceByLifecycle.get(lifecycle);
    if (prior !== undefined && prior !== sourceKind) {
      return refuse(`${label} captured lifecycle crosses packument and tarball sources`);
    }
    sourceByLifecycle.set(lifecycle, sourceKind);
  }

  const sourceResponses = [];
  for (const record of captured) {
    const sourceKind =
      record?.url === expectedPackumentUrl
        ? 'packument'
        : record?.url === expectedTarballUrl
          ? 'tarball'
          : sourceByLifecycle.get(responseLifecycle(record));
    if (sourceKind === undefined) {
      const url =
        typeof record?.url === 'string' && record.url.length > 0 ? record.url : '<unknown>';
      return refuse(`${label} has unclassified captured response lifecycle ${url}`);
    }
    const signal = cacheSignal(record);
    if (signal !== undefined) {
      return refuse(`${label} ${sourceKind} response was served from cache (${signal})`);
    }
    sourceResponses.push(sourceResponse(record, sourceKind));
  }

  return {
    ok: true,
    sourceResponses,
  };
}
