import { createNodeProcessRelease } from './process-identity.ts';

/**
 * Node's own brand: own `Symbol.toStringTag` = 'process' (non-enumerable,
 * non-configurable) → `String(process) === '[object process]'`, read by
 * brand-based Node detectors (pdfjs-dist `isNodeJS`). Compatibility identity
 * like `release.name`, not an OS claim (ADR-0345).
 */
export function defineNodeProcessBrand(process: object): void {
  Object.defineProperty(process, Symbol.toStringTag, {
    value: 'process',
    writable: true,
    enumerable: false,
    configurable: false,
  });
}

/** A `NodeProcess`'s own identity descriptors: a fresh `release` + the brand (ADR-0345). */
export function defineNodeProcessOwnIdentity(process: object): void {
  Object.defineProperty(process, 'release', {
    value: createNodeProcessRelease(),
    writable: false,
    enumerable: true,
    configurable: true,
  });
  defineNodeProcessBrand(process);
}
