import { createHash } from 'node:crypto';

/** @typedef {{ readonly id: string, readonly hunk?: string, readonly anchor: string }} ExactTextPatchAnchor */
/** @typedef {ExactTextPatchAnchor & { readonly replacement: string }} ExactTextPatch */

const lines = (...parts) => parts.join('\n');

export const ESBUILD_RUNTIME_PATCH_IDS = Object.freeze([
  'inline-worker-startup',
  'node-callback-fs',
  'channel-has-fs',
  'runtime-default-wd',
  'transform-temp-fs',
  'native-validation-provenance',
  'native-target-errno',
  'gate-direct-lifecycle',
  'gate-sync-family',
  'gate-analyze-metafile',
  'gate-context-watch-serve',
  'gate-one-shot-build-write',
]);

/**
 * Exact 0.28.0 CJS inspection anchors. These describe mutation sites only;
 * production replacements belong to the generator implementation slice.
 */
export const ESBUILD_RUNTIME_PATCH_ANCHORS = Object.freeze(
  [
    {
      id: 'inline-worker-startup',
      hunk: 'envelope-open',
      anchor: lines('(module=>{', '"use strict";'),
    },
    {
      id: 'inline-worker-startup',
      hunk: 'service',
      anchor: lines(
        'var startRunningService = (wasmURL, wasmModule, useWorker) => __async(null, null, function* () {',
        '  let worker;',
        '  let rejectAllWith;',
        '  const rejectAllPromise = new Promise((resolve) => rejectAllWith = resolve);',
        '  if (useWorker) {',
      ),
    },
    {
      id: 'node-callback-fs',
      hunk: 'main',
      anchor: lines(
        '      (() => {',
        '        const enosys = () => {',
        '          const err = new Error("not implemented");',
        '          err.code = "ENOSYS";',
        '          return err;',
        '        };',
        '        if (!globalThis.fs) {',
        '          let outputBuf = "";',
        '          globalThis.fs = {',
      ),
    },
    {
      id: 'channel-has-fs',
      hunk: 'main',
      anchor: lines('    isSync: false,', '    hasFS: false,', '    esbuild: browser_exports'),
    },
    {
      id: 'runtime-default-wd',
      hunk: 'main',
      anchor: lines(
        '        defaultWD: "/",',
        '        callback: (err, res) => err ? reject(err) : resolve(res)',
        '      });',
        '    }),',
        '    context: (options) => new Promise((resolve, reject) => {',
        '      rejectAllPromise.then(reject);',
        '      service.buildOrContext({',
        '        callName: "context",',
        '        refs: null,',
        '        options,',
        '        isTTY: false,',
        '        defaultWD: "/",',
      ),
    },
    {
      id: 'transform-temp-fs',
      hunk: 'main',
      anchor: lines(
        '        fs: {',
        '          readFile(_, callback) {',
        '            callback(new Error("Internal error"), null);',
        '          },',
        '          writeFile(_, callback) {',
        '            callback(null);',
        '          }',
        '        },',
      ),
    },
    {
      id: 'native-validation-provenance',
      hunk: 'origin-owner',
      anchor: 'var canBeAnything = () => null;',
    },
    {
      id: 'native-validation-provenance',
      hunk: 'must-be-origin',
      anchor: '  if (mustBe !== null) throw new Error(`${quote(key)} must be ${mustBe}`);',
    },
    {
      id: 'native-validation-provenance',
      hunk: 'invalid-option-origin',
      anchor: '      throw new Error(`Invalid option ${where}: ${quote(key)}`);',
    },
    {
      id: 'native-validation-provenance',
      hunk: 'post-extract',
      anchor:
        '  return { id: "", pluginName, text, location: location2, notes: note ? [note] : [], detail: stash ? stash.store(e) : -1 };',
    },
    {
      id: 'native-target-errno',
      hunk: 'owner',
      anchor: 'function createChannel(streamIn) {',
    },
    {
      id: 'native-target-errno',
      hunk: 'materialized-message',
      anchor: lines(
        'function replaceDetailsInMessages(messages, stash) {',
        '  for (const message of messages) {',
        '    message.detail = stash.load(message.detail);',
        '  }',
        '  return messages;',
        '}',
      ),
    },
    {
      id: 'gate-direct-lifecycle',
      hunk: 'main',
      anchor: lines(
        'var stop = () => {',
        '  if (stopService) stopService();',
        '  return Promise.resolve();',
        '};',
        'var initializePromise;',
        'var stopService;',
        'var longLivedService;',
        'var ensureServiceIsRunning = () => {',
        '  if (longLivedService) return longLivedService;',
        '  if (initializePromise) throw new Error(\'You need to wait for the promise returned from "initialize" to be resolved before calling this\');',
        '  throw new Error(\'You need to call "initialize" before calling this\');',
        '};',
        'var initialize = (options) => {',
        '  options = validateInitializeOptions(options || {});',
        '  let wasmURL = options.wasmURL;',
        '  let wasmModule = options.wasmModule;',
        '  let useWorker = options.worker !== false;',
        '  if (!wasmURL && !wasmModule) throw new Error(\'Must provide either the "wasmURL" option or the "wasmModule" option\');',
        '  if (initializePromise) throw new Error(\'Cannot call "initialize" more than once\');',
        '  initializePromise = startRunningService(wasmURL || "", wasmModule, useWorker);',
        '  initializePromise.catch(() => {',
        '    initializePromise = void 0;',
        '  });',
        '  return initializePromise;',
        '};',
      ),
    },
    {
      id: 'gate-sync-family',
      hunk: 'main',
      anchor: lines(
        'var buildSync = () => {',
        '  throw new Error(`The "buildSync" API only works in node`);',
        '};',
        'var transformSync = () => {',
        '  throw new Error(`The "transformSync" API only works in node`);',
        '};',
        'var formatMessagesSync = () => {',
        '  throw new Error(`The "formatMessagesSync" API only works in node`);',
        '};',
        'var analyzeMetafileSync = () => {',
        '  throw new Error(`The "analyzeMetafileSync" API only works in node`);',
        '};',
      ),
    },
    {
      id: 'gate-analyze-metafile',
      hunk: 'main',
      anchor: lines(
        '    checkForInvalidFlags(options, keys, `in ${callName}() call`);',
        '    let request = {',
        '      command: "analyze-metafile",',
        '      metafile',
        '    };',
      ),
    },
    {
      id: 'gate-analyze-metafile',
      hunk: 'request-tail',
      anchor: lines(
        '    if (color !== void 0) request.color = color;',
        '    if (verbose !== void 0) request.verbose = verbose;',
        '    sendRequest(refs, request, (error, response) => {',
        '      if (error) return callback(new Error(error), null);',
        '      callback(null, response.result);',
        '    });',
      ),
    },
    {
      id: 'gate-context-watch-serve',
      hunk: 'main',
      anchor: lines(
        '        watch: (options2 = {}) => new Promise((resolve, reject) => {',
        '          if (!streamIn.hasFS) throw new Error(`Cannot use the "watch" API in this environment`);',
        '          const keys = {};',
        '          const delay = getFlag(options2, keys, "delay", mustBeInteger);',
        '          checkForInvalidFlags(options2, keys, `in watch() call`);',
        '          const request2 = {',
        '            command: "watch",',
        '            key: buildKey',
        '          };',
        '          if (delay) request2.delay = delay;',
        '          sendRequest(refs, request2, (error2) => {',
        '            if (error2) reject(new Error(error2));',
        '            else resolve(void 0);',
        '          });',
        '        }),',
        '        serve: (options2 = {}) => new Promise((resolve, reject) => {',
        '          if (!streamIn.hasFS) throw new Error(`Cannot use the "serve" API in this environment`);',
        '          const keys = {};',
        '          const port = getFlag(options2, keys, "port", mustBeValidPortNumber);',
        '          const host = getFlag(options2, keys, "host", mustBeString);',
        '          const servedir = getFlag(options2, keys, "servedir", mustBeString);',
        '          const keyfile = getFlag(options2, keys, "keyfile", mustBeString);',
        '          const certfile = getFlag(options2, keys, "certfile", mustBeString);',
        '          const fallback = getFlag(options2, keys, "fallback", mustBeString);',
        '          const cors = getFlag(options2, keys, "cors", mustBeObject);',
        '          const onRequest = getFlag(options2, keys, "onRequest", mustBeFunction);',
        '          checkForInvalidFlags(options2, keys, `in serve() call`);',
      ),
    },
    {
      id: 'gate-context-watch-serve',
      hunk: 'serve-execution-tail',
      anchor: lines(
        '          const request2 = {',
        '            command: "serve",',
        '            key: buildKey,',
        '            onRequest: !!onRequest',
        '          };',
        '          if (port !== void 0) request2.port = port;',
        '          if (host !== void 0) request2.host = host;',
        '          if (servedir !== void 0) request2.servedir = servedir;',
        '          if (keyfile !== void 0) request2.keyfile = keyfile;',
        '          if (certfile !== void 0) request2.certfile = certfile;',
        '          if (fallback !== void 0) request2.fallback = fallback;',
        '          if (cors) {',
        '            const corsKeys = {};',
        '            const origin = getFlag(cors, corsKeys, "origin", mustBeStringOrArrayOfStrings);',
        '            checkForInvalidFlags(cors, corsKeys, `on "cors" object`);',
        '            if (Array.isArray(origin)) request2.corsOrigin = origin;',
        '            else if (origin !== void 0) request2.corsOrigin = [origin];',
        '          }',
        '          sendRequest(refs, request2, (error2, response2) => {',
        '            if (error2) return reject(new Error(error2));',
        '            if (onRequest) {',
        '              requestCallbacks["serve-request"] = (id, request3) => {',
        '                onRequest(request3.args);',
        '                sendResponse(id, {});',
        '              };',
        '            }',
        '            resolve(response2);',
        '          });',
        '        }),',
      ),
    },
    {
      id: 'gate-one-shot-build-write',
      hunk: 'main',
      anchor: lines(
        '    } = flagsForBuildOptions(callName, options, isTTY, buildLogLevelDefault, writeDefault);',
        '    if (write && !streamIn.hasFS) throw new Error(`The "write" option is unavailable in this environment`);',
        '    const request = {',
      ),
    },
    {
      id: 'inline-worker-startup',
      hunk: 'envelope-close',
      anchor: lines(
        'var browser_default = browser_exports;',
        '})(typeof module==="object"?module:{set exports(x){(typeof self!=="undefined"?self:this).esbuild=x}});',
      ),
    },
  ].map((patch) => Object.freeze(patch)),
);

export class ExactTextPatchError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ExactTextPatchError';
  }
}

/** @param {string} text */
export function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Count overlapping occurrences so an anchor such as `aaa` in `aaaa` is
 * rejected as duplicate instead of being mistaken for one safe mutation site.
 * @param {string} source
 * @param {string} anchor
 */
function occurrenceOffsets(source, anchor) {
  const offsets = [];
  for (let from = 0; from <= source.length - anchor.length; ) {
    const offset = source.indexOf(anchor, from);
    if (offset === -1) break;
    offsets.push(offset);
    from = offset + 1;
  }
  return offsets;
}

/** @param {readonly ExactTextPatchAnchor[]} patches */
function validatePatchPlan(patches) {
  const keys = new Set();
  for (const patch of patches) {
    if (typeof patch.id !== 'string' || patch.id.length === 0) {
      throw new ExactTextPatchError('exact patch plan: patch id must be non-empty');
    }
    const hunk = patch.hunk ?? 'main';
    if (typeof hunk !== 'string' || hunk.length === 0) {
      throw new ExactTextPatchError(`exact patch "${patch.id}": hunk must be non-empty`);
    }
    const key = `${patch.id}/${hunk}`;
    if (keys.has(key)) {
      throw new ExactTextPatchError(`exact patch plan: duplicate patch key "${key}"`);
    }
    keys.add(key);
    if (typeof patch.anchor !== 'string' || patch.anchor.length === 0) {
      throw new ExactTextPatchError(`exact patch "${patch.id}": anchor must be non-empty`);
    }
  }
}

/**
 * Validate all anchors against the same immutable source before mutation.
 * @param {string} source
 * @param {readonly ExactTextPatchAnchor[]} patches
 */
export function inspectExactTextPatchAnchors(source, patches) {
  if (typeof source !== 'string') throw new TypeError('exact patch source must be a string');
  validatePatchPlan(patches);
  const anchors = patches.map((patch) => {
    const offsets = occurrenceOffsets(source, patch.anchor);
    if (offsets.length !== 1) {
      const fault = offsets.length === 0 ? 'missing' : 'duplicate';
      const hunk = patch.hunk ?? 'main';
      throw new ExactTextPatchError(
        `exact patch "${patch.id}/${hunk}": ${fault} anchor; expected exactly 1, found ${offsets.length}`,
      );
    }
    const start = offsets[0];
    return Object.freeze({
      id: patch.id,
      hunk: patch.hunk ?? 'main',
      inputSpan: Object.freeze({ start, end: start + patch.anchor.length }),
      beforeSha256: sha256Text(patch.anchor),
    });
  });
  const bySourcePosition = [...anchors].sort(
    (left, right) => left.inputSpan.start - right.inputSpan.start,
  );
  for (let index = 1; index < bySourcePosition.length; index += 1) {
    const previous = bySourcePosition[index - 1];
    const current = bySourcePosition[index];
    if (previous.inputSpan.end > current.inputSpan.start) {
      throw new ExactTextPatchError(
        `exact patches "${previous.id}/${previous.hunk}" and "${current.id}/${current.hunk}": anchors overlap`,
      );
    }
  }
  return Object.freeze({ sourceSha256: sha256Text(source), anchors: Object.freeze(anchors) });
}

/**
 * Apply replacements against inspected positions in the original source.
 * @param {string} source
 * @param {readonly ExactTextPatch[]} patches
 */
export function applyExactTextPatches(source, patches) {
  for (const patch of patches) {
    if (typeof patch.replacement !== 'string') {
      throw new ExactTextPatchError(`exact patch "${patch.id}": replacement must be a string`);
    }
  }
  const inspection = inspectExactTextPatchAnchors(source, patches);
  const patchByKey = new Map(
    patches.map((patch) => [`${patch.id}/${patch.hunk ?? 'main'}`, patch]),
  );
  const bySourcePosition = [...inspection.anchors].sort(
    (left, right) => left.inputSpan.start - right.inputSpan.start,
  );
  const outputSpans = new Map();
  const outputParts = [];
  let sourceCursor = 0;
  let outputCursor = 0;
  for (const anchor of bySourcePosition) {
    const key = `${anchor.id}/${anchor.hunk}`;
    const patch = patchByKey.get(key);
    const unchanged = source.slice(sourceCursor, anchor.inputSpan.start);
    outputParts.push(unchanged, patch.replacement);
    outputCursor += unchanged.length;
    outputSpans.set(
      key,
      Object.freeze({ start: outputCursor, end: outputCursor + patch.replacement.length }),
    );
    outputCursor += patch.replacement.length;
    sourceCursor = anchor.inputSpan.end;
  }
  outputParts.push(source.slice(sourceCursor));
  const output = outputParts.join('');
  const applied = inspection.anchors.map((anchor) => {
    const key = `${anchor.id}/${anchor.hunk}`;
    const patch = patchByKey.get(key);
    return Object.freeze({
      ...anchor,
      outputSpan: outputSpans.get(key),
      afterSha256: sha256Text(patch.replacement),
    });
  });
  return Object.freeze({
    sourceSha256: inspection.sourceSha256,
    output,
    outputSha256: sha256Text(output),
    patches: Object.freeze(applied),
  });
}
