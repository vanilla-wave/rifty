import { isDocumentationOnlyPath } from './ci-change-scope.mjs';

// Product roots incl. the published tools/shadow-registry package; every shipped file counts
// (source, wasm, html, assets) — documentation basenames and test support do not.
const PRODUCTION_ROOT_RE = /^(?:apps|packages|services|tools\/shadow-registry)\//u;
const SOURCE_EXTENSION_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/u;
const TEST_SUPPORT_PATH_RE =
  /(?:^|\/)(?:__tests__|tests?|fixtures|_test-fixtures|test-fixtures)(?:\/|$)|(?:^|\/)[^/]+\.(?:test|spec|test-fixture|contract-fixtures)\.[^/]+$/u;
const TEST_SUPPORT_SOURCE_BASENAME_RE = /(?:^|\/)(?:test-[^/]+|[^/]+-test-fixture)\.[^/]+$/u;

/**
 * Autonomous-run path boundary shared by drift and budget checks.
 * @returns {'production'|'test-support'|'other'}
 */
export function classifyAutonomousRunPath(path) {
  if (TEST_SUPPORT_PATH_RE.test(path)) return 'test-support';
  const sourceExtension = SOURCE_EXTENSION_RE.test(path);
  if (sourceExtension && TEST_SUPPORT_SOURCE_BASENAME_RE.test(path)) return 'test-support';
  if (PRODUCTION_ROOT_RE.test(path) && !isDocumentationOnlyPath(path)) return 'production';
  return 'other';
}
