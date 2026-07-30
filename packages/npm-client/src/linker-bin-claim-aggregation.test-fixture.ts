import type * as linker from './linker.ts';
type Normalizer = (
  sources: readonly linker.PackageBinSource[],
) => readonly linker.PackageBinClaim[];
type MissingNormalizer = (
  sources: readonly (linker.PackageBinSource | linker.ResolvedPackage | linker.PackageBinClaim)[],
) => readonly linker.PackageBinClaim[];
type NormalizeExport = typeof linker extends { normalizePackageBinSources: infer TExport }
  ? Extract<TExport, (...args: never[]) => unknown>
  : MissingNormalizer;
declare const normalize: NormalizeExport;
declare const prepared: linker.PreparedInstallPackage;
declare const narrow: linker.PackageBinSource;
declare const raw: linker.ResolvedPackage;
declare const claim: linker.PackageBinClaim;
const exact: Normalizer = normalize;
const claims: readonly linker.PackageBinClaim[] = exact([prepared, narrow, narrow] as const);
exact([] as const);
// @ts-expect-error Contract: raw resolved-package lists are not bin sources.
normalize([raw]);
// @ts-expect-error Contract: shaped output-claim lists are not bin sources.
normalize([claim]);
void claims;
