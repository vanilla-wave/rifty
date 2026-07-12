import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ESBUILD_RUNTIME_PATCH_ANCHORS,
  ESBUILD_RUNTIME_PATCH_IDS,
  applyExactTextPatches,
} from './esbuild-exact-patcher.mjs';

interface ValidationAnchorPolicy {
  readonly id: string;
  readonly start: string;
  readonly end: string;
  readonly sha256: string;
}

interface RuntimePolicy {
  readonly schema: number;
  readonly version: string;
  readonly source: {
    readonly package: string;
    readonly member: string;
    readonly sha256: string;
  };
  readonly wasm: { readonly member: string; readonly sha256: string };
  readonly validationSource: {
    readonly package: string;
    readonly version: string;
    readonly member: string;
    readonly sha256: string;
    readonly anchors: readonly ValidationAnchorPolicy[];
  };
  readonly patches: readonly string[];
}

interface ExactAnchor {
  readonly id: string;
  readonly hunk?: string;
  readonly anchor: string;
}

const policyUrl = new URL('../esbuild-runtime-policy.json', import.meta.url);
const manifestUrl = new URL('../generated/esbuild-runtime-manifest.json', import.meta.url);
const outputUrl = new URL(
  '../../../apps/playground/src/workers/generated/esbuild-runtime.js',
  import.meta.url,
);
const policy = JSON.parse(readFileSync(policyUrl, 'utf8')) as RuntimePolicy;
const require = createRequire(import.meta.url);
const lines = (...parts: readonly string[]): string => parts.join('\n');

function sha256(contents: string | Uint8Array): string {
  return createHash('sha256').update(contents).digest('hex');
}

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function sourceMemberPath(packageRoot: string, member: string): string {
  const prefix = 'package/';
  if (!member.startsWith(prefix)) throw new Error(`invalid package member: ${member}`);
  return join(packageRoot, member.slice(prefix.length));
}

function replacementFor(anchor: ExactAnchor): string {
  const key = `${anchor.id}/${anchor.hunk ?? 'main'}`;
  switch (key) {
    case 'inline-worker-startup/envelope-open':
      return lines(
        "import { NotImplementedError } from '@riftydev/io';",
        'import { createEsbuildCallbackFs } from "../esbuild-runtime-fs.ts";',
        'const module = { exports: {} };',
        'let startEsbuildRuntime;',
        '(module=>{',
        '"use strict";',
      );
    case 'inline-worker-startup/service':
      return lines(
        'var runtimeFs;',
        'var runtimeDefaultWD;',
        'startEsbuildRuntime = ({ wasm, fs, cwd }) => {',
        '  if (initializePromise || longLivedService) throw new Error("Cannot start the esbuild runtime more than once");',
        '  runtimeFs = createEsbuildCallbackFs(fs, cwd);',
        '  runtimeDefaultWD = cwd;',
        '  initializePromise = startRunningService("", wasm, false);',
        '  return initializePromise.then(() => module.exports);',
        '};',
        'var startRunningService = (wasmURL, wasmModule, useWorker) => __async(null, null, function* () {',
        '  let worker;',
        '  let rejectAllWith;',
        '  const rejectAllPromise = new Promise((resolve) => rejectAllWith = resolve);',
        '  if (useWorker) {',
      );
    case 'inline-worker-startup/envelope-close':
      return lines(
        'var browser_default = browser_exports;',
        '})(module);',
        'const esbuild = module.exports;',
        'export { startEsbuildRuntime };',
        'export default esbuild;',
      );
    case 'node-callback-fs/main':
      return lines(
        '      globalThis.fs = runtimeFs.go;',
        '      (() => {',
        '        const enosys = () => {',
        '          const err = new Error("not implemented");',
        '          err.code = "ENOSYS";',
        '          return err;',
        '        };',
        '        if (!globalThis.fs) {',
        '          let outputBuf = "";',
        '          globalThis.fs = {',
      );
    case 'channel-has-fs/main':
      return lines('    isSync: false,', '    hasFS: true,', '    esbuild: browser_exports');
    case 'runtime-default-wd/main':
      return lines(
        '        defaultWD: runtimeDefaultWD,',
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
        '        defaultWD: runtimeDefaultWD,',
      );
    case 'transform-temp-fs/main':
      return '        fs: runtimeFs.transform,';
    case 'gate-direct-lifecycle/main':
      return lines(
        'var stop = () => Promise.reject(new NotImplementedError("esbuild.stop"));',
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
        '  if (options.wasmURL) throw new Error(\'The "wasmURL" option only works in the browser\');',
        '  if (options.wasmModule) throw new Error(\'The "wasmModule" option only works in the browser\');',
        '  if (options.worker) throw new Error(\'The "worker" option only works in the browser\');',
        '  return Promise.reject(new NotImplementedError("esbuild.initialize"));',
        '};',
      );
    case 'gate-sync-family/main':
      return lines(
        'var fakeBuildError = (text) => {',
        '  let error = new Error(`Build failed with 1 error:',
        'error: ${text}`);',
        '  let errors = [{ id: "", pluginName: "", text, location: null, notes: [], detail: void 0 }];',
        '  error.errors = errors;',
        '  error.warnings = [];',
        '  return error;',
        '};',
        'var validateBuildSyncOptions = (options) => {',
        '  if (!options) return;',
        '  let plugins = options.plugins;',
        '  if (plugins && plugins.length > 0) throw fakeBuildError(`Cannot use plugins in synchronous API calls`);',
        '};',
        'var syncValidationFailure = (kind, error) => {',
        '  let text = error && error.message || String(error);',
        '  let isInvalidOption = text.startsWith("Invalid option ");',
        '  let line = isInvalidOption ? 540 : 534;',
        '  let column = isInvalidOption ? 12 : 29;',
        '  let lineText = isInvalidOption ? "      throw new Error(`Invalid option ${where}: ${quote(key)}`);" : "  if (mustBe !== null) throw new Error(`${quote(key)} must be ${mustBe}`);";',
        '  let location = { file: "/node_modules/esbuild/lib/main.js", namespace: "file", line, column, length: 0, lineText, suggestion: "" };',
        '  let message = { id: "", pluginName: "", text, location, notes: [], detail: error };',
        '  return failureErrorWithLog(`${kind} failed`, [message], []);',
        '};',
        'var buildSync = (options) => {',
        '  validateBuildSyncOptions(options);',
        '  try {',
        '    flagsForBuildOptions("build", options || {}, false, buildLogLevelDefault, true);',
        '  } catch (error) {',
        '    throw syncValidationFailure("Build", error);',
        '  }',
        '  throw new NotImplementedError("esbuild.buildSync");',
        '};',
        'var transformSync = (input, options) => {',
        '  try {',
        '    validateStringValue(input, "input");',
        '    flagsForTransformOptions("transform", options || {}, false, transformLogLevelDefault);',
        '  } catch (error) {',
        '    throw syncValidationFailure("Transform", error);',
        '  }',
        '  throw new NotImplementedError("esbuild.transformSync");',
        '};',
        'var formatMessagesSync = (messages, options) => {',
        '  if (!options) throw new Error("Missing second argument in formatMessages() call");',
        '  let keys = {};',
        '  let kind = getFlag(options, keys, "kind", mustBeString);',
        '  getFlag(options, keys, "color", mustBeBoolean);',
        '  let terminalWidth = getFlag(options, keys, "terminalWidth", mustBeInteger);',
        '  checkForInvalidFlags(options, keys, "in formatMessages() call");',
        '  if (kind === void 0) throw new Error(\'Missing "kind" in formatMessages() call\');',
        '  if (kind !== "error" && kind !== "warning") throw new Error(\'Expected "kind" to be "error" or "warning" in formatMessages() call\');',
        '  sanitizeMessages(messages, "messages", null, "", terminalWidth);',
        '  throw new NotImplementedError("esbuild.formatMessagesSync");',
        '};',
        'var analyzeMetafileSync = (metafile, options) => {',
        '  if (options === void 0) options = {};',
        '  let keys = {};',
        '  getFlag(options, keys, "color", mustBeBoolean);',
        '  getFlag(options, keys, "verbose", mustBeBoolean);',
        '  checkForInvalidFlags(options, keys, "in analyzeMetafile() call");',
        '  if (metafile == null) Object.keys(metafile);',
        '  if (typeof metafile !== "string") JSON.stringify(metafile);',
        '  throw new NotImplementedError("esbuild.analyzeMetafileSync");',
        '};',
      );
    case 'gate-analyze-metafile/main':
      return lines(
        '    checkForInvalidFlags(options, keys, `in ${callName}() call`);',
        '    if (metafile == null) Object.keys(metafile);',
        '    throw new NotImplementedError("esbuild.analyzeMetafile");',
      );
    case 'gate-analyze-metafile/request-tail':
      return '';
    case 'gate-context-watch-serve/main':
      return lines(
        '        watch: (options2 = {}) => new Promise((resolve, reject) => {',
        '          const keys = {};',
        '          getFlag(options2, keys, "delay", mustBeInteger);',
        '          checkForInvalidFlags(options2, keys, `in watch() call`);',
        '          throw new NotImplementedError("esbuild.context.watch");',
        '        }),',
        '        serve: (options2 = {}) => new Promise((resolve, reject) => {',
        '          const keys = {};',
        '          getFlag(options2, keys, "port", mustBeValidPortNumber);',
        '          getFlag(options2, keys, "host", mustBeString);',
        '          getFlag(options2, keys, "servedir", mustBeString);',
        '          getFlag(options2, keys, "keyfile", mustBeString);',
        '          getFlag(options2, keys, "certfile", mustBeString);',
        '          getFlag(options2, keys, "fallback", mustBeString);',
        '          getFlag(options2, keys, "cors", mustBeObject);',
        '          getFlag(options2, keys, "onRequest", mustBeFunction);',
        '          checkForInvalidFlags(options2, keys, `in serve() call`);',
        '          throw new NotImplementedError("esbuild.context.serve");',
      );
    case 'gate-context-watch-serve/serve-execution-tail':
      return '        }),';
    case 'gate-one-shot-build-write/main':
      return lines(
        '    } = flagsForBuildOptions(callName, options, isTTY, buildLogLevelDefault, writeDefault);',
        '    if (!isContext && write) return callback(new NotImplementedError("esbuild.build.write"), null);',
        '    const request = {',
      );
    default:
      throw new Error(`no replacement for exact patch ${key}`);
  }
}

function validationAnchors(source: string): readonly object[] {
  return policy.validationSource.anchors.map((anchor) => {
    const start = source.indexOf(anchor.start);
    if (start === -1) throw new Error(`validation anchor ${anchor.id}: missing start`);
    if (source.indexOf(anchor.start, start + 1) !== -1) {
      throw new Error(`validation anchor ${anchor.id}: duplicate start`);
    }
    const end = source.indexOf(anchor.end, start + anchor.start.length);
    if (end === -1) throw new Error(`validation anchor ${anchor.id}: missing end`);
    const exact = source.slice(start, end);
    assertEqual(`validation anchor ${anchor.id} sha256`, sha256(exact), anchor.sha256);
    return {
      id: anchor.id,
      inputSpan: { start, end },
      sha256: anchor.sha256,
    };
  });
}

function derive(): { readonly manifest: string; readonly output: string } {
  assertEqual('policy schema', policy.schema, 1);
  assertEqual('policy/source version', policy.version, '0.28.0');
  assertEqual(
    'policy/patch ids',
    JSON.stringify(policy.patches),
    JSON.stringify(ESBUILD_RUNTIME_PATCH_IDS),
  );

  const wasmRoot = dirname(require.resolve(`${policy.source.package}/package.json`));
  const sourcePath = sourceMemberPath(wasmRoot, policy.source.member);
  const source = readFileSync(sourcePath, 'utf8');
  assertEqual('upstream browser.js sha256', sha256(source), policy.source.sha256);

  const wasmPath = sourceMemberPath(wasmRoot, policy.wasm.member);
  const wasm = readFileSync(wasmPath);
  assertEqual('upstream esbuild.wasm sha256', sha256(wasm), policy.wasm.sha256);

  const validationRoot = dirname(
    require.resolve(`${policy.validationSource.package}/package.json`),
  );
  const validationPath = sourceMemberPath(validationRoot, policy.validationSource.member);
  const validationSource = readFileSync(validationPath, 'utf8');
  assertEqual(
    'oracle validation source sha256',
    sha256(validationSource),
    policy.validationSource.sha256,
  );
  const pinnedValidationAnchors = validationAnchors(validationSource);

  const patches = (ESBUILD_RUNTIME_PATCH_ANCHORS as readonly ExactAnchor[]).map((anchor) => ({
    ...anchor,
    replacement: replacementFor(anchor),
  }));
  const generated = applyExactTextPatches(source, patches);
  const output = `${generated.output}\n`;
  const manifest = {
    schema: 1,
    source: {
      package: policy.source.package,
      version: policy.version,
      member: policy.source.member,
      sha256: policy.source.sha256,
    },
    wasm: {
      member: policy.wasm.member,
      sha256: policy.wasm.sha256,
    },
    validationSource: {
      package: policy.validationSource.package,
      version: policy.validationSource.version,
      member: policy.validationSource.member,
      sha256: policy.validationSource.sha256,
      anchors: pinnedValidationAnchors,
    },
    patches: policy.patches,
    hunks: generated.patches,
    output: {
      path: 'apps/playground/src/workers/generated/esbuild-runtime.js',
      format: 'esm',
      bytes: Buffer.byteLength(output),
      sha256: sha256(output),
    },
  };
  return { output, manifest: `${JSON.stringify(manifest, null, 2)}\n` };
}

function checkFile(path: string, expected: string): void {
  if (!existsSync(path) || readFileSync(path, 'utf8') !== expected) {
    throw new Error(`generated esbuild runtime drift: ${path}`);
  }
}

function main(): void {
  const mode = process.argv[2];
  if (mode !== '--write' && mode !== '--check') {
    throw new Error('usage: generate-esbuild-runtime.ts --write|--check');
  }
  const derived = derive();
  const outputPath = fileURLToPath(outputUrl);
  const manifestPath = fileURLToPath(manifestUrl);
  if (mode === '--check') {
    checkFile(outputPath, derived.output);
    checkFile(manifestPath, derived.manifest);
    return;
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(outputPath, derived.output);
  writeFileSync(manifestPath, derived.manifest);
}

main();
