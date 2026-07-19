import { Buffer } from 'node:buffer';

function refuse(note) {
  return { ok: false, note };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function responseRecord(requestId, response) {
  return {
    requestId,
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

/**
 * Record complete CDP response bodies without projecting away retries,
 * redirects, or failures. stop() drains every body command before detaching.
 */
export async function startCdpResponseRecorder(page, options = {}) {
  const context = typeof page?.context === 'function' ? page.context() : null;
  if (context === null || typeof context.newCDPSession !== 'function') {
    throw new TypeError('Playwright page must expose context().newCDPSession()');
  }
  const captureUrl = options.captureUrl ?? (() => true);
  if (typeof captureUrl !== 'function') {
    throw new TypeError('CDP response recorder captureUrl must be a function');
  }
  const session = cdpSessionPort(await context.newCDPSession(page));
  const captured = [];
  const active = new Map();
  const requestUrls = new Map();
  const tracked = new Set();
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

  const track = (requestId, url) => {
    if (tracked.has(requestId)) return true;
    if (typeof url !== 'string' || captureUrl(url) !== true) return false;
    tracked.add(requestId);
    return true;
  };

  const onRequestWillBeSent = (event) => {
    if (stopping || typeof event?.requestId !== 'string') return;
    const requestId = event.requestId;
    const requestUrl = typeof event.request?.url === 'string' ? event.request.url : undefined;
    const redirectUrl =
      typeof event.redirectResponse?.url === 'string' ? event.redirectResponse.url : undefined;
    if (!track(requestId, requestUrl) && !track(requestId, redirectUrl)) return;
    if (event.redirectResponse !== undefined) {
      const redirect = event.redirectResponse;
      const prior = active.get(requestId);
      if (prior !== undefined && prior.url === redirect?.url && prior.status === redirect?.status) {
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
        const record = responseRecord(requestId, redirect);
        retainIncomplete(
          record,
          'redirect response body is unavailable through an unambiguous CDP lifecycle',
        );
        captured.push(record);
      }
      active.delete(requestId);
    }
    if (requestUrl !== undefined) requestUrls.set(requestId, requestUrl);
  };

  const onResponseReceived = (event) => {
    if (stopping || typeof event?.requestId !== 'string') return;
    if (!track(event.requestId, event.response?.url)) return;
    const prior = active.get(event.requestId);
    if (prior !== undefined) {
      retainIncomplete(
        prior,
        'response lifecycle was replaced before Network.loadingFinished/loadingFailed',
      );
    }
    const record = responseRecord(event.requestId, event.response);
    captured.push(record);
    active.set(event.requestId, record);
    responseMetadata.add(record);
  };

  const collectBody = async (requestId, record) => {
    try {
      const body = decodedBody(await session.send('Network.getResponseBody', { requestId }));
      record.bodyBytes = body.bytes.byteLength;
      if (body.text !== undefined) record.bodyText = body.text;
      if (responseMetadata.has(record)) {
        record.complete = true;
      } else {
        appendError(record, 'Network.loadingFinished lacked Network.responseReceived metadata');
      }
    } catch (error) {
      retainIncomplete(record, `Network.getResponseBody failed: ${errorMessage(error)}`);
    }
  };

  const onLoadingFinished = (event) => {
    if (stopping || typeof event?.requestId !== 'string') return;
    const requestId = event.requestId;
    if (!tracked.has(requestId)) return;
    let record = active.get(requestId);
    if (record === undefined) {
      record = responseRecord(requestId, { url: requestUrls.get(requestId) });
      captured.push(record);
    }
    active.delete(requestId);
    const operation = collectBody(requestId, record);
    pending.add(operation);
    void operation.finally(() => pending.delete(operation));
  };

  const onLoadingFailed = (event) => {
    if (stopping || typeof event?.requestId !== 'string') return;
    const requestId = event.requestId;
    if (!tracked.has(requestId)) return;
    let record = active.get(requestId);
    if (record === undefined) {
      record = responseRecord(requestId, { url: requestUrls.get(requestId) });
      captured.push(record);
    }
    active.delete(requestId);
    retainIncomplete(record, loadingFailure(event));
  };

  const listeners = [
    ['Network.requestWillBeSent', onRequestWillBeSent],
    ['Network.responseReceived', onResponseReceived],
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
    stop() {
      if (stopPromise !== undefined) return stopPromise;
      stopPromise = (async () => {
        stopping = true;
        for (const [event, listener] of listeners) session.off(event, listener);
        while (pending.size > 0) await Promise.all([...pending]);
        for (const record of active.values()) {
          retainIncomplete(
            record,
            'response lifecycle stopped before Network.loadingFinished/loadingFailed',
          );
        }
        active.clear();
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

function sourceResponse(record, source) {
  return {
    source,
    url: record.url,
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
  const [expectedTarballUrl] = tarballUrls;
  const tarballs = captured.filter((record) => record?.url === expectedTarballUrl);
  if (tarballs.length === 0) return refuse(`${label} has no exact tarball response`);

  return {
    ok: true,
    sourceResponses: captured.flatMap((record) => {
      if (record?.url === expectedPackumentUrl) return [sourceResponse(record, 'packument')];
      if (record?.url === expectedTarballUrl) return [sourceResponse(record, 'tarball')];
      return [];
    }),
  };
}
