import type {
  SandboxSupportCheck,
  SandboxSupportCheckId,
  SandboxSupportMode,
  SandboxSupportOptions,
} from './types.ts';

export const CHECK_IDS: readonly SandboxSupportCheckId[] = [
  'window',
  'secure-context',
  'cross-origin-isolated',
  'crypto',
  'page-locks',
  'module-worker',
  'module-import',
  'nested-worker',
  'message-port',
  'broadcast-channel',
  'js-eval',
  'wasm',
  'shared-memory',
  'opfs',
  'service-worker-api',
  'service-worker-registration',
  'service-worker-module-registration',
  'deployment-control',
];

export function failure(id: SandboxSupportCheckId, error: unknown): SandboxSupportCheck {
  const detail =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : { name: 'Error', message: String(error) };
  return {
    id,
    status: 'failed',
    reason: `${id}: ${detail.name}: ${detail.message || 'cause unknown'}`,
    error: detail,
  };
}

/** Existing compositions, not a replacement admission policy (ADR-0437). */
export function modes(checks: readonly SandboxSupportCheck[], options: SandboxSupportOptions) {
  const basic: SandboxSupportCheckId[] = [
    'window',
    'secure-context',
    'crypto',
    'module-worker',
    'module-import',
    'message-port',
    'js-eval',
  ];
  if (options.persistence === 'required') basic.push('opfs');
  const coi: SandboxSupportCheckId[] = [
    ...basic,
    'cross-origin-isolated',
    'page-locks',
    'nested-worker',
    'broadcast-channel',
    'shared-memory',
    'wasm',
    'service-worker-api',
    'service-worker-registration',
  ];
  const nonCoi: SandboxSupportCheckId[] = [...basic];
  if (options.nonCoiVmEngine === 'quickjs' || options.wasm) nonCoi.push('wasm');
  const summarize = (
    composition: SandboxSupportMode['composition'],
    required: SandboxSupportCheckId[],
  ): SandboxSupportMode => {
    const unmet = checks.filter(
      (check) => required.includes(check.id) && check.status !== 'passed',
    );
    const optional =
      composition === 'openWorkbench'
        ? ['opfs']
        : [
            'opfs',
            'wasm',
            'broadcast-channel',
            'service-worker-api',
            'service-worker-module-registration',
          ];
    return Object.freeze({
      composition,
      conclusion: unmet.some((check) => check.status === 'failed')
        ? 'unsupported'
        : unmet.length > 0
          ? 'inconclusive'
          : 'supported',
      required: Object.freeze(required),
      reasons: Object.freeze(unmet.map((check) => check.reason)),
      limitations: Object.freeze(
        checks
          .filter(
            (check) =>
              optional.includes(check.id) &&
              !required.includes(check.id) &&
              check.status !== 'passed' &&
              check.status !== 'not-applicable',
          )
          .map((check) => check.reason),
      ),
    });
  };
  return Object.freeze({
    coi: summarize('openWorkbench', coi),
    nonCoi: summarize('sdk-toolchain', nonCoi),
  });
}
