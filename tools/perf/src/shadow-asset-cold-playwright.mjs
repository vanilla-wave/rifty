import {
  describeCapturedResponseLedger,
  finalizeStandardAssetSourceResponses,
  startCdpResponseRecorder,
} from './shadow-asset-cold-cdp.mjs';
import {
  buildEddyShadowAssetColdRun,
  buildStandardShadowAssetColdRun,
} from './shadow-asset-cold-evidence.mjs';
import { runShadowAssetColdContexts } from './shadow-asset-cold-harness.mjs';
import { canonicalShadowAssetColdExpectation } from './shadow-asset-cold-plan.mjs';
import { installEsbuild0280SelectionOracle } from './shadow-asset-cold-selection.mjs';

const PAGE_READY_TIMEOUT_MS = 60_000;
const MEASURE_TIMEOUT_MS = 300_000;
const SOURCE_TERMINAL_TIMEOUT_MS = 10_000;
const CACHE_REGIME = 'fresh-context-empty-store-and-tarball;warm-proxy-origin';

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout(operation, label, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function absoluteHttpUrl(value, label) {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`${label} must use http(s)`);
  }
  return url;
}

function sourceCapturePredicate(registryUrl, sourceName) {
  const base = registryUrl.replace(/\/$/u, '');
  const packument = `${base}/${encodeURIComponent(sourceName).replace('%40', '@')}`;
  const encoded = encodeURIComponent(sourceName).toLowerCase();
  const plain = sourceName.toLowerCase();
  return (input) => {
    let url;
    try {
      url = new URL(input);
    } catch {
      return false;
    }
    if (url.href === packument) return true;
    const path = url.pathname.toLowerCase();
    return (path.includes(plain) || path.includes(encoded)) && path.endsWith('.tgz');
  };
}

function eddyCapturePredicates({ registryUrl, resolverUrl, bundleUrl, source }) {
  const sourceName = source.name;
  const standardSource = sourceCapturePredicate(registryUrl, sourceName);
  const resolver = new URL(resolverUrl).href;
  const bundlePrefix = `${new URL(bundleUrl).href.replace(/\/+$/u, '')}/bundle/`;
  const captureUrl = (input) => {
    if (standardSource(input)) return true;
    let href;
    try {
      href = new URL(input).href;
    } catch {
      return false;
    }
    return href === resolver || href.startsWith(bundlePrefix);
  };
  const exactPostData = JSON.stringify({
    dependencies: { [source.name]: source.version },
    optionalDependencies: {},
  });
  const captureRequest = (request) => {
    if (standardSource(request?.url)) return true;
    let href;
    try {
      href = new URL(request?.url).href;
    } catch {
      return false;
    }
    if (href.startsWith(bundlePrefix)) return true;
    return href === resolver && request?.method === 'POST' && request?.postData === exactPostData;
  };
  return { captureRequest, captureUrl };
}

function appendLifecycleFailure(current, next, message) {
  if (current === null) return next;
  return new AggregateError([current, next], message);
}

/** One authority for the observable measure -> CDP stop -> public close boundary. */
export async function completeCapturedShadowAssetColdPage({ measure, stopRecorder, close }) {
  let pageEvidence;
  let captured;
  let cleanup;
  let failure = null;
  try {
    pageEvidence = await measure();
  } catch (error) {
    failure = error;
  }
  try {
    captured = await stopRecorder();
  } catch (error) {
    failure = appendLifecycleFailure(failure, error, 'shadow-asset cold CDP capture failed');
  }
  try {
    cleanup = await close();
  } catch (error) {
    failure = appendLifecycleFailure(failure, error, 'shadow-asset cold page cleanup failed');
  }
  if (failure !== null) throw failure;
  return { pageEvidence, captured, cleanup };
}

function createMeasuredContext({
  browser,
  hostUrl,
  mode,
  registryUrl,
  resolverUrl,
  bundleUrl,
  catalog,
  catalogAsset,
  label,
}) {
  let context;
  let page;
  return {
    async measure() {
      context = await browser.newContext({ serviceWorkers: 'allow' });
      const selectionOracle = await installEsbuild0280SelectionOracle(context, registryUrl);
      page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.goto(hostUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_READY_TIMEOUT_MS });
      await page.waitForFunction(
        () =>
          typeof globalThis.__RIFTY_SHADOW_ASSET_COLD__?.prepare === 'function' &&
          typeof globalThis.__RIFTY_SHADOW_ASSET_COLD__?.measure === 'function',
        undefined,
        { timeout: PAGE_READY_TIMEOUT_MS },
      );

      const pageOptions =
        mode === 'eddy'
          ? { mode, registryUrl, resolverUrl, bundleBaseUrl: bundleUrl }
          : { mode, registryUrl };
      await withTimeout(
        page.evaluate(
          (options) => globalThis.__RIFTY_SHADOW_ASSET_COLD__.prepare(options),
          pageOptions,
        ),
        `${label} Workbench preparation`,
        MEASURE_TIMEOUT_MS,
      );
      const sourceUrlPredicate = sourceCapturePredicate(registryUrl, catalogAsset.source.name);
      const capture =
        mode === 'eddy'
          ? eddyCapturePredicates({
              registryUrl,
              resolverUrl,
              bundleUrl,
              source: catalogAsset.source,
            })
          : {
              captureRequest: (request) => sourceUrlPredicate(request?.url),
              captureUrl: sourceUrlPredicate,
            };
      const recorder = await startCdpResponseRecorder(page, capture);
      let measurementFailure = null;
      let settled;
      try {
        settled = await completeCapturedShadowAssetColdPage({
          measure: () =>
            withTimeout(
              page.evaluate(() => globalThis.__RIFTY_SHADOW_ASSET_COLD__.measure()),
              `${label} page operation`,
              MEASURE_TIMEOUT_MS,
            ),
          stopRecorder: () => recorder.stop({ settleTimeoutMs: SOURCE_TERMINAL_TIMEOUT_MS }),
          close: () =>
            withTimeout(
              page.evaluate(() => globalThis.__RIFTY_SHADOW_ASSET_COLD__.close()),
              `${label} page cleanup`,
              MEASURE_TIMEOUT_MS,
            ),
        });
      } catch (error) {
        measurementFailure = error;
      }
      try {
        selectionOracle.assertUsed();
      } catch (error) {
        measurementFailure =
          measurementFailure === null
            ? error
            : new AggregateError([measurementFailure, error], `${label} selection proof failed`);
      }
      if (measurementFailure !== null) throw measurementFailure;
      const { pageEvidence, captured, cleanup } = settled;
      if (pageErrors.length > 0) {
        throw new Error(`${label} page errors: ${pageErrors.join('; ')}`);
      }

      const expected = canonicalShadowAssetColdExpectation({
        catalog,
        lockfileText: pageEvidence.lockfileText,
      });
      let sourceResponses;
      if (mode === 'standard') {
        const source = finalizeStandardAssetSourceResponses({
          registryUrl,
          source: expected.source,
          captured,
        });
        if (!source.ok) {
          throw new Error(`${source.note}; ${describeCapturedResponseLedger(captured)}`);
        }
        sourceResponses = source.sourceResponses;
      } else {
        sourceResponses = captured;
      }
      const responseLabel = mode === 'eddy' ? 'captured candidate' : 'exact source';
      console.log(
        `  [shadow asset cold] ${label}: ${pageEvidence.progress.length} progress events, ${sourceResponses.length} ${responseLabel} response(s)`,
      );
      const { lockfileText: _lockfileText, ...evidence } = pageEvidence;
      const raw = {
        ...evidence,
        cleanup,
        expected,
        sourceResponses,
        ...(mode === 'eddy'
          ? {
              endpoints: { registryUrl, resolverUrl, bundleUrl },
              shadowSourceCacheRegime: 'fresh-owner-empty-tarball-cache',
            }
          : {}),
      };
      const proof =
        mode === 'eddy' ? buildEddyShadowAssetColdRun(raw) : buildStandardShadowAssetColdRun(raw);
      if (!proof.ok) {
        throw new Error(`${proof.note}; ${describeCapturedResponseLedger(captured)}`);
      }
      return raw;
    },
    async close() {
      if (context === undefined) return;
      let failure = null;
      try {
        if (page !== undefined) {
          await withTimeout(
            page.evaluate(() => globalThis.__RIFTY_SHADOW_ASSET_COLD__.close()),
            `${label} page cleanup`,
            MEASURE_TIMEOUT_MS,
          );
        }
      } catch (error) {
        failure = error;
      }
      try {
        await context.close();
      } catch (error) {
        failure =
          failure === null
            ? error
            : new AggregateError([failure, error], `${label} context cleanup failed`);
      } finally {
        context = undefined;
        page = undefined;
      }
      if (failure !== null) throw failure;
    },
  };
}

async function runPackedShadowAssetCold({
  mode,
  browser,
  hostOrigin,
  registryUrl: registryUrlInput,
  resolverUrl: resolverUrlInput,
  bundleUrl: bundleUrlInput,
  catalog,
}) {
  if (browser === null || typeof browser !== 'object' || typeof browser.newContext !== 'function') {
    throw new TypeError('cold benchmark requires a Playwright browser');
  }
  if (catalog === null || typeof catalog !== 'object') {
    throw new TypeError('cold benchmark requires the canonical catalog');
  }
  const host = absoluteHttpUrl(hostOrigin, 'packed host origin');
  const registry = absoluteHttpUrl(registryUrlInput, 'registry URL');
  const resolver =
    mode === 'eddy' ? absoluteHttpUrl(resolverUrlInput, 'Eddy resolver URL') : undefined;
  const bundle = mode === 'eddy' ? absoluteHttpUrl(bundleUrlInput, 'Eddy bundle URL') : undefined;
  const hostUrl = new URL('/shadow-asset-cold.html', host).href;
  const catalogAsset = catalog.assets?.find(
    (asset) => asset?.source?.name === 'esbuild-wasm' && asset?.source?.version === '0.28.0',
  );
  if (catalogAsset === undefined) {
    throw new Error('cold benchmark catalog lacks esbuild-wasm@0.28.0');
  }
  const registryUrl = registry.href.replace(/\/$/u, '');
  const resolverUrl = resolver?.href.replace(/\/$/u, '');
  const bundleUrl = bundle?.href.replace(/\/$/u, '');
  const result = await runShadowAssetColdContexts({
    mode,
    createContext: async (iteration) =>
      createMeasuredContext({
        browser,
        hostUrl,
        mode,
        registryUrl,
        resolverUrl,
        bundleUrl,
        catalog,
        catalogAsset,
        label: iteration.kind === 'warmup' ? 'warm-up (discarded)' : `run ${iteration.index + 1}/5`,
      }),
    buildRun: mode === 'eddy' ? buildEddyShadowAssetColdRun : buildStandardShadowAssetColdRun,
  });
  if (result.status !== 'measured') return result;
  return {
    status: 'measured',
    registryUrl,
    ...(mode === 'eddy' ? { resolverUrl, bundleUrl } : {}),
    cacheRegime: CACHE_REGIME,
    runs: result.runs,
  };
}

/** Run one discarded warm-up + five measured STD contexts against a packed host. */
export function runPackedStandardShadowAssetCold(input) {
  return runPackedShadowAssetCold({ mode: 'standard', ...input });
}

/** Run one discarded warm-up + five measured Eddy contexts against a packed host. */
export function runPackedEddyShadowAssetCold(input) {
  return runPackedShadowAssetCold({ mode: 'eddy', ...input });
}

export function describeShadowAssetColdFailure(error) {
  return errorMessage(error);
}
