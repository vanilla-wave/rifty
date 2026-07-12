import { createHash } from 'node:crypto';

/** @typedef {{ readonly id: string, readonly anchor: string }} ExactTextPatchAnchor */
/** @typedef {ExactTextPatchAnchor & { readonly replacement: string }} ExactTextPatch */

const lines = (...parts) => parts.join('\n');

export const ESBUILD_RUNTIME_PATCH_IDS = Object.freeze([
  'inline-worker-startup',
  'node-callback-fs',
  'channel-has-fs',
  'runtime-default-wd',
  'transform-temp-fs',
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
      anchor: lines('    isSync: false,', '    hasFS: false,', '    esbuild: browser_exports'),
    },
    {
      id: 'runtime-default-wd',
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
      id: 'gate-direct-lifecycle',
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
      anchor: lines(
        '    checkForInvalidFlags(options, keys, `in ${callName}() call`);',
        '    let request = {',
        '      command: "analyze-metafile",',
        '      metafile',
        '    };',
      ),
    },
    {
      id: 'gate-context-watch-serve',
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
      id: 'gate-one-shot-build-write',
      anchor: lines(
        '    } = flagsForBuildOptions(callName, options, isTTY, buildLogLevelDefault, writeDefault);',
        '    if (write && !streamIn.hasFS) throw new Error(`The "write" option is unavailable in this environment`);',
        '    const request = {',
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
  const ids = new Set();
  for (const patch of patches) {
    if (typeof patch.id !== 'string' || patch.id.length === 0) {
      throw new ExactTextPatchError('exact patch plan: patch id must be non-empty');
    }
    if (ids.has(patch.id)) {
      throw new ExactTextPatchError(`exact patch plan: duplicate patch id "${patch.id}"`);
    }
    ids.add(patch.id);
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
      throw new ExactTextPatchError(
        `exact patch "${patch.id}": ${fault} anchor; expected exactly 1, found ${offsets.length}`,
      );
    }
    const start = offsets[0];
    return Object.freeze({
      id: patch.id,
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
        `exact patches "${previous.id}" and "${current.id}": anchors overlap`,
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
  const patchById = new Map(patches.map((patch) => [patch.id, patch]));
  const bySourcePosition = [...inspection.anchors].sort(
    (left, right) => left.inputSpan.start - right.inputSpan.start,
  );
  const outputSpans = new Map();
  const outputParts = [];
  let sourceCursor = 0;
  let outputCursor = 0;
  for (const anchor of bySourcePosition) {
    const patch = patchById.get(anchor.id);
    const unchanged = source.slice(sourceCursor, anchor.inputSpan.start);
    outputParts.push(unchanged, patch.replacement);
    outputCursor += unchanged.length;
    outputSpans.set(
      anchor.id,
      Object.freeze({ start: outputCursor, end: outputCursor + patch.replacement.length }),
    );
    outputCursor += patch.replacement.length;
    sourceCursor = anchor.inputSpan.end;
  }
  outputParts.push(source.slice(sourceCursor));
  const output = outputParts.join('');
  const applied = inspection.anchors.map((anchor) => {
    const patch = patchById.get(anchor.id);
    return Object.freeze({
      ...anchor,
      outputSpan: outputSpans.get(anchor.id),
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
