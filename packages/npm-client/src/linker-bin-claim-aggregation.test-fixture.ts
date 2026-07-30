import type * as linker from './linker.ts';
type Normalizer = (
  sources: readonly linker.PackageBinSource[],
) => readonly linker.PackageBinClaim[];
type MissingNormalizer = (
  sources: readonly (linker.PackageBinSource | linker.ResolvedPackage | linker.PackageBinClaim)[],
) => readonly linker.PackageBinClaim[];
type ExportOr<TFallback> = typeof linker extends { normalizePackageBinSources: infer TExport }
  ? Extract<TExport, (...args: never[]) => unknown>
  : TFallback;
type NormalizeExport = ExportOr<MissingNormalizer>;
type SignatureExport = ExportOr<Normalizer>;
type Same<TLeft, TRight> = (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight
  ? 1
  : 2
  ? true
  : false;
declare const normalize: NormalizeExport;
declare const prepared: linker.PreparedInstallPackage;
declare const narrow: linker.PackageBinSource;
declare const raw: linker.ResolvedPackage;
declare const claim: linker.PackageBinClaim;
const exactSignature: Same<SignatureExport, Normalizer> = true;
const exact: Normalizer = normalize;
const claims: readonly linker.PackageBinClaim[] = exact([prepared, narrow, narrow] as const);
exact([] as const);
// @ts-expect-error Contract: exactly one source list is required.
normalize();
// @ts-expect-error Contract: a source must be wrapped in the source list.
normalize(narrow);
// @ts-expect-error Contract: prepared packages must be wrapped in the source list.
normalize(prepared);
// @ts-expect-error Contract: one source list; no prior or settlement argument.
normalize([narrow], [narrow]);
// @ts-expect-error Contract: no second prepared source list.
normalize([narrow], [prepared]);
// @ts-expect-error Contract: raw resolved-package lists are not bin sources.
normalize([raw]);
// @ts-expect-error Contract: shaped output-claim lists are not bin sources.
normalize([claim]);
void [claims, exactSignature];
