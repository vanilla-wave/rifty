import type * as linker from './linker.ts';

type Preflight = (
  current: readonly linker.PackageBinSource[],
  prior?: readonly linker.PackageBinSource[],
) => readonly linker.PackageBinClaim[];
type SourceLike = linker.PackageBinSource | linker.ResolvedPackage | linker.PackageBinClaim;
type MissingPreflight = (
  current: readonly SourceLike[],
  prior?: readonly SourceLike[],
) => readonly linker.PackageBinClaim[];
type ExportOr<TFallback> = typeof linker extends { preflightPackageBins: infer TExport }
  ? Extract<TExport, (...args: never[]) => unknown>
  : TFallback;
type PreflightExport = ExportOr<MissingPreflight>;
type SignatureExport = ExportOr<Preflight>;
type Same<TLeft, TRight> = (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight
  ? 1
  : 2
  ? true
  : false;

declare const preflight: PreflightExport;
declare const prepared: linker.PreparedInstallPackage;
declare const narrow: linker.PackageBinSource;
declare const raw: linker.ResolvedPackage;
declare const claim: linker.PackageBinClaim;

const exactSignature: Same<SignatureExport, Preflight> = true;
const exact: Preflight = preflight;
const claims: readonly linker.PackageBinClaim[] = exact(
  [prepared, narrow] as const,
  [narrow, prepared] as const,
);
exact([narrow] as const);
// @ts-expect-error Contract: the current source list is required.
preflight();
// @ts-expect-error Contract: no third source list or overload is admitted.
preflight([narrow], [narrow], [narrow]);
// @ts-expect-error Contract: raw resolved packages are not current bin sources.
preflight([narrow, raw]);
// @ts-expect-error Contract: shaped output claims are not current bin sources.
preflight([narrow, claim]);
// @ts-expect-error Contract: raw resolved packages are not prior bin sources.
preflight([narrow], [narrow, raw]);
// @ts-expect-error Contract: shaped output claims are not prior bin sources.
preflight([narrow], [narrow, claim]);
void [claims, exactSignature];
